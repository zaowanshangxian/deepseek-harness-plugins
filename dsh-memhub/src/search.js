/**
 * dsh-memhub · 记忆检索（ROADMAP Step 4）
 *
 * 为什么单独成模块：原来打分写在 `tools-recall.js` 里，无法单测、无法做「改前/改后」对比。
 * 这里保留两档：
 *   - `v1`：迁移期用的老公式（token 命中，标题 3 倍、正文 1 倍，无 IDF）
 *   - `v2`：默认。token 命中 × IDF 稀有度 × 字段权重（标题 3 / 摘要 2 / 正文 1）
 *          + 整句短语加成 + 记忆别名扩展；可选实体扩展（星图里有实体时）
 * 不上向量：ROADMAP 明确「先复用 2-gram + 别名 + 实体扩展」。
 *
 * 排序：分数降序 → 更新时间降序；空查询直接给最近 N 条（与原行为一致）。
 */
import { queryTokens } from './indexer.js'

/** 记忆域别名（技能域那批在 indexer.ALIASES；这里补记忆里常见的同义说法）。 */
export const MEMORY_ALIASES = {
  记忆: ['记忆', 'memory', 'memhub'],
  插件: ['插件', 'plugin', 'dsh-'],
  卸载: ['卸载', '删除', '删掉', '清理', 'uninstall'],
  体检: ['体检', '审计', '健康', 'audit', 'health'],
  归档: ['归档', 'archive', '总结'],
  注入: ['注入', 'inject', '上下文', 'systemPrompt'],
  配置: ['配置', '设置', 'config', 'patch', 'yml', 'profile'],
  接入: ['接入', '接进', '安装', '部署', '连上', '打通'],
  接进: ['接入', '接进', '安装', '部署'],
  恢复: ['恢复', '还原', '修复', '回滚', '救回'],
  损坏: ['损坏', '坏了', '故障', '崩了', '打不开'],
  模型: ['模型', 'model', 'qwen', 'ollama'],
  汇报: ['汇报', '报告', '报表', 'report'],
  分盘: ['分盘', '作用域', 'scope'],
  沙箱: ['沙箱', 'sandbox', 'mock'],
  迁移: ['迁移', 'migrate', '搬迁'],
  人格: ['人格', 'persona', '人设', '性格'],
  检索: ['检索', '搜索', '搜索词', 'search', '召回'],
}

export const FIELD_WEIGHTS = { title: 3, summary: 2, content: 1 }

/** 查询 → token（技能域别名 + 记忆域别名都展开）。 */
export function expandQuery(query) {
  const q = String(query || '').toLowerCase().trim()
  const tokens = new Set(queryTokens(query))
  for (const [alias, expansions] of Object.entries(MEMORY_ALIASES)) {
    if (q.includes(alias)) for (const expansion of expansions) tokens.add(expansion.toLowerCase())
  }
  return [...tokens]
}

/** 文档频率 → IDF（平滑版；越稀有权重越高，压掉「的/是」这类到处都有的 token）。 */
export function buildIdf(items, tokens) {
  const idf = new Map()
  const total = items.length || 1
  for (const token of tokens) {
    let df = 0
    for (const item of items) {
      const haystack = `${item.title || ''} ${item.summary || ''} ${item.content || ''}`.toLowerCase()
      if (haystack.includes(token)) df += 1
    }
    idf.set(token, Math.log(1 + total / (1 + df)))
  }
  return idf
}

function fieldsOf(item) {
  return {
    title: String(item.title || '').toLowerCase(),
    summary: String(item.summary || '').toLowerCase(),
    content: String(item.content || '').toLowerCase(),
  }
}

/** 单个 token 在一条记忆上的得分：字段权重 × token 长度 × IDF。 */
function tokenScore(fields, token, idf, weights) {
  const lengthBoost = token.length >= 2 ? 2 : 1
  const rarity = idf?.get(token) ?? 1
  let best = 0
  if (fields.title.includes(token)) best = weights.title
  if (fields.summary.includes(token)) best = Math.max(best, weights.summary)
  if (fields.content.includes(token)) best = Math.max(best, weights.content)
  return best * lengthBoost * rarity
}

/** v1：迁移期老公式（对照用，别改）。 */
function scoreV1(item, tokens) {
  const title = String(item.title || '').toLowerCase()
  const body = String(item.content || '').toLowerCase()
  let score = 0
  for (const token of tokens) {
    if (!token) continue
    const weight = token.length >= 2 ? 2 : 1
    if (title.includes(token)) score += weight * 3
    else if (body.includes(token)) score += weight
  }
  return score
}

/** v2：IDF + 字段权重 + 整句短语加成（可选实体加成）。 */
function scoreV2(item, tokens, options) {
  const fields = fieldsOf(item)
  const idf = options.idf
  let score = 0
  for (const token of tokens) {
    if (token) score += tokenScore(fields, token, idf, options.weights)
  }
  const phrase = String(options.phrase || '').toLowerCase()
  if (phrase && phrase.length >= 2) {
    if (fields.title.includes(phrase)) score += 6
    else if (fields.summary.includes(phrase)) score += 3
    else if (fields.content.includes(phrase)) score += 2
  }
  const entityNames = options.entityIndex?.get(item.id)
  if (entityNames) {
    for (const name of entityNames) {
      if (phrase && phrase.includes(String(name).toLowerCase())) score += 2
    }
  }
  return score
}

/**
 * 检索记忆。
 * @param {object[]} items sidecar 或 orb 记录
 * @param {string} query
 * @param {{limit?:number, mode?:'v1'|'v2', entityIndex?:Map<string,string[]>, weights?:object, now?:number}} options
 */
export function searchMemories(items = [], query = '', options = {}) {
  const limit = Number(options.limit) > 0 ? Math.min(Number(options.limit), 10) : 5
  const mode = options.mode === 'v1' ? 'v1' : 'v2'
  const active = items.filter((item) => !item.archived && item.status !== 'archived')
  const q = String(query || '').trim()
  if (!q) {
    return [...active]
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
      .slice(0, limit)
      .map((item) => ({ item, score: 0 }))
  }
  const tokens = mode === 'v1' ? queryTokens(q) : expandQuery(q)
  const weights = { ...FIELD_WEIGHTS, ...(options.weights || {}) }
  const idf = mode === 'v2' ? buildIdf(active, tokens) : null
  const demote = Number(options.supersededFactor) > 0 ? Number(options.supersededFactor) : 0.35
  const scored = active
    .map((item) => {
      const raw = mode === 'v1' ? scoreV1(item, tokens) : scoreV2(item, tokens, { idf, phrase: q, weights, entityIndex: options.entityIndex })
      // 被取代的旧结论：仍可搜到（可追溯），但降权到 35%，别再把旧结论排前面
      return { item, score: item.supersededBy ? raw * demote : raw }
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || Number(right.item.updatedAt || 0) - Number(left.item.updatedAt || 0))
  return scored.slice(0, limit)
}
