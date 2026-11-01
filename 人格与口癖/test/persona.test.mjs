/**
 * 单元测试：人格解析 / 频率生效 / 口癖优先级 / 提示组装。
 * 运行：node --test test/
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PERSONAS,
  PERSONA_WEIGHTS,
  blendPersonas,
  catchphraseLines,
  mergePersonas,
  personaPromptLines,
  resolvePersona,
} from '../src/persona.mjs'
import { buildPersonaPrompt, effectiveFrequencies } from '../src/host.mjs'

const base = { personaSource: 'manual', activePersona: 'daughter', customPersonas: [] }

test('预设档完整：至少 12 个，id 唯一', () => {
  assert.ok(PERSONAS.length >= 12)
  const ids = PERSONAS.map((p) => p.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const persona of PERSONAS) {
    assert.ok(persona.name.length > 0, persona.id + ' 缺 name')
    assert.ok(persona.guide.length > 4, persona.id + ' 缺 guide')
    assert.ok(persona.kinds.length > 0, persona.id + ' 缺 kinds')
    assert.ok(persona.maxPerReply >= 0 && persona.maxPerReply <= 6)
  }
})

test('resolvePersona：manual / off / 未知 id 回退', () => {
  assert.equal(resolvePersona(base, '').id, 'daughter')
  assert.equal(resolvePersona({ ...base, personaSource: 'off' }, ''), null)
  assert.equal(resolvePersona({ ...base, activePersona: 'not-exist' }, '').id, 'daughter')
})

test('自定义人格：同 id 覆盖，参数收敛到 0–1', () => {
  const merged = mergePersonas([
    { id: 'daughter', name: '我的人设', dims: { cuteness: 2, bite: -1 }, kinds: ['kaomoji'], maxPerReply: 99 },
    { id: 'custom-x', name: 'X', guide: '小写', kinds: ['emoji', 'bogus'] },
  ])
  const daughter = merged.get('daughter')
  assert.equal(daughter.name, '我的人设')
  assert.equal(daughter.dims.cuteness, 1)
  assert.equal(daughter.dims.bite, 0)
  assert.deepEqual(daughter.kinds, ['kaomoji'])
  assert.equal(daughter.maxPerReply, 6)
  assert.deepEqual(merged.get('custom-x').kinds, ['emoji'])
})

test('频率：auto 跟随人格，显式档位覆盖', () => {
  const persona = resolvePersona({ ...base, activePersona: 'kuudere' }, '')
  assert.equal(effectiveFrequencies({ emojiFrequency: 'auto', catchphraseEvery: 0 }, persona).maxPerReply, 1)
  assert.equal(effectiveFrequencies({ emojiFrequency: 'off', catchphraseEvery: 0 }, persona).maxPerReply, 0)
  assert.equal(effectiveFrequencies({ emojiFrequency: 'high', catchphraseEvery: 0 }, persona).maxPerReply, 6)
  assert.equal(effectiveFrequencies({ emojiFrequency: 'auto', catchphraseEvery: 5 }, persona).catchphraseEvery, 5)
})

test('人格提示：cap=0 时明确禁用表情', () => {
  const persona = resolvePersona(base, '')
  const lines = personaPromptLines(persona, 0)
  assert.match(lines[1], /不要使用表情/)
  const lines6 = personaPromptLines(persona, 6)
  assert.match(lines6[1], /最多 6 个表情/)
})

test('口癖：用户自定义优先于人格默认；every 可覆盖', () => {
  const cat = resolvePersona({ ...base, activePersona: 'cat' }, '')
  assert.match(catchphraseLines(cat, [])[0], /喵～/)
  const custom = catchphraseLines(cat, [{ text: '哥哥', mode: 'prefix', every: 2 }], 5)
  assert.match(custom[0], /哥哥（放开头，约每 5 条一次）/)
  assert.doesNotMatch(custom[0], /喵～/)
  assert.equal(catchphraseLines(resolvePersona({ ...base, activePersona: 'colleague' }, ''), []).length, 0)
})

test('提示组装：包含人格、频率、口癖三部分', () => {
  const text = buildPersonaPrompt({ ...base, activePersona: 'cat', emojiFrequency: 'low', catchphraseEvery: 3 })
  assert.match(text, /\[人格与口癖 · 当前生效\]/)
  assert.match(text, /当前表达人格：猫系/)
  assert.match(text, /最多 1 个表情/)
  assert.match(text, /口癖（说话习惯/)
})

// ───────────────────────────── 复合人格（2026-11-01 新增）─────────────────────────────

test('复合人格：dims 按权重加权平均，不是相加', () => {
  const personas = mergePersonas([])
  const blend = blendPersonas([{ id: 'daughter' }, { id: 'tsundere' }], personas)
  assert.equal(blend.id, 'blend')
  assert.equal(blend.name, '活泼女儿 + 傲娇')
  const d = personas.get('daughter').dims.cuteness
  const t = personas.get('tsundere').dims.cuteness
  const expected = (d * PERSONA_WEIGHTS[0] + t * PERSONA_WEIGHTS[1]) / (PERSONA_WEIGHTS[0] + PERSONA_WEIGHTS[1])
  assert.ok(Math.abs(blend.dims.cuteness - expected) < 1e-9, '加权平均不准：' + blend.dims.cuteness)
  // 结果应该落在两者之间
  assert.ok(blend.dims.cuteness >= Math.min(d, t) && blend.dims.cuteness <= Math.max(d, t))
  // 权重按勾选顺序递减
  assert.equal(blend.blend[0].weight, PERSONA_WEIGHTS[0])
  assert.equal(blend.blend[1].weight, PERSONA_WEIGHTS[1])
})

test('复合人格：kinds/denyPacks 取并集，工作模式取最收敛', () => {
  const personas = mergePersonas([])
  const blend = blendPersonas([{ id: 'sweet' }, { id: 'daughter' }], personas)
  const sweet = personas.get('sweet')
  const daughter = personas.get('daughter')
  // denyPacks 并集：sweet 禁的，复合后也禁
  for (const pack of sweet.denyPacks) assert.ok(blend.denyPacks.includes(pack), '丢了禁用分类 ' + pack)
  for (const pack of daughter.denyPacks) assert.ok(blend.denyPacks.includes(pack))
  // kinds 并集
  for (const kind of sweet.kinds) assert.ok(blend.kinds.includes(kind))
  // workModeMaxPerReply 取最小值
  assert.equal(
    blend.workModeMaxPerReply,
    Math.min(sweet.workModeMaxPerReply ?? 1, daughter.workModeMaxPerReply ?? 1),
  )
})

test('复合人格：只勾一个原样返回，空/无效输入返回 null', () => {
  const personas = mergePersonas([])
  assert.equal(blendPersonas([{ id: 'cat' }], personas).id, 'cat')
  assert.equal(blendPersonas([], personas), null)
  assert.equal(blendPersonas(null, personas), null)
  assert.equal(blendPersonas([{ id: 'not-exist' }], personas), null)
})

test('复合人格：未知 id 被跳过，不影响其余', () => {
  const personas = mergePersonas([])
  const blend = blendPersonas([{ id: 'genki' }, { id: 'bogus' }, { id: 'cat' }], personas)
  assert.equal(blend.blend.length, 2)
  assert.deepEqual(blend.blend.map((x) => x.id), ['genki', 'cat'])
})

test('resolvePersona：activePersonas 优先于 activePersona', () => {
  const one = resolvePersona({ ...base, activePersonas: [{ id: 'cat' }] }, '')
  assert.equal(one.id, 'cat')
  const two = resolvePersona({ ...base, activePersonas: [{ id: 'cat' }, { id: 'genki' }] }, '')
  assert.equal(two.id, 'blend')
  // 空数组退回单值逻辑
  assert.equal(resolvePersona({ ...base, activePersonas: [] }, '').id, 'daughter')
  // off 优先于一切
  assert.equal(resolvePersona({ ...base, personaSource: 'off', activePersonas: [{ id: 'cat' }] }, ''), null)
})

test('复合人格提示：写明主次与「融合后的整体」', () => {
  const personas = mergePersonas([])
  const blend = blendPersonas([{ id: 'daughter' }, { id: 'sassy' }], personas)
  const lines = personaPromptLines(blend)
  assert.match(lines[0], /复合人格/)
  assert.match(lines[0], /活泼女儿（主导）/)
  assert.match(lines[0], /毒舌/)
  assert.match(lines[0], /不是轮流切换/)
  // 仍然带发送纪律那一行
  assert.match(lines[1], /发送纪律/)
})
