#!/usr/bin/env node
/**
 * 迁移：zzerx 记忆 + fish 会话记忆 → memhub 自有 orb 存储。
 * 默认 dry-run（只统计不写）；--apply 才落盘。
 *
 * 分类规则：
 *   - 公共区（shared）：工程/通用决策与事实 → <sharedRoot>/orbs
 *   - 项目（project）：带 projectPath 的项目专属（审计/备忘录）→ <memhub>/orbs/projects/<slug>
 *   - 自我（self）：L:\DSH\DeepSeek 的自我记忆 → <memhub>/orbs/self
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadZzerxMemories, zzerxRoot } from '../src/recall-store.js'
import { migrateFromZzerx, migrateFromFish, loadOrbs, classifyOrb, fromZzerx } from '../src/orb-store.js'
import { DATA_ROOT, DSH_HOME, DEFAULT_SHARED_ROOT } from '../src/const.js'
import { similarity } from '../src/similarity.js'

const args = process.argv.slice(2)
function arg(name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const sharedRoot = arg('--shared', DEFAULT_SHARED_ROOT)
const apply = args.includes('--apply')

/**
 * 星图数据（entities / edges）也存在 zzerx 库，原脚本只搬记忆。
 * 卸掉 zzerx 前必须一起搬，否则星图页会静默变空（实测 82 实体 / 2013 边）。
 * 按文件名幂等：目标已存在就跳过，不覆盖本地新写的同名图。
 */
function migrateGraph({ apply, zzerx, dataRoot }) {
  const summary = { entities: 0, edges: 0, copied: 0, skipped: 0 }
  for (const name of ['entities', 'edges']) {
    const from = path.join(zzerx, name)
    const to = path.join(dataRoot, 'graph', name)
    let files = []
    try {
      files = fs.readdirSync(from).filter((file) => file.endsWith('.json'))
    } catch {
      continue // 目录不在 = 没图可搬
    }
    summary[name] = files.length
    if (!apply) continue
    fs.mkdirSync(to, { recursive: true })
    for (const file of files) {
      const target = path.join(to, file)
      if (fs.existsSync(target)) {
        summary.skipped += 1
        continue
      }
      fs.copyFileSync(path.join(from, file), target)
      summary.copied += 1
    }
  }
  return summary
}

const graphReport = migrateGraph({ apply, zzerx: zzerxRoot(), dataRoot: DATA_ROOT })
console.log(
  `星图：entities ${graphReport.entities} / edges ${graphReport.edges} → ${
    apply ? `复制 ${graphReport.copied}，跳过 ${graphReport.skipped}` : 'dry-run 未写入（--apply 才复制）'
  }`,
)

const { entries, errors } = loadZzerxMemories(zzerxRoot())

if (entries.length === 0) {
  const dir = path.join(zzerxRoot(), 'memories')
  const reason = fs.existsSync(dir) ? '库是空的' : `目录不存在（${dir}），zzerx 卸掉后不用再迁`
  console.log(`没有可迁移的 zzerx 记忆：${reason}`)
  process.exit(1)
}

