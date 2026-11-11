/**
 * dsh-memhub · 第 5 期：情感（参数 + 依据，不演情绪）
 *
 * 输出是调制参数，不是文字；注入块只给参数与约束，不给形容词。
 * 规则层优先（关键词/事件，0 模型调用）；无依据回落 neutral；边界规则不可被情绪覆盖。
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadOrbs, normalizeEmotion } from './orb-store.js'
import { DATA_ROOT, DEFAULT_SHARED_ROOT } from './const.js'
import { writeAtomic } from './frontmatter.js'

export const MOODS = ['warm', 'playful', 'neutral', 'serious', 'tired', 'hurt']

// ── mood 派生（规格 v3 L182/L201/L445/L463）────────────────────
// 「mood 只能从最近 N 条记忆的 emotion 标签加权算出，不允许凭感觉设值。」
// 所以 mood 不存盘，每次现算；存盘的 affect/state.json 只剩调制参数（closeness/softness/...）。

/** 七词 → 六 mood（规格钉死）。playful / tired 不在映射表里：它们只能来自 pin，不从情绪派生。 */
export const EMOTION_TO_MOOD = {
  joy: 'warm',
  sad: 'hurt',
  anger: 'hurt',
  fear: 'serious',
  disgust: 'hurt',
  anxiety: 'serious',
  calm: 'neutral',
}

/** 同分优先级（任务书钉死）。 */
export const MOOD_TIE_ORDER = ['warm', 'playful', 'serious', 'hurt', 'tired', 'neutral']

/** 只看最近 N 条未归档 orb。 */
export const DERIVE_LIMIT = 12
/** 总权重低于这个值 → 没有依据，回落 neutral（规格 L464：不编造）。 */
export const DERIVE_MIN_WEIGHT = 0.5
/** 与 recall-store 的时间衰减同口径：半衰期 72 小时。 */
const DERIVE_HALF_LIFE_HOURS = 72

/** 载入 orb 的短期缓存：注入块每轮都要算 mood，不能每轮读 144 个文件。 */
let moodSource = { at: 0, entries: [] }
const MOOD_SOURCE_TTL_MS = 60_000

/** 清掉派生缓存（测试 / 写完记忆后立刻重算用）。 */
export function resetMoodCache() {
  moodSource = { at: 0, entries: [] }
}

// shortcut: 60 秒缓存 + 只读默认 home/shared 根（运行时 cfg.sharedRoot 到不了这一层，
// 用 MEMHUB_SHARED_ROOT 环境变量可覆盖，测试/沙箱靠它隔离）。
// 写入后最多 60 秒内 mood 不刷新；需要即时刷新就调 resetMoodCache()。
function recentOrbEntries(now = Date.now()) {
  if (now - moodSource.at < MOOD_SOURCE_TTL_MS) return moodSource.entries
  try {
    const sharedRoot = process.env.MEMHUB_SHARED_ROOT || DEFAULT_SHARED_ROOT
    moodSource = { at: now, entries: loadOrbs(DATA_ROOT, sharedRoot).entries }
  } catch {
    moodSource = { at: now, entries: [] }
  }
  return moodSource.entries
}

/**
 * 从最近 N 条 orb 的 emotion 标签派生 mood（纯函数，可单测）。
 * 权重 = importance(1–5) × 0.5^(小时数/72)。
 * **没有 emotion 标签的球不进派生**（复审 2026-11-11：缺失 ≠ calm，把「不知道」当「确实平静」就是编造依据）；
 * 所以先在「有标签的未归档球」里取最近 N 条，再算权重。
 * basis = 「映射到获胜 mood 的球」里权重前 3 的真 id。
 * 返回 {mood, intensity, basis, totalWeight, scores}；没有可用证据 → neutral + 空 basis。
 */
