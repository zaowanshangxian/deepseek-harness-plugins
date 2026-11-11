#!/usr/bin/env node
/**
 * 把**孤儿 sidecar** 挪到归档目录（不删除）。
 *
 * 背景：迁移后 orb id 变成 `m_*` / `arc_*` / `o_*`，但 `~/.dsh/memhub/recall/`
 * 里还留着迁移前按旧 zzerx id 存的 sidecar。它们没有对应的 orb，
 * 每次重建都要多读一遍，纯属垃圾。
 *
 * 安全：**只移动，不删除**；移到 `~/.dsh/memhub/recall-orphans-<时间戳>/`，
 * 想恢复把文件挪回来即可。
 *
 * 用法：node tools/prune-sidecars.mjs [--dry-run]
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadOrbs } from '../src/orb-store.js'
import { sidecarRoot } from '../src/recall-store.js'
import { DATA_ROOT, DEFAULT_SHARED_ROOT } from '../src/const.js'

const DRY = process.argv.includes('--dry-run')
const dir = sidecarRoot()
const { entries } = loadOrbs(DATA_ROOT, DEFAULT_SHARED_ROOT)
const valid = new Set(entries.map((orb) => String(orb.id)))

let files = []
try {
  files = fs.readdirSync(dir).filter((name) => name.endsWith('.json'))
} catch {
  console.log(`sidecar 目录不存在：${dir}`)
  process.exit(0)
}

const orphans = files.filter((name) => !valid.has(name.replace(/\.json$/, '')))
const kept = files.length - orphans.length

if (orphans.length === 0) {
  console.log(`没有孤儿 sidecar（${files.length} 个全部有对应 orb）`)
  process.exit(0)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const target = path.join(path.dirname(dir), `recall-orphans-${stamp}`)
if (!DRY) fs.mkdirSync(target, { recursive: true })

let moved = 0
for (const name of orphans) {
  if (DRY) {
    moved += 1
    continue
  }
  fs.renameSync(path.join(dir, name), path.join(target, name))
  moved += 1
}

console.log(
  `${DRY ? '[dry-run] ' : ''}孤儿 sidecar ${orphans.length} 个｜保留有效 ${kept} 个｜` +
    (DRY ? '会移到同目录的 recall-orphans-<时间戳>/' : `已移到 ${target}`),
)
if (DRY) console.log(`样例：${orphans.slice(0, 3).join(', ')}`)
