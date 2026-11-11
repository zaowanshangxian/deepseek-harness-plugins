/**
 * dsh-memhub · 日记（2026-11-05）
 *
 * 和记忆的区别：
 *   - 记忆 = 事实 / 决策 / 教训（要被检索、要衰减、要注入）
 *   - 日记 = 当天发生的事和心情（按天分页，不参与召回，靠翻）
 *
 * 位置：`<sharedRoot>/diary/YYYY-MM-DD.md`（公共区，哥哥和我共用一本）
 * 一页里可以有多段：每段带时间 + 署名，谁写的谁署名。
 */
import fs from 'node:fs'
import path from 'node:path'
import { writeAtomic } from './frontmatter.js'

const AUTHOR_RE = /^[^\n]{1,20}$/

export function diaryDir(sharedRoot) {
  return path.join(sharedRoot, 'diary')
}

export function diaryFile(sharedRoot, date) {
  return path.join(diaryDir(sharedRoot), `${date}.md`)
}

/** `2026-11-05`（本地时区，不是 UTC——日记按人的日子算）。 */
export function today(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function hhmm(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/**
 * 往当天那页追加一段。同一天多次写就是多段，不覆盖。
 * @returns {{file: string, date: string, appended: boolean}}
 */
export function appendDiary(sharedRoot, text, options = {}) {
  const content = String(text || '').trim()
  if (!content) throw new Error('日记内容为空')
  if (content.length > 2000) throw new Error(`日记超长：${content.length} > 2000 字，请分开写`)
  const author = String(options.author || 'DeepSeek').trim().slice(0, 20)
  if (!AUTHOR_RE.test(author)) throw new Error('署名不合法')
  const date = String(options.date || today())
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期格式应为 YYYY-MM-DD')
  const at = options.at || hhmm()
  const file = diaryFile(sharedRoot, date)
  fs.mkdirSync(diaryDir(sharedRoot), { recursive: true })
  const exists = fs.existsSync(file)
  const header = exists ? '' : `# ${date}\n\n`
  const block = `## ${at} · ${author}\n\n${content}\n\n`
  writeAtomic(file, `${exists ? fs.readFileSync(file, 'utf8') : header}${block}`)
  return { file, date, appended: exists }
}

/** 读某一天；不存在返回 null。 */
export function readDiary(sharedRoot, date = today()) {
  const file = diaryFile(sharedRoot, date)
  if (!fs.existsSync(file)) return null
  return { file, date, text: fs.readFileSync(file, 'utf8') }
}

/** 最近 n 天有哪些日记页（新→旧）。 */
export function listDiary(sharedRoot, limit = 7) {
  const dir = diaryDir(sharedRoot)
  let files = []
  try {
    files = fs.readdirSync(dir).filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
  } catch {
    return []
  }
  return files
    .sort()
    .reverse()
    .slice(0, Math.max(1, limit))
    .map((name) => {
      const date = name.replace(/\.md$/, '')
      const full = path.join(dir, name)
      let preview = ''
      try {
        preview = fs.readFileSync(full, 'utf8').replace(/^#[^\n]*\n+/, '').replace(/\n+/g, ' ').slice(0, 60)
      } catch {
        /* 读不到就空着 */
      }
      return { date, file: full, preview }
    })
}
