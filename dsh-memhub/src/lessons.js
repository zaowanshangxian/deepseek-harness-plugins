/**
 * dsh-memhub · 教训（触发式，不常驻）
 *
 * 铁律：trigger 必须是「当 X 时」形状且可判真假；形容词式不许入库。
 * 存储：~/.dsh/memhub/lessons.jsonl；坏行原样保留，载入/保存都不丢。
 */
import fs from 'node:fs'
import path from 'node:path'
import { queryTokens } from './indexer.js'
import { writeAtomic, backupWithStamp } from './frontmatter.js'

export const LESSON_STATUS = ['active', 'promoted', 'retired']
const MAX_TRIGGER = 200

/** 校验并生成一条教训（失败返回错误文本）。 */
export function makeLesson(input = {}) {
  const trigger = String(input.trigger || '').trim()
  if (!trigger) return { error: 'trigger 必填：写成「当 X 时」的可匹配情境。' }
  if (!/^当.*时$/.test(trigger)) {
    return { error: 'trigger 必须写成「当 X 时」形状（以「当」开头、以「时」结尾），例如「当我要说『应该没问题』时」。' }
  }
  if (trigger.length > MAX_TRIGGER) return { error: `trigger 太长（${trigger.length} 字符，上限 ${MAX_TRIGGER}）。` }
  const wrong = String(input.wrong || '').trim()
  const right = String(input.right || '').trim()
  if (!wrong || !right) return { error: 'wrong 与 right 都必填（错在哪 / 正确做法）。' }
  return {
    lesson: {
      id: `l_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      trigger,
      wrong,
      right,
      evidence: String(input.evidence || ''),
      source: String(input.source || 'observed'),
      recurrence: 0,
      last_hit: null,
      status: 'active',
      promoted_to: null,
      createdAt: new Date().toISOString(),
    },
  }
}

/** 读取教训：返回 { items, badLines }（坏行原样保留，不静默丢）。 */
export function loadLessons(dir) {
  const file = path.join(dir, 'lessons.jsonl')
  if (!fs.existsSync(file)) return { items: [], badLines: [] }
  const items = []
  const badLines = []
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      items.push(JSON.parse(line))
    } catch {
      badLines.push(line)
    }
  }
  return { items, badLines }
}

/** 保存教训：坏行原样写回；写前备份一代。 */
export function saveLessons(dir, items, badLines = []) {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'lessons.jsonl')
  backupWithStamp(file, 3)
  const lines = [...items.map((item) => JSON.stringify(item)), ...badLines]
  writeAtomic(file, `${lines.join('\n')}\n`)
}

/** 情境匹配：返回命中的教训（≤3 条）；只读，不累加复发。 */
export function matchLessons(items, situation, limit = 3) {
  const tokens = queryTokens(String(situation || ''))
  if (tokens.length === 0) return []
  const scored = []
  for (const lesson of items) {
    if (lesson.status !== 'active') continue
    const hay = `${lesson.trigger} ${lesson.wrong} ${lesson.right}`.toLowerCase()
    let score = 0
    for (const token of tokens) if (hay.includes(token)) score += 1
    if (score > 0) scored.push({ score, lesson })
  }
  scored.sort((a, b) => b.score - a.score || (b.lesson.recurrence || 0) - (a.lesson.recurrence || 0))
  return scored.slice(0, limit).map((item) => item.lesson)
}

/** 复发 +1（由真实复发事件调用，不由 match 调用）。 */
export function bumpRecurrence(items, id) {
  const lesson = items.find((item) => item.id === id)
  if (!lesson) return null
  lesson.recurrence = Number(lesson.recurrence || 0) + 1
  lesson.last_hit = new Date().toISOString()
  return lesson
}

/** 90 天未触发的教训 → retired 候选（只给提案，不自动改）。 */
export function staleLessons(items, now = Date.now(), days = 90) {
  return items.filter((lesson) => {
    if (lesson.status !== 'active') return false
    const last = Date.parse(lesson.last_hit || lesson.createdAt || 0)
    return now - last > days * 86_400_000
  })
}

/** 复发 ≥3 次 → 升格提案（技能段落 / 硬规则），需人确认。 */
export function graduationProposals(items) {
  return items.filter((lesson) => lesson.status === 'active' && Number(lesson.recurrence || 0) >= 3)
}