export function deriveMood(entries = [], now = Date.now()) {
  const recent = (Array.isArray(entries) ? entries : [])
    .map((entry) => (entry && entry.id ? { ...entry, emotion: normalizeEmotion(entry.emotion) } : null))
    // 2026-11-11 哥哥定：工程记忆是客观事实，不参与情绪派生。
    // 只让 life（生活/聊天/陪伴）的球投票——工程会话里即使显式带了情绪也不影响 mood。
    .filter((entry) => entry && (entry.domain || 'life') !== 'work')
    .filter((entry) => entry && !entry.archived && entry.status !== 'archived' && entry.emotion)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    .slice(0, DERIVE_LIMIT)
  const contributions = recent.map((entry) => {
    const hours = Math.max(0, (now - Number(entry.updatedAt || 0)) / 3_600_000)
    const importance = Math.min(5, Math.max(1, Number(entry.importance) || 1))
    return {
      id: entry.id,
      emotion: entry.emotion,
      weight: importance * Math.pow(0.5, hours / DERIVE_HALF_LIFE_HOURS),
    }
  })
  const totalWeight = contributions.reduce((sum, item) => sum + item.weight, 0)
  const round = (value) => Number(value.toFixed(4))
  if (totalWeight < DERIVE_MIN_WEIGHT) {
    return { mood: 'neutral', intensity: 0, basis: [], totalWeight: round(totalWeight), scores: {} }
  }
  const scores = {}
  for (const item of contributions) {
    const mood = EMOTION_TO_MOOD[item.emotion]
    scores[mood] = (scores[mood] || 0) + item.weight
  }
  const winner = Object.keys(scores).sort(
    (a, b) => scores[b] - scores[a] || MOOD_TIE_ORDER.indexOf(a) - MOOD_TIE_ORDER.indexOf(b),
  )[0]
  // basis 取「真的把这个 mood 顶上去的球」——比整体权重前 3 更能回答「为什么是这个语气」
  const basis = contributions
    .filter((item) => EMOTION_TO_MOOD[item.emotion] === winner)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((item) => item.id)
  return {
    mood: winner || 'neutral',
    // 强度 = 获胜 mood 的权重占比：0 = 没有依据，1 = 全部证据指向同一个基调。
    // neutral 一律记 0：中性基调不需要占用注入预算（renderAffectBlock 在 <0.2 时不注入），
    // 依据仍然留在 basis 里，affect_state 照常能回答「为什么是中性」。
    intensity: !winner || winner === 'neutral' ? 0 : Number((scores[winner] / totalWeight).toFixed(2)),
    basis,
    totalWeight: round(totalWeight),
    scores: Object.fromEntries(Object.entries(scores).map(([mood, value]) => [mood, round(value)])),
  }
}

const MOOD_CHARS = { warm: '温暖', playful: '俏皮', neutral: '平静', serious: '认真', tired: '疲惫', hurt: '受伤' }

export function affectFile(dir) {
  return path.join(dir, 'affect', 'state.json')
}

export function defaultState(now = Date.now()) {
  return {
    mood: 'neutral',
    intensity: 0,
    valence: 0,
    arousal: 0,
    closeness: 0.5,
    softness: 0.6,
    verbosity: 0.6,
    emoji_density: 0.3,
    basis: [],
    boundaries: ['正经问题不用阴阳怪气', '不替哥哥做决定'],
    pinned: null,
    updatedAt: new Date(now).toISOString(),
  }
}

/** boundaries 会拼进**每轮系统提示**：必须单行、限条数限长（复审 M-1）。 */
const MAX_BOUNDARIES = 6
const BOUNDARY_MAX_CHARS = 40

function oneLine(value, limit = 200) {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, limit)
}

/**
 * boundaries 归一：只要字符串、去换行、每条 ≤40 字、最多 6 条。
 * 类型不对（历史脏数据可能是字符串/对象/数字）降级成空数组，**不抛**——
 * 这里一抛，host 的 try/catch 会吞掉，情感注入块就永久消失了（复审 M-6）。
 */
export function normalizeBoundaries(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  return list
    .filter((item) => typeof item === 'string')
    .map((item) => oneLine(item, BOUNDARY_MAX_CHARS))
    .filter(Boolean)
    .slice(0, MAX_BOUNDARIES)
}

/**
 * 存档状态净化：`affect/state.json` 是**手可改的文件**，改坏一行就会进系统提示。
 * mood 必须是 MOODS 之一；数值夹 0–1（NaN → 默认值）；pinned 的 mood/until 同样校验。
 */
export function sanitizeState(input) {
  const defaults = defaultState()
  const state = { ...defaults, ...(input && typeof input === 'object' ? input : {}) }
  state.mood = MOODS.includes(state.mood) ? state.mood : 'neutral'
  for (const key of ['intensity', 'closeness', 'softness', 'emoji_density', 'verbosity']) {
    const value = Number(state[key])
    state[key] = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : defaults[key]
  }
  state.boundaries = normalizeBoundaries(state.boundaries)
  state.basis = Array.isArray(state.basis) ? state.basis.map((id) => oneLine(id, 120)).filter(Boolean).slice(-5) : []
  const pin = state.pinned
  state.pinned =
    pin && typeof pin === 'object' && MOODS.includes(pin.mood) && Number.isFinite(Date.parse(pin.until || ''))
      ? { mood: pin.mood, until: String(pin.until), reason: oneLine(pin.reason, 60) }
      : null
  state.updatedAt = Number.isFinite(Date.parse(state.updatedAt || '')) ? state.updatedAt : new Date().toISOString()
  return state
}

export function loadState(dir) {
  try {
    return sanitizeState(JSON.parse(fs.readFileSync(affectFile(dir), 'utf8')))
  } catch {
    return defaultState()
  }
}

export function saveState(dir, state) {
  fs.mkdirSync(path.join(dir, 'affect'), { recursive: true })
  const clean = sanitizeState(state)
  // 原子写（复审 L-3）：崩在写一半会留半截 JSON，loadState 读不动就回落默认值，调制参数全丢
  writeAtomic(affectFile(dir), JSON.stringify(clean, null, 2))
  return clean
}

/**
 * 规则层：从事件推出下一状态（不调模型）。
 * ⚠ 只更新调制参数（intensity/closeness/softness/emoji_density）；这里设的 mood 只是存档痕迹，
 * 展示层一律被 deriveMood() 覆盖（规格 v3 L463：mood 不允许凭感觉设值）。
 */
