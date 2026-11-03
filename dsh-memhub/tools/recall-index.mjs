#!/usr/bin/env node
/**
 * 生成记忆 sidecar（tier / decay / recall）与派生索引，可重跑。
 * 用法：node tools/recall-index.mjs [--source <zzerx 库根>] [--out <sidecar 目录>]
 */
import path from 'node:path'
import { loadZzerxMemories, buildSidecars, writeSidecars, zzerxRoot, sidecarRoot } from '../src/recall-store.js'

const args = process.argv.slice(2)
function arg(name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const source = arg('--source', zzerxRoot())
const out = arg('--out', sidecarRoot())
const { entries, errors } = loadZzerxMemories(source)
const sidecars = buildSidecars(entries)
const written = writeSidecars(out, sidecars)
const byTier = sidecars.reduce((acc, item) => {
  acc[item.tier] = (acc[item.tier] || 0) + 1
  return acc
}, {})

console.log(`source: ${source}`)
console.log(`memories: ${entries.length}`)
console.log(`byTier: ${JSON.stringify(byTier)}`)
console.log(`errors: ${errors.length}`)
console.log(`written: ${written.count} → ${written.dir}`)
for (const error of errors) console.log(`  - ${error.file}: ${error.error}`)
if (errors.length > 0) process.exit(1)
