/**
 * dsh-memhub · 第 10 期：janitor（容量上限 / 淘汰 / 去重合并 / 维护前快照）
 *
 * 口径来自 ROADMAP Step 3：
 *  - **写入永不拒绝**：超上限时淘汰「最低权重 + 最老」；
 *  - 淘汰 = 只把 sidecar 标 `archived`（可恢复），**orb 原件不删、不搬**；
 *  - `protected` 不参与淘汰：archived / evergreen（公共区，含旧栈 `scope: global`）/
 *    pinned / core / working（working 是按需层，清掉等于悄悄丢项目记忆）；
 *  - 去重：**全文** bigram Jaccard ≥ 阈值（默认 0.82）且两边正文都 ≥ 60 字、长度差 ≤30%
 *    → 保留权重高者、权重 `min(9, a + b*0.3)`、另一条归档，合并记录写 `archive.jsonl`；
 *  - 任何写盘前先快照（orbs / recall / graph / 公共区 orbs），保留 3 份，可 restore；
 *    restore 前**再快照一次并保护要恢复的那份**（否则安全快照的 prune 会把它吃掉）。
 *
 * 盲审（REVIEW-janitor.md，2026-11-09）修掉的点：
 *  - P0：restore 的 prune 会删掉自己要恢复的快照 → 现在 prune 排除 source + 二次校验 + 空恢复报错
 *  - S-1：快照按 manifest.at 排序（不再按 id 字典序，`pre-restore-*` 不会永远算「最新」）
 *  - S-2：同轮被去重保下来的条目不再进淘汰候选
 *  - S-3：相似度用全文（原来只看前 300 字，长条目尾部差异会被判 1.000）
 *  - S-7：restore 改两阶段提交（先全部拷到 tmp，再换入；失败回滚）
 *  - S-8：快照拷失败会清掉半成品目录，坏目录不占配额
 *  - S-9：manifest 记 dataRoot / sharedRoot，恢复时路径不一致直接拒绝（除非 force）
 *
 * shortcut: 去重是 O(n²) 两两比，启动自动治理已关掉去重（只算淘汰）；
 * 手工 --apply 在 1000 条量级约几秒，到几千条要换倒排索引。
 */
import fs from 'node:fs'
import path from 'node:path'
import { bigrams, jaccard } from './similarity.js'
import { applyArchive } from './govern.js'
import { backupWithStamp, writeAtomic } from './frontmatter.js'

export const DEFAULT_MAX_ORBS = 300
export const DEFAULT_DEDUPE_THRESHOLD = 0.82
/** 去重最小正文长度：太短的条目 bigram 相似度虚高（"甲 body" vs "乙 body" 能到 0.84）。 */
export const DEFAULT_DEDUPE_MIN_CHARS = 60
/** 长度差超过这个比例就不算重复（防「同开头、不同结尾」的长条目）。 */
export const DEFAULT_DEDUPE_MAX_LEN_RATIO = 0.3
export const SNAPSHOT_KEEP = 3
/** 容量缓冲：活跃数超过 maxOrbs × buffer 才动手，归档到 maxOrbs（防「每条新记忆都触发一次淘汰」）。 */
export const DEFAULT_ARCHIVE_BUFFER = 1.2

const ACTIVE = (sidecar) => !sidecar.archived && sidecar.status !== 'archived'
const TEXT_OF = (item) => `${item.title || ''} ${String(item.content || '')}`

/** 淘汰权重：importance × decay（decay 缺失按 1）。 */
export function weightOf(sidecar) {
  const importance = Number(sidecar.importance) || 3
  const decay = Number.isFinite(Number(sidecar.decay)) ? Number(sidecar.decay) : 1
  return importance * decay
}

/** 受保护：不参与淘汰。 */
export function isProtected(sidecar) {
  return Boolean(
    !ACTIVE(sidecar) ||
      sidecar.tier === 'core' ||
      sidecar.tier === 'working' ||
      sidecar.evergreen ||
      sidecar.pinned,
  )
}

/**
 * 去重计划（纯函数，只报不改）。用全文 + 长度差门限，避免「同开头不同结尾」被误判。
 * @returns {{a:object,b:object,score:number}[]}
 */
