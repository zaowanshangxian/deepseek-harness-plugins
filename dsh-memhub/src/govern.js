/**
 * dsh-memhub · 第 3 期：治理（衰减 / 冻结 / 归档 / 恢复）
 *
 * 只改自己的 sidecar，不动 zzerx 原文：归档 = sidecar.archived=true（可恢复），永不 unlink。
 * 双通道：最近 30 天被召回 ≥2 次的条目冻结时间衰减（time 通道 vs 复习通道互斥）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { decayScore } from './recall-store.js'
import { writeAtomic } from './frontmatter.js'

export const ARCHIVE_THRESHOLD = 0.2
export const FROZEN_MIN_RECALLS = 2
export const FROZEN_WINDOW_DAYS = 30

/** 双通道互斥：最近 30 天召回 ≥2 次 → 冻结。 */
export function isFrozen(sidecar, now = Date.now()) {
  const recall = sidecar.recall || {}
  if (!recall.last) return false
  const days = (now - Date.parse(recall.last)) / 86_400_000
  return Number(recall.count) >= FROZEN_MIN_RECALLS && days <= FROZEN_WINDOW_DAYS
}

/** 单条状态计划（纯函数）：返回 {action,status,reason}。 */
export function planStatus(sidecar, now = Date.now()) {
  if (sidecar.archived) return { action: 'keep', status: 'archived', reason: '已归档' }
  if (sidecar.evergreen || sidecar.pinned) {
    return { action: 'keep', status: 'active', reason: '工程/公共区记忆不衰减' }
  }
  if (isFrozen(sidecar, now)) return { action: 'keep', status: 'active', reason: '冻结（近期高频召回）' }
  if (sidecar.tier === 'core') return { action: 'keep', status: 'core', reason: '核心记忆不衰减' }
  const decay = decayScore(sidecar.tier, sidecar.updatedAt, now)
  if (decay < ARCHIVE_THRESHOLD) {
    return { action: 'archive', status: 'archived', reason: `衰减 ${decay.toFixed(2)} < ${ARCHIVE_THRESHOLD}` }
  }
  return { action: 'keep', status: 'active', reason: '正常' }
}

/** 全库治理计划（纯函数，供面板/CLI 展示，不写盘）。 */
export function planGovernance(sidecars, now = Date.now()) {
  return sidecars.map((sidecar) => ({ id: sidecar.id, title: sidecar.title, ...planStatus(sidecar, now) }))
}

/** 应用归档/恢复：只写 sidecar 文件。 */
export function applyArchive(sidecarDir, id, archived = true) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(id))) throw new Error('非法记忆 id')
  const file = path.join(sidecarDir, `${id}.json`)
  const sidecar = JSON.parse(fs.readFileSync(file, 'utf8'))
  sidecar.archived = Boolean(archived)
  sidecar.status = archived ? 'archived' : sidecar.tier === 'core' ? 'core' : 'active'
  fs.writeFileSync(file, JSON.stringify(sidecar, null, 2), 'utf8')
  return sidecar
}

/** 记录一次召回（双通道数据来源）。 */
export function recordRecall(sidecarDir, id, now = Date.now()) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(id))) throw new Error('非法记忆 id')
  const file = path.join(sidecarDir, `${id}.json`)
  if (!fs.existsSync(file)) return null
  const sidecar = JSON.parse(fs.readFileSync(file, 'utf8'))
  sidecar.recall = { count: Number(sidecar.recall?.count || 0) + 1, last: new Date(now).toISOString() }
  writeAtomic(file, JSON.stringify(sidecar, null, 2))
  return sidecar
}
