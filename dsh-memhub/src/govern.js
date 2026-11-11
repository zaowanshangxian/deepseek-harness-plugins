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

/** 合法记忆 id：字母数字下划线连字符 + 中文（归档回填的 id 可能带中文）；禁路径分隔符与 `..`。 */
const SAFE_ID = /^(?!.*\.\.)[\w\u4e00-\u9fa5-]+$/

/** 应用归档/恢复：只写 sidecar 文件。 */
export function applyArchive(sidecarDir, id, archived = true) {
  if (!SAFE_ID.test(String(id))) throw new Error('非法记忆 id')
  const file = path.join(sidecarDir, `${id}.json`)
  const sidecar = JSON.parse(fs.readFileSync(file, 'utf8'))
  sidecar.archived = Boolean(archived)
  sidecar.status = archived ? 'archived' : sidecar.tier === 'core' ? 'core' : 'active'
  fs.writeFileSync(file, JSON.stringify(sidecar, null, 2), 'utf8')
  return sidecar
}

/** 记录一次召回（双通道数据来源）。 */
export const REVIEW_COOLDOWN_MS = 3_600_000

export function recordRecall(sidecarDir, id, now = Date.now()) {
  if (!SAFE_ID.test(String(id))) throw new Error('非法记忆 id')
  const file = path.join(sidecarDir, `${id}.json`)
  if (!fs.existsSync(file)) return null
  const sidecar = JSON.parse(fs.readFileSync(file, 'utf8'))
  const lastTs = sidecar.recall?.last ? Date.parse(sidecar.recall.last) : 0
  // 冷却：1 小时内重复打开只刷新「想起来过」的时间，不累加计数。
  // 不加这条，importance>=5 的条目被连开 3 次就升 core（永久不衰减）。
  const count = Number(sidecar.recall?.count || 0)
  const cooling = Number.isFinite(lastTs) && lastTs > 0 && now - lastTs < REVIEW_COOLDOWN_MS
  sidecar.recall = { count: cooling ? count : count + 1, last: new Date(now).toISOString() }
  writeAtomic(file, JSON.stringify(sidecar, null, 2))
  return sidecar
}
