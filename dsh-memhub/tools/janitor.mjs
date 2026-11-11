#!/usr/bin/env node
/**
 * janitor：容量上限 / 淘汰 / 去重合并 / 维护前快照。
 *
 * 默认 **dry-run**，只打印计划；`--apply` 才会动盘（动盘前先快照）。
 * 自动治理（宿主启动时）只做「超容量淘汰」；**去重合并必须走这个 CLI 人工确认**。
 *
 * 用法：
 *   node tools/janitor.mjs                     # 看计划（不写盘）
 *   node tools/janitor.mjs --apply             # 快照 → 淘汰 + 合并
 *   node tools/janitor.mjs --max 400           # 临时改上限跑计划
 *   node tools/janitor.mjs --list              # 看已有快照
 *   node tools/janitor.mjs --restore latest    # 恢复最近一份普通快照（不含 pre-restore-*）
 *   node tools/janitor.mjs --restore <id>      # 恢复指定快照
 *   node tools/janitor.mjs --restore <id> --force   # 公共区路径对不上时强制覆盖
 *   node tools/janitor.mjs --shared <目录>     # 公共区 orb 位置（测试用，默认 L:\DSH\shared\memhub）
 *
 * 注意：计划基于**本地 orb 库**；宿主若还在跑旧源（zzerx），CLI 的数字不代表宿主行为。
 */
import path from 'node:path'
import { loadOrbs, orbPathFor } from '../src/orb-store.js'
import { readSidecarMap, buildSidecars, mergeSidecars, writeSidecars, sidecarRoot } from '../src/recall-store.js'
import { runJanitor, listSnapshots, latestSnapshot, restoreSnapshot, DEFAULT_MAX_ORBS, DEFAULT_DEDUPE_THRESHOLD } from '../src/janitor.js'
import { DATA_ROOT, DEFAULT_SHARED_ROOT } from '../src/const.js'

const args = process.argv.slice(2)
const has = (flag) => args.includes(flag)
const isFlag = (value) => typeof value === 'string' && value.startsWith('--')

/** 取 flag 的值；下一个是别的 flag 就当没给（防 `--restore --shared` 把 flag 当 id）。 */
function valueOf(flag, fallback) {
  const index = args.indexOf(flag)
  if (index < 0) return fallback
  const value = args[index + 1]
  return value && !isFlag(value) ? value : fallback
}

/** 数字参数：非法直接退出，不静默回落默认值。 */
function numberOf(flag, fallback) {
  const raw = valueOf(flag, null)
  if (raw === null) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    console.error(`${flag} 需要一个数字，收到的是「${raw}」`)
    process.exit(2)
  }
  return value
}

