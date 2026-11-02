// dsh-plugin-tool-tax — Host 半。
//
// 「工具税」只回答一个问题：**每一轮对话，光是把工具定义塞进提示词，要花多少 token？**
//
// 数据来源只有一个：`ctx.tools.schemas()` —— DSH 自己把「模型能看到的工具定义」投影出来的
// 那份 schema 集合。本插件不猜、不读补丁层、不重算工具列表；它只做三件事：
//
//   1. 把每条 schema 序列化成模型真正会读到的 JSON 形状，量字符数；
//   2. 把工具名归属回插件包（在 profile 的 node_modules 里找 `name: "xxx"` 声明，
//      **只有一个包命中才算归属**，多命中或零命中一律记「未归属」）；
//   3. 给一个明确标注了算法的 token 估算（字符 ÷ 3.5），并同时给出区间，不冒充精确值。
//
// 边界（有意为之，写进 README 和 UI title）：
//   - 只量 tools；系统提示词、人格注入、记忆注入、技能索引不在这个通道里，本插件不编。
//   - 字符 ÷ 3.5 是估算，不是 DeepSeek 分词器实测；真实值以每次调用的 prompt_tokens 为准。
//   - 归属靠源码里的声明形状匹配，是推断；推断不出来就说「未归属」，不硬指。
//
// 安全：只读。不写文件、不发网络、不接管任何官方槽位；路由只接受 POST，失败静默返回 JSON。

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanTools } from './session-scan.mjs'

export const name = 'dsh-plugin-tool-tax'
export const inject = ['webServer', 'tools']

const ROUTE = '/api/tool-tax'
const CHARS_PER_TOKEN = 3.5
const MAX_BODY = 64 * 1024
const CACHE_MS = 60_000
const MAX_TOTAL_FILES = 400

/** 把任意形态的 schema 集合拉平成 [{name, description, parameters}]。 */
export function normalizeSchemas(raw) {
  const out = []
  if (raw === null || raw === undefined) return out
  let entries
  if (Array.isArray(raw)) entries = raw
  else if (typeof raw[Symbol.iterator] === 'function') entries = [...raw].map((x) => (Array.isArray(x) ? x[1] : x))
  else if (typeof raw === 'object') entries = Object.values(raw)
  else return out
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue
    const value = entry.definition && typeof entry.definition === 'object' ? entry.definition : entry
    const toolName = value.name || value.id || value.toolName
    if (typeof toolName !== 'string' || toolName === '') continue
    out.push({
      name: toolName,
      description: typeof value.description === 'string' ? value.description : '',
      parameters: value.parameters ?? value.inputSchema ?? value.input_schema ?? value.schema ?? null,
    })
  }
  return out
}

/** 模型实际读到的形状：name + description + parameters（JSON）。 */
export function schemaPayload(tool) {
  return JSON.stringify({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.parameters === undefined ? { type: 'object', properties: {} } : tool.parameters,
    },
  })
}

export function measure(tools) {
  let chars = 0
  const rows = []
  for (const tool of tools) {
    let payload = ''
    try {
      payload = schemaPayload(tool)
    } catch {
      payload = String(tool.name)
    }
    chars += payload.length
    rows.push({
      name: tool.name,
      chars: payload.length,
      tokens: Math.round(payload.length / CHARS_PER_TOKEN),
    })
  }
  return { chars, rows, tokens: Math.round(chars / CHARS_PER_TOKEN) }
}

/**
 * 在 profile 的 node_modules 里找工具名字面量声明，返回 Map<toolName, string[]|null>。
 * 只读，限制文件数，任何错误都退化成「未归属」。
 */
export function attributeTools(profileDir, toolNames) {
  const result = new Map()
  for (const toolName of toolNames) result.set(toolName, [])
  if (!profileDir) return result
  const wanted = new Set(toolNames)
  const packageDirs = listPackageDirs(profileDir)
  let files = 0
  for (const [pkgName, pkgDir] of packageDirs) {
    if (files >= MAX_TOTAL_FILES) break
    const hits = scanPackage(pkgDir, wanted, () => files++ < MAX_TOTAL_FILES)
    for (const toolName of hits) {
      const owners = result.get(toolName)
      if (owners && !owners.includes(pkgName)) owners.push(pkgName)
    }
  }
  return result
}

