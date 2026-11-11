#!/usr/bin/env node
/**
 * 检索命中率对比（ROADMAP Step 4 验收）：baseline 子串 vs v1 老打分 vs v2 新打分。
 *
 * 基线点名的原因：memhub 迁移后没有「向量」可跟，所以对照的是
 * ① zzerx 时代的整句子串匹配（`memory_search` 的行为）② 迁移期 v1 打分。
 * 查询是人工按真实记忆写的「换个说法」，每条指定一个期望 id；只看 hit@1 / hit@3 / MRR，
 * 不看模型主观评价。
 *
 * 用法：node tools/search-bench.mjs [--write]
 * 产物：data/search-bench-<日期>.md（--write 时额外落盘）
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadOrbs } from '../src/orb-store.js'
import { readSidecarMap, buildSidecars, mergeSidecars, sidecarRoot } from '../src/recall-store.js'
import { searchMemories } from '../src/search.js'
import { DATA_ROOT, DEFAULT_SHARED_ROOT } from '../src/const.js'

/** 人工查询集：query → 期望命中的记忆 id（按 2026-11-10 的真机库写）。 */
const CASES = [
  ['QQ 机器人怎么接进 Windows', 'm_15912472-fdf8-4a00-b19b-16bbf3aeff5b'],
  ['配置坏了怎么恢复', 'm_783e699a-c91a-4b30-b759-59c668b96a0c'],
  ['本地模型怎么分工', 'm_4c946063-eda8-4533-b541-07f435d65e1a'],
  ['省 token 的插件装了哪些', 'm_06c53bb7-b6c0-4d1b-a549-a2ac2b32be98'],
  ['技能描述太长怎么办', 'm_26cb04c1-e160-4f11-921c-e0da03f040cd'],
  ['Windows 脚本编码问题', 'm_3530ced0-b238-471a-bf7d-7a546ce83905'],
  ['工作区怎么分盘', 'm_4cd11a38-0662-4dbc-94fe-fc1e2d5c5bdb'],
  ['记忆怎么分盘', 'm_d104e580-fa05-45de-83e5-678c1239017a'],
  ['成本怎么汇报', 'm_6ee3487e-5eca-42d2-a4d0-fc2112ff4d47'],
  ['能不能改会话日志', 'm_38051d81-1a66-409c-892e-cd9f66e3ac64'],
  ['插件路径中文行不行', 'm_eb3fbc9b-b7f3-4feb-b739-6da680059b97'],
  ['哥哥喜欢什么相处方式', 'm_7cb9d57e-43e8-49a1-82e5-7686a7f82921'],
  ['记忆分层 L0 L4', 'm_de3c1709-027d-4288-b183-3a4036f45bed'],
  ['save-token 阈值怎么调', 'm_1f3daa97-c46d-4cc2-bf49-119cdcf89955'],
  ['我是谁 人格设定', 'm_f7927311-a9ac-4e18-bcf6-dc284dee561e'],
  ['桌面更新卡住', 'm_33346827-9090-47a5-94ff-324b1d4a4967'],
  ['B站账号定位', 'm_1c6bc8e3-8bbd-4daf-9732-fbc27b53713c'],
  ['GPU 守卫 游戏', 'm_c5152512-0845-48e6-95cd-310548134ef0'],
]

function loadSidecars() {
  const previous = readSidecarMap(sidecarRoot())
  const usage = {}
  for (const [id, old] of previous) usage[id] = old.recall || { count: 0, last: null }
  const { entries } = loadOrbs(DATA_ROOT, DEFAULT_SHARED_ROOT)
  return mergeSidecars(buildSidecars(entries, usage), previous).filter((item) => !item.archived)
}

/** baseline：zzerx 时代的整句子串匹配（忽略大小写），按更新时间倒序。 */
function baselineSearch(items, query, limit = 5) {
  const needle = String(query || '').toLowerCase().trim()
  if (!needle) return []
  return items
    .filter((item) =>
      `${item.title || ''} ${item.summary || ''} ${item.content || ''}`.toLowerCase().includes(needle),
    )
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
    .slice(0, limit)
}

