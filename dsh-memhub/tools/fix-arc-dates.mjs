#!/usr/bin/env node
/**
 * 一次性修复：把 `arc_*` 归档记忆的 createdAt / updatedAt 改回归档当时的日期。
 *
 * 起因（2026-11-05）：回填 33 个历史归档时统一用了「回填时刻」当 updatedAt，
 * 结果 10 月的会话记录全部伪装成「今天刚发生」，把注入里的「最近 3 条」挤掉了。
 * 之后 `archive-to-memory.mjs` 已改成写归档日期；这个脚本只补历史数据。
 *
 * 用法：node tools/fix-arc-dates.mjs [--dry-run]
 */
import fs from 'node:fs'
import path from 'node:path'

const DRY = process.argv.includes('--dry-run')
const ROOTS = [
  path.join(process.env.USERPROFILE || '', '.dsh', 'memhub', 'orbs'),
  'L:\\DSH\\shared\\memhub\\orbs',
]

function walk(dir, out = []) {
  let items = []
  try {
    items = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const item of items) {
    const full = path.join(dir, item.name)
    if (item.isDirectory()) walk(full, out)
    else if (item.name.startsWith('arc_') && item.name.endsWith('.md')) out.push(full)
  }
  return out
}

let fixed = 0
let skipped = 0
for (const root of ROOTS) {
  for (const file of walk(root)) {
    // 文件名形如 arc_20261027-1823-misc-27db6fbf.md
    const match = path.basename(file).match(/^arc_(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/)
    if (!match) {
      skipped += 1
      continue
    }
    const [, year, month, day, hour, minute] = match
    const ts = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:00`)
    if (!Number.isFinite(ts)) {
      skipped += 1
      continue
    }
    const text = fs.readFileSync(file, 'utf8')
    const next = text
      .replace(/^createdAt: \d+$/m, `createdAt: ${ts}`)
      .replace(/^updatedAt: \d+$/m, `updatedAt: ${ts}`)
    if (next === text) {
      skipped += 1
      continue
    }
    if (DRY) {
      console.log(`[dry-run] ${path.basename(file)} → ${new Date(ts).toISOString()}`)
    } else {
      fs.writeFileSync(file, next, 'utf8')
    }
    fixed += 1
  }
}
console.log(`${DRY ? '[dry-run] ' : ''}修正 ${fixed} 条，跳过 ${skipped} 条`)
