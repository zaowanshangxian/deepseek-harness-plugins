/**
 * dsh-memhub · 第 3 期：晋升（记忆 → 技能草案）与技能台账（成功/失败回写、改版提案）
 *
 * 三条边必须人确认：本模块只生成草案/提案文本，不自动写技能、不改规则。
 */
import fs from 'node:fs'
import path from 'node:path'

export const LEDGER_FILE = 'skill-ledger.jsonl'

export function loadLedger(dir) {
  const file = path.join(dir, LEDGER_FILE)
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

export function saveLedger(dir, entries) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, LEDGER_FILE), `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8')
}

/** 回写一次技能执行结果：append-only，不改写旧台账（坏行也不会被抹掉）。 */
export function recordOutcome(dir, skill, success, note = '') {
  fs.mkdirSync(dir, { recursive: true })
  const line = JSON.stringify({
    skill: String(skill || ''),
    success: Boolean(success),
    note: String(note || '').slice(0, 200),
    at: new Date().toISOString(),
  })
  fs.appendFileSync(path.join(dir, LEDGER_FILE), `${line}\n`, 'utf8')
  return loadLedger(dir).length
}

/** 汇总每个技能的成功率（只统计 ≥1 次的）。 */
export function summarizeLedger(entries) {
  const bySkill = new Map()
  for (const entry of entries) {
    const key = String(entry.skill || '')
    if (!key) continue
    const item = bySkill.get(key) || { skill: key, total: 0, success: 0, last: null }
    item.total += 1
    if (entry.success) item.success += 1
    item.last = entry.at || item.last
    bySkill.set(key, item)
  }
  return [...bySkill.values()].map((item) => ({ ...item, rate: item.total ? item.success / item.total : 0 }))
}

/** 失败率高的技能 → 改版提案（≥ minCalls 次才作数）。 */
export function revisionProposal(summary, minCalls = 10, maxFailRate = 0.5) {
  return summary.filter((item) => item.total >= minCalls && 1 - item.rate >= maxFailRate)
}

/**
 * 从 N 条记忆生成技能草案（≥3 条才提，且必须人确认才落盘）。
 * 返回 { error } 或 { draft }。
 */
export function draftSkillFromMemories(memories, ids, options = {}) {
  const selected = memories.filter((memory) => ids.includes(memory.id))
  if (selected.length < 3) return { error: `至少 3 条同类记忆才能提草案（当前 ${selected.length} 条）。` }
  const name = String(options.name || 'draft-skill').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'draft-skill'
  const lines = [
    `# 技能草案：${name}`,
    '',
    '> 由 memhub 从记忆生成，**必须人工确认后再写入技能库**。',
    '',
    '## 触发',
    `当 ${String(options.trigger || '同类操作再次出现')} 时。`,
    '',
    '## 步骤（从记忆归纳）',
    ...selected.map((memory, index) => `${index + 1}. ${String(memory.title || '').slice(0, 40)}：${String(memory.content || '').slice(0, 80)}`),
    '',
    '## 完成标准',
    '按步骤做完，并留下可核对的结果（命令输出 / 文件 / 记录）。',
  ]
  return {
    draft: {
      name,
      trigger: String(options.trigger || ''),
      group: String(options.group || '未分组'),
      content: lines.join('\n'),
      basedOn: selected.map((memory) => memory.id),
    },
  }
}
