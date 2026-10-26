/**
 * 「更多表情和颜文字」Host 半侧。
 *
 * 只做一件事：给 Agent 一个 emoji_pack 工具，让它能取到成组的表情 / 颜文字 /
 * 文字表情 / 短句。面板（浏览器半侧）用的是同一份数据，由 tools/build.mjs 注入。
 *
 * 插件是可选的：tools 服务没就绪、或工具名被别的插件占了，都只降级不抛错。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

import { KINDS, PACKS } from './packs.mjs'

export const name = 'dsh-plugin-more-emoji'

const TOOL_NAME = 'emoji_pack'
const DEFAULT_COUNT = 12
const MAX_COUNT = 40

const KIND_BY_ID = new Map(KINDS.map((kind) => [kind.id, kind]))

function packTitle(pack) {
  const kind = KIND_BY_ID.get(pack.kind)
  return (kind ? kind.label : pack.kind) + '·' + pack.name
}

function catalogText() {
  const lines = ['可用分类（emoji_pack 的 category 参数可用 id 或名字片段）：']
  for (const kind of KINDS) {
    const packs = PACKS.filter((pack) => pack.kind === kind.id)
    const total = packs.reduce((sum, pack) => sum + pack.items.length, 0)
    lines.push('')
    lines.push(kind.label + '（kind=' + kind.id + '，共 ' + total + ' 条）')
    for (const pack of packs) {
      lines.push('- ' + kind.label + '/' + pack.name + '  id=' + pack.id + '  ' + pack.items.length + ' 条')
    }
  }
  lines.push('')
  lines.push(
    '用法：kind 选大类，category 选分类（id 或名字片段），query 做关键词过滤，count 控制条数（1-' +
      MAX_COUNT +
      '），random=true 随机取样。不带参数调用返回这份目录。',
  )
  return lines.join('\n')
}

function matchesQuery(pack, term) {
  const needle = term.toLowerCase()
  const haystack = (pack.id + ' ' + pack.name + ' ' + packTitle(pack)).toLowerCase()
  return haystack.includes(needle)
}

function pickItems(items, count, random) {
  if (items.length <= count) return items.slice()
  if (!random) return items.slice(0, count)
  const pool = items.slice()
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = pool[i]
    pool[i] = pool[j]
    pool[j] = tmp
  }
  return pool.slice(0, count)
}

function normalizeArgs(args) {
  const input = args && typeof args === 'object' ? args : {}
  const kind = typeof input.kind === 'string' && KIND_BY_ID.has(input.kind) ? input.kind : undefined
  const category = typeof input.category === 'string' && input.category.trim() !== '' ? input.category.trim() : undefined
  const query = typeof input.query === 'string' && input.query.trim() !== '' ? input.query.trim() : undefined
  const rawCount = Number(input.count)
  const count = Number.isFinite(rawCount) ? Math.max(1, Math.min(MAX_COUNT, Math.trunc(rawCount))) : DEFAULT_COUNT
  return { kind, category, query, count, random: input.random === true }
}

function selectPacks(args) {
  let packs = PACKS.slice()
  if (args.kind) packs = packs.filter((pack) => pack.kind === args.kind)
  if (args.category) {
    const term = args.category.toLowerCase()
    const byId = packs.filter((pack) => pack.id.toLowerCase() === term)
    const byName = packs.filter((pack) => matchesQuery(pack, term))
    packs = byId.length > 0 ? byId : byName
  }
  if (args.query) packs = packs.filter((pack) => matchesQuery(pack, args.query))
  return packs
}

function renderSelection(args) {
  const packs = selectPacks(args)
  if (packs.length === 0) {
    return '没有匹配的分类。不带参数调用 emoji_pack 可以看完整目录。'
  }

  // 一个分类：全部条目给出来（本来就选了分类，不再随机截断）。
  if (packs.length === 1) {
    const pack = packs[0]
    const items = args.random ? pickItems(pack.items, pack.items.length, true) : pack.items
    return '[' + packTitle(pack) + '] ' + pack.items.length + ' 条：\n' + items.join('  ')
  }

  // 多个分类：按分类取样，避免一次塞太多。
  const lines = []
  for (const pack of packs) {
    const perPack = Math.max(3, Math.ceil(args.count / Math.min(packs.length, 4)))
    const items = pickItems(pack.items, perPack, args.random)
    lines.push('[' + packTitle(pack) + '] ' + items.join('  '))
  }
  return lines.join('\n')
}

function execute(args) {
  const normalized = normalizeArgs(args)
  const hasSelector = Boolean(normalized.kind || normalized.category || normalized.query)
  const text = hasSelector ? renderSelection(normalized) : catalogText()
  return { text }
}

export function apply(ctx) {
  ctx.inject(['tools'], (toolsCtx) => {
    const tools = toolsCtx.tools
    if (!tools || typeof tools.register !== 'function') {
      toolsCtx.logger?.warn?.('[more-emoji] tools service not ready — emoji_pack unavailable')
      return
    }

    const definition = defineTool({
      name: TOOL_NAME,
      description:
        '取更多表情包 / 颜文字 / 文字表情 / 文字短句。emoji_pack({}) 返回分类目录；传入 kind 或 category 或 query 时返回对应条目，可直接粘贴进回复。emoji=Emoji 表情，kaomoji=日式颜文字，art=字符画文字表情，phrase=聊天短句。',
      parameters: {
        kind: {
          type: 'string',
          enum: KINDS.map((kind) => kind.id),
          description: '大类：emoji / kaomoji / art / phrase。省略则不限。',
        },
        category: {
          type: 'string',
          description: '分类 id 或名字片段，例如 emoji-heart、猫、夸夸。省略则不限。',
        },
        query: {
          type: 'string',
          description: '关键词过滤（匹配分类 id、名字）。',
        },
        count: {
          type: 'integer',
          description: '期望条数 1-' + MAX_COUNT + '，缺省 ' + DEFAULT_COUNT + '。选单个分类时返回该分类全部条目。',
        },
        random: {
          type: 'boolean',
          description: '是否随机取样。缺省 false（按固定顺序）。',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            text: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: String(value.text) }],
      },
      execute,
    })

    try {
      tools.register(definition)
      toolsCtx.logger?.info?.('[more-emoji] emoji_pack tool registered')
    } catch (error) {
      toolsCtx.logger?.warn?.('[more-emoji] emoji_pack registration skipped: ' + String(error))
    }
  })
}
