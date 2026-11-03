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
ok(decayScore('core', Date.now() - 10 * 86_400_000) === 1, 'core 不衰减')
ok(Math.abs(decayScore('event', Date.now() - 30 * 86_400_000) - 0.5) < 0.01, 'event 30 天后 ≈0.5')

const block = buildRecallBlock(sidecars, { budgetChars: DEFAULT_BUDGET_CHARS, workspace: 'L:\\DSH\\DeepSeek' })
ok(block.chars <= DEFAULT_BUDGET_CHARS, `注入块 ≤${DEFAULT_BUDGET_CHARS} 字符（实际 ${block.chars}）`)
ok(block.text.includes('## 记忆'), '注入块带标题行')
ok(block.picked.length > 0, `注入块选中了条目（${block.picked.length} 条）`)

const tiny = buildRecallBlock(sidecars, { budgetChars: 100, workspace: 'L:\\DSH\\DeepSeek' })
ok(tiny.chars <= 100 && tiny.picked.length <= block.picked.length, '收紧预算会少选（硬截断）')

const raw = findRawText(sidecars[0]?.id || 'x')
ok(raw === null || typeof raw.text === 'string', '原文回读：要么有片段，要么明确 null（不崩）')

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
