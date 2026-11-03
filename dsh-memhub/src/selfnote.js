/**
 * dsh-memhub · 第 4 期：自我叙述（L4 selfNote）+ 岛屿（派生视图）
 *
 * 自我叙述是「它自己写的库」：≤320 字/段、活跃区 ≤8 段、第 9 段挤掉最旧进 archive（可回读）。
 * 岛屿是从 core 记忆算出的派生视图（可重算）——两者互相引用，不互相替代。
 */
import fs from 'node:fs'
import path from 'node:path'
import { writeAtomic } from './frontmatter.js'

export const MAX_ACTIVE_NOTES = 8
export const MAX_NOTE_CHARS = 320

export function selfRoot(dir) {
  return path.join(dir, 'self')
}

function notesDir(dir) {
  return path.join(selfRoot(dir), 'notes')
}

function archiveDir(dir) {
  return path.join(selfRoot(dir), 'archive')
}

function ensureDirs(dir) {
  fs.mkdirSync(notesDir(dir), { recursive: true })
  fs.mkdirSync(archiveDir(dir), { recursive: true })
}

function listFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return []
  return fs
    .readdirSync(dirPath)
    .filter((name) => name.endsWith('.md'))
    .sort()
}

/** 列出活跃/归档的叙述（按文件名即时间排序）。 */
export function listNotes(dir) {
  const active = listFiles(notesDir(dir)).map((name) => ({
    file: name,
    text: fs.readFileSync(path.join(notesDir(dir), name), 'utf8'),
  }))
  const archived = listFiles(archiveDir(dir)).map((name) => ({
    file: name,
    text: fs.readFileSync(path.join(archiveDir(dir), name), 'utf8'),
  }))
  return { active, archived }
}

/** 写一段自我叙述：超长拒绝，超活跃上限把最旧一段移进 archive。 */
export function writeNote(dir, text, now = Date.now()) {
  const body = String(text || '').trim()
  if (!body) return { error: '叙述不能为空。' }
  if ([...body].length > MAX_NOTE_CHARS) {
    return { error: `叙述超过 ${MAX_NOTE_CHARS} 字（当前 ${[...body].length} 字），拆成两段或压缩。` }
  }
  ensureDirs(dir)
  const date = new Date(now)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  const ms = String(date.getMilliseconds()).padStart(3, '0')
  const name = `${date.toISOString().slice(0, 10)}-${hh}${mm}${ss}${ms}-${Math.random().toString(36).slice(2, 5)}.md`
  writeAtomic(path.join(notesDir(dir), name), body)
  const files = listFiles(notesDir(dir))
  let archived = null
  if (files.length > MAX_ACTIVE_NOTES) {
    archived = files[0]
    fs.renameSync(path.join(notesDir(dir), archived), path.join(archiveDir(dir), archived))
  }
  return { file: name, archived, chars: [...body].length }
}

/** 注入用的最新一段摘要：标题行 + 前 60 字。 */
export function noteSummary(dir) {
  const files = listFiles(notesDir(dir))
  if (files.length === 0) return null
  const latest = files[files.length - 1]
  const text = fs.readFileSync(path.join(notesDir(dir), latest), 'utf8')
  const firstLine = text.split('\n').map((line) => line.trim()).find(Boolean) || latest
  const archivedCount = listFiles(archiveDir(dir)).length
  return {
    file: latest,
    title: firstLine.slice(0, 40),
    summary: firstLine.slice(0, 60),
    count: files.length,
    archivedCount,
  }
}

/**
 * 岛屿（派生）：从 core / 高重要度记忆按 kind 聚成 3–5 句「我是什么样的人」。
 * 每次可重算，不落盘。
 */
export function buildIslands(sidecars, limit = 5) {
  const groups = new Map()
  for (const sidecar of sidecars) {
    if (sidecar.archived) continue
    const core = sidecar.tier === 'core' || Number(sidecar.importance) >= 5
    if (!core) continue
    const key = sidecar.kind || '其他'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(sidecar)
  }
  const islands = []
  for (const [kind, items] of groups) {
    const top = items.sort((a, b) => b.importance - a.importance).slice(0, 3)
    islands.push({
      name: kind,
      sentence: `${kind}：${top.map((item) => item.title).join('；')}`,
      ids: top.map((item) => item.id),
    })
  }
  return islands.slice(0, limit)
}