if (!apply) {
  const byCategory = {}
  const byGroup = { shared: [], self: [], project: [] }
  for (const record of entries) {
    const category = classifyOrb(record)
    byCategory[category] = (byCategory[category] || 0) + 1
    byGroup[category].push(record)
  }

  // 疑似重复组：只报不改（B 的 dedupe 用 difflib 0.82，这里用 bigram 近似）
  // 阈值标定：B 的 difflib 0.82 ≈ 本实现的 bigram Jaccard 0.6（量纲不同，实测这份库最高只有 0.46）
  const THRESHOLD = Number(arg('--threshold', 0.6)) || 0.6
  const dups = []
  const notable = [] // ≥0.2：供人判断是「相关」还是「重复」
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = entries[i]
      const b = entries[j]
      const score = similarity(
        `${a.title} ${String(a.content || '').slice(0, 300)}`,
        `${b.title} ${String(b.content || '').slice(0, 300)}`,
      )
      if (score >= 0.2) notable.push({ a, b, score })
      if (score >= THRESHOLD) dups.push({ a, b, score })
    }
  }
  dups.sort((x, y) => y.score - x.score)
  notable.sort((x, y) => y.score - x.score)

  const stamp = new Date().toISOString().slice(0, 10)
  const reportFile = path.join(import.meta.dirname, '..', 'data', `migrate-dryrun-${stamp}.md`)
  fs.mkdirSync(path.dirname(reportFile), { recursive: true })
  const lines = [
    `# 迁移 dry-run 报告（${new Date().toISOString()}）`,
    '',
    `zzerx ${entries.length} 条，解析错误 ${errors.length}；source: \`${zzerxRoot()}\``,
    '',
    '## 分类',
    '',
    '| 分类 | 条数 | 会落到哪 |',
    '|---|---|---|',
    `| shared（公共区） | ${byCategory.shared || 0} | L:\\DSH\\shared\\memhub\\orbs |`,
    `| self（自我） | ${byCategory.self || 0} | ~/.dsh/memhub/orbs/self |`,
    `| project（项目） | ${byCategory.project || 0} | ~/.dsh/memhub/orbs/projects/<slug> |`,
    '',
  ]
  for (const [group, list] of Object.entries(byGroup)) {
    lines.push(`### ${group}（${list.length}）`, '')
    for (const record of list) {
      lines.push(
        `- \`${record.id}\` ｜ ${record.title || '（无标题）'}${record.projectPath ? ` ｜ ${record.projectPath}` : ''}`,
      )
    }
    lines.push('')
  }
  lines.push(`## 疑似重复组（阈值 ${THRESHOLD}，${dups.length} 组）`, '')
  if (dups.length === 0) lines.push('无。')
  for (const dup of dups) {
    lines.push(`- **${dup.score.toFixed(2)}**`)
    lines.push(`  - \`${dup.a.id}\` ${dup.a.title}`)
    lines.push(`  - \`${dup.b.id}\` ${dup.b.title}`)
  }
  lines.push('', '## 相似度 Top 5（≥0.2，供判断「相关」还是「重复」）', '')
  if (notable.length === 0) lines.push('无。')
  for (const pair of notable.slice(0, 5)) {
    lines.push(`- ${pair.score.toFixed(3)} ｜ ${pair.a.title} ／ ${pair.b.title}`)
  }
  lines.push('', '## 结论', '')
  const top = notable[0]?.score || 0
  lines.push(
    dups.length === 0
      ? `- 阈值 ${THRESHOLD} 下无重复；最高相似度只有 ${top.toFixed(3)}，属于「主题相关」不是「内容重复」。**可直接 --apply**。`
      : `- 有 ${dups.length} 组疑似重复（最高 ${top.toFixed(3)}），先人工确认再 --apply。`,
  )
  lines.push('- 命令：`node tools/migrate-memory.mjs --apply`')
  fs.writeFileSync(reportFile, `${lines.join('\n')}\n`, 'utf8')

  console.log(`dry-run（未写入）：zzerx ${entries.length} 条，解析错误 ${errors.length}`)
  console.log(`分类：${JSON.stringify(byCategory)}`)
  console.log(`疑似重复组：${dups.length} 组（阈值 ${THRESHOLD}；最高相似度 ${(notable[0]?.score || 0).toFixed(3)}）`)
  for (const dup of dups.slice(0, 5)) {
    console.log(`  ${dup.score.toFixed(2)} ｜ ${dup.a.title} ／ ${dup.b.title}`)
  }
  console.log(`完整报告：${reportFile}`)
  process.exit(0)
}

const zzerxReport = migrateFromZzerx(entries, DATA_ROOT, sharedRoot)
const fishReport = migrateFromFish(path.join(DSH_HOME, 'fish-memory'), DATA_ROOT, sharedRoot)

// 把旧 sidecar 的 recall/archived/tierOverride 复制到新 id（m_<id>），避免切源后「复活」已归档记忆
const { readSidecarMap } = await import('../src/recall-store.js')
const { writeAtomic } = await import('../src/frontmatter.js')
const sidecarDir = path.join(DSH_HOME, 'memhub', 'recall')
const oldSidecars = readSidecarMap(sidecarDir)
let movedSidecars = 0
for (const [id, old] of oldSidecars) {
  if (id.startsWith('m_')) continue
  const target = path.join(sidecarDir, `m_${id}.json`)
  if (fs.existsSync(target)) continue
  writeAtomic(target, JSON.stringify({ ...old, id: `m_${id}` }, null, 2))
  movedSidecars += 1
}
const orbs = loadOrbs(DATA_ROOT, sharedRoot)
console.log(`sidecar 状态迁移：${movedSidecars} 个（recall/archived/tierOverride）`)

console.log(`zzerx：total ${zzerxReport.total} / migrated ${zzerxReport.migrated} / skipped ${zzerxReport.skipped} / errors ${zzerxReport.errors.length}`)
console.log(`  byCategory：${JSON.stringify(zzerxReport.byCategory)}`)
console.log(`fish：total ${fishReport.total} / migrated ${fishReport.migrated} / skipped ${fishReport.skipped} / errors ${fishReport.errors.length}`)
console.log(`orbs 总量：${orbs.entries.length}（读取错误 ${orbs.errors.length}）`)
for (const error of [...zzerxReport.errors, ...fishReport.errors, ...orbs.errors].slice(0, 5)) console.log(`  - ${JSON.stringify(error)}`)
console.log(`\n下一步：在 profile 配置里把 recall.source 切成 "memhub"，并保持 zzerx 停用 30 天可回滚。`)
