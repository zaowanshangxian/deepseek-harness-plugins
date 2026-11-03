#!/usr/bin/env node
/**
 * 给技能库批量加/去 disable-model-invocation（让描述从系统提示目录消失，/技能名 仍可用）。
 *
 * 用法：
 *   node tools/toggle-model-invocation.mjs              # 默认 dry-run，只报告不写入
 *   node tools/toggle-model-invocation.mjs --apply      # 真正加开关（时间戳备份 + 原子写）
 *   node tools/toggle-model-invocation.mjs --restore    # 从 .bak-toggle 恢复（先备份现状）
 *
 * 写盘统一走 src/frontmatter.js：flag 判定只看头部、原子写、带时间戳备份。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hasFlag, addFlag, writeAtomic, backupWithStamp } from '../src/frontmatter.js'

const args = process.argv.slice(2)
function arg(name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const vault = arg('--vault', path.join(os.homedir(), '.dsh', 'skills'))
const apply = args.includes('--apply')
const restore = args.includes('--restore')
const dryRun = !apply && !restore

let dirs = []
try {
  dirs = fs
    .readdirSync(vault, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
} catch (error) {
  console.error(`技能库不可读：${vault}（${String(error)}）`)
  process.exit(1)
}

let changed = 0
let already = 0
let noFrontmatter = 0
let restored = 0
const samples = []

for (const dir of dirs) {
  const file = path.join(vault, dir, 'SKILL.md')
  const bak = path.join(vault, dir, 'SKILL.md.bak-toggle')
  if (!fs.existsSync(file)) continue

  if (restore) {
    if (!fs.existsSync(bak)) continue
    backupWithStamp(file) // 先备份现状，restore 不会把当前编辑弄丢
    writeAtomic(file, fs.readFileSync(bak, 'utf8'))
    restored += 1
    continue
  }

  const text = fs.readFileSync(file, 'utf8')
  if (hasFlag(text)) {
    already += 1
    continue
  }
  const next = addFlag(text)
  if (next === null) {
    noFrontmatter += 1
    continue
  }
  if (dryRun) {
    changed += 1
    if (samples.length < 3) samples.push(dir)
    continue
  }
  backupWithStamp(file)
  writeAtomic(file, next)
  changed += 1
  if (samples.length < 3) samples.push(dir)
}

if (restore) {
  console.log(`已从 .bak-toggle 恢复：${restored} 个（恢复前已做时间戳备份）`)
  process.exit(0)
}

const mode = dryRun ? 'dry-run（未写入）' : '已写入'
console.log(`vault: ${vault}`)
console.log(`${mode}：本次${dryRun ? '将' : '已'}加开关 ${changed} 个；已有开关 ${already} 个；无 frontmatter 跳过 ${noFrontmatter} 个`)
if (samples.length) console.log(`示例：${samples.join(', ')}`)
if (dryRun) console.log('确认后跑：node tools/toggle-model-invocation.mjs --apply')