export function planDedupe(sidecars, options = {}) {
  const threshold = Number(options.threshold) > 0 ? Number(options.threshold) : DEFAULT_DEDUPE_THRESHOLD
  const minChars = Number(options.minChars) >= 0 ? Number(options.minChars) : DEFAULT_DEDUPE_MIN_CHARS
  const maxLenRatio =
    Number(options.maxLenRatio) >= 0 ? Number(options.maxLenRatio) : DEFAULT_DEDUPE_MAX_LEN_RATIO
  const textOf = options.textOf || TEXT_OF
  const items = sidecars
    .filter(ACTIVE)
    .map((sidecar) => ({ sidecar, text: String(textOf(sidecar)) }))
    .filter((item) => item.text.length >= minChars)
    .map((item) => ({ ...item, grams: bigrams(item.text) }))
  const pairs = []
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const left = items[i]
      const right = items[j]
      const longest = Math.max(left.text.length, right.text.length)
      if (longest > 0 && Math.abs(left.text.length - right.text.length) / longest > maxLenRatio) continue
      const score = jaccard(left.grams, right.grams)
      if (score >= threshold) pairs.push({ a: left.sidecar, b: right.sidecar, score })
    }
  }
  return pairs.sort((left, right) => right.score - left.score)
}

function pickKeep(pair) {
  const { a, b } = pair
  const weightDiff = weightOf(b) - weightOf(a)
  if (Math.abs(weightDiff) > 0.001) return weightDiff > 0 ? b : a
  return Number(b.updatedAt || 0) > Number(a.updatedAt || 0) ? b : a
}

/** 全库 janitor 计划（纯函数）：容量溢出 + 去重对。 */
export function planJanitor(sidecars, options = {}) {
  const maxOrbs = Number(options.maxOrbs) > 0 ? Math.max(1, Math.floor(Number(options.maxOrbs))) : DEFAULT_MAX_ORBS
  const buffer = Number(options.archiveBuffer) >= 1 ? Number(options.archiveBuffer) : DEFAULT_ARCHIVE_BUFFER
  const active = sidecars.filter(ACTIVE)
  // 去重（可关：启动自动治理只算淘汰，省 O(n²)）
  const dedupe =
    options.dedupe === false
      ? []
      : planDedupe(sidecars, {
          threshold: options.dedupeThreshold,
          minChars: options.dedupeMinChars,
          maxLenRatio: options.dedupeMaxLenRatio,
        }).map((pair) => {
          const keep = pickKeep(pair)
          const drop = keep === pair.a ? pair.b : pair.a
          return {
            keep: keep.id,
            drop: drop.id,
            score: Number(pair.score.toFixed(3)),
            dropProtected: isProtected(drop),
          }
        })
  // 先合并、再淘汰（R-3）：合并会让活跃数 -1，overflow 必须按合并后的集合算，
  // 否则名额压力会转嫁给「权重更高」的条目。drop 会被合并归档，不再进淘汰候选。
  const mergeDrops = new Set(dedupe.filter((pair) => !pair.dropProtected).map((pair) => pair.drop))
  const evictable = active.filter((item) => !isProtected(item) && !mergeDrops.has(item.id))
  const afterMerge = active.length - mergeDrops.size
  // 缓冲：只有超过上限 × buffer 才归档，且归档到上限，不是「一超就动」
  const overflow = afterMerge > maxOrbs * buffer ? Math.max(0, Math.floor(afterMerge - maxOrbs)) : 0
  const evict = [...evictable]
    .sort(
      (left, right) =>
        weightOf(left) - weightOf(right) || Number(left.updatedAt || 0) - Number(right.updatedAt || 0),
    )
    .slice(0, overflow)
    .map((item) => ({
      id: item.id,
      title: item.title,
      tier: item.tier,
      weight: Number(weightOf(item).toFixed(2)),
      updatedAt: item.updatedAt,
    }))
  return {
    total: sidecars.length,
    active: active.length,
    maxOrbs,
    overflow,
    evictable: evictable.length,
    evict,
    dedupe,
    // 溢出但可淘汰的不够（protected / 合并 keep 占满了上限）：计划照给，剩多少报多少
    capped: evict.length < overflow,
  }
}

// ── 快照 ────────────────────────────────────────────────────────────────

export function snapshotsRoot(dataRoot) {
  return path.join(dataRoot, 'snapshots')
}

function stampOf(now) {
  const iso = new Date(now).toISOString()
  return iso.slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
}

