/**
 * dsh-memhub · 第 8 期：人格模块
 *
 * 蓝图 = 现在的复合人格（活泼女儿 + 乖巧甜 + 猫系 + 傲娇），参数化后作为 baseline。
 * 两条时间尺度分开：
 *   - baseline（慢变量）：周级、每步最多 ±0.02（变形参数调小），体现「成长」但不会一夜变人。
 *   - affect 偏置（快变量）：情感对性格的**临时影响**，按 24h 半衰期衰减到 0，绝不改写 baseline。
 */
import fs from 'node:fs'
import path from 'node:path'
import { writeAtomic, backupWithStamp } from './frontmatter.js'

/** 初始蓝图：以现有人格为准。 */
export const PERSONA_BASELINE = {
  name: 'DeepSeek',
  blueprint: '活泼女儿+乖巧甜+猫系+傲娇',
  warmth: 0.7,
  playfulness: 0.6,
  clinginess: 0.7,
  catness: 0.4,
  tsundere: 0.25,
  formality: 0.3,
  humor: 0.5,
  boundaries: ['正经问题不用阴阳怪气', '不替哥哥做决定', '工作模式不撒娇'],
}

/** 演化步长上限：一步最多 0.02（变形参数调小）。 */
export const EVOLUTION_STEP = 0.02
/** 情感偏置半衰期（小时）：24h 后剩一半，衰减到 0.01 以下归零。 */
export const OFFSET_HALF_LIFE_HOURS = 24
export const OFFSET_EPSILON = 0.01

/** tier → 情感影响强度权重（分层影响不同）。 */
export const TIER_AFFECT_WEIGHT = { core: 1, long: 0.6, event: 0.3 }

function personaFile(dir) {
  return path.join(dir, 'persona', 'baseline.json')
}

export function defaultPersona() {
  return {
    ...PERSONA_BASELINE,
    boundaries: [...PERSONA_BASELINE.boundaries],
    offsets: {}, // 情感偏置（快变量）
    offsetsUpdatedAt: null,
    updatedAt: new Date().toISOString(),
  }
}

export function loadPersona(dir) {
  try {
    const saved = JSON.parse(fs.readFileSync(personaFile(dir), 'utf8'))
    return { ...defaultPersona(), ...saved }
  } catch {
    return defaultPersona()
  }
}

export function savePersona(dir, persona) {
  fs.mkdirSync(path.join(dir, 'persona'), { recursive: true })
  backupWithStamp(personaFile(dir), 3)
  writeAtomic(personaFile(dir), JSON.stringify(persona, null, 2))
  return persona
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

/**
 * 用情感生成/更新「临时偏置」：偏置 = 情感强度 × tier 权重 × 0.3。
 * basis 里记忆的 tier 决定权重（核心记忆对性格影响最大）。
 */
export function affectOffsets(effect, basisTiers = [], now = Date.now()) {
  const moodWeights = {
    warm: { warmth: 0.3, clinginess: 0.2 },
    playful: { playfulness: 0.3, humor: 0.2 },
    serious: { formality: 0.3, playfulness: -0.2 },
    tired: { warmth: -0.2, humor: -0.2 },
    hurt: { warmth: -0.3, tsundere: 0.2 },
    neutral: {},
  }
  const intensity = Number(effect?.intensity || 0)
  if (intensity < 0.2) return {}
  const tierWeight = basisTiers.reduce((max, tier) => Math.max(max, TIER_AFFECT_WEIGHT[tier] || 0.3), 0)
  const weight = intensity * (tierWeight || 0.3) * 0.3
  const offsets = {}
  for (const [key, delta] of Object.entries(moodWeights[effect.mood] || {})) {
    offsets[key] = Number((delta * weight).toFixed(3))
  }
  offsets.__updatedAt = new Date(now).toISOString()
  return offsets
}

/** 偏置随时间衰减：0.5^(小时/24)，小于 0.01 归零。 */
export function decayOffsets(offsets = {}, now = Date.now()) {
  const updated = Date.parse(offsets.__updatedAt || 0)
  const hours = updated ? Math.max(0, (now - updated) / 3_600_000) : 0
  const factor = Math.pow(0.5, hours / OFFSET_HALF_LIFE_HOURS)
  const next = {}
  for (const [key, value] of Object.entries(offsets)) {
    if (key === '__updatedAt') continue
    const decayed = Number(value) * factor
    if (Math.abs(decayed) >= OFFSET_EPSILON) next[key] = Number(decayed.toFixed(3))
  }
  if (Object.keys(next).length > 0) next.__updatedAt = offsets.__updatedAt || new Date(now).toISOString()
  return next
}

/** 合并 baseline + 衰减后的偏置 → 当前生效人格（不改 baseline）。 */
export function effectivePersona(persona, now = Date.now()) {
  const offsets = decayOffsets(persona.offsets || {}, now)
  const effective = { ...persona, offsets }
  for (const key of ['warmth', 'playfulness', 'clinginess', 'catness', 'tsundere', 'formality', 'humor']) {
    const base = Number(persona[key] ?? 0)
    effective[key] = clamp(base + Number(offsets[key] || 0))
  }
  return effective
}

/** 慢速演化：每次最多 ±0.02，永远不越过边界；默认 7 天冷却（可配）。 */
export function evolvePersona(persona, signal = {}, options = {}) {
  const key = String(signal.key || '')
  const allowed = ['warmth', 'playfulness', 'clinginess', 'catness', 'tsundere', 'formality', 'humor']
  if (!allowed.includes(key)) return { error: `未知人格维度：${key}` }
  const intervalMs = Number(options.intervalMs ?? 7 * 86_400_000)
  const last = Number(persona.lastEvolvedAt || 0)
  if (last && Date.now() - last < intervalMs) {
    const days = Math.round(intervalMs / 86_400_000)
    return { error: `演化冷却中：距上次不足 ${days} 天（默认周级，防性格漂移）。` }
  }
  const delta = Math.max(-EVOLUTION_STEP, Math.min(EVOLUTION_STEP, Number(signal.delta || 0)))
  const next = { ...persona, [key]: clamp(Number(persona[key] || 0) + delta) }
  next.updatedAt = new Date().toISOString()
  next.lastEvolvedAt = Date.now()
  next.evolutionCount = Number(persona.evolutionCount || 0) + 1
  return { persona: next }
}

/** 注入块：≤120 字符（≈80 tokens），只给参数，不给形容词。 */
export function renderPersonaBlock(effective, budgetChars = 120) {
  const params = ['warmth', 'playfulness', 'clinginess', 'catness', 'tsundere', 'formality', 'humor']
    .map((key) => `${key.slice(0, 4)} ${Number(effective[key] || 0).toFixed(2)}`)
    .join(' ｜ ')
  const lines = ['## 性格参数', params]
  const constraints = (effective.boundaries || []).length ? `约束：${effective.boundaries.join('；')}` : ''
  let used = lines[0].length + params.length + 2
  if (constraints && used + constraints.length + 1 <= budgetChars) lines.push(constraints)
  return lines.join('\n')
}