/** 读 profile 的 package.json / cordis.patch.yml，拿到要扫的包目录。 */
export function listPackageDirs(profileDir) {
  const out = []
  const seen = new Set()
  const add = (pkgName) => {
    if (!pkgName || seen.has(pkgName)) return
    const dir = resolvePackageDir(profileDir, pkgName)
    if (!dir) return
    seen.add(pkgName)
    out.push([pkgName, dir])
  }
  try {
    const pkg = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    for (const field of ['dependencies', 'devDependencies']) {
      for (const key of Object.keys(pkg[field] || {})) {
        if (key.startsWith('@deepseek-ai/')) continue
        add(key)
      }
    }
  } catch {}
  try {
    const patch = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
    for (const m of patch.matchAll(/^\s*name:\s*['"]?([^'"\s]+)['"]?\s*$/gm)) {
      const v = m[1]
      if (v.startsWith('@deepseek-ai/') || v.startsWith('.')) continue
      add(v)
    }
  } catch {}
  return out
}

function resolvePackageDir(profileDir, pkgName) {
  const candidates = [join(profileDir, 'node_modules', pkgName)]
  // pnpm：node_modules/.pnpm/<encoded>/node_modules/<pkg>
  try {
    const pnpmDir = join(profileDir, 'node_modules', '.pnpm')
    if (existsSync(pnpmDir)) {
      for (const entry of readdirSync(pnpmDir)) {
        const guess = join(pnpmDir, entry, 'node_modules', pkgName)
        if (existsSync(guess)) candidates.push(guess)
      }
    }
  } catch {}
  for (const dir of candidates) {
    try {
      if (statSync(dir).isDirectory()) return dir
    } catch {}
  }
  return null
}

function scanPackage(dir, wanted, budget) {
  const found = new Set()
  const walk = (current, depth) => {
    if (depth > 4 || !budget()) return
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full, depth + 1)
        continue
      }
      if (!/\.(mjs|cjs|js)$/.test(entry.name)) continue
      if (/\.map$/.test(entry.name)) continue
      if (/client/i.test(entry.name)) continue // 浏览器半不算宿主声明
      let text
      try {
        const size = statSync(full).size
        if (size > 2_000_000) continue
        text = readFileSync(full, 'utf8')
      } catch {
        continue
      }
      for (const m of text.matchAll(/(?:^|[\s{,(])name\s*:\s*['"]([A-Za-z0-9_][A-Za-z0-9_.-]{1,47})['"]|['"]([A-Za-z_][A-Za-z0-9_.-]{1,47})['"]/g)) {
        const candidate = m[1] || m[2]
        if (candidate && wanted.has(candidate)) found.add(candidate)
      }
      if (found.size === wanted.size) return
    }
  }
  walk(dir, 0)
  return found
}

function mcpOwner(toolName) {
  const m = /^mcp__([^_]+)__/.exec(toolName)
  return m ? `mcp:${m[1]}` : null
}

/** 组装报告（纯函数，测试可直接调用）。 */
export function buildReport({ schemas, owners, now = Date.now(), profileFound = true }) {
  const measured = measure(schemas)
  const byPlugin = new Map()
  const unattributed = { tools: 0, chars: 0, tokens: 0, names: [] }
  for (const row of measured.rows) {
    const list = owners?.get?.(row.name) || []
    const owner = list.length === 1 ? list[0] : mcpOwner(row.name) || null
    if (!owner) {
      unattributed.tools += 1
      unattributed.chars += row.chars
      unattributed.tokens += row.tokens
      if (unattributed.names.length < 8) unattributed.names.push(row.name)
      continue
    }
    const entry = byPlugin.get(owner) || { name: owner, tools: 0, chars: 0, tokens: 0 }
    entry.tools += 1
    entry.chars += row.chars
    entry.tokens += row.tokens
    byPlugin.set(owner, entry)
  }
  const plugins = [...byPlugin.values()].sort((a, b) => b.tokens - a.tokens)
  return {
    ok: true,
    measuredAt: now,
    profileFound,
    toolCount: measured.rows.length,
    totalChars: measured.chars,
    totalTokens: measured.tokens,
    tokenRange: [Math.round(measured.chars / 4), Math.round(measured.chars / 3)],
    charsPerToken: CHARS_PER_TOKEN,
    method: 'ctx.tools.schemas() 序列化后的字符数 ÷ 3.5；区间 = 字符数 ÷ 4 … ÷ 3',
    note: '只统计工具 schema；系统提示词、人格/记忆注入、技能索引不在此通道，本插件不估算它们。',
    plugins,
    unattributed,
    heaviest: [...measured.rows].sort((a, b) => b.tokens - a.tokens).slice(0, 12),
  }
}

function findProfileDir() {
  try {
    const here = fileURLToPath(import.meta.url)
    const marker = `${sep}node_modules${sep}`
    const at = here.lastIndexOf(marker)
    if (at > 0) return here.slice(0, at)
  } catch {}
  const env = process.env.DSH_HOME
  return env && existsSync(join(env, 'profiles')) ? join(env, 'profiles', process.env.DSH_PROFILE || 'desktop') : null
}

function sendJson(res, status, body) {
  try {
    res.statusCode = status
    res.setHeader?.('content-type', 'application/json; charset=utf-8')
    res.end?.(JSON.stringify(body))
  } catch {}
}

/** 只读 body（有上限），失败返回结构化错误而不是抛。 */
function readJsonBody(req, limit = MAX_BODY) {
  return new Promise((finish) => {
    const chunks = []
    let size = 0
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      finish(value)
    }
    req?.on?.('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > limit) {
        done({ ok: false, error: 'request body too large' })
        return
      }
      chunks.push(chunk)
    })
    req?.on?.('end', () => {
      if (settled) return
      if (chunks.length === 0) return done({ ok: true, value: {} })
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        done({ ok: true, value: parsed !== null && typeof parsed === 'object' ? parsed : {} })
      } catch {
        done({ ok: false, error: 'invalid JSON body' })
      }
    })
    req?.on?.('error', () => done({ ok: false, error: 'request stream error' }))
  })
}

