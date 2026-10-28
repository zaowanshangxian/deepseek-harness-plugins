/**
 * 「人格与口癖」Host 半侧。
 *
 * 职责（只有三件，不碰表情/贴纸）：
 * 1. 维护人格档（12 个预设 + 用户自定义）与当前选择；
 * 2. 维护口癖（说话习惯）与频率（表情上限 / 口癖间隔）；
 * 3. 把「人格 + 频率 + 口癖」写进系统提示，并提供设置页读写 API。
 *
 * 降级安全：systemPrompt / webServer 任一不可用都只跳过，不抛错。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { EMOJI_FREQUENCY, PERSONAS, catchphraseLines, personaPromptLines, resolvePersona } from './persona.mjs'

export const name = 'dsh-plugin-persona-voice'

const PROMPT_SECTION = 'persona-voice-usage'
const PROMPT_CONTEXT = 'persona-voice-active'
const API_PREFIX = '/persona-voice'

const DSH_HOME = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
const SETTINGS_DIR = join(DSH_HOME, 'persona-voice')
const SETTINGS_PATH = join(SETTINGS_DIR, 'settings.json')

const MAX_CATCHPHRASES = 12
const MAX_CATCH_LENGTH = 24

const DEFAULT_SETTINGS = {
  enabled: true, // 关掉就完全不注入
  personaSource: 'manual', // manual | off（preset 留给后续接入会话 preset）
  activePersona: 'daughter',
  customPersonas: [],
  emojiFrequency: 'auto', // auto | off | low | normal | high
  catchphraseEvery: 0, // 0 = 跟随人格；2/3/5/8 = 每 N 条
  catchphrases: [], // [{ text, mode: 'prefix'|'suffix'|'any', every }]，空 = 用当前人格默认
}

function sanitizeSettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const catchphrases = Array.isArray(input.catchphrases)
    ? input.catchphrases
        .map((item) => (typeof item === 'string' ? { text: item, mode: 'any', every: 3 } : item))
        .filter((item) => item && typeof item.text === 'string' && item.text.trim() !== '')
        .map((item) => ({
          text: item.text.trim().slice(0, MAX_CATCH_LENGTH),
          mode: ['prefix', 'suffix', 'any'].includes(item.mode) ? item.mode : 'any',
          every: Math.min(10, Math.max(1, Math.trunc(Number(item.every)) || 3)),
        }))
        .slice(0, MAX_CATCHPHRASES)
    : []
  return {
    enabled: input.enabled !== false,
    personaSource: ['manual', 'off'].includes(input.personaSource) ? input.personaSource : 'manual',
    activePersona:
      typeof input.activePersona === 'string' && input.activePersona.trim() !== ''
        ? input.activePersona.trim().slice(0, 24)
        : 'daughter',
    customPersonas: Array.isArray(input.customPersonas) ? input.customPersonas.slice(0, 20) : [],
    emojiFrequency: ['auto', 'off', 'low', 'normal', 'high'].includes(input.emojiFrequency)
      ? input.emojiFrequency
      : 'auto',
    catchphraseEvery: [0, 2, 3, 5, 8].includes(Math.trunc(Number(input.catchphraseEvery)))
      ? Math.trunc(Number(input.catchphraseEvery))
      : 0,
    catchphrases,
  }
}

function readSettings() {
  try {
    return sanitizeSettings(JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')))
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
    /* 首次落盘失败不影响读取（有默认值） */
  }
}

/** 生效频率：用户显式档位优先，auto 跟随人格。 */
export function effectiveFrequencies(settings, persona) {
  const level = EMOJI_FREQUENCY[settings.emojiFrequency]
  const maxPerReply = level === null ? (persona ? persona.maxPerReply : 3) : level
  return { maxPerReply, catchphraseEvery: settings.catchphraseEvery > 0 ? settings.catchphraseEvery : 0 }
}

/** 系统提示的动态段（供测试直接调用）。 */
export function buildPersonaPrompt(settings) {
  const persona = resolvePersona(settings, '')
  const freq = effectiveFrequencies(settings, persona)
  const lines = ['[人格与口癖 · 当前生效]']
  if (persona) lines.push(...personaPromptLines(persona, freq.maxPerReply))
  const catchLines = catchphraseLines(persona, settings.catchphrases, freq.catchphraseEvery)
  if (catchLines.length > 0) lines.push(...catchLines)
  if (lines.length === 1) lines.push('- 未启用任何人格档（personaSource=off），按默认语气回复，不使用口癖。')
  return lines.join('\n')
}

const STATIC_GUIDE = [
  '[人格与口癖] 本机装了 DSH 插件「人格与口癖」。它只约束表达方式（人格、口癖、表情频率），不改变事实与结论。',
  '- 人格与口癖由用户配置，下面的「当前生效」段是硬约束：风格照它来，事实照证据来。',
  '- 口癖自然使用，不要机械复读；工作/数据/代码类回复可以完全不用。',
].join('\n')

function registerPrompt(ctx) {
  ctx.inject(['systemPrompt'], (promptCtx) => {
    try {
      promptCtx.systemPrompt.section({ name: PROMPT_SECTION, order: 2940, text: STATIC_GUIDE })
      promptCtx.systemPrompt.context({
        name: PROMPT_CONTEXT,
        order: 95,
        text: () => {
          try {
            const settings = readSettings()
            return settings.enabled ? buildPersonaPrompt(settings) : ''
          } catch {
            return ''
          }
        },
      })
    } catch (error) {
      promptCtx.logger?.warn?.('[persona-voice] system prompt skipped: ' + String(error))
    }
  })
}

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
  return raw.trim() === '' ? {} : JSON.parse(raw)
}

function registerApi(ctx) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['webServer'], (webCtx) => {
    const server = webCtx.webServer
    if (!server || typeof server.register !== 'function') {
      webCtx.logger?.warn?.('[persona-voice] webServer not ready — settings page will fall back to defaults')
      return
    }
    try {
      server.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: async (req, res) => {
          const url = new URL(req.url, 'http://localhost')
          const path = url.pathname
          try {
            if (path === API_PREFIX + '/api/settings') {
              if (req.method === 'GET') {
                return sendJson(res, 200, { ok: true, settings: readSettings(), presets: PERSONAS })
              }
              if (req.method === 'POST') {
                const body = await readBody(req)
                const result = writeSettings(body)
                return sendJson(res, 200, { ok: true, settings: result.settings, persisted: result.persisted })
              }
              return sendJson(res, 405, { ok: false, error: 'method not allowed' })
            }
            if (path === API_PREFIX + '/api/preview' && req.method === 'GET') {
              return sendJson(res, 200, { ok: true, text: buildPersonaPrompt(readSettings()) })
            }
            return sendJson(res, 404, { ok: false, error: 'unknown persona-voice endpoint' })
          } catch (error) {
            return sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
          }
        },
      })
      webCtx.logger?.info?.('[persona-voice] settings API registered at ' + API_PREFIX)
    } catch (error) {
      webCtx.logger?.warn?.('[persona-voice] settings API skipped: ' + String(error))
    }
  })
}

export function apply(ctx) {
  ensureSettingsFile()
  registerPrompt(ctx)
  registerApi(ctx)
}