function snapshotDirs(dataRoot, sharedRoot) {
  const list = ['orbs', 'recall', 'graph'].map((name) => [name, path.join(dataRoot, name)])
  if (sharedRoot) list.push(['shared-orbs', path.join(sharedRoot, 'orbs')])
  return list
}

function readManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  } catch {
    return null
  }
}

/** 维护前快照：拷 orbs / recall / graph / 公共区 orbs，保留 keep 份（protect 的那份永远不动）。 */
export function createSnapshot(dataRoot, sharedRoot, options = {}) {
  const now = Number(options.now) || Date.now()
  const keep = Number(options.keep) > 0 ? Number(options.keep) : SNAPSHOT_KEEP
  const id = `${options.tag ? `${options.tag}-` : ''}${stampOf(now)}-${Math.random().toString(36).slice(2, 6)}`
  const dir = path.join(snapshotsRoot(dataRoot), id)
  fs.mkdirSync(dir, { recursive: true })
  const copied = []
  try {
    for (const [name, source] of snapshotDirs(dataRoot, sharedRoot)) {
      if (!fs.existsSync(source)) continue
      fs.cpSync(source, path.join(dir, name), { recursive: true })
      copied.push(name)
    }
    const manifest = {
      id,
      at: new Date(now).toISOString(),
      dataRoot: path.resolve(dataRoot),
      sharedRoot: sharedRoot ? path.resolve(sharedRoot) : null,
      copied,
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  } catch (error) {
    // 半成品快照（有目录没 manifest）既不能用又占配额：直接清掉
    fs.rmSync(dir, { recursive: true, force: true })
    throw error
  }
  pruneSnapshots(dataRoot, keep, options.protect)
  return { id, dir, copied }
}

export function listSnapshots(dataRoot) {
  const root = snapshotsRoot(dataRoot)
  if (!fs.existsSync(root)) return []
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(root, entry.name)
      const manifest = readManifest(dir)
      return { id: entry.name, at: manifest?.at || null, copied: manifest?.copied || [], manifest }
    })
    .filter((item) => item.manifest) // 没有 manifest 的坏快照不算数（不会被 restore，也不占配额）
    // 按 manifest.at 排序，不按目录名：pre-restore-* 的名字前缀会让字符排序误判新旧
    .sort((left, right) => String(left.at || left.id).localeCompare(String(right.at || right.id)))
}

/** 最近一份「普通」快照：`pre-restore-*` 是撤销用的，不算日常回滚点。 */
export function latestSnapshot(dataRoot) {
  const items = listSnapshots(dataRoot).filter((item) => !item.id.startsWith('pre-restore-'))
  return items[items.length - 1] || null
}

function pruneSnapshots(dataRoot, keep, protectId) {
  // 硬崩溃留下的无 manifest 目录：既不能用也不该占配额，直接清
  const root = snapshotsRoot(dataRoot)
  if (fs.existsSync(root)) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = path.join(root, entry.name)
      if (!readManifest(dir)) fs.rmSync(dir, { recursive: true, force: true })
    }
  }
  const items = listSnapshots(dataRoot)
  const protectedItem = protectId ? items.find((item) => item.id === protectId) : null
  const others = items.filter((item) => !protectedItem || item.id !== protectedItem.id)
  const allowed = Math.max(0, keep - (protectedItem ? 1 : 0))
  while (others.length > allowed) {
    const oldest = others.shift()
    fs.rmSync(path.join(snapshotsRoot(dataRoot), oldest.id), { recursive: true, force: true })
  }
}

/** 清掉同目录下旧的 `.pre-restore-*` 副本，只留最新一份。 */
function pruneAsides(targets) {
  for (const target of targets) {
    const dir = path.dirname(target)
    const base = path.basename(target)
    let names = []
    try {
      names = fs.readdirSync(dir).filter((name) => name.startsWith(`${base}.pre-restore-`)).sort()
    } catch {
      continue
    }
    while (names.length > 1) {
      fs.rmSync(path.join(dir, names.shift()), { recursive: true, force: true })
    }
  }
}

/**
 * 恢复快照：两阶段提交（先全部拷到 tmp，再换入；失败回滚）。
 * 恢复前先快照当前状态，并**保护要恢复的那份**（P0：否则安全快照的 prune 会把它吃掉）。
 */
