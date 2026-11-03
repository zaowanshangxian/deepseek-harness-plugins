/**
 * dsh-memhub · 索引分类（可选增强）
 *
 * 生成 ~/.dsh/memhub/INDEX.md：记忆（按 tide/scope/项目分类）、技能分组、教训、自我、人格。
 * 会话启动/每轮只注入一行指过去，索引正文不常驻。
 */
import fs from 'node:fs'
import path from 'node:path'
import { writeAtomic } from './frontmatter.js'

function groupBy(items, keyOf) {
  const map = new Map()
  for (const item of items) {
    const key = keyOf(item) || '其他'
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(item)
  }
  return map
}

/**
 * @param {{sidecars:object[], skills:object[], lessons:object[], self:object|null, persona:object|null, memoryRoot:string}} input
 */
export function buildIndexDoc(input = {}) {
  const sidecars = input.sidecars || []
  const skills = input.skills || []
  const lessons = input.lessons || []
  const lines = ['# memhub 索引（分类目录，供会话开头读）', '']

  lines.push(`## 记忆（${sidecars.length} 条）`)
  const byTier = groupBy(sidecars, (item) => item.tier)
  for (const tier of ['core', 'long', 'event']) {
    const list = byTier.get(tier) || []
    if (list.length === 0) continue
    lines.push(`- ${tier}（${list.length}）`)
    for (const item of list.slice(0, 12)) lines.push(`  - ${item.title}（${item.kind}${item.projectPath ? `｜${item.projectPath}` : ''}）`)
  }
  lines.push('')

  lines.push(`## 技能（${skills.length} 个）`)
  for (const [group, items] of groupBy(skills, (item) => item.category || item.group)) {
    lines.push(`- ${group}（${items.length}）：${items.slice(0, 20).map((item) => item.name).join(' / ')}`)
  }
  lines.push('')

  lines.push(`## 教训（${lessons.length} 条）`)
  for (const lesson of lessons.slice(-10)) lines.push(`- ${lesson.trigger} → ${lesson.right}`)
  lines.push('')

  lines.push('## 自我')
  lines.push(input.self ? `- 最新叙述：${input.self.title}（${input.self.count} 段活跃，${input.self.archivedCount || 0} 段归档）` : '- （还没有自我叙述）')
  lines.push('')

  if (input.persona) {
    lines.push('## 性格蓝图')
    lines.push(
      `- ${input.persona.blueprint} ｜ warmth ${Number(input.persona.warmth || 0).toFixed(2)} ｜ playfulness ${Number(input.persona.playfulness || 0).toFixed(2)} ｜ clinginess ${Number(input.persona.clinginess || 0).toFixed(2)}`,
    )
    lines.push('')
  }

  lines.push('> 本文件由 memhub 生成，可随时重算；正文不注入，只注入路径。')
  return lines.join('\n')
}

export function writeIndexDoc(dir, text) {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'INDEX.md')
  writeAtomic(file, text)
  return file
}
