/**
 * 「更多表情和颜文字」Host 半侧。
 *
 * 职责：
 * 1. emoji_pack 工具：取表情/颜文字/文字表情/短句，并按用户配置过滤与加权；
 * 2. 系统提示：告诉模型工具用法，以及用户允许的分类 / 常用词（优先发送）；
 * 3. 配置 API：把客户端设置页的改动持久化到 DSH_HOME/more-emoji/settings.json，
 *    供模型工具与客户端面板共同读取（单一数据源）。
 *
 * 全部降级安全：tools / systemPrompt / webServer 任一不可用都只跳过，不抛错。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'

import { KINDS, PACKS } from './packs.mjs'

export const name = 'dsh-plugin-more-emoji'

const TOOL_NAME = 'emoji_pack'
const DEFAULT_COUNT = 12
const MAX_COUNT = 40
const PROMPT_SECTION = 'more-emoji-usage'
const PROMPT_CONTEXT = 'more-emoji-settings'
const API_PREFIX = '/more-emoji'
const MAX_CUSTOM_WORDS = 200
const MAX_CUSTOM_LENGTH = 80

const DSH_HOME = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
const SETTINGS_DIR = join(DSH_HOME, 'more-emoji')
const SETTINGS_PATH = join(SETTINGS_DIR, 'settings.json')

const KIND_BY_ID = new Map(KINDS.map((kind) => [kind.id, kind]))
const PACK_BY_ID = new Map(PACKS.map((pack) => [pack.id, pack]))

const DEFAULT_SETTINGS = {
  hideClient: false, // 隐藏客户端面板（😊 按钮与浮层），配置页仍可用
  preferCustom: true, // 优先发送常用词/常用表情（提高权重）
  allowedPacks: [], // 允许发送的分类 id；空数组 = 全部允许
  customWords: [], // 客户端添加的常用词/常用表情
  preferFavorites: true, // 客户端收藏的表情是否也参与优先
  favoriteItems: [], // 客户端收藏同步上来的条目（模型侧加权）
}

// ── 设置存取 ─────────────────────────────────────────────────────────
function sanitizeSettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const allowed = Array.isArray(input.allowedPacks)
    ? Array.from(new Set(input.allowedPacks.filter((id) => typeof id === 'string' && PACK_BY_ID.has(id))))
    : []
  const customWords = Array.isArray(input.customWords)
    ? Array.from(
        new Set(
          input.customWords
            .filter((word) => typeof word === 'string')
            .map((word) => word.trim().slice(0, MAX_CUSTOM_LENGTH))
            .filter((word) => word !== ''),
        ),
      ).slice(0, MAX_CUSTOM_WORDS)
    : []
  const favoriteItems = Array.isArray(input.favoriteItems)
    ? Array.from(
        new Set(
          input.favoriteItems
            .filter((word) => typeof word === 'string')
            .map((word) => word.trim().slice(0, MAX_CUSTOM_LENGTH))
            .filter((word) => word !== ''),
        ),
      ).slice(0, MAX_CUSTOM_WORDS)
    : []
  return {
    hideClient: input.hideClient === true,
    preferCustom: input.preferCustom !== false,
    preferFavorites: input.preferFavorites !== false,
    allowedPacks: allowed,
    customWords,
    favoriteItems,
  }
}

function readSettings() {
  try {
    const raw = readFileSync(SETTINGS_PATH, 'utf8')
    return sanitizeSettings(JSON.parse(raw))
  } catch {
    return sanitizeSettings(DEFAULT_SETTINGS)
  }
}

function writeSettings(patch) {
  const merged = sanitizeSettings(Object.assign({}, readSettings(), patch && typeof patch === 'object' ? patch : {}))
  let persisted = true
  try {
    mkdirSync(SETTINGS_DIR, { recursive: true })
    const tmp = SETTINGS_PATH + '.tmp'
    writeFileSync(tmp, JSON.stringify(merged, null, 2))
    renameSync(tmp, SETTINGS_PATH)
  } catch {
    // 写失败要如实告诉客户端，避免「界面显示已保存、模型侧其实没变」。
    persisted = false
  }
  return { settings: merged, persisted }
}

function ensureSettingsFile() {
  try {
    if (!existsSync(SETTINGS_PATH)) {
      mkdirSync(SETTINGS_DIR, { recursive: true })
      writeFileSync(SETTINGS_PATH, JSON.stringify(sanitizeSettings(DEFAULT_SETTINGS), null, 2))
    }
  } catch {
    /* 只影响首次落盘，读路径有默认值兜底 */
  }
}