function main() {
  const sharedRoot = valueOf('--shared', DEFAULT_SHARED_ROOT)
  const dataRoot = DATA_ROOT
  const sidecarDir = sidecarRoot()
  const maxOrbs = numberOf('--max', DEFAULT_MAX_ORBS)
  const threshold = numberOf('--threshold', DEFAULT_DEDUPE_THRESHOLD)
  const archiveBuffer = numberOf('--buffer', 1.2)

  const loadSidecars = () => {
    const { entries, errors } = loadOrbs(dataRoot, sharedRoot)
    const previous = readSidecarMap(sidecarDir)
    const usage = {}
    for (const [id, old] of previous) usage[id] = old.recall || { count: 0, last: null }
    return { sidecars: mergeSidecars(buildSidecars(entries, usage), previous), errors }
  }

  if (has('--list')) {
    const snapshots = listSnapshots(dataRoot)
    if (snapshots.length === 0) {
      console.log('还没有快照。')
    } else {
      for (const snapshot of snapshots) {
        const kind = snapshot.id.startsWith('pre-restore-') ? '（恢复前备份）' : ''
        console.log(`${snapshot.id}  ${snapshot.at || '?'}  [${snapshot.copied.join(' ')}]${kind}`)
      }
    }
    return
  }

  if (has('--restore')) {
    const wanted = valueOf('--restore', 'latest')
    const index = args.indexOf('--restore')
    const next = args[index + 1]
    if (next && isFlag(next)) console.log(`（--restore 后面没给 id，按 latest 处理）`)
    const snapshots = listSnapshots(dataRoot)
    // latest 只认普通快照：pre-restore-* 是「撤销上一次恢复」用的，得显式给 id
    const target = wanted === 'latest' ? latestSnapshot(dataRoot) : snapshots.find((item) => item.id === wanted)
    if (!target) {
      console.error(wanted === 'latest' ? '没有可恢复的普通快照（只有 pre-restore 备份）。' : `没有这个快照：${wanted}`)
      process.exit(1)
    }
    const result = restoreSnapshot(dataRoot, sharedRoot, target.id, { force: has('--force') })
    console.log(`已恢复快照 ${result.id}：${result.restored.join(' / ')}`)
    console.log(`公共区：${sharedRoot}`)
    console.log(`恢复前的状态另存为 ${result.safety}（不满意再 --restore ${result.safety}）`)
    console.log('提醒：archived 只存在 sidecar，orb 原件一直没动；恢复后宿主重启/重建缓存才会看到新状态。')
    return
  }

  const { sidecars, errors } = loadSidecars()
  const apply = has('--apply')
  // apply 之前先把 sidecar 落盘：runJanitor 靠 sidecar 文件做归档/合并（宿主平时也是这么做的）
  if (apply) writeSidecars(sidecarDir, sidecars)
  const result = runJanitor({
    dataRoot,
    sharedRoot,
    sidecarDir,
    sidecars,
    options: { maxOrbs, dedupeThreshold: threshold, archiveBuffer },
    apply,
    merge: true,
    orbPathFor: (record) => orbPathFor(record, dataRoot, sharedRoot),
  })
  const { plan } = result

  console.log(`orb 总数 ${plan.total} ｜ 活跃 ${plan.active} ｜ 上限 ${plan.maxOrbs} ｜ 可淘汰 ${plan.evictable}`)
  console.log(`超容量 ${plan.overflow} 条${plan.capped ? '（可淘汰的不够：protected 占满了上限）' : ''}`)
  if (plan.evict.length > 0) {
    console.log('淘汰候选（最低权重 + 最老）：')
    for (const item of plan.evict.slice(0, 20)) {
      console.log(`  - ${item.id}  ${item.tier}  权重 ${item.weight}  ${item.title || ''}`)
    }
    if (plan.evict.length > 20) console.log(`  …共 ${plan.evict.length} 条`)
  }
  if (plan.dedupe.length > 0) {
    console.log(`去重候选（全文相似度 ≥ ${threshold}）：`)
    for (const pair of plan.dedupe.slice(0, 20)) {
      console.log(`  - ${pair.keep} ← ${pair.drop}  ${pair.score}${pair.dropProtected ? '（受保护，跳过）' : ''}`)
    }
  } else {
    console.log('没有相似度达到阈值的重复条目。')
  }
  if (errors.length > 0) console.log(`⚠️ 有 ${errors.length} 个 orb 解析失败，先修再治理`)

  if (!apply) {
    console.log('\n这是 dry-run。确认后加 --apply（会先快照再动盘）。')
    return
  }
  console.log(
    `\n已执行：淘汰 ${result.evicted.length} 条 ｜ 合并 ${result.merged.length} 对 ｜ 跳过 ${result.skipped.length} 条`,
  )
  if (result.snapshot) {
    console.log(`快照：${result.snapshot.id}（${path.join(dataRoot, 'snapshots', result.snapshot.id)}）`)
  }
  if (result.skipped.length > 0) {
    const byReason = {}
    for (const item of result.skipped) byReason[item.reason] = (byReason[item.reason] || 0) + 1
    for (const [reason, count] of Object.entries(byReason)) console.log(`  跳过：${reason} × ${count}`)
  }
  if (result.logErrors.length > 0) {
    console.log(`⚠️ 日志写失败：${result.logErrors.join(' / ')}（审计链断了，检查磁盘权限）`)
  }
  if (result.evicted.length + result.merged.length === 0) console.log('没有需要动盘的东西。')
}

try {
  main()
} catch (error) {
  console.error(`janitor 失败：${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
