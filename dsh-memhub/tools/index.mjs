#!/usr/bin/env node
/**
 * 生成技能索引 + 预算报告（开发/验收用，可重跑）。
 * 用法：node tools/index.mjs [--vault <dir>] [--out <file>]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadVault, toIndexLines, budgetReport } from '../src/indexer.js'

const args = process.argv.slice(2)
function arg(name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const vault = arg('--vault', path.join(os.homedir(), '.dsh', 'skills'))
const out = arg('--out', '')
const index = loadVault(vault)
const report = budgetReport(index.entries)

console.log(`vault: ${vault}`)
console.log(`skills: ${report.count}`)
console.log(`desc: ${report.descChars} chars ≈ ${report.descTokens} tokens`)
console.log(`body: ${report.bodyChars} chars ≈ ${report.bodyTokens} tokens`)
console.log(`errors: ${index.errors.length}`)
for (const error of index.errors) console.log(`  - ${error.dir}: ${error.error}`)

if (out) {
  fs.writeFileSync(out, toIndexLines(index.entries), 'utf8')
  console.log(`index written: ${out}`)
}

if (index.errors.length > 0) process.exit(1)