export function restoreSnapshot(dataRoot, sharedRoot, id, options = {}) {
  const source = path.join(snapshotsRoot(dataRoot), String(id))
  const manifestPath = path.join(source, 'manifest.json')
  const manifest = readManifest(source)
  if (!manifest) throw new Error(`没有这个快照：${id}`)
  if (
    manifest.sharedRoot &&
    sharedRoot &&
    path.resolve(manifest.sharedRoot) !== path.resolve(sharedRoot) &&
    !options.force
  ) {
    throw new Error(
      `快照记录的公共区是 ${manifest.sharedRoot}，当前给的是 ${sharedRoot}；确认要盖过去请加 --force`,
    )
  }
  const safety = createSnapshot(dataRoot, sharedRoot, {
    tag: 'pre-restore',
    now: options.now,
    keep: (Number(options.snapshotKeep) > 0 ? Number(options.snapshotKeep) : SNAPSHOT_KEEP) + 2,
    protect: id,
  })
  // 二次校验：prune 有 protect，理论上还在；万一被并发删掉就别静默跳过
  if (!fs.existsSync(manifestPath)) throw new Error(`快照在恢复前被清掉了：${id}`)

  const now = Number(options.now) || Date.now()
  const plan = []
  const stamp = stampOf(now)
  try {
    for (const [name, target] of snapshotDirs(dataRoot, sharedRoot)) {
      const from = path.join(source, name)
      if (!fs.existsSync(from)) continue
      const tmp = `${target}.restore-tmp-${stamp}-${Math.random().toString(36).slice(2, 6)}`
      fs.cpSync(from, tmp, { recursive: true })
      plan.push({ name, target, tmp })
    }
  } catch (error) {
    for (const item of plan) fs.rmSync(item.tmp, { recursive: true, force: true })
    throw error
  }
  if (plan.length === 0) throw new Error(`快照里没有任何可恢复目录：${id}`)

  const done = []
  try {
    for (const item of plan) {
      let aside = null
      if (fs.existsSync(item.target)) {
        aside = `${item.target}.pre-restore-${stamp}-${Math.random().toString(36).slice(2, 6)}`
        fs.renameSync(item.target, aside)
      }
      // 先记账再换入：换入失败时回滚循环必须能看到这一项（否则该组件消失）
      done.push({ ...item, aside })
      fs.renameSync(item.tmp, item.target)
    }
  } catch (error) {
    // 回滚已换入的目录：把 aside 换回来，tmp 清掉，别留下「orbs 消失」的现场
    for (const item of done.reverse()) {
      try {
        fs.rmSync(item.target, { recursive: true, force: true })
        if (item.aside) fs.renameSync(item.aside, item.target)
      } catch {
        /* 回滚尽力而为 */
      }
    }
    for (const item of plan) fs.rmSync(item.tmp, { recursive: true, force: true })
    throw error
  }
  pruneAsides(plan.map((item) => item.target))
  return {
    id,
    restored: plan.map((item) => item.name),
    safety: safety.id,
    dir: source,
  }
}

// ── 执行 ────────────────────────────────────────────────────────────────

/** 追加 JSONL；返回是否写成功（日志断了要让调用方看得见，不能吞）。 */
function appendJsonLine(file, entry) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

function readSidecar(sidecarDir, id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(sidecarDir, `${id}.json`), 'utf8'))
  } catch {
    return null
  }
}

/** 把合并后的 importance 写回 orb 原件 + sidecar（内容不动）。返回 {ok, reason}。 */
function bumpImportance(orbPath, sidecarDir, id, importance) {
  const sidecar = readSidecar(sidecarDir, id)
  if (!sidecar) return { ok: false, reason: 'sidecar 缺失' }
  if (!orbPath || !fs.existsSync(orbPath)) {
    // 只改 sidecar 会在下次 rebuild 被 orb 覆盖 → 权重蒸发；宁可算失败
    return { ok: false, reason: 'orb 原件找不到' }
  }
  const text = fs.readFileSync(orbPath, 'utf8')
  const current = Number(/^importance:\s*([\d.]+)$/m.exec(text)?.[1])
  // 已经到 9（合并上限）时不用再写：不能当成「字段缺失」失败，否则重复对永远清不掉
  if (Number.isFinite(current) && current >= importance) {
    sidecar.importance = current
    writeAtomic(path.join(sidecarDir, `${id}.json`), JSON.stringify(sidecar, null, 2))
    return { ok: true, reason: '权重已到上限' }
  }
  const next = text.replace(/^importance:.*$/m, `importance: ${importance}`)
  if (next === text) return { ok: false, reason: 'orb 里没有 importance 字段' }
  backupWithStamp(orbPath, 3)
  writeAtomic(orbPath, next)
  sidecar.importance = importance
  writeAtomic(path.join(sidecarDir, `${id}.json`), JSON.stringify(sidecar, null, 2))
  return { ok: true }
}

