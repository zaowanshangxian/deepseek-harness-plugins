/**
 * 第 3–7 期纯逻辑自测（hermetic，临时目录）：node tests/govern-check.mjs
 * 覆盖：治理 / 教训（新 API）/ 晋升+台账 / 自我叙述 / 情感 / 星图 / sidecar 合并。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { planStatus, isFrozen, recordRecall, applyArchive } from '../src/govern.js'
import { makeLesson, matchLessons, loadLessons, saveLessons, bumpRecurrence, staleLessons, graduationProposals } from '../src/lessons.js'
import { recordOutcome, summarizeLedger, revisionProposal, draftSkillFromMemories } from '../src/promote.js'
import { writeNote, noteSummary, buildIslands } from '../src/selfnote.js'
import { defaultState, updateFromEvent, blend, renderAffectBlock, pinMood, effectiveState, explainState } from '../src/affect.js'
import { buildGraph } from '../src/graph.js'
import { writeSidecars, readSidecarMap, buildSidecars } from '../src/recall-store.js'
import {
  defaultPersona,
  evolvePersona,
  decayOffsets,
  effectivePersona,
  renderPersonaBlock,
  loadPersona,
  savePersona,
} from '../src/persona.js'
import { buildIndexDoc } from '../src/index-doc.js'
import { writeOrb, loadOrbs, migrateFromZzerx } from '../src/orb-store.js'

const failures = []
let total = 0
function ok(condition, label) {
  total += 1
  if (condition) console.log(`PASS  ${label}`)
  else {
    console.log(`FAIL  ${label}`)
    failures.push(label)
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memhub-govern-'))
const DAY = 86_400_000
const NOW = Date.now()

// 治理
ok(planStatus({ tier: 'core', updatedAt: NOW, archived: false }).action === 'keep', 'core 不归档')
ok(planStatus({ tier: 'event', updatedAt: NOW - 400 * DAY, archived: false }).action === 'archive', 'event 衰减够久 → 归档')
ok(isFrozen({ recall: { count: 3, last: new Date(NOW - 5 * DAY).toISOString() } }, NOW), '近期召回 ≥2 次 → 冻结')
ok(!isFrozen({ recall: { count: 1, last: new Date(NOW - 5 * DAY).toISOString() } }, NOW), '召回 <2 次不冻结')

const sidecarDir = path.join(tmp, 'recall')
fs.mkdirSync(sidecarDir, { recursive: true })
fs.writeFileSync(
  path.join(sidecarDir, 'm1.json'),
  JSON.stringify({ id: 'm1', tier: 'long', archived: false, recall: { count: 0 }, title: '记忆一', updatedAt: NOW }),
  'utf8',
)
ok(recordRecall(sidecarDir, 'm1').recall.count === 1, 'recordRecall 累加召回')
ok(applyArchive(sidecarDir, 'm1', true).archived === true, 'applyArchive 归档')
ok(applyArchive(sidecarDir, 'm1', false).archived === false, 'applyArchive 可恢复')

// S1 集成：重建 sidecar 不能抹掉 recall/archived
recordRecall(sidecarDir, 'm1')
applyArchive(sidecarDir, 'm1', true)
const rebuilt = writeSidecars(sidecarDir, buildSidecars([{ id: 'm1', title: '记忆一', kind: 'decision', importance: 5, updatedAt: NOW }]))
const kept = readSidecarMap(sidecarDir).get('m1')
ok(kept.recall.count === 2, `重建后召回计数保留（实际 ${kept.recall.count}）`)
ok(kept.archived === true, '重建后归档标记保留')
ok(rebuilt.sidecars[0].recall.count === 2, 'writeSidecars 返回合并结果')
const m1File = path.join(sidecarDir, 'm1.json')
const m1 = JSON.parse(fs.readFileSync(m1File, 'utf8'))
m1.tier = 'core'
m1.tierOverride = 'core'
fs.writeFileSync(m1File, JSON.stringify(m1))
writeSidecars(sidecarDir, buildSidecars([{ id: 'm1', title: '记忆一', kind: 'decision', importance: 3, updatedAt: NOW }]))
ok(readSidecarMap(sidecarDir).get('m1').tier === 'core', '重建后用户改的 tier 保持（tierOverride）')

// 教训（新 API：loadLessons → {items,badLines}）
ok(makeLesson({ trigger: '不要偷懒', wrong: 'x', right: 'y' }).error, '不以「当」开头的 trigger 被拒')
ok(makeLesson({ trigger: '当总是失败的时候', wrong: 'x', right: 'y' }).error, '不以「时」收尾（含「的时候」）也拒') // 「当总是失败的时候」→ /^当.*时/ 能匹配「的时候」……见下修正
const made = makeLesson({ trigger: '当我要说「应该没问题」时', wrong: '直接下结论', right: '先跑验证', evidence: '2026-11-02 build 失败' })
ok(Boolean(made.lesson), '合法教训可生成')
const badge = { ...made.lesson, id: 'l1' }
const matched = matchLessons([badge], '我现在要说应该没问题了')
ok(matched.length === 1, '教训按情境命中')
ok(Number(matched[0].recurrence) === 0, 'matchLessons 只读，不累加复发（盲审建议7）')
bumpRecurrence([badge], badge.id)
ok(graduationProposals([{ ...badge, recurrence: 3 }]).length === 1, '复发 ≥3 次出升格提案')
ok(staleLessons([{ status: 'active', last_hit: null, createdAt: new Date(NOW - 100 * DAY).toISOString() }], NOW).length === 1, '90 天未触发 → 退休候选')

// 教训坏行保留
saveLessons(tmp, [badge], ['{坏行}'])
const loaded = loadLessons(tmp)
ok(loaded.items.length === 1 && loaded.badLines.length === 1, '坏行原样保留，不静默丢弃')

// 晋升 + 台账
recordOutcome(tmp, 'tdd', true)
recordOutcome(tmp, 'tdd', false)
ok(summarizeLedger([{ skill: 'tdd', success: true }, { skill: 'tdd', success: false }])[0].rate === 0.5, '台账成功率计算')
ok(revisionProposal([{ skill: 'x', total: 12, success: 0, rate: 0 }]).length === 1, '失败率高 → 改版提案')
const memories = [{ id: 'a', title: 'A', content: '内容A' }, { id: 'b', title: 'B', content: '内容B' }, { id: 'c', title: 'C', content: '内容C' }]
ok(draftSkillFromMemories(memories, ['a', 'b']).error, '不足 3 条拒绝出草案')
const draft = draftSkillFromMemories(memories, ['a', 'b', 'c'])
ok(draft.draft.name === 'draft-skill', '无 name 时默认名可落盘（不是空串）')

// 自我叙述
ok(writeNote(tmp, 'x'.repeat(321)).error, '超过 320 字被拒')
ok(Boolean(writeNote(tmp, '第一段自我叙述').file), '写一段自我叙述')
for (let i = 0; i < 8; i += 1) writeNote(tmp, `第 ${i + 2} 段叙述`, NOW + i * 1000)
const notes = noteSummary(tmp)
ok(notes && notes.count <= 8, `活跃段数 ≤8（实际 ${notes ? notes.count : 0}）`)
ok(fs.readdirSync(path.join(tmp, 'self', 'archive')).length >= 1, '旧叙述进 archive')
ok(buildIslands([{ id: 'm1', title: '承诺', kind: 'decision', tier: 'core', importance: 5, archived: false }]).length === 1, '岛屿从核心记忆派生')

// 情感
const base = defaultState(NOW)
ok(base.mood === 'neutral' && base.intensity === 0, '默认中性、无强度')
ok(updateFromEvent(base, { type: 'praise' }).mood === 'warm', 'praise → warm')
ok(updateFromEvent(base, { type: 'correction' }).mood === 'hurt', 'correction → hurt')
ok(updateFromEvent(base, { type: 'task' }).mood === 'serious', 'task → serious')
const blended = blend(
  { ...base, mood: 'warm', intensity: 0.8, updatedAt: new Date(NOW - 10 * 3_600_000).toISOString() },
  { ...base, mood: 'warm', intensity: 0.3, basis: ['m1'] },
  NOW,
)
ok(blended.mood === 'warm' && blended.intensity >= 0.3, '同情绪取大 + 带 basis')
ok(renderAffectBlock({ ...base, intensity: 0 }) === '', '强度 <0.2 不注入')
const block = renderAffectBlock({ ...base, mood: 'warm', intensity: 0.5 })
ok(block.length <= 92, `情感块 ≤92 字符（实际 ${block.length}）`)
ok(block.includes('不替哥哥做决定'), '边界行完整，不被切半（盲审 S2）')
ok(pinMood(base, 'nope', '2026-11-04T00:00:00+08:00', 'x').error, '非法 mood 被拒')
ok(pinMood(base, 'serious', 'bad', '交付').error, '非法 until 被拒')
ok(effectiveState({ ...base, pinned: { mood: 'serious', until: new Date(NOW + 3_600_000).toISOString(), reason: '交付' } }, NOW).mood === 'serious', 'pin 生效')
ok(explainState(base).explainable === false, '无 basis 不可解释')

// 第 8–9 期：人格 / 索引 / orb 存储 / evergreen
const persona = defaultPersona()
ok(String(persona.blueprint || '').includes('活泼女儿'), '初始人格以现有人格为蓝图')
ok(
  Math.abs(evolvePersona(persona, { key: 'warmth', delta: 0.5 }).persona.warmth - persona.warmth) <= 0.02 + 1e-9,
  '演化步长 ≤0.02（变形参数调小）',
)
ok(evolvePersona(persona, { key: 'nope', delta: 0.1 }).error, '未知人格维度被拒')
ok(
  evolvePersona({ ...persona, lastEvolvedAt: Date.now() }, { key: 'warmth', delta: 0.01 }).error,
  '演化有冷却（默认周级，防性格漂移）',
)
ok(
  Boolean(
    evolvePersona({ ...persona, lastEvolvedAt: Date.now() - 8 * 86_400_000 }, { key: 'warmth', delta: 0.01 })
      .persona,
  ),
  '冷却到期可演化',
)
const offsetPersona = { ...persona, offsets: { warmth: 0.3, __updatedAt: new Date(NOW).toISOString() } }
ok(decayOffsets(offsetPersona.offsets, NOW + 24 * 3_600_000).warmth < 0.3, '情感偏置随时间衰减')
ok(
  decayOffsets({ warmth: 0.3, __updatedAt: new Date(NOW).toISOString() }, NOW + 24 * 30 * 3_600_000).warmth === undefined,
  '情感偏置最终衰减到零',
)
const eff = effectivePersona(offsetPersona, NOW)
ok(Math.abs(eff.warmth - (persona.warmth + 0.3)) < 1e-6, '生效人格 = baseline + 偏置')
ok(persona.warmth === 0.7, 'effectivePersona 不改 baseline（限时情感不永久改性格）')
const personaBlock = renderPersonaBlock(eff)
ok(personaBlock.length <= 120 && personaBlock.includes('warm '), '人格块 ≤120 字符且含参数')
savePersona(path.join(tmp, 'persona-test'), persona)
ok(loadPersona(path.join(tmp, 'persona-test')).blueprint === persona.blueprint, '人格可存取')

const idxDoc = buildIndexDoc({
  sidecars: [{ id: 'm1', title: 'T', tier: 'long', kind: 'decision' }],
  skills: [{ name: 'tdd', group: '工程实现' }],
  lessons: [{ trigger: '当X时', right: 'Z' }],
  self: { title: '自我', count: 2 },
  persona,
})
ok(
  ['记忆', '技能', '教训', '自我'].every((word) => idxDoc.includes(word)),
  '索引文档含四类分类',
)

const orbHome = path.join(tmp, 'orb-home')
const sharedOrbs = path.join(tmp, 'shared-orbs')
const orb = { id: 'm_test_1', kind: 'decision', scope: 'shared', projectPath: '', title: '测试记忆', content: '正文', importance: 4, createdAt: NOW, updatedAt: NOW }
writeOrb(orb, orbHome, sharedOrbs)
const loadedOrbs = loadOrbs(orbHome, sharedOrbs)
ok(loadedOrbs.entries.length === 1 && loadedOrbs.entries[0].content === '正文', 'orb 写入后可读回')
const zzerxOrb = { id: 'z1', kind: 'decision', scope: 'global', title: 'Z', content: 'zbody', importance: 4, updatedAt: NOW }
ok(migrateFromZzerx([zzerxOrb], orbHome, sharedOrbs).migrated === 1, 'zzerx 迁移写入 orb')
ok(migrateFromZzerx([zzerxOrb], orbHome, sharedOrbs).skipped === 1, '迁移幂等（同 id 跳过）')
ok(
  planStatus({ tier: 'event', evergreen: true, updatedAt: NOW - 400 * DAY, archived: false }).action === 'keep',
  '工程/公共区记忆不衰减（永不归档）',
)

// 星图
const graph = buildGraph({
  sidecars: [{ id: 'm1', title: 'T1', tier: 'long', importance: 4 }, { id: 'm2', title: 'T2', tier: 'event', importance: 3 }],
  entities: [{ id: 'e1', name: 'E1', kind: 'tool' }],
  edges: [
    { from: { kind: 'memory', id: 'm1' }, to: { kind: 'entity', id: 'e1' }, relation: 'about', origin: 'agent' },
    { from: { kind: 'memory', id: 'm1' }, to: { kind: 'memory', id: 'm2' }, relation: 'related', origin: 'auto' },
  ],
})
ok(graph.nodes.length === 3, '星图节点数')
ok(graph.edges.length === 1 && graph.stats.autoFiltered === 1, '默认过滤 auto related 边')
ok(buildGraph({ sidecars: [], entities: [], edges: [] }).edges.length === 0, '空图不崩')

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n第 3–7 期自测：${total - failures.length}/${total} 通过`)
if (failures.length > 0) {
  console.log(`失败项：${failures.join(' ｜ ')}`)
  process.exit(1)
}