export function updateFromEvent(state, event = {}) {
  const type = String(event.type || 'chat')
  const next = { ...state }
  if (type === 'praise') {
    next.mood = 'warm'
    next.intensity = Math.min(1, Number(state.intensity || 0) + 0.2)
    next.closeness = Math.min(1, Number(state.closeness || 0) + 0.03)
    next.softness = Math.min(1, Number(state.softness || 0) + 0.05)
  } else if (type === 'correction') {
    next.mood = 'hurt'
    next.intensity = 0.5
    next.softness = Math.max(0, Number(state.softness || 0) - 0.2)
    next.valence = Math.max(-1, Number(state.valence || 0) - 0.2)
  } else if (type === 'task') {
    next.mood = 'serious'
    next.intensity = 0.4
    next.emoji_density = Math.min(Number(state.emoji_density || 0), 0.15)
  } else if (type === 'chat') {
    next.mood = 'playful'
    next.intensity = Math.max(0.2, Number(state.intensity || 0))
  }
  return next
}

/** 混合：先时间衰减 → 同情绪取大 → 换情绪保留 35%（照 dsh-emotion-feedback）。 */
export function blend(previous, next, now = Date.now()) {
  const hours = Math.max(0, (now - Date.parse(previous.updatedAt || now)) / 3_600_000)
  const decayed = Number(previous.intensity || 0) * Math.pow(0.5, hours / 72)
  const sameMood = previous.mood === next.mood
  const intensity = sameMood
    ? Math.max(decayed, Number(next.intensity || 0))
    : Math.max(decayed * 0.35, Number(next.intensity || 0))
  const mood = intensity < 0.2 ? 'neutral' : next.mood
  return {
    ...next,
    mood,
    intensity: Number(intensity.toFixed(2)),
    basis: Array.from(new Set([...(previous.basis || []), ...(next.basis || [])])).slice(-5),
    updatedAt: new Date(now).toISOString(),
  }
}

/**
 * 注入块：规格 v3 L466 ——「参数走配置通道不走 prompt 通道，用 0 个文字 token 换到语气变化」。
 *
 * DSH 没有参数通道，所以这里做一个明确取舍：
 * - **派生的 mood 不注入**（那是 L466 点名的「注入一段『你现在心情温暖』」）→ 要查用 `affect_state`。
 * - 只保留唯一值得占文字的一项：**人为指定的基调**（pinned，必须带原因 + 期限）。
 * 无 pinned → 空串，每轮 0 token。
 */
export function renderAffectBlock(state, budgetChars = 40) {
  const pinned = state?.pinned
  if (!pinned || !pinned.mood) return ''
  const until = String(pinned.until || '').slice(0, 16)
  const reason = String(pinned.reason || '').slice(0, 20)
  const line = `基调：${pinned.mood}（到 ${until}｜${reason}）`
  return line.length <= budgetChars ? line : `${line.slice(0, budgetChars - 1)}…`
}

/** 可解释性：有 basis 才能回答「为什么是这个语气」。 */
export function explainState(state) {
  const basis = Array.isArray(state?.basis) ? state.basis : []
  return {
    mood: state?.mood,
    intensity: state?.intensity,
    basis,
    boundaries: normalizeBoundaries(state?.boundaries),
    explainable: basis.length > 0,
  }
}

/** 人为指定基调：必须给原因和期限，到期自动回落。 */
export function pinMood(state, mood, until, reason) {
  if (!MOODS.includes(mood)) return { error: `mood 必须是：${MOODS.join(' / ')}` }
  if (!reason) return { error: 'affect_pin 必须给 reason（为什么指定这个基调）。' }
  if (!until || Number.isNaN(Date.parse(until))) return { error: 'until 必须是 ISO 时间。' }
  return { state: { ...state, pinned: { mood, until, reason } } }
}

/**
 * 把 pinned 应用到当前展示（不改底层状态）。
 *
 * mood 的**唯一来源**是 deriveMood()（规格 L463）：这里不再采信 state.mood。
 * state.json 里存的 mood 只剩历史痕迹，展示层一律用派生值覆盖；
 * pinned（人为指定基调，必须给原因+期限）是唯一的上位覆盖。
 * @param {object} state 存档状态
 * @param {number} now 当前时间
 * @param {object[]} [entries] 传入 orb 列表（测试/批量用）；省略则读盘（60s 缓存）
 */
export function effectiveState(state, now = Date.now(), entries) {
  // 展示前再过一道净化：脏 state（字符串 boundaries / 非法 pinned）不许流向系统提示
  const base = sanitizeState(state)
  const pinned = base.pinned
  if (pinned && Date.parse(pinned.until) > now) {
    return { ...base, mood: pinned.mood, intensity: Math.max(0.4, Number(base.intensity) || 0) }
  }
  if (pinned) base.pinned = null
  const derived = deriveMood(entries ?? recentOrbEntries(now), now)
  return {
    ...base,
    mood: derived.mood,
    intensity: derived.intensity,
    basis: derived.basis,
  }
}