/**
 * 执行 janitor。**任何写盘前先快照**。
 * @param {{dataRoot:string, sharedRoot:string, sidecarDir:string, sidecars:object[], options?:object, apply?:boolean, merge?:boolean, orbPathFor?:Function, now?:number}} input
 */
export function runJanitor(input) {
  const {
    dataRoot,
    sharedRoot,
    sidecarDir,
    sidecars,
    options = {},
    apply = false,
    merge = true, // 自动治理只淘汰不合并（合并要人看报告）
    orbPathFor,
    now = Date.now(),
  } = input
  const plan = planJanitor(sidecars, { ...options, dedupe: merge ? options.dedupe : false })
  const result = {
    plan,
    applied: false,
    snapshot: null,
    evicted: [],
    merged: [],
    skipped: [],
    logErrors: [],
  }
  const addLogError = (name) => {
    if (!result.logErrors.includes(name)) result.logErrors.push(name)
  }
  if (!apply) return result
  const pairs = merge ? plan.dedupe.filter((pair) => !pair.dropProtected) : []
  const needWork = plan.evict.length > 0 || pairs.length > 0
  if (!needWork) return result
  result.snapshot = createSnapshot(dataRoot, sharedRoot, { keep: options.snapshotKeep, now })
  const dropped = new Set()
  for (const pair of pairs) {
    if (dropped.has(pair.drop) || dropped.has(pair.keep)) {
      result.skipped.push({ id: pair.drop, reason: '连环合并已处理' })
      continue
    }
    const kept = readSidecar(sidecarDir, pair.keep)
    const gone = readSidecar(sidecarDir, pair.drop)
    if (!kept || !gone) {
      result.skipped.push({ id: pair.drop, reason: 'sidecar 缺失' })
      continue
    }
    if (kept.archived) {
      result.skipped.push({ id: pair.drop, reason: '保留方已归档' })
      continue
    }
    const mergedImportance = Math.min(9, Number(kept.importance || 3) + Number(gone.importance || 3) * 0.3)
    const orbPath = orbPathFor ? orbPathFor(kept) : null
    const bumped = bumpImportance(orbPath, sidecarDir, pair.keep, mergedImportance)
    if (!bumped.ok) {
      result.skipped.push({ id: pair.drop, reason: `权重写回失败：${bumped.reason}` })
      continue
    }
    try {
      applyArchive(sidecarDir, pair.drop, true)
      dropped.add(pair.drop)
      result.merged.push({ keep: pair.keep, drop: pair.drop, score: pair.score, importance: mergedImportance })
      if (
        !appendJsonLine(path.join(dataRoot, 'archive.jsonl'), {
          at: new Date(now).toISOString(),
          action: 'merge',
          keep: pair.keep,
          drop: pair.drop,
          score: pair.score,
          importance: mergedImportance,
        })
      ) {
        addLogError('archive.jsonl')
      }
    } catch (error) {
      result.skipped.push({ id: pair.drop, reason: String(error) })
    }
  }
  // 淘汰放在合并之后：合并会改变活跃数与权重，先合并才不会把名额压力转嫁给高权重条目
  for (const item of plan.evict) {
    try {
      applyArchive(sidecarDir, item.id, true)
      result.evicted.push(item.id)
      if (
        !appendJsonLine(path.join(dataRoot, 'janitor-log.jsonl'), {
          at: new Date(now).toISOString(),
          action: 'evict',
          id: item.id,
          weight: item.weight,
          tier: item.tier,
        })
      ) {
        addLogError('janitor-log.jsonl')
      }
    } catch (error) {
      result.skipped.push({ id: item.id, reason: String(error) })
    }
  }
  result.applied = result.evicted.length > 0 || result.merged.length > 0
  return result
}
