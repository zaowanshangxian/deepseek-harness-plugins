/**
 * dsh-memhub · 第 2 期自测（零依赖）：node tests/recall-check.mjs
 * 只测纯逻辑（recall-store / recall-scheduler），不 import host.js。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  loadZzerxMemories,
  buildSidecars,
  writeSidecars,
  readSidecar,
  tierOf,
  decayScore,
  findRawText,
  zzerxRoot,
} from '../src/recall-store.js'
import { buildRecallBlock, DEFAULT_BUDGET_CHARS } from '../src/recall-scheduler.js'

const failures = []
let total = 0
function ok(condition, label) {
  total += 1
  if (condition) console.log(`PASS  ${label}`)
  else {
    console.log(`FAIL  ${label}`)
    failures.push(label)
  }
}

const { entries, errors } = loadZzerxMemories()
ok(errors.length === 0, `zzerx 记忆库无解析错误（errors=${errors.length}）`)
ok(entries.length > 0, `读到记忆条目（${entries.length}）`)

const sidecars = buildSidecars(entries)
const tiers = sidecars.reduce((acc, item) => {
  acc[item.tier] = (acc[item.tier] || 0) + 1
  return acc
}, {})
ok(
  sidecars.length === entries.length && Object.values(tiers).reduce((a, b) => a + b, 0) === sidecars.length,
  `sidecar 覆盖全部条目（${JSON.stringify(tiers)}）`,
)

ok(tierOf({ pinned: true, importance: 2 }, { count: 0 }) === 'core', 'pinned → core')
ok(
  tierOf({ kind: 'decision', importance: 5 }, { count: 0 }) === 'long',
  'decision/importance5 但未达 recall≥3 → long',
)
ok(tierOf({ kind: 'decision', importance: 5 }, { count: 3 }) === 'core', 'importance5 且 recall≥3 → core')
ok(tierOf({ kind: 'fact', importance: 3 }, { count: 0 }) === 'event', 'fact/importance3 → event')
// 工作记忆（2026-11-08）：项目记忆不注入、不衰减，按需读
ok(tierOf({ kind: 'decision', importance: 4, scope: 'project' }) === 'working', '项目记忆 → working')
ok(
  tierOf({ kind: 'fact', importance: 2, scope: 'project', working: true }) === 'working',
  '显式 working 标记 → working',
)
ok(
  tierOf({ kind: 'decision', importance: 5, scope: 'project' }, { count: 3 }) === 'core',
  'core 规则优先于 working',
)
ok(decayScore('working', Date.now() - 400 * 86_400_000) === 1, 'working 400 天仍不衰减')
ok(decayScore('core', Date.now() - 10 * 86_400_000) === 1, 'core 不衰减')
// 四级的保护期（2026-11-05）：期内 decay 恒为 1，过了才开始掉
const day = 86_400_000
const ago = (d) => Date.now() - d * day
ok(decayScore('event', ago(29)) === 1, 'event 29 天在保护期内 = 1')
ok(decayScore('event', ago(30)) === 1, 'event 30 天仍在保护期边界 = 1')
ok(Math.abs(decayScore('event', ago(60)) - 0.5) < 0.01, 'event 60 天（保护 30 + 半个衰期 30）≈0.5')
ok(decayScore('mid', ago(89)) === 1, 'mid 89 天在保护期内 = 1')
ok(Math.abs(decayScore('mid', ago(90 + 90)) - 0.5) < 0.01, 'mid 180 天（保护 90 + 半衰 90）≈0.5')
ok(decayScore('long', ago(179)) === 1, 'long 179 天在保护期内 = 1')
ok(Math.abs(decayScore('long', ago(180 + 180)) - 0.5) < 0.01, 'long 360 天（保护 180 + 半衰 180）≈0.5')

const block = buildRecallBlock(sidecars, { budgetChars: DEFAULT_BUDGET_CHARS, workspace: 'L:\\DSH\\DeepSeek' })
ok(block.chars <= DEFAULT_BUDGET_CHARS, `注入块 ≤${DEFAULT_BUDGET_CHARS} 字符（实际 ${block.chars}）`)
ok(block.text.includes('## 记忆'), '注入块带标题行')
ok(block.picked.length > 0, `注入块选中了条目（${block.picked.length} 条）`)

const tiny = buildRecallBlock(sidecars, { budgetChars: 100, workspace: 'L:\\DSH\\DeepSeek' })
ok(tiny.chars <= 100 && tiny.picked.length <= block.picked.length, '收紧预算会少选（硬截断）')

const raw = findRawText(sidecars[0]?.id || 'x')
ok(
  raw === null || typeof raw.text === 'string' || raw.missingRoot === true,
  '原文回读：有片段 / 明确 null / 明确「旧库目录不在」（不崩）',
)


// ── 取代关系（supersedes）：旧条目标 supersededBy、注入排除 ─────────────
const supOld = { id: 'sup-old', kind: 'decision', scope: 'self', title: '旧结论：插件要走沙箱', content: '旧结论正文', importance: 4, updatedAt: 1000 }
const supNew = { id: 'sup-new', kind: 'decision', scope: 'self', title: '新结论：插件直接装桌面', content: '新结论正文', importance: 4, updatedAt: 2000, supersedes: ['sup-old'] }
const supSidecars = buildSidecars([supOld, supNew], {}, 5000)
ok(supSidecars.find((item) => item.id === 'sup-old')?.supersededBy === 'sup-new', 'supersedes：旧条目记下 supersededBy')
ok(supSidecars.find((item) => item.id === 'sup-new')?.supersededBy === null, 'supersedes：新条目自己不被标取代')
const supBlock = buildRecallBlock(supSidecars, { budgetChars: 280 })
ok(!supBlock.text.includes('旧结论：插件要走沙箱'), '注入排除被取代的旧结论')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memhub-sidecar-'))
const written = writeSidecars(tmp, sidecars)
ok(written.count === sidecars.length, `sidecar 落盘 ${written.count} 个`)
ok(fs.existsSync(path.join(tmp, 'recall-index.jsonl')), '派生索引 recall-index.jsonl 生成')
const one = readSidecar(sidecars[0].id, tmp)
ok(one?.id === sidecars[0].id, 'sidecar 可按 id 读回')
fs.rmSync(tmp, { recursive: true, force: true })

console.log(`\n记忆模块自测：${total - failures.length}/${total} 通过`)
if (failures.length > 0) {
  console.log(`失败项：${failures.join(' ｜ ')}`)
  process.exit(1)
}
