#!/usr/bin/env node
/**
 * 一次性：给历史 orb 回填 emotion 字段（情绪色）。
 *
 * 为什么需要：2026-11-11 补的「情绪绑定记忆」靠 orb 的 emotion 派生 mood；
 * 生产 144 条老 orb 都没有这个字段 → 派生恒 neutral → 对历史记忆等于无信号。
 *
 * 做法：不重新格式化文件，只在 frontmatter 里「kind:」后插一行 `emotion:`。
 * 安全：dry-run 默认；--apply 才写；写前备份（.bak-<时间戳>）；
 *       写后自检「删掉 emotion 行 == 原文」——不等就回滚该文件并报错。
 */
import fs from 'node:fs'
import path from 'node:path'
import { detectEmotion, normalizeEmotion, EMOTIONS } from '../src/orb-store.js'
import { DATA_ROOT, DEFAULT_SHARED_ROOT } from '../src/const.js'

const args = process.argv.slice(2)
const apply = args.includes('--apply')

function walk(dir) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) out.push(...walk(full))
    else if (name.endsWith('.md')) out.push(full)
  }
  return out
}

function splitFrontmatter(text) {
  if (!text.startsWith('---\n')) return null
  const end = text.indexOf('\n---', 3)
  if (end < 0) return null
  return { fm: text.slice(4, end), body: text.slice(end), rest: text }
}

const roots = [path.join(DATA_ROOT, 'orbs'), path.join(DEFAULT_SHARED_ROOT, 'orbs')]
const files = roots.flatMap(walk)
const dist = Object.fromEntries(EMOTIONS.map((e) => [e, 0]))
const missing = []
const byKeyword = []
let already = 0
let broken = 0
let unjudged = 0

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  const parts = splitFrontmatter(text)
  if (!parts) {
    broken += 1
    continue
  }
  if (/^emotion:/m.test(parts.fm)) {
    already += 1
    continue
  }
  const body = parts.body.replace(/^---\n/, '')
  const emotion = normalizeEmotion(detectEmotion(body))
  // 2026-11-11 决策：**不回填历史情绪**。
  // 关键词判定对工程记忆不可靠（实测 joy 28 条多是「验收/构建/通过」误判、fear 7 条多是「风险/担心」），
  // 而且 deriveMood 现在把「无标签」当 unknown 不参与投票——瞎猜反而污染依据。
  // 所以判不出来的直接标「未判定」，绝不写 `emotion: null` 这种脏行。
  if (!emotion) {
    unjudged += 1
    continue
  }
  dist[emotion] += 1
  missing.push({ file, emotion })
  if (emotion !== 'calm') byKeyword.push({ file, emotion })
}

function stamp() {
  const d = new Date()
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

console.log(`扫描 ${files.length} 个 orb（${roots.join(' + ')}）`)
console.log(`  已有 emotion: ${already} ｜ 缺字段: ${missing.length} ｜ 判不出（不猜）: ${unjudged} ｜ frontmatter 坏: ${broken}`)
console.log('  回填分布（关键词判定）:', JSON.stringify(dist))
if (byKeyword.length) console.log(`  其中非 calm（关键词命中）: ${byKeyword.length} 条`)

if (!apply) {
  console.log('\ndry-run：未写入。加 --apply 才落盘。')
  process.exit(0)
}

let written = 0
let rolledBack = 0
for (const item of missing) {
  const original = fs.readFileSync(item.file, 'utf8')
  const parts = splitFrontmatter(original)
  if (!parts) continue
  // 在 frontmatter 的 kind 行后插 emotion；没有 kind 就插在开头
  const lines = parts.fm.split('\n')
  const kindIndex = lines.findIndex((line) => line.startsWith('kind:'))
  const insertAt = kindIndex >= 0 ? kindIndex + 1 : 0
  lines.splice(insertAt, 0, `emotion: ${item.emotion}`)
  const next = `---\n${lines.join('\n')}${parts.body}`

  // 自检：删掉我们插的那行，必须与原文完全一致
  const check = next.replace(`emotion: ${item.emotion}\n`, '')
  if (check !== original) {
    console.error(`✗ 自检失败（会改到别的行），跳过: ${item.file}`)
    rolledBack += 1
    continue
  }
  fs.copyFileSync(item.file, `${item.file}.bak-${stamp()}`)
  fs.writeFileSync(item.file, next, 'utf8')
  written += 1
}

console.log(`\n已写入 ${written} 条 ｜ 自检失败跳过 ${rolledBack} 条`)
console.log('备份：同目录 *.bak-<时间戳>')
console.log('回滚：把 .bak-* 覆盖回去即可；或用 git checkout（仓库内副本）')
