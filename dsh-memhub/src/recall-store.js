/**
 * dsh-memhub · 第 2 期：记忆存储（读 zzerx 库 + sidecar 分级）
 *
 * 边界：只读 zzerx 的记忆文件（~/.dsh/storages/memory/memories/*.json），
 * 扩展字段（tier / decay / recall / emotion）全部写进我们自己的 sidecar，
 * 不改 zzerx 一行、不迁数据。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeAtomic } from './frontmatter.js'

const DAY_MS = 86_400_000

/** 长期类 memory.kind（zzerx 的 kind 枚举：decision/fact/preference/project/user）。 */
export const LONG_KINDS = new Set(['decision', 'preference', 'project', 'user'])

/**
 * 四级分层 + 工作记忆（2026-11-08 按哥哥要求改）：
 *   core     永久不衰减（pinned / importance 5 且被召回 ≥3 次）
 *   long     前 180 天不衰减，之后半衰期 180 天
 *   mid      前 90 天不衰减，之后半衰期 90 天
 *   event    前 30 天不衰减，之后半衰期 30 天
 *   working  项目记忆：**不注入、不衰减**，干活时按需读（memhub_search / memhub_open）
 * 保护期内 decay 恒为 1——「刚记住的东西不该一开始就掉分」。
 */
export const GRACE_DAYS = { core: Infinity, long: 180, mid: 90, event: 30, working: Infinity }

/** 保护期之后的半衰期（天）；core 与 working 不衰减。 */
export const HALF_LIFE_DAYS = { core: Infinity, long: 180, mid: 90, event: 30, working: Infinity }

export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

/** zzerx 记忆库根目录（只读）。 */
export function zzerxRoot() {
  return path.join(dshHome(), 'storages', 'memory')
}

/** 我们的 sidecar 目录。 */
export function sidecarRoot() {
  return path.join(dshHome(), 'memhub', 'recall')
}

/** 读 zzerx 全部记忆（每文件 {"version":1,"record":{...}}）。 */
export function loadZzerxMemories(root = zzerxRoot()) {
  const dir = path.join(root, 'memories')
  const entries = []
  const errors = []
  let files = []
  try {
    files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
  } catch (error) {
    return { root, entries, errors: [{ file: dir, error: `记忆库不可读：${String(error)}` }] }
  }
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
      const record = raw && raw.record ? raw.record : raw
      if (!record || !record.id) {
        errors.push({ file, error: '缺少 id' })
        continue
      }
      entries.push(record)
    } catch (error) {
      errors.push({ file, error: String(error) })
    }
  }
  return { root, entries, errors }
}

/** 判定 tier：确定性规则，不调模型。 */
export function tierOf(record, recall = { count: 0 }) {
  if (record.pinned) return 'core'
  const importance = Number(record.importance) || 0
  const count = Number(recall.count) || 0
  if (importance >= 5 && count >= 3) return 'core'
  // 工作记忆：项目上下文，干活时按需读，不参与每轮注入、也不衰减
  if (record.working === true || record.scope === 'project') return 'working'
  const longKind = LONG_KINDS.has(String(record.kind))
  if (longKind && importance >= 4) return 'long' // 180 天保护
  if (longKind || importance >= 4) return 'mid' // 90 天保护
  return 'event' // 30 天保护
}

/** 时间衰减分：保护期内恒为 1，之后 0.5^(超期天数/半衰期)；core 恒 1。 */
export function decayScore(tier, updatedAt, now = Date.now()) {
  const halfLife = HALF_LIFE_DAYS[tier] ?? HALF_LIFE_DAYS.event
  if (!Number.isFinite(halfLife)) return 1
  const grace = Number.isFinite(GRACE_DAYS[tier]) ? GRACE_DAYS[tier] : GRACE_DAYS.event
  const days = Math.max(0, (now - Number(updatedAt || 0)) / DAY_MS)
  if (days <= grace) return 1
  return Math.pow(0.5, (days - grace) / halfLife)
}

/**
 * 休眠：淡了（decay 低）且近期没被想起 → **不自动注入**。
 * 和「冻结」（近期高频召回→免衰减，见 govern.isFrozen）是两个相反的概念，别混。
 * 工具照样查得到；查到一次就更新 recall.last → 自动醒（见 govern.recordRecall 的冷却）。
 */
export const DORMANT_DECAY = 0.3
export const DORMANT_IDLE_DAYS = 3

export function isDormant(sidecar, now = Date.now()) {
  if (sidecar.archived) return false
  if (sidecar.tier === 'core' || sidecar.pinned || sidecar.evergreen) return false
  if (Number(sidecar.decay) >= DORMANT_DECAY) return false
  const last = sidecar.recall?.last ? Date.parse(sidecar.recall.last) : 0
  if (Number.isFinite(last) && last > 0 && now - last <= DORMANT_IDLE_DAYS * DAY_MS) return false
  return true
}