export function apply(ctx, config = {}) {
  const logger = config.logger
  let cache = null

  const readSchemas = () => {
    const service = ctx?.tools
    if (!service || typeof service.schemas !== 'function') return []
    try {
      return normalizeSchemas(service.schemas())
    } catch (error) {
      logger?.warn?.('tool-tax: ctx.tools.schemas() failed', error)
      return []
    }
  }

  const build = async (force) => {
    if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value
    const schemas = readSchemas()
    const profileDir = findProfileDir()
    const owners = attributeTools(
      profileDir,
      schemas.map((t) => t.name),
    )
    const value = buildReport({ schemas, owners, profileFound: Boolean(profileDir) })
    cache = { at: Date.now(), value }
    return value
  }

  const server = ctx?.webServer
  if (!server || typeof server.register !== 'function') {
    logger?.warn?.('tool-tax: webServer unavailable; the panel has nothing to talk to')
    return
  }

  // ── 工具账单：从会话日志里按工具聚合「调用次数 / 分摊 tokens / 分摊金额」──
  // 性能：按文件缓存（mtime+size 命中即跳过解析），落盘到 <DSH_HOME>/tool-tax/cache.json；
  // 启动时预热一次，之后打开 Token 页基本是毫秒级。
  const TOOLS_CACHE_MS = 5 * 60_000
  let toolsCache = null
  const dshHome = () => process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
  const sessionsRoot = () => join(dshHome(), 'sessions')
  const toolsCachePath = () => join(dshHome(), 'tool-tax', 'cache.json')
  const buildTools = async (force) => {
    if (!force && toolsCache && Date.now() - toolsCache.at < TOOLS_CACHE_MS) return toolsCache.value
    const root = sessionsRoot()
    const value = scanTools(root, { windowDays: 14, maxFiles: 200, cachePath: toolsCachePath() })
    toolsCache = { at: Date.now(), value }
    return value
  }

  const guard = (handler) => async (req, res) => {
    const method = String(req?.method ?? 'GET').toUpperCase()
    if (method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const body = await readJsonBody(req)
    if (body.ok !== true) {
      sendJson(res, 400, { ok: false, error: body.error })
      return
    }
    try {
      await handler(body.value ?? {}, res)
    } catch (error) {
      logger?.warn?.('tool-tax: handler failed', error)
      sendJson(res, 500, { ok: false, error: String(error?.message || error) })
    }
  }

  const routes = {
    report: guard(async (input, res) => {
      sendJson(res, 200, { ok: true, value: await build(input.force === true) })
    }),
    tools: guard(async (input, res) => {
      sendJson(res, 200, { ok: true, value: await buildTools(input.force === true) })
    }),
  }

  for (const [suffix, handler] of Object.entries(routes)) {
    ctx.effect(
      () => server.register({ kind: 'exact', path: `${ROUTE}/${suffix}`, handler }),
      `tool-tax: ${suffix} route`,
    )
  }

  // 启动预热一次：首屏打开用量卡片时不用等扫描。
  void build(false).catch(() => {})
  void buildTools(false).catch(() => {})
}

/** Shown by the package manager / docs. */
export const meta = {
  title: '工具税',
  description: '量出每轮对话固定注入的工具 schema 有多少 token，并按插件归属；只读不改配置。',
}

export { ROUTE, CHARS_PER_TOKEN }