function allowedPackIds(settings) {
  return settings.allowedPacks.length > 0 ? new Set(settings.allowedPacks) : null
}

// ── 工具输出 ─────────────────────────────────────────────────────────
function packTitle(pack) {
  const kind = KIND_BY_ID.get(pack.kind)
  return (kind ? kind.label : pack.kind) + '·' + pack.name
}

function priorityItems(settings) {
  const words = settings.preferCustom ? settings.customWords : []
  const favorites = settings.preferFavorites ? settings.favoriteItems : []
  return Array.from(new Set([].concat(words, favorites))).slice(0, 40)
}

function customBlock(settings) {
  const items = priorityItems(settings)
  if (items.length === 0) return []
  return [
    '[常用优先] 用户设置的常用/收藏表情，能自然用上时优先用它们：',
    items.join('  '),
    '',
  ]
}

function catalogText(settings) {
  const allow = allowedPackIds(settings)
  const lines = customBlock(settings)
  lines.push('可用分类（emoji_pack 的 category 参数可用 id 或名字片段）：')
  for (const kind of KINDS) {
    const packs = PACKS.filter((pack) => pack.kind === kind.id && (!allow || allow.has(pack.id)))
    const total = packs.reduce((sum, pack) => sum + pack.items.length, 0)
    lines.push('')
    lines.push(kind.label + '（kind=' + kind.id + '，共 ' + total + ' 条）')
    for (const pack of packs) {
      lines.push('- ' + kind.label + '/' + pack.name + '  id=' + pack.id + '  ' + pack.items.length + ' 条')
    }
  }
  if (allow) lines.push('', '（用户只允许了部分分类，未列出的分类不可用。）')
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

function selectPacks(args, settings) {
  const allow = allowedPackIds(settings)
  let packs = PACKS.filter((pack) => !allow || allow.has(pack.id))
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

function renderSelection(args, settings) {
  const packs = selectPacks(args, settings)
  const head = customBlock(settings)
  if (packs.length === 0) {
    return (
      head.join('\n') +
      (head.length > 0 ? '\n' : '') +
      '没有匹配的分类。不带参数调用 emoji_pack 可以看完整（或用户允许的）目录。'
    )
  }

  // 一个分类：全部条目给出来（本来就选了分类，不再随机截断）。
  if (packs.length === 1) {
    const pack = packs[0]
    const items = args.random ? pickItems(pack.items, pack.items.length, true) : pack.items
    return head.join('\n') + '[' + packTitle(pack) + '] ' + pack.items.length + ' 条：\n' + items.join('  ')
  }

  const lines = head.slice()
  for (const pack of packs) {
    const perPack = Math.max(3, Math.ceil(args.count / Math.min(packs.length, 4)))
    const items = pickItems(pack.items, perPack, args.random)
    lines.push('[' + packTitle(pack) + '] ' + items.join('  '))
  }
  return lines.join('\n')
}

function execute(args) {
  const settings = readSettings()
  const normalized = normalizeArgs(args)
  const hasSelector = Boolean(normalized.kind || normalized.category || normalized.query)
  return { text: hasSelector ? renderSelection(normalized, settings) : catalogText(settings) }
}

// ── 系统提示 ─────────────────────────────────────────────────────────
const AGENT_GUIDE = [
  '[更多表情和颜文字] 本机装了 DSH 插件「更多表情和颜文字」。你可以调用 emoji_pack 工具获取表情/颜文字/文字表情/短句，再自然地点缀到回复里。',
  '- emoji_pack({}) 返回分类目录；传 kind（emoji / kaomoji / art / phrase）、category（分类 id 或名字片段，如 emoji-love、猫、夸夸）、query、count、random 取具体条目。',
  '- 用法建议：按用户语气和场景少量使用，一条回复 1-3 个为宜，不要堆砌；正式/严肃内容、代码解释里不要加。用户明确说别用表情时不要用。',
  '- 用户界面上还有图片贴纸面板（输入框左侧 😊 按钮），那是给用户发送用的；你不需要也不应该声称自己发了图片。',
].join('\n')

function settingsPromptText() {
  const settings = readSettings()
  const lines = ['[更多表情和颜文字 · 用户配置]']
  if (settings.allowedPacks.length > 0) {
    const names = settings.allowedPacks
      .map((id) => {
        const pack = PACK_BY_ID.get(id)
        return pack ? packTitle(pack) : id
      })
      .filter(Boolean)
    lines.push('- 用户只允许这些表情分类：' + names.join('、') + '。请只从这些分类里选。')
  }
  const preferred = priorityItems(settings)
  if (preferred.length > 0) {
    lines.push(
      '- 用户把这些设为「常用/收藏表情」，需要发表情时优先用它们：' +
        preferred.join('、') +
        '。它们权重更高，能自然用上就用。',
    )
  }
  if (lines.length === 1) lines.push('- 用户未限制分类，也没有设置常用表情。')
  return lines.join('\n')
}

function registerTools(ctx) {
  ctx.inject(['tools'], (toolsCtx) => {
    const tools = toolsCtx.tools
    if (!tools || typeof tools.register !== 'function') {
      toolsCtx.logger?.warn?.('[more-emoji] tools service not ready — emoji_pack unavailable')
      return
    }

    const definition = defineTool({
      name: TOOL_NAME,
      description:
        '取更多表情包 / 颜文字 / 文字表情 / 文字短句。emoji_pack({}) 返回分类目录；传入 kind 或 category 或 query 时返回对应条目，可直接粘贴进回复。会遵循用户配置：只返回用户允许的分类，并优先给出用户设置的常用表情。emoji=Emoji 表情，kaomoji=日式颜文字，art=字符画文字表情，phrase=聊天短句。',
      parameters: {
        kind: {
          type: 'string',
          enum: KINDS.map((kind) => kind.id),
          description: '大类：emoji / kaomoji / art / phrase。省略则不限。',
        },
        category: {
          type: 'string',
          description: '分类 id 或名字片段，例如 emoji-love、猫、夸夸。省略则不限。',
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

function registerPrompt(ctx) {
  ctx.inject(['systemPrompt'], (promptCtx) => {
    try {
      promptCtx.systemPrompt.section({ name: PROMPT_SECTION, order: 2950, text: AGENT_GUIDE })
      promptCtx.systemPrompt.context({
        name: PROMPT_CONTEXT,
        order: 96,
        text: () => {
          try {
            return settingsPromptText()
          } catch {
            return ''
          }
        },
      })
    } catch (error) {
      promptCtx.logger?.warn?.('[more-emoji] system prompt skipped: ' + String(error))
    }
  })
}

// ── 配置 API（客户端设置页读写）──────────────────────────────────────
function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

async function readBody(req) {
  const MAX_BODY = 64 * 1024
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('body too large')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim() === '') return {}
  return JSON.parse(raw)
}

function registerSettingsApi(ctx) {
  ctx.inject(['webServer'], (webCtx) => {
    try {
      const handler = async (req, res) => {
        try {
          // 同源校验：只接受同源页面发来的写请求；curl 之类没有 Origin 的本地请求放行。
          const origin = req.headers ? req.headers.origin : undefined
          if (origin) {
            let sameOrigin = false
            try {
              sameOrigin = new URL(origin).host === req.headers.host
            } catch {
              sameOrigin = false
            }
            if (!sameOrigin) {
              sendJson(res, 403, { ok: false, error: 'cross-origin request refused' })
              return
            }
          }

          const path = String(req.url || '').split('?')[0].replace(/\/+$/, '')
          if (path.endsWith('/api/settings')) {
            if (req.method === 'GET') {
              sendJson(res, 200, { ok: true, settings: readSettings() })
              return
            }
            if (req.method === 'POST') {
              let body = null
              try {
                body = await readBody(req)
              } catch (error) {
                const message = String(error && error.message ? error.message : error)
                sendJson(res, message === 'body too large' ? 413 : 400, { ok: false, error: message })
                return
              }
              if (!body || typeof body !== 'object' || Array.isArray(body)) {
                sendJson(res, 400, { ok: false, error: 'body must be a JSON object' })
                return
              }
              const result = writeSettings(body)
              sendJson(res, 200, { ok: result.persisted, persisted: result.persisted, settings: result.settings })
              return
            }
          }
          sendJson(res, 404, { ok: false, error: 'unknown more-emoji endpoint' })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) })
        }
      }
      // 交给 effect 托管：插件热重载/卸载时路由一起释放，避免重复注册。
      webCtx.effect(
        () => webCtx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler }),
        'more-emoji: settings API route',
      )
      webCtx.logger?.info?.('[more-emoji] settings API registered at ' + API_PREFIX + '/api/settings')
    } catch (error) {
      webCtx.logger?.warn?.('[more-emoji] settings API skipped: ' + String(error))
    }
  })
}

export function apply(ctx) {
  ensureSettingsFile()
  registerTools(ctx)
  registerPrompt(ctx)
  registerSettingsApi(ctx)
}
