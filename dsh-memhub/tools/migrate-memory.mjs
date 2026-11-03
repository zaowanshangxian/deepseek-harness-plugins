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

const args = process.argv.slice(2)
function arg(name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const sharedRoot = arg('--shared', DEFAULT_SHARED_ROOT)
const apply = args.includes('--apply')
const { entries, errors } = loadZzerxMemories(zzerxRoot())

if (entries.length === 0) {
  console.log(`没有可迁移的 zzerx 记忆（source: ${zzerxRoot()}）`)
  process.exit(1)
}

if (!apply) {
  const byCategory = {}
  const sample = []
  for (const record of entries) {
    const category = classifyOrb(record)
    byCategory[category] = (byCategory[category] || 0) + 1
    if (sample.length < 3) sample.push(fromZzerx(record))
  }
  console.log(`dry-run（未写入）：zzerx ${entries.length} 条，解析错误 ${errors.length}`)
  console.log(`分类：${JSON.stringify(byCategory)}`)
  for (const orb of sample) {
    console.log(`  - ${orb.id} ｜ ${orb.scope} ｜ ${orb.title} ｜ ${orb.projectPath || '（无项目）'}`)
  }
  console.log(`确认后：node tools/migrate-memory.mjs --apply`)
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
