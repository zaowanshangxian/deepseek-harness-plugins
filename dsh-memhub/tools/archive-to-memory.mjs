#!/usr/bin/env node
/**
 * 归档 → 记忆：把 `.dsh/archive/logs` 下的会话总结同步成 orb 记忆。
 *
 * 为什么要有这一步：会话归档（`.dsh/archive/`）记的是**这一次会话发生了什么**；
 * 记忆（orb）记的是**以后还该记得的结论**。两者不能混，也不该散落——
 * 所以统一出口只有一处：`~/.dsh/memhub/orbs` 与 `L:\DSH\shared\memhub\orbs`。
 *
 * 用法：
 *   node tools/archive-to-memory.mjs              # 只同步今天归档的
 *   node tools/archive-to-memory.mjs --date 2026-11-05
 *   node tools/archive-to-memory.mjs --all        # 全量回填（首次用一次）
 *   node tools/archive-to-memory.mjs --dry-run    # 只看要写什么
 *
 * 幂等：orb id = `arc_<归档文件名>`，已存在就跳过。
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseFrontmatter, stripFrontmatter } from '../src/frontmatter.js'
import { saveOrb, loadOrbs } from '../src/orb-store.js'
import { DATA_ROOT, DEFAULT_SHARED_ROOT } from '../src/const.js'
import { similarity } from '../src/similarity.js'

const args = process.argv.slice(2)
const has = (flag) => args.includes(flag)
const value = (flag, fallback) => {
  const index = args.indexOf(flag)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

const dryRun = has('--dry-run')
const all = has('--all')
const date = value('--date', '')
const sharedRoot = value('--shared', DEFAULT_SHARED_ROOT)

const ROOTS = [
  { dir: 'L:\\DSH\\work\\.dsh\\archive\\logs', scope: 'project', projectPath: 'L:\\DSH\\work', label: 'work' },
  { dir: 'L:\\DSH\\DeepSeek\\.dsh\\archive\\logs', scope: 'self', projectPath: '', label: 'DeepSeek' },
]

const existingOrbs = loadOrbs(DATA_ROOT, sharedRoot).entries
const existingIds = new Set(existingOrbs.map((orb) => orb.id))
// 去重阈值：归档总结之间「同源」概率高（同一次归档的多次尝试、同一天多段），
// 所以用 0.5 而不是记忆库的 0.6；实测那对同分钟归档正文相似度 0.535，该判重复。
const THRESHOLD = Number(value('--threshold', 0.5)) || 0.5
const textOf = (item) => `${item.title || ''} ${String(item.content || '').slice(0, 1200)}`
const accepted = [] // 本批已通过的，防批内重复
let skippedDupe = 0
const today = new Date().toISOString().slice(0, 10)
const wantDate = date || (all ? '' : today)

let scanned = 0
let written = 0
let skipped = 0
const touched = []

for (const root of ROOTS) {
  let files = []
  try {
    files = fs.readdirSync(root.dir).filter((name) => name.endsWith('.md'))
  } catch {
    continue
  }
  for (const name of files) {
    const full = path.join(root.dir, name)
    let text = ''
    try {
      text = fs.readFileSync(full, 'utf8')
    } catch {
      continue
    }
    const { meta } = parseFrontmatter(text)
    const created = String(meta.created || '').slice(0, 10)
    if (wantDate && created && created !== wantDate) continue
    if (wantDate && !created) {
      const mtime = fs.statSync(full).mtime.toISOString().slice(0, 10)
      if (mtime !== wantDate) continue
    }
    scanned += 1

    const id = `arc_${name.replace(/\.md$/, '')}`
    if (existingIds.has(id)) {
      skipped += 1
      continue
    }
    const body = stripFrontmatter(text).trim()
    if (!body) continue
    const firstLine = body
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('#') && !line.startsWith('|') && !/^-{2,}$/.test(line))
    const titleDate = created || today
    const title = `${titleDate} 会话归档（${root.label}）：${String(firstLine || name).replace(/^[\s#]+/, '').slice(0, 50)}`
    const clipped = body.length > 1900 ? `${body.slice(0, 1900)}\n\n…（截断；全文见 ${full}）` : body
    // 用归档当时的日期当 updatedAt（不是回填时刻），否则旧会话会挤占注入的「最近 3 条」
    const archivedAt = Date.parse(String(meta.created || '').replace(' ', 'T')) || Date.now()

    // 去重：和已有 orb、以及本批已通过的比；相似度 ≥ 阈值就跳过（只报不改，人工可复核）
    const candidate = { id, title, content: clipped }
    const dupe = [...existingOrbs, ...accepted].find(
      (orb) => similarity(textOf(candidate), textOf(orb)) >= THRESHOLD,
    )
    if (dupe) {
      skippedDupe += 1
      console.log(`跳过重复：${id} ≈ ${dupe.id}（${String(dupe.title || '').slice(0, 30)}）`)
      continue
    }

    if (dryRun) {
      console.log(`[dry-run] 会写 ${id} ｜ ${root.scope} ｜ ${title}`)
      touched.push(id)
      accepted.push(candidate)
      continue
    }
    try {
      saveOrb(
        {
          id,
          title,
          content: clipped,
          kind: 'event',
          scope: root.scope,
          projectPath: root.projectPath,
          importance: 3,
          tags: ['archive', root.label],
          createdAt: archivedAt,
          updatedAt: archivedAt,
        },
        DATA_ROOT,
        sharedRoot,
      )
      written += 1
      touched.push(id)
      accepted.push(candidate)
    } catch (error) {
      console.log(`写入失败 ${id}：${String(error.message || error)}`)
    }
  }
}

console.log(
  `${dryRun ? '[dry-run] ' : ''}扫描 ${scanned} 个归档${wantDate ? `（${wantDate}）` : '（全部）'}｜` +
    `写入 ${written}｜跳过 ${skipped}（已存在）｜去重 ${skippedDupe}（相似度 ≥ ${THRESHOLD}）`,
)
if (touched.length) console.log(`涉及 id：${touched.slice(0, 5).join(', ')}${touched.length > 5 ? '…' : ''}`)
if (scanned === 0) console.log(`没有 ${wantDate || '任何'} 的归档总结。归档由哥哥手动做，跑完再执行本脚本。`)