/** 由 zzerx 记录 + 使用台账生成 sidecar 条目（纯函数，可单测）。 */
export function buildSidecars(records, usage = {}, now = Date.now()) {
  const sidecars = records.map((record) => {
    const recall = usage[record.id] || { count: 0, last: null }
    const tier = tierOf(record, recall)
    return {
      id: record.id,
      tier,
      status: record.archived ? 'archived' : tier === 'core' ? 'core' : 'active',
      decay: Number(decayScore(tier, record.updatedAt, now).toFixed(4)),
      recall,
      // 情绪色（规格 v3 L71/L74）：从记忆记录的 emotion 透传；老库没有就是 null（召回时不打标签）
      emotion: record.emotion ? String(record.emotion) : null,
      title: String(record.title || ''),
      summary: String(record.summary || ''),
      content: String(record.content || ''),
      kind: String(record.kind || ''),
      scope: String(record.scope || ''),
      projectPath: String(record.projectPath || ''),
      importance: Number(record.importance) || 0,
      updatedAt: Number(record.updatedAt) || 0,
      createdAt: Number(record.createdAt) || 0,
      source: String(record.source || ''),
      sessionId: String(record.sessionId || ''),
      pinned: Boolean(record.pinned),
      archived: Boolean(record.archived),
      // 旧栈的「公共区」是 scope: global；迁移前默认源下也得算 evergreen，否则会被淘汰
      evergreen: Boolean(record.evergreen) || record.scope === 'shared' || record.scope === 'global',
      // 工作记忆：项目上下文，不注入、不衰减，靠 memhub_search / memhub_open 按需读
      working: tier === 'working',
      // 取代关系：新记录 supersedes 旧记录（显式标注）；旧记录标 supersededBy，
      // 检索降权、注入排除——替代原来的「只能靠 archived 一刀切」。
      supersedes: Array.isArray(record.supersedes) ? record.supersedes : [],
      contradicts: Array.isArray(record.contradicts) ? record.contradicts : [],
      supersededBy: null,
      artifact: String(record.artifact || ''),
      artifactSha: String(record.artifactSha || ''),
    }
  })
  const byId = new Map(sidecars.map((sidecar) => [sidecar.id, sidecar]))
  // 按时间从旧到新应用，最新者胜（同一条被多条取代时以最新为准）
  for (const sidecar of [...sidecars].sort((a, b) => Number(a.updatedAt || 0) - Number(b.updatedAt || 0))) {
    for (const target of sidecar.supersedes) {
      const old = byId.get(target)
      if (old && old.id !== sidecar.id) old.supersededBy = sidecar.id
    }
  }
  return sidecars
}

/** 读已有 sidecar（id → sidecar），用于合并召回计数与归档标记。 */
export function readSidecarMap(dir) {
  const map = new Map()
  let files = []
  try {
    files = fs.readdirSync(dir).filter((name) => name.endsWith('.json'))
  } catch {
    return map
  }
  for (const file of files) {
    try {
      const sidecar = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
      if (sidecar?.id) map.set(sidecar.id, sidecar)
    } catch {
      /* 坏 sidecar 跳过 */
    }
  }
  return map
}

/** 合并旧 sidecar：保留 recall / archived / tierOverride（用户改过的主次不能被重建抹掉）。纯函数。 */
export function mergeSidecars(sidecars, previous = new Map()) {
  return sidecars.map((sidecar) => {
    const old = previous.get(sidecar.id)
    if (!old) return sidecar
    return {
      ...sidecar,
      recall: old.recall || sidecar.recall,
      archived: old.archived ?? sidecar.archived,
      status: old.archived ? 'archived' : sidecar.status,
      tier: old.tierOverride || sidecar.tier,
      tierOverride: old.tierOverride || null,
      // 情绪标签跟着走：源记录没带（老库）时保留 sidecar 上已有的，别在重建时丢掉
      emotion: sidecar.emotion || old.emotion || null,
    }
  })
}

/** 写 sidecar：先合并旧文件，再落盘。 */
export function writeSidecars(dir, sidecars) {
  fs.mkdirSync(dir, { recursive: true })
  const previous = readSidecarMap(dir)
  const merged = mergeSidecars(sidecars, previous)
  for (const sidecar of merged) {
    writeAtomic(path.join(dir, `${sidecar.id}.json`), JSON.stringify(sidecar, null, 2))
  }
  const lines = merged.map((sidecar) => JSON.stringify(sidecar))
  writeAtomic(path.join(dir, 'recall-index.jsonl'), `${lines.join('\n')}\n`)
  return { count: merged.length, dir, sidecars: merged }
}

/** 读一份 sidecar（不存在返回 null）。 */
export function readSidecar(id, dir = sidecarRoot()) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'))
  } catch {
    return null
  }
}

/** raw_documents 目录（L0 原文，跟 zzerx 一起活、一起没）。 */
export function rawDocumentsDir(root = zzerxRoot()) {
  return path.join(root, 'raw_documents')
}

/** 读 raw_documents，按 recordId 回链原文（L0 原文回读）。 */
export function loadRawDocuments(root = zzerxRoot()) {
  const dir = rawDocumentsDir(root)
  const docs = []
  let files = []
  try {
    files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
  } catch {
    return docs
  }
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
      const record = raw && raw.record ? raw.record : raw
      if (record) docs.push({ file, record })
    } catch {
      /* 坏文件跳过，不阻塞 */
    }
  }
  return docs
}

/**
 * 从 raw_documents 里找某条记忆的原文片段。
 * 返回：{file, text, record} ｜ {missingRoot: true, dir}（旧库目录不在，跟「没有原文」是两回事）｜ null
 */
export function findRawText(memoryId, docs = null) {
  const dir = rawDocumentsDir()
  if (docs === null) {
    if (!fs.existsSync(dir)) return { missingRoot: true, dir }
    docs = loadRawDocuments()
  }
  // 迁移后 orb 的 id 是 `m_<zzerx id>`，raw_documents 里记的是裸 id，两边都要试
  const wanted = new Set([String(memoryId), String(memoryId).replace(/^m_/, '')])
  for (const { file, record } of docs) {
    const recordIds = record.recordIds || record.record_ids || []
    if (Array.isArray(recordIds) && recordIds.some((id) => wanted.has(String(id)))) {
      const text = record.text || record.content || record.transcript || ''
      return { file, text: typeof text === 'string' ? text : JSON.stringify(text), record }
    }
  }
  return null
}
