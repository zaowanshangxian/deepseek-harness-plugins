#!/usr/bin/env node
/**
 * memhub 体检（只读；不调模型、不写记忆）。
 *
 * 为什么有这个：旧的 `memory_audit.py` 读 `~/.dsh/storages/memory`（zzerx 旧库），
 * 迁移后每天还在量一个停用的库。这里直接量 memhub 自己的产物。
 *
 * 用法：
 *   node tools/health-report.mjs                # 打印 Markdown 到终端
 *   node tools/health-report.mjs --dupes        # 额外算重复对（O(n²)，140 条约 0.1s）
 *   node tools/health-report.mjs --write        # 写到 ~/.dsh/memhub/reports/health-<时间>.md
 *   node tools/health-report.mjs --json         # 机器可读
 *   node tools/health-report.mjs --max 300 --budget 280    # 覆盖上限/预算
 *
 * 退出码：有「严重」问题 → 2（计划任务可据此报警），否则 0。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { loadOrbs } from '../src/orb-store.js'
import { readSidecarMap, buildSidecars, mergeSidecars, sidecarRoot } from '../src/recall-store.js'
import { loadLessons } from '../src/lessons.js'
import { loadEntities, loadEdges } from '../src/graph.js'
import { listNotes } from '../src/selfnote.js'
import { listSnapshots, planDedupe, DEFAULT_MAX_ORBS } from '../src/janitor.js'
import { buildHealth, renderHealthMarkdown, SEVERE } from '../src/health.js'
import { DATA_ROOT, DEFAULT_SHARED_ROOT } from '../src/const.js'

const args = process.argv.slice(2)
const has = (flag) => args.includes(flag)
const valueOf = (flag, fallback) => {
  const index = args.indexOf(flag)
  const value = index >= 0 ? args[index + 1] : null
  return value && !value.startsWith('--') ? value : fallback
}
const numberOf = (flag, fallback) => {
  const raw = valueOf(flag, null)
  if (raw === null) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    console.error(`${flag} 需要数字，收到「${raw}」`)
    process.exit(2)
  }
  return value
}

function statOf(file) {
  try {
    const stat = fs.statSync(file)
    return { mtime: stat.mtimeMs, bytes: stat.size }
  } catch {
    return null
  }
}

function countFiles(dir, filter = () => true) {
  try {
    return fs.readdirSync(dir).filter(filter).length
  } catch {
    return 0
  }
}

function main() {
  const sharedRoot = valueOf('--shared', DEFAULT_SHARED_ROOT)
  const maxOrbs = numberOf('--max', DEFAULT_MAX_ORBS)
  const budgetChars = numberOf('--budget', 280)
  const sidecarDir = sidecarRoot()

  const { entries, errors } = loadOrbs(DATA_ROOT, sharedRoot)
  const previous = readSidecarMap(sidecarDir)
  const usage = {}
  for (const [id, old] of previous) usage[id] = old.recall || { count: 0, last: null }
  const sidecars = mergeSidecars(buildSidecars(entries, usage), previous)
  const selfCheck = statOf(path.join(DATA_ROOT, 'self-check.json'))
  const selfCheckData = selfCheck ? JSON.parse(fs.readFileSync(path.join(DATA_ROOT, 'self-check.json'), 'utf8')) : null
  const indexFile = statOf(path.join(DATA_ROOT, 'INDEX.md'))
  const lessons = loadLessons(sharedRoot).items.length
  const diary = countFiles(path.join(sharedRoot, 'diary'), (name) => name.endsWith('.md'))
  const notes = listNotes(DATA_ROOT)
  const entities = loadEntities(path.join(DATA_ROOT, 'graph'))
  const edges = loadEdges(path.join(DATA_ROOT, 'graph'))
  const snapshots = listSnapshots(DATA_ROOT)
  // 产物指纹：算一次当前 sha256，跟记忆里存的比
  const artifactStats = { checked: 0, stale: 0, missing: 0 }
  for (const sidecar of sidecars) {
    // 归档条目不参与：它的产物文件可能已经清理，报警没有意义
    if (sidecar.archived || sidecar.status === 'archived') continue
    if (!sidecar.artifact || !sidecar.artifactSha) continue
    artifactStats.checked += 1
    try {
      const current = createHash('sha256').update(fs.readFileSync(sidecar.artifact)).digest('hex')
      if (current !== sidecar.artifactSha) artifactStats.stale += 1
    } catch {
      artifactStats.missing += 1
    }
  }
  const duplicates = has('--dupes')
    ? planDedupe(sidecars, { threshold: numberOf('--threshold', 0.82) }).length
    : null

  const report = buildHealth({
    sidecars,
    maxOrbs,
    budgetChars,
    workspace: process.cwd(),
    skills: selfCheckData?.skills ?? null,
    memoryErrors: errors.length + Number(selfCheckData?.memoryErrors || 0),
    recallSource: selfCheckData?.recallSource || 'memhub',
    selfCheck,
    indexFile,
    snapshots,
    duplicates,
    lessons,
    diary,
    selfNotes: { active: notes.active.length, archived: notes.archived.length },
    graph: { entities: entities.length, edges: edges.length },
    artifacts: artifactStats,
  })

  if (has('--json')) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    const markdown = renderHealthMarkdown(report)
    if (has('--write')) {
      const dir = path.join(DATA_ROOT, 'reports')
      fs.mkdirSync(dir, { recursive: true })
      const stamp = (report.localTime || '').replace(/[-: ]/g, '')
      const file = path.join(dir, `health-${stamp}.md`)
      fs.writeFileSync(file, markdown, 'utf8')
      console.log(`已写入 ${file}`)
      console.log(
        `摘要：${report.totals.active} 活跃 / ${report.totals.archived} 归档 ｜ 注入 ${report.injection.chars}/${report.injection.budget} 字符 ｜ 问题 ${report.issues.length} 条`,
      )
    } else {
      console.log(markdown)
    }
  }
  const severe = report.issues.filter((issue) => issue.level === SEVERE).length
  if (severe > 0) process.exit(2)
}

try {
  main()
} catch (error) {
  console.error(`体检失败：${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
