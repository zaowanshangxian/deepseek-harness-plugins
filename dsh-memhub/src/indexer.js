/**
 * dsh-memhub · 技能索引器（纯逻辑，零依赖，可单测）
 *
 * 职责：扫描技能库 → 解析 SKILL.md frontmatter → 结构化条目 → 检索/列表/索引行。
 * 约束：只读技能文件；不写 SKILL.md；不认识 YAML 嵌套（我们只用扁平 key: value）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseFrontmatter, hasFlag } from './frontmatter.js'

export { parseFrontmatter } from './frontmatter.js'

/** 没有 cost 字段时按正文长度估算（约 0.5 token/字符，保守）。 */
export function estimateCost(bodyChars) {
  return Math.max(50, Math.round(Number(bodyChars || 0) * 0.5))
}

/** 扫描技能库，返回 { vault, entries, errors }。 */
export function loadVault(vault) {
  const entries = []
  const errors = []
  let dirs = []
  try {
    dirs = fs
      .readdirSync(vault, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
  } catch (error) {
    return { vault, entries, errors: [{ dir: vault, error: `技能库不可读：${String(error)}` }] }
  }

  for (const dir of dirs) {
    const file = path.join(vault, dir, 'SKILL.md')
    if (!fs.existsSync(file)) continue
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch (error) {
      errors.push({ dir, error: `读取失败：${String(error)}` })
      continue
    }
    const { meta, body, ok } = parseFrontmatter(text)
    if (!ok) errors.push({ dir, error: '没有 frontmatter' })
    else if (!meta.description) errors.push({ dir, error: '缺少 description' })
    const name = meta.name || dir
    if (name !== dir) errors.push({ dir, error: `name 与目录名不一致：${name}` })

    entries.push({
      name,
      dir,
      file,
      description: meta.description || '',
      trigger: meta.trigger || meta.description || '',
      group: meta.group || '未分组',
      cost: Number(meta.cost) || estimateCost(body.length),
      version: meta.version || '0.0.0',
      hidden: hasFlag(text),
      bodyChars: body.length,
    })
  }

  const seen = new Map()
  let signature = 0
  for (const entry of entries) {
    try {
      signature += fs.statSync(entry.file).mtimeMs
    } catch {
      /* 文件消失时签名不变，下次重扫 */
    }
    if (seen.has(entry.name)) errors.push({ dir: entry.dir, error: `重名：${entry.name}` })
    else seen.set(entry.name, entry.dir)
  }

  return { vault, entries, errors, signature }
}

/** 中文任务词 → 技能关键词。纯子串匹配在中文上太脆，这张小表是补丁。 */
const ALIASES = {
  排障: ['诊断', '排查', 'bug', 'debug'],
  调试: ['诊断', '排查', 'bug'],
  测试: ['测试', 'tdd'],
  验证: ['验证', '验收'],
  交付: ['交付', '验收', '完成', '验证'],
  验收: ['验收', '验证', '完成'],
  ppt: ['ppt', '幻灯片', '演示'],
  幻灯片: ['ppt', '幻灯片'],
  文档: ['文档', 'word', 'excel', 'office'],
  调研: ['调研', '研究'],
  架构: ['架构', 'archify'],
  复盘: ['复盘', 'retro'],
  规划: ['规划', '需求', '决策'],
  工单: ['工单', 'tickets', '拆'],
  拆票: ['工单', 'tickets', '拆'],
  需求: ['需求', 'align', 'requirements'],
  重构: ['重构', 'refactor'],
  审查: ['审查', 'review'],
}

/** 技能用途分类（「技能就是流程规范」）：流程规范 / 规划思考 / 文档内容 / 记忆自我 / 其他。 */
const CATEGORY_BY_NAME = {
  tdd: '流程规范', implement: '流程规范', 'implement-spec': '流程规范', 'to-spec': '流程规范',
  'to-tickets': '流程规范', 'code-review': '流程规范', 'diagnosing-bugs': '流程规范',
  'verification-before-completion': '流程规范', pr: '流程规范', triage: '流程规范', retro: '流程规范',
  handoff: '流程规范', 'improve-codebase-architecture': '流程规范', prototype: '流程规范',
  wizard: '流程规范', wayfinder: '流程规范', 'codebase-design': '流程规范',
  'align-requirements': '规划思考', 'to-questionnaire': '规划思考', 'ask-matt': '规划思考',
  'skill-index': '规划思考', grilling: '规划思考', 'grill-me': '规划思考', 'grill-with-docs': '规划思考',
  'domain-modeling': '规划思考', 'writing-for-agents': '规划思考',
  officecli: '文档内容', 'ppt-design-skill': '文档内容', archify: '文档内容', 'note-format': '文档内容',
  research: '文档内容', teach: '文档内容', 'vox-director': '文档内容',
  'memory-cloud-review': '记忆自我', enhancement: '记忆自我', 'i-have-adhd': '记忆自我',
  'wait-what': '记忆自我', 'browser-skill': '记忆自我', 'archive-summarize': '记忆自我',
}

/** 一条技能的用途分类；没有显式映射时退到 frontmatter 的 group。 */
export function skillCategory(entry) {
  if (!entry) return '其他'
  return CATEGORY_BY_NAME[entry.name] || (entry.group && entry.group !== '未分组' ? entry.group : '其他')
}

const STOPWORDS = new Set([
  '的', '了', '是', '我', '你', '他', '要', '做', '前', '后', '和', '与',
  '把', '个', '这', '那', '一', '先', '再', '用', '并', '吧', '呢',
])

/** 查询 → token 集合：英文词 + 中文原词 + 中文 2-gram + 别名扩展。 */
export function queryTokens(query) {
  const q = String(query || '').toLowerCase().trim()
  const tokens = new Set()
  for (const match of q.matchAll(/[a-z0-9][a-z0-9-]*/g)) tokens.add(match[0])
  for (const match of q.matchAll(/[\u4e00-\u9fa5]+/g)) {
    const segment = match[0]
    if (!STOPWORDS.has(segment)) tokens.add(segment)
    for (let i = 0; i + 1 < segment.length; i += 1) {
      const bigram = segment.slice(i, i + 2)
      if (!STOPWORDS.has(bigram)) tokens.add(bigram)
    }
  }
  for (const [alias, expansions] of Object.entries(ALIASES)) {
    if (q.includes(alias)) for (const expansion of expansions) tokens.add(expansion.toLowerCase())
  }
  return [...tokens]
}

/**
 * 检索：token 命中制（中文 2-gram + 别名扩展），名字命中权重最高。
 * 返回条目数组（已按分数降序，最多 limit 条）。
 */
export function searchSkills(entries, query, options = {}) {
  const limit = Number(options.limit) > 0 ? Math.min(Number(options.limit), 8) : 3
  const group = options.group ? String(options.group) : ''
  const tokens = queryTokens(query)
  if (tokens.length === 0) return entries.slice(0, limit)

  const scored = []
  for (const entry of entries) {
    if (group && entry.group !== group) continue
    const fields = {
      name: entry.name.toLowerCase(),
      trigger: entry.trigger.toLowerCase(),
      description: entry.description.toLowerCase(),
      group: entry.group.toLowerCase(),
    }
    let score = 0
    let matched = 0
    for (const token of tokens) {
      let best = 0
      for (const [key, value] of Object.entries(fields)) {
        if (value.includes(token)) {
          best = Math.max(best, key === 'name' ? 3 : key === 'trigger' ? 2 : 1)
        }
      }
      if (best > 0) {
        score += best
        matched += 1
      }
    }
    if (matched === 0) continue
    score += matched
    scored.push({ score, entry })
  }

  scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
  return scored.slice(0, limit).map((item) => item.entry)
}

/** 候选卡文本：只有判断所需信息，不含全文。 */
export function formatCards(entries, query = '') {
  if (!entries.length) {
    return `技能库里没有匹配「${query}」的技能。换关键词试试，或用 skill_list 浏览全部分组。`
  }
  const lines = entries.map((entry) => {
    const desc = entry.description.length > 40 ? `${entry.description.slice(0, 40)}…` : entry.description
    return `- ${entry.name} ｜ ${desc} ｜ 组:${entry.group} ｜ ≈${entry.cost} tokens ｜ v${entry.version}`
  })
  return `找到 ${entries.length} 个候选（先看卡片，要用再 skill_load 取全文）：\n${lines.join('\n')}`
}

/** 全库列表：按分组列名字（省 token，不给描述）。 */
export function formatList(entries) {
  const groups = new Map()
  for (const entry of entries) {
    if (!groups.has(entry.group)) groups.set(entry.group, [])
    groups.get(entry.group).push(entry.name)
  }
  const lines = [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([group, names]) => `- ${group}（${names.length}）：${names.join(' / ')}`)
  return `技能库 ${entries.length} 个技能，${groups.size} 个分组：\n${lines.join('\n')}`
}

/** 派生索引（JSONL，一行一条；可重扫，不是真源）。 */
export function toIndexLines(entries) {
  const lines = entries.map((entry) =>
    JSON.stringify({
      name: entry.name,
      dir: entry.dir,
      description: entry.description,
      trigger: entry.trigger,
      group: entry.group,
      cost: entry.cost,
      version: entry.version,
      hidden: entry.hidden,
      bodyChars: entry.bodyChars,
    }),
  )
  return `${lines.join('\n')}\n`
}

/** 预算统计（字符 + 保守 token 估算）。 */
export function budgetReport(entries, tokenPerChar = 0.65) {
  const descChars = entries.reduce((sum, entry) => sum + entry.description.length, 0)
  const bodyChars = entries.reduce((sum, entry) => sum + entry.bodyChars, 0)
  return {
    count: entries.length,
    descChars,
    descTokens: Math.round(descChars * tokenPerChar),
    bodyChars,
    bodyTokens: Math.round(bodyChars * tokenPerChar),
  }
}
