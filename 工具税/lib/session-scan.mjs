// 会话日志扫描：把「每个工具调用了多少次 / 花了多少 token / 花了多少钱」从
// `<DSH_HOME>/sessions/**/session*.jsonl.zstd` 里算出来。
//
// 口径（和 dsh-token-mb 对齐，便于两个插件对账）：
//   - 每轮 LLM 请求的成本记在 `assistant/message.data.usage`；
//   - 每次工具调用是 `tool/call`，带 (turn, step)；
//   - 同一 (turn, step) 里有 k 个工具 → 这一轮的 usage 平摊 1/k 给每个工具。
//     （这是「归因」不是「账单」：工具本身没有独立计费，只能这样分摊。）
//   - 金额按 DeepSeek 官方峰谷价折算，价格表与 dsh-token-mb 一致（MIT，来源见 README）；
//     非官方 provider 的会话只记 token，不猜钱。
//
// 性能：按文件缓存（mtime + size 命中就跳过解析），缓存可落盘到
// `<DSH_HOME>/tool-tax/cache.json`，第二次打开是毫秒级。安全：只读；文件数、
// 单文件大小、解压总量都有上限；坏数据跳过不抛。

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import zlib from 'node:zlib'

/** 与 dsh-token-mb 相同的价格表（元 / 百万 token，峰谷两档）。 */
export const PRICE_TIERS = {
  'deepseek-flash': {
    cacheHit: { offPeak: 0.02, peak: 0.04 },
    cacheMiss: { offPeak: 1, peak: 2 },
    output: { offPeak: 4, peak: 8 },
  },
  'deepseek-v4-pro': {
    cacheHit: { offPeak: 0.15, peak: 0.3 },
    cacheMiss: { offPeak: 4.5, peak: 9 },
    output: { offPeak: 13.5, peak: 27 },
  },
  'deepseek-v4-flash': {
    cacheHit: { offPeak: 0.02, peak: 0.04 },
    cacheMiss: { offPeak: 1, peak: 2 },
    output: { offPeak: 4, peak: 8 },
  },
  'deepseek-v4-flash-vision-exp': {
    cacheHit: { offPeak: 0.02, peak: 0.04 },
    cacheMiss: { offPeak: 1, peak: 2 },
    output: { offPeak: 4, peak: 8 },
  },
}
const OFFICIAL_PROVIDERS = new Set(['deepseek-official', 'deepseek-account'])

/** 北京时间周一至周五 9:00-12:00、14:00-18:00 为高峰（不识别法定节假日，与 token-mb 同口径）。 */
export function isPeakHour(ms, tzOffsetMinutes = 480) {
  const d = new Date(ms + tzOffsetMinutes * 60_000)
  const day = d.getUTCDay()
  if (day === 0 || day === 6) return false
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes()
  return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60)
}

/** 一次调用的金额（元）；未知模型返回 null —— 只记 token、不猜钱。 */
export function costOf(usage, model, ms, rates = PRICE_TIERS) {
  const tier = rates[model]
  if (!tier) return null
  const peak = isPeakHour(ms)
  const pick = (p) => (peak ? p.peak : p.offPeak)
  const hit = pick(tier.cacheHit)
  const miss = pick(tier.cacheMiss)
  const out = pick(tier.output)
  const cny =
    ((usage.inputTokens || 0) / 1e6) * miss +
    ((usage.cacheReadTokens || 0) / 1e6) * hit +
    ((usage.outputTokens || 0) / 1e6) * out
  return { cny, peak }
}

/** 解压「每次 flush 追加一帧」的会话文件：逐帧解，坏帧跳过。 */
export function decodeSessionFile(path) {
  const buf = readFileSync(path)
  const parts = []
  let start = 0
  for (let i = 0; i <= buf.length - 4; i++) {
    if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) {
      if (i > start) parts.push([start, i])
      start = i
    }
  }
  parts.push([start, buf.length])
  let text = ''
  for (const [a, b] of parts) {
    try {
      text += zlib.zstdDecompressSync(buf.subarray(a, b)).toString('utf8')
    } catch {}
  }
  return text
}

/** 把一个会话文本解析成「按 (turn,step) 的用量」和「工具调用列表」。 */
export function parseSessionText(text) {
  const usageByStep = new Map()
  const calls = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let rec
    try {
      rec = JSON.parse(line)
    } catch {
      continue
    }
    if (rec.type === 'assistant/message' && rec.data?.usage) {
      const key = `${rec.data.turn}:${rec.data.step}`
      usageByStep.set(key, {
        usage: rec.data.usage,
        model: rec.data?.message?.source?.model || '',
        provider: rec.data?.message?.source?.provider || '',
        time: Number(rec.time) || 0,
      })
      continue
    }
    if (rec.type === 'tool/call' && rec.data?.name) {
      calls.push({
        name: rec.data.name,
        turn: Number(rec.data.turn) || 0,
        step: Number(rec.data.step) || 0,
        time: Number(rec.time) || 0,
      })
    }
  }
  return { usageByStep, calls }
}