function evaluate(rankedIds, expected) {
  const rank = rankedIds.indexOf(expected)
  return {
    hit1: rank === 0,
    hit3: rank >= 0 && rank < 3,
    rr: rank >= 0 ? 1 / (rank + 1) : 0,
  }
}

function summarize(rows) {
  const total = rows.length
  const hit1 = rows.filter((row) => row.hit1).length
  const hit3 = rows.filter((row) => row.hit3).length
  const mrr = rows.reduce((sum, row) => sum + row.rr, 0) / (total || 1)
  return { hit1, hit3, mrr, total }
}

const items = loadSidecars()
const rows = []
for (const [query, expected] of CASES) {
  const baseline = baselineSearch(items, query).map((item) => item.id)
  const v1 = searchMemories(items, query, { limit: 5, mode: 'v1' }).map((entry) => entry.item.id)
  const v2 = searchMemories(items, query, { limit: 5, mode: 'v2' }).map((entry) => entry.item.id)
  rows.push({
    query,
    expected,
    baseline: evaluate(baseline, expected),
    v1: evaluate(v1, expected),
    v2: evaluate(v2, expected),
    v1Top: v1[0] || '-',
    v2Top: v2[0] || '-',
    v2Rank: v2.indexOf(expected),
  })
}

const methods = ['baseline', 'v1', 'v2']
const summary = Object.fromEntries(methods.map((method) => [method, summarize(rows.map((row) => row[method]))]))

const lines = []
lines.push(`# 检索命中率对比 · ${new Date().toISOString().slice(0, 10)}`)
lines.push('')
lines.push(`- 库：${items.length} 条活跃记忆（真机）`)
lines.push(`- 查询：${CASES.length} 条人工「换个说法」，每条指定期望 id`)
lines.push(`- baseline = zzerx 整句子串；v1 = 迁移期打分；v2 = IDF + 字段权重 + 别名 + 短语加成`)
lines.push('')
lines.push('## 总览')
lines.push('')
lines.push('| 方法 | hit@1 | hit@3 | MRR |')
lines.push('|---|---|---|---|')
for (const method of methods) {
  const s = summary[method]
  lines.push(`| ${method} | ${s.hit1}/${s.total} | ${s.hit3}/${s.total} | ${s.mrr.toFixed(3)} |`)
}
lines.push('')
lines.push('## 逐条')
lines.push('')
lines.push('| 查询 | 期望 id | baseline | v1 | v2 | v2 名次 |')
lines.push('|---|---|---|---|---|---|')
for (const row of rows) {
  const mark = (result) => (result.hit1 ? '✅第1' : result.hit3 ? '✅前3' : result.rr > 0 ? '✅前5' : '❌')
  lines.push(
    `| ${row.query} | ${row.expected.slice(0, 12)}… | ${mark(row.baseline)} | ${mark(row.v1)} | ${mark(row.v2)} | ${row.v2Rank >= 0 ? row.v2Rank + 1 : '未命中'} |`,
  )
}
lines.push('')
lines.push('## 结论')
lines.push('')
lines.push(
  `- v2 hit@1 ${summary.v2.hit1}/${summary.v2.total}（${Math.round((summary.v2.hit1 / summary.v2.total) * 100)}%），v1 ${summary.v1.hit1}/${summary.v1.total}，baseline ${summary.baseline.hit1}/${summary.baseline.total}`,
)
lines.push(
  `- v2 的 MRR 比 baseline 高 ${(summary.v2.mrr - summary.baseline.mrr).toFixed(3)}，比 v1 高 ${(summary.v2.mrr - summary.v1.mrr).toFixed(3)}`,
)
lines.push('- 语义「换个说法」的问题上，整句子串基本不可用；v2 主要靠 IDF 压掉高频词、别名补同义词。')
lines.push('')

const text = `${lines.join('\n')}\n`
console.log(text)
if (process.argv.includes('--write')) {
  const dir = path.join('data')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `search-bench-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.md`)
  fs.writeFileSync(file, text, 'utf8')
  console.log(`已写入 ${file}`)
}
