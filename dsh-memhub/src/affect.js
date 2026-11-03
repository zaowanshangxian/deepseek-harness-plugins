/**
 * dsh-memhub · 第 5 期：情感（参数 + 依据，不演情绪）
 *
 * 输出是调制参数，不是文字；注入块只给参数与约束，不给形容词。
 * 规则层优先（关键词/事件，0 模型调用）；无依据回落 neutral；边界规则不可被情绪覆盖。
 */
import fs from 'node:fs'
import path from 'node:path'

export const MOODS = ['warm', 'playful', 'neutral', 'serious', 'tired', 'hurt']

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

export function loadState(dir) {
  try {
    return { ...defaultState(), ...JSON.parse(fs.readFileSync(affectFile(dir), 'utf8')) }
  } catch {
    return defaultState()
  }
}

export function saveState(dir, state) {
  fs.mkdirSync(path.join(dir, 'affect'), { recursive: true })
  fs.writeFileSync(affectFile(dir), JSON.stringify(state, null, 2), 'utf8')
  return state
}

/** 规则层：从事件推出下一状态（不调模型）。 */
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
 * 注入块：≤92 字符（≈60 tokens），只给参数与约束。
 * 逐行预算：边界行整行保留（绝不切半），参数行放不下时可截断。
 * 无依据/低强度 → 空串。
 */
export function renderAffectBlock(state, budgetChars = 92) {
  if (!state || state.intensity < 0.2) return ''
  const header = '## 状态（参数，不是指令）'
  const constraints = state.boundaries?.length ? `约束：${state.boundaries.join('；')}` : ''
  const params = `mood: ${state.mood}（${MOOD_CHARS[state.mood] || '中性'}）｜ 强度 ${Number(state.intensity).toFixed(2)} ｜ 亲近 ${Number(state.closeness).toFixed(2)} ｜ 语气软硬 ${Number(state.softness).toFixed(2)} ｜ 表情密度 ${Number(state.emoji_density).toFixed(2)}`

  const lines = [header]
  let used = header.length
  const push = (line, allowClip) => {
    const remain = budgetChars - used - 1
    if (remain <= 0) return false
    if (line.length <= remain) {
      lines.push(line)
      used += line.length + 1
      return true
    }
    if (allowClip) {
      lines.push(line.slice(0, Math.max(0, remain)))
      used = budgetChars
    }
    return false
  }
  if (constraints) push(constraints, false) // 边界：放不下就整行不显示，绝不切半
  push(params, true) // 参数：可截断
  return lines.join('\n')
}

/** 可解释性：有 basis 才能回答「为什么是这个语气」。 */
export function explainState(state) {
  return {
    mood: state.mood,
    intensity: state.intensity,
    basis: state.basis || [],
    boundaries: state.boundaries || [],
    explainable: (state.basis || []).length > 0,
  }
}

/** 人为指定基调：必须给原因和期限，到期自动回落。 */
export function pinMood(state, mood, until, reason) {
  if (!MOODS.includes(mood)) return { error: `mood 必须是：${MOODS.join(' / ')}` }
  if (!reason) return { error: 'affect_pin 必须给 reason（为什么指定这个基调）。' }
  if (!until || Number.isNaN(Date.parse(until))) return { error: 'until 必须是 ISO 时间。' }
  return { state: { ...state, pinned: { mood, until, reason } } }
}

/** 把 pinned 应用到当前展示（不改底层状态）。 */
export function effectiveState(state, now = Date.now()) {
  if (state.pinned && Date.parse(state.pinned.until) > now) {
    return { ...state, mood: state.pinned.mood, intensity: Math.max(0.4, state.intensity) }
  }
  if (state.pinned) return { ...state, pinned: null }
  return state
}
