#!/usr/bin/env node
/**
 * 把「归档回填」的 `arc_*` 条目集体归档（sidecar.archived = true，可恢复）。
 *
 * 为什么：`arc_*` 记的是「某次会话发生了什么」= **过程记录**；
 * 记忆库里该留的是「以后还该记住的结论」。33 条会话总结混在里面，
 * 会挤占检索与注入的候选位（虽然时间已修正，但仍然是最新那几条）。
 *
 * 归档 ≠ 删除：文件还在，`memhub_archive({id, archived:false})` 可恢复。
 *
 * 用法：node tools/archive-backfill.mjs [--dry-run] [--restore]
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadOrbs } from '../src/orb-store.js'
import { buildSidecars, writeSidecars, sidecarRoot } from '../src/recall-store.js'
import { applyArchive } from '../src/govern.js'
import { DATA_ROOT, DEFAULT_SHARED_ROOT } from '../src/const.js'

const DRY = process.argv.includes('--dry-run')
const RESTORE = process.argv.includes('--restore')
const dir = sidecarRoot()

const { entries } = loadOrbs(DATA_ROOT, DEFAULT_SHARED_ROOT)
// 先把 sidecar 补齐（新增的 orb 可能还没有 sidecar 文件）
fs.mkdirSync(dir, { recursive: true })
writeSidecars(dir, buildSidecars(entries, {}, Date.now()))

const targets = entries.filter((orb) => String(orb.id).startsWith('arc_'))
let changed = 0
let failed = 0
for (const orb of targets) {
  if (DRY) {
    console.log(`[dry-run] ${RESTORE ? '恢复' : '归档'} ${orb.id} ｜ ${String(orb.title).slice(0, 40)}`)
    changed += 1
    continue
  }
  try {
    applyArchive(dir, orb.id, !RESTORE)
    changed += 1
  } catch (error) {
    failed += 1
    console.log(`跳过 ${orb.id}：${String(error.message || error)}`)
  }
}
console.log(
  `${DRY ? '[dry-run] ' : ''}${RESTORE ? '恢复' : '归档'} ${changed} 条${failed ? `，失败 ${failed}` : ''}` +
    `（共匹配 ${targets.length} 条 arc_ 条目）`,
)
