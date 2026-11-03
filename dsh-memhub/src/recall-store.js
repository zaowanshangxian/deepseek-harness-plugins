/**
 * dsh-memhub · 第 2 期：记忆存储（读 zzerx 库 + sidecar 分级）
 *
 * 边界：只读 zzerx 的记忆文件（~/.dsh/storages/memory/memories/*.json），
 * 扩展字段（tier / decay / recall / emotion）全部写进我们自己的 sidecar，
 * 不改 zzerx 一行、不迁数据。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeAtomic } from './frontmatter.js'

const DAY_MS = 86_400_000

/** 长期类 memory.kind（zzerx 的 kind 枚举：decision/fact/preference/project/user）。 */
export const LONG_KINDS = new Set(['decision', 'preference', 'project', 'user'])

/** 各 tier 的半衰期（天）；core 不衰减。 */
export const HALF_LIFE_DAYS = { core: Infinity, long: 180, event: 30 }

export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

/** zzerx 记忆库根目录（只读）。 */
export function zzerxRoot() {
  return path.join(dshHome(), 'storages', 'memory')
}

/** 我们的 sidecar 目录。 */
export function sidecarRoot() {
  return path.join(dshHome(), 'memhub', 'recall')
}

/** 读 zzerx 全部记忆（每文件 {"version":1,"record":{...}}）。 */
export function loadZzerxMemories(root = zzerxRoot()) {
  const dir = path.join(root, 'memories')
  const entries = []
  const errors = []
  let files = []
  try {
    files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
  } catch (error) {
    return { root, entries, errors: [{ file: dir, error: `记忆库不可读：${String(error)}` }] }
  }
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
      const record = raw && raw.record ? raw.record : raw
      if (!record || !record.id) {
        errors.push({ file, error: '缺少 id' })
        continue
      }
      entries.push(record)
    } catch (error) {
      errors.push({ file, error: String(error) })
    }
  }
  return { root, entries, errors }
}

/** 判定 tier：确定性规则，不调模型。 */
export function tierOf(record, recall = { count: 0 }) {
  if (record.pinned) return 'core'
  const importance = Number(record.importance) || 0
  const count = Number(recall.count) || 0
  if (importance >= 5 && count >= 3) return 'core'
  if (LONG_KINDS.has(String(record.kind)) && importance >= 4) return 'long'
  return 'event'
}

/** 时间衰减分：0.5^(天数/半衰期)；core=1。 */
export function decayScore(tier, updatedAt, now = Date.now()) {
  const halfLife = HALF_LIFE_DAYS[tier] ?? HALF_LIFE_DAYS.event
  if (!Number.isFinite(halfLife)) return 1
  const days = Math.max(0, (now - Number(updatedAt || 0)) / DAY_MS)
  return Math.pow(0.5, days / halfLife)
}

/** 由 zzerx 记录 + 使用台账生成 sidecar 条目（纯函数，可单测）。 */
export function buildSidecars(records, usage = {}, now = Date.now()) {
  return records.map((record) => {
    const recall = usage[record.id] || { count: 0, last: null }
    const tier = tierOf(record, recall)
    return {
      id: record.id,
      tier,
      status: record.archived ? 'archived' : tier === 'core' ? 'core' : 'active',
      decay: Number(decayScore(tier, record.updatedAt, now).toFixed(4)),
      recall,
      emotion: null, // 第 5 期接情感标签；现在诚实留空
      title: String(record.title || ''),
      summary: String(record.summary || ''),
      content: String(record.content || ''),
      kind: String(record.kind || ''),
      scope: String(record.scope || ''),
      projectPath: String(record.projectPath || ''),
      importance: Number(record.importance) || 0,
      updatedAt: Number(record.updatedAt) || 0,
      createdAt: Number(record.createdAt) || 0,
      source: String(record.source || ''),
      sessionId: String(record.sessionId || ''),
      pinned: Boolean(record.pinned),
      archived: Boolean(record.archived),
      evergreen: Boolean(record.evergreen) || record.scope === 'shared',
    }
  })
}

/** 读已有 sidecar（id → sidecar），用于合并召回计数与归档标记。 */
export function readSidecarMap(dir) {
  const map = new Map()
  let files = []
  try {
    files = fs.readdirSync(dir).filter((name) => name.endsWith('.json'))
  } catch {
    return map
  }
  for (const file of files) {
    try {
      const sidecar = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
      if (sidecar?.id) map.set(sidecar.id, sidecar)
    } catch {
      /* 坏 sidecar 跳过 */
    }
  }
  return map
}

/** 写 sidecar：保留旧文件的 recall/archived/tierOverride（用户改过的主次不能被重建抹掉）。 */
export function writeSidecars(dir, sidecars) {
  fs.mkdirSync(dir, { recursive: true })
  const previous = readSidecarMap(dir)
  const merged = sidecars.map((sidecar) => {
    const old = previous.get(sidecar.id)
    if (!old) return sidecar
    return {
      ...sidecar,
      recall: old.recall || sidecar.recall,
      archived: old.archived ?? sidecar.archived,
      status: old.archived ? 'archived' : sidecar.status,
      tier: old.tierOverride || sidecar.tier,
      tierOverride: old.tierOverride || null,
    }
  })
  for (const sidecar of merged) {
    writeAtomic(path.join(dir, `${sidecar.id}.json`), JSON.stringify(sidecar, null, 2))
  }
  const lines = merged.map((sidecar) => JSON.stringify(sidecar))
  writeAtomic(path.join(dir, 'recall-index.jsonl'), `${lines.join('\n')}\n`)
  return { count: merged.length, dir, sidecars: merged }
}

/** 读一份 sidecar（不存在返回 null）。 */
export function readSidecar(id, dir = sidecarRoot()) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'))
  } catch {
    return null
  }
}

/** 读 raw_documents，按 recordId 回链原文（L0 原文回读）。 */
export function loadRawDocuments(root = zzerxRoot()) {
  const dir = path.join(root, 'raw_documents')
  const docs = []
  let files = []
  try {
    files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
  } catch {
    return docs
  }
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
      const record = raw && raw.record ? raw.record : raw
      if (record) docs.push({ file, record })
    } catch {
      /* 坏文件跳过，不阻塞 */
    }
  }
  return docs
}

/** 从 raw_documents 里找某条记忆的原文片段。 */
export function findRawText(memoryId, docs = loadRawDocuments()) {
  for (const { file, record } of docs) {
    const recordIds = record.recordIds || record.record_ids || []
    if (Array.isArray(recordIds) && recordIds.includes(memoryId)) {
      const text = record.text || record.content || record.transcript || ''
      return { file, text: typeof text === 'string' ? text : JSON.stringify(text), record }
    }
  }
  return null
}