/** 把会话里的一轮用量平摊到该轮的每个工具上，累加到 Map<toolName, bucket>。 */
export function foldInto(byTool, parsed) {
  const perStep = new Map()
  for (const call of parsed.calls) {
    const key = `${call.turn}:${call.step}`
    const list = perStep.get(key) || []
    list.push(call)
    perStep.set(key, list)
  }
  let calls = 0
  let priced = 0
  let unpriced = 0
  for (const [key, list] of perStep) {
    calls += list.length
    const entry = parsed.usageByStep.get(key)
    const share = entry ? 1 / list.length : 0
    let cny = 0
    if (entry) {
      const cost = OFFICIAL_PROVIDERS.has(entry.provider) ? costOf(entry.usage, entry.model, entry.time) : null
      if (cost) {
        cny = cost.cny * share
        priced += 1
      } else {
        unpriced += 1
      }
    }
    const usage = entry?.usage || { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 }
    for (const call of list) {
      const bucket = byTool.get(call.name) || { name: call.name, calls: 0, tokens: 0, cny: 0, lastAt: 0 }
      bucket.calls += 1
      bucket.tokens +=
        ((usage.inputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.outputTokens || 0)) * share
      bucket.cny += cny
      bucket.lastAt = Math.max(bucket.lastAt, call.time)
      byTool.set(call.name, bucket)
    }
  }
  return { calls, priced, unpriced }
}

/** 列出窗口内要扫的会话文件（按 mtime 过滤）。 */
export function listSessionFiles(sessionsRoot, { sinceMs = 0, maxFiles = 200 } = {}) {
  const out = []
  const stack = [sessionsRoot]
  while (stack.length && out.length < maxFiles) {
    const dir = stack.pop()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (out.length >= maxFiles) break
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        stack.push(p)
        continue
      }
      if (!/session\.v\d+\.jsonl\.zstd$/.test(e.name)) continue
      try {
        const st = statSync(p)
        if (st.mtimeMs >= sinceMs) out.push({ path: p, size: st.size, mtimeMs: st.mtimeMs })
      } catch {}
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, maxFiles)
}

/* ------------------------------------------------------------------ *
 * 按文件缓存：mtime + size 没变就直接复用上次的聚合结果
 * ------------------------------------------------------------------ */

function readCache(cachePath) {
  if (!cachePath) return { files: {} }
  try {
    const data = JSON.parse(readFileSync(cachePath, 'utf8'))
    if (data && data.version === 1 && data.files && typeof data.files === 'object') return data
  } catch {}
  return { files: {} }
}

function writeCache(cachePath, data) {
  if (!cachePath) return
  try {
    mkdirSync(dirname(cachePath), { recursive: true })
    writeFileSync(cachePath, JSON.stringify(data))
  } catch {}
}

function mergePerFile(target, obj) {
  for (const name of Object.keys(obj)) {
    const src = obj[name]
    const dst = target.get(name) || { name, calls: 0, tokens: 0, cny: 0, lastAt: 0 }
    dst.calls += src.calls
    dst.tokens += src.tokens
    dst.cny += src.cny
    dst.lastAt = Math.max(dst.lastAt, src.lastAt || 0)
    target.set(name, dst)
  }
}

/**
 * 主入口：扫窗口内的会话，返回按工具聚合的结果。
 * @param {string} sessionsRoot
 * @param {{windowDays?:number, now?:number, maxFiles?:number, cachePath?:string}} options
 */
export function scanTools(sessionsRoot, { windowDays = 14, now = Date.now(), maxFiles = 200, cachePath = null } = {}) {
  const sinceMs = now - windowDays * 86_400_000
  const files = listSessionFiles(sessionsRoot, { sinceMs, maxFiles })
  const cache = readCache(cachePath)
  const nextFiles = {}
  const byTool = new Map()
  let scanned = 0
  let reused = 0
  let skipped = 0
  const free = { calls: 0, priced: 0, unpriced: 0 }

  for (const file of files) {
    if (file.size > 64 * 1024 * 1024) {
      skipped += 1
      continue
    }
    const hit = cache.files[file.path]
    if (hit && hit.mtimeMs === file.mtimeMs && hit.size === file.size && hit.byTool) {
      nextFiles[file.path] = hit
      mergePerFile(byTool, hit.byTool)
      free.calls += hit.calls || 0
      free.priced += hit.priced || 0
      free.unpriced += hit.unpriced || 0
      reused += 1
      continue
    }
    let text = ''
    try {
      text = decodeSessionFile(file.path)
    } catch {
      skipped += 1
      continue
    }
    const parsed = parseSessionText(text)
    const per = new Map()
    const folded = foldInto(per, parsed)
    const obj = {}
    for (const [name, v] of per) obj[name] = { calls: v.calls, tokens: Math.round(v.tokens), cny: Number(v.cny.toFixed(6)), lastAt: v.lastAt }
    nextFiles[file.path] = {
      mtimeMs: file.mtimeMs,
      size: file.size,
      byTool: obj,
      calls: folded.calls,
      priced: folded.priced,
      unpriced: folded.unpriced,
    }
    mergePerFile(byTool, obj)
    free.calls += folded.calls
    free.priced += folded.priced
    free.unpriced += folded.unpriced
    scanned += 1
  }

  if (cachePath) writeCache(cachePath, { version: 1, savedAt: now, files: nextFiles })

  const tools = [...byTool.values()]
    .map((t) => ({ ...t, tokens: Math.round(t.tokens), cny: Number(t.cny.toFixed(4)) }))
    .sort((a, b) => b.tokens - a.tokens)
  const totalTokens = tools.reduce((sum, t) => sum + t.tokens, 0)
  const totalCny = tools.reduce((sum, t) => sum + t.cny, 0)
  for (const tool of tools) tool.share = totalTokens > 0 ? Number((tool.tokens / totalTokens).toFixed(4)) : 0
  return {
    windowDays,
    sessionsScanned: scanned,
    sessionsReused: reused,
    sessionsSkipped: skipped,
    totalCalls: free.calls,
    totalTokens,
    totalCny: Number(totalCny.toFixed(4)),
    pricedSteps: free.priced,
    unpricedSteps: free.unpriced,
    tools,
    method: 'tool/call 按 (turn,step) 平摊该轮 usage；金额按 DeepSeek 峰谷价（与 dsh-token-mb 同表），非官方 provider 只记 token',
  }
}
