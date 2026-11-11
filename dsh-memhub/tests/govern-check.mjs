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
import { writeSidecars, readSidecarMap, buildSidecars, isDormant, mergeSidecars } from '../src/recall-store.js'
import { buildRecallBlock } from '../src/recall-scheduler.js'
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
import { planJanitor, planDedupe, runJanitor, createSnapshot, listSnapshots, restoreSnapshot, latestSnapshot, isProtected } from '../src/janitor.js'
import { writeOrb, saveOrb, loadOrbs, migrateFromZzerx, orbPathFor } from '../src/orb-store.js'

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
recordRecall(sidecarDir, 'm1', Date.now() + 3_600_001) // 超过冷却期，才该 +1
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
// 2026-11-11 改口径（规格 v3 L466）：派生 mood 不再做成「注入一段状态」，只保留 pinned 一行。
ok(renderAffectBlock({ ...base, intensity: 0 }) === '', '无 pinned 时不注入（0 token）')
ok(renderAffectBlock({ ...base, mood: 'warm', intensity: 0.9 }) === '', '派生 mood 不注入（规格 L466）')
const pinnedState = { ...base, pinned: { mood: 'warm', until: new Date(NOW + 3_600_000).toISOString(), reason: '测试' } }
const block = renderAffectBlock(pinnedState)
ok(block.startsWith('基调：warm'), 'pinned 时注入一行基调')
ok(block.length <= 40, `pinned 行 ≤40 字符（实际 ${block.length}）`)
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

// ── 休眠（淡了不注入）+ 查到即醒 + 冷却 ──────────────────
const stale = {
  id: 'stale',
  tier: 'event',
  archived: false,
  decay: 0.1,
  recall: { count: 0, last: null },
  title: '淡了的',
  summary: '一句话',
  updatedAt: 0,
  importance: 3,
}
ok(isDormant(stale), '淡且没想起 → 休眠')
ok(!isDormant({ ...stale, tier: 'core' }), 'core 永不休眠')
ok(
  !isDormant({ ...stale, recall: { count: 1, last: new Date().toISOString() } }),
  '最近想起过 → 不休眠（查到即醒）',
)
ok(!isDormant({ ...stale, decay: 0.9 }), '新鲜的不休眠')
const staleBlock = buildRecallBlock([stale], { budgetChars: 280 })
ok(!staleBlock.text.includes('淡了的'), '休眠条目不进注入块')

const coolDir = path.join(tmp, 'cool')
fs.mkdirSync(coolDir, { recursive: true })
fs.writeFileSync(path.join(coolDir, 'c1.json'), JSON.stringify({ id: 'c1', recall: { count: 0, last: null } }))
recordRecall(coolDir, 'c1', 1000)
recordRecall(coolDir, 'c1', 2000)
const cooled = JSON.parse(fs.readFileSync(path.join(coolDir, 'c1.json'), 'utf8'))
ok(cooled.recall.count === 1, `冷却期内重复想起只算一次（实际 ${cooled.recall.count}）`)
recordRecall(coolDir, 'c1', 2000 + 3_600_001)
const thawed = JSON.parse(fs.readFileSync(path.join(coolDir, 'c1.json'), 'utf8'))
ok(thawed.recall.count === 2, '冷却期外再想起会累加')


// ── janitor：容量 / 淘汰 / 去重合并 / 快照 restore ──────────────────────
const now = Date.now()
const janRoot = path.join(tmp, 'jan')
const janShared = path.join(tmp, 'jan-shared')
const janSidecar = path.join(janRoot, 'recall')
fs.mkdirSync(janSidecar, { recursive: true })
const recent = now - 86_400_000
const janOrbs = [
  { id: 'j_a', title: '甲', content: '甲的内容', scope: 'self', kind: 'event', importance: 3, updatedAt: recent },
  { id: 'j_b', title: '乙', content: '乙的内容', scope: 'self', kind: 'event', importance: 4, updatedAt: recent },
  { id: 'j_c', title: '丙', content: '丙的内容', scope: 'self', kind: 'event', importance: 5, updatedAt: recent },
  { id: 'j_work', title: '项目上下文', content: '项目上下文正文', scope: 'project', projectPath: 'L:\DSH\work', kind: 'project', importance: 3, updatedAt: recent },
  { id: 'j_shared', title: '公共区结论', content: '公共区正文', scope: 'global', kind: 'decision', importance: 4, updatedAt: recent },
]
for (const orb of janOrbs) saveOrb(orb, janRoot, janShared)
const janSidecars = buildSidecars(loadOrbs(janRoot, janShared).entries, {}, now)
writeSidecars(janSidecar, janSidecars)

const underCap = planJanitor(janSidecars, { maxOrbs: 5 })
ok(underCap.overflow === 0 && underCap.evict.length === 0, 'janitor：没超上限就不淘汰')
const overCap = planJanitor(janSidecars, { maxOrbs: 3 })
ok(overCap.overflow === 2 && overCap.evict.length === 2, 'janitor：超上限淘汰到上限')
ok(overCap.evict[0].weight <= overCap.evict[1].weight, 'janitor：按权重升序淘汰（最低权重先走）')
ok(
  !overCap.evict.some((item) => item.id === 'j_work' || item.id === 'j_shared'),
  'janitor：working / evergreen 豁免淘汰',
)
const tight = planJanitor(janSidecars, { maxOrbs: 1 })
ok(tight.capped === true && tight.evict.length === 3, 'janitor：protected 占满上限时如实标 capped')
ok(planDedupe(janSidecars, { threshold: 0.82 }).length === 0, 'janitor：不同内容不算重复')

// 去重 + 合并（单独一个库，避免污染容量用例）
const dupRoot = path.join(tmp, 'dup')
const dupShared = path.join(tmp, 'dup-shared')
const dupSidecarDir = path.join(dupRoot, 'recall')
fs.mkdirSync(dupSidecarDir, { recursive: true })
saveOrb(
  { id: 'd1', title: '同一件事', content: '同一件事的完整正文，用来测重复度；这段故意写长一点，超过六十个字符，避免短文本相似度虚高导致的误判。再补一句凑够长度，保证它落在正常记忆的长度区间里，不会因为最小长度门槛被过滤掉。', scope: 'self', kind: 'event', importance: 3, updatedAt: now - 2_000_000 },
  dupRoot,
  dupShared,
)
saveOrb(
  { id: 'd2', title: '同一件事', content: '同一件事的完整正文，用来测重复度；这段故意写长一点，超过六十个字符，避免短文本相似度虚高导致的误判。再补一句凑够长度，保证它落在正常记忆的长度区间里，不会因为最小长度门槛被过滤掉。', scope: 'self', kind: 'event', importance: 4, updatedAt: now - 1_000_000 },
  dupRoot,
  dupShared,
)
const dupSidecars = buildSidecars(loadOrbs(dupRoot, dupShared).entries, {}, now)
writeSidecars(dupSidecarDir, dupSidecars)
const dupPlan = planJanitor(dupSidecars, { maxOrbs: 100 })
ok(dupPlan.dedupe.length === 1, 'janitor：近似重复被抓到')
ok(dupPlan.dedupe[0].keep === 'd2', 'janitor：重复时保留权重高的那条')
const applied = runJanitor({
  dataRoot: dupRoot,
  sharedRoot: dupShared,
  sidecarDir: dupSidecarDir,
  sidecars: dupSidecars,
  options: { maxOrbs: 100 },
  apply: true,
  merge: true,
  orbPathFor: (record) => orbPathFor(record, dupRoot, dupShared),
  now,
})
ok(applied.merged.length === 1 && applied.merged[0].drop === 'd1', 'janitor：合并在 --apply 下执行')
ok(Boolean(applied.snapshot?.id), 'janitor：动盘前先留快照')
const keptFile = orbPathFor({ id: 'd2', updatedAt: now - 1_000_000, scope: 'self' }, dupRoot, dupShared)
ok(fs.readFileSync(keptFile, 'utf8').includes('importance: 4.9'), 'janitor：权重合并 min(9, a + b*0.3)')
ok(
  JSON.parse(fs.readFileSync(path.join(dupSidecarDir, 'd1.json'), 'utf8')).archived === true,
  'janitor：被合并的那条归档（不删 orb）',
)
ok(fs.existsSync(path.join(dupRoot, 'archive.jsonl')), 'janitor：合并写 archive.jsonl')
const dryRun = runJanitor({
  dataRoot: dupRoot,
  sharedRoot: dupShared,
  sidecarDir: dupSidecarDir,
  sidecars: dupSidecars,
  options: { maxOrbs: 100 },
  apply: false,
})
ok(dryRun.merged.length === 0 && dryRun.applied === false, 'janitor：dry-run 不动盘')

const restored = restoreSnapshot(dupRoot, dupShared, applied.snapshot.id, { now })
ok(restored.restored.includes('orbs') && restored.restored.includes('recall'), 'janitor：restore 覆盖 orbs / recall')
ok(
  JSON.parse(fs.readFileSync(path.join(dupSidecarDir, 'd1.json'), 'utf8')).archived === false,
  'janitor：restore 把归档恢复',
)
ok(!fs.readFileSync(keptFile, 'utf8').includes('importance: 4.9'), 'janitor：restore 把权重恢复')

const shortPair = [
  { id: 'q1', tier: 'event', title: '甲', content: '甲 body', importance: 3, updatedAt: now, archived: false },
  { id: 'q2', tier: 'event', title: '乙', content: '乙 body', importance: 3, updatedAt: now, archived: false },
]
ok(planDedupe(shortPair, { threshold: 0.5 }).length === 0, 'janitor：短文本不按相似度合并（防虚高误判）')

const snapRoot = path.join(tmp, 'snap-prune')
for (let i = 0; i < 4; i += 1) createSnapshot(snapRoot, null, { now: now + i * 1000, keep: 3 })
const keptSnaps = listSnapshots(snapRoot)
ok(keptSnaps.length === 3, 'janitor：快照只留 3 份（旧的清掉）')
ok(
  keptSnaps.map((item) => item.at).join(',') ===
    [1, 2, 3].map((i) => new Date(now + i * 1000).toISOString()).join(','),
  'janitor：快照修剪按时间留最新三份',
)


// ── 盲审回归（REVIEW-janitor.md 2026-11-09）────────────────────────────
// P0：连续 restore 不能把基线快照 prune 掉（原来第 4 次会静默零恢复）
const p0Root = path.join(tmp, 'p0')
fs.mkdirSync(path.join(p0Root, 'orbs'), { recursive: true })
fs.writeFileSync(path.join(p0Root, 'orbs', 'x.md'), 'v1')
const p0Snap = createSnapshot(p0Root, null, { now })
const p0Results = []
for (let i = 0; i < 5; i += 1) {
  fs.writeFileSync(path.join(p0Root, 'orbs', 'x.md'), `v-before-${i}`)
  const r = restoreSnapshot(p0Root, null, p0Snap.id, { now: now + (i + 1) * 1000 })
  p0Results.push({ restored: r.restored.length, text: fs.readFileSync(path.join(p0Root, 'orbs', 'x.md'), 'utf8') })
}
ok(
  p0Results.every((r) => r.restored > 0 && r.text === 'v1'),
  `P0：连续 5 次 restore 都真的恢复（${JSON.stringify(p0Results.map((r) => r.restored))}）`,
)
ok(latestSnapshot(p0Root)?.id === p0Snap.id, 'S-1：latest 只选普通快照（pre-restore 不算回滚点）')

// S-2：同轮被合并保下来的条目不进淘汰候选（防「两条都归档、日志说反话」）
const s2Root = path.join(tmp, 's2')
const s2Shared = path.join(tmp, 's2-shared')
const s2SidecarDir = path.join(s2Root, 'recall')
fs.mkdirSync(s2SidecarDir, { recursive: true })
const longDup = '这是一段足够长的重复正文，用来触发去重合并判定，'.repeat(4)
saveOrb({ id: 'ka', title: '同一件事', content: longDup, scope: 'self', kind: 'event', importance: 1, updatedAt: now - 2000 }, s2Root, s2Shared)
saveOrb({ id: 'kb', title: '同一件事', content: longDup, scope: 'self', kind: 'event', importance: 1, updatedAt: now - 1000 }, s2Root, s2Shared)
saveOrb({ id: 'kc', title: '完全不同', content: '完全不同的一条内容，权重最高，用来占住上限位置。', scope: 'self', kind: 'event', importance: 5, updatedAt: now }, s2Root, s2Shared)
const s2Sidecars = buildSidecars(loadOrbs(s2Root, s2Shared).entries, {}, now)
writeSidecars(s2SidecarDir, s2Sidecars)
const s2Plan = planJanitor(s2Sidecars, { maxOrbs: 1 })
ok(!s2Plan.evict.some((item) => item.id === 'ka'), 'R-3：会被合并归档的 drop 不进淘汰候选')
ok(s2Plan.evict.some((item) => item.id === 'kc') === false, 'R-3：合并后按活跃数算溢出，不淘汰高权重条目')
const s2Run = runJanitor({
  dataRoot: s2Root,
  sharedRoot: s2Shared,
  sidecarDir: s2SidecarDir,
  sidecars: s2Sidecars,
  options: { maxOrbs: 1 },
  apply: true,
  merge: true,
  orbPathFor: (record) => orbPathFor(record, s2Root, s2Shared),
  now,
})
const s2After = readSidecarMap(s2SidecarDir)
ok(s2Run.merged.length === 1 && s2After.get('ka')?.archived === true, 'R-3：先合并（drop 归档），再按合并后集合淘汰')
ok(s2After.get('kc')?.archived === false, 'R-3：高权重条目不被名额压力转嫁淘汰')

// S-3：相似度用全文（原来只看前 300 字，长条目尾部差异被判重复）
const prefix300 = '同开头的前三百字用来制造截断假象，'.repeat(20).slice(0, 300)
const s3Pair = [
  { id: 'h1', tier: 'event', title: '', content: `${prefix300}${'甲'.repeat(100)}部署步骤`, importance: 3, updatedAt: now, archived: false },
  { id: 'h2', tier: 'event', title: '', content: `${prefix300}${'乙'.repeat(100)}回滚步骤`, importance: 3, updatedAt: now, archived: false },
]
ok(planDedupe(s3Pair, { minChars: 0 }).length === 0, 'S-3：同开头但尾部不同的长条目不算重复')

// S-4：旧栈 scope: global 也算 evergreen（默认 zzerx 源下不能被淘汰）
const s4 = buildSidecars([{ id: 'g1', scope: 'global', kind: 'fact', importance: 3, updatedAt: now }], {}, now)
ok(s4[0].evergreen === true && isProtected(s4[0]), 'S-4：scope=global 在迁移前也受保护')

// S-5：pinned 能落 orb 并读回（只对 zzerx 有效的死规则修掉）
const s5Root = path.join(tmp, 's5')
const s5Shared = path.join(tmp, 's5-shared')
saveOrb({ id: 'pin1', title: '固定条目', content: '固定正文内容', scope: 'self', kind: 'event', importance: 2, pinned: true, updatedAt: now }, s5Root, s5Shared)
const s5Record = loadOrbs(s5Root, s5Shared).entries.find((entry) => entry.id === 'pin1')
const s5Sidecar = buildSidecars([s5Record], {}, now)[0]
ok(s5Record.pinned === true && s5Sidecar.tier === 'core' && isProtected(s5Sidecar), 'S-5：pinned 落 orb → core → 受保护')

// S-6：不传 scope 的写入不再静默落公共区
let s6Error = null
try {
  saveOrb({ title: '显式项目', content: '正文', scope: 'project' }, path.join(tmp, 's6'), path.join(tmp, 's6-shared'))
} catch (error) {
  s6Error = String(error.message || error)
}
ok(String(s6Error).includes('projectPath'), 'S-6：显式 scope=project 且无 projectPath 直接报错（不落公共区）')

// S-9：快照记录的公共区和恢复时给的不一致 → 拒绝覆盖
const s9Root = path.join(tmp, 's9')
const s9SharedA = path.join(tmp, 's9-shared-a')
const s9SharedB = path.join(tmp, 's9-shared-b')
saveOrb({ id: 'sa', title: '公共区甲', content: '公共区甲正文', scope: 'global', updatedAt: now }, s9Root, s9SharedA)
const s9Snap = createSnapshot(s9Root, s9SharedA, { now })
let s9Error = null
try {
  restoreSnapshot(s9Root, s9SharedB, s9Snap.id, { now: now + 1000 })
} catch (error) {
  s9Error = String(error.message || error)
}
ok(String(s9Error).includes('公共区'), 'S-9：公共区路径对不上时拒绝恢复')

// capped 时不动盘、不留空快照
const cappedSidecars = ['w1', 'w2', 'w3'].map((id) => ({
  id,
  tier: 'working',
  status: 'active',
  archived: false,
  evergreen: false,
  pinned: false,
  importance: 3,
  decay: 1,
  updatedAt: now,
  title: id,
  content: id,
}))
const cappedRun = runJanitor({
  dataRoot: path.join(tmp, 'capped'),
  sharedRoot: path.join(tmp, 'capped-shared'),
  sidecarDir: path.join(tmp, 'capped-recall'),
  sidecars: cappedSidecars,
  options: { maxOrbs: 1 },
  apply: true,
  merge: true,
  now,
})
ok(cappedRun.applied === false && cappedRun.snapshot === null, 'G-6：capped（protected 占满）时不动盘、不留空快照')
ok(planJanitor(cappedSidecars, { maxOrbs: 1 }).capped === true, 'G-6：capped 如实上报')

// 容量缓冲：超过 maxOrbs × buffer 才归档
const bufferCases = ['e1', 'e2', 'e3', 'e4', 'e5'].map((id) => ({
  id, tier: 'event', status: 'active', archived: false, evergreen: false, pinned: false, working: false,
  importance: 3, decay: 1, updatedAt: now, title: id, content: id,
}))
ok(planJanitor(bufferCases, { maxOrbs: 4, archiveBuffer: 2 }).overflow === 0, '容量缓冲：5 条 / 上限 4 ×2 不动手')
ok(planJanitor(bufferCases, { maxOrbs: 4, archiveBuffer: 1 }).overflow === 1, '容量缓冲：buffer=1 时超一条就归档一条')

// G-11：上限是小数也要算得清
const frac = planJanitor(cappedSidecars, { maxOrbs: 2.5 })
ok(frac.maxOrbs === 2 && Number.isInteger(frac.overflow), 'G-11：maxOrbs 小数会取整，overflow 是整数')


// R-1 同类：importance 饱和（已 9）时合并不能误报失败
const satRoot = path.join(tmp, 'sat')
const satShared = path.join(tmp, 'sat-shared')
const satSidecarDir = path.join(satRoot, 'recall')
fs.mkdirSync(satSidecarDir, { recursive: true })
const satBody = '这是一条用来测权重饱和的重复正文，长度要足够长以通过去重门槛，'.repeat(2)
saveOrb({ id: 'nt1', title: '饱和重复', content: satBody, scope: 'self', kind: 'event', importance: 5, updatedAt: now - 1000 }, satRoot, satShared)
saveOrb({ id: 'nt2', title: '饱和重复', content: satBody, scope: 'self', kind: 'event', importance: 5, updatedAt: now }, satRoot, satShared)
for (const id of ['nt1', 'nt2']) {
  const file = orbPathFor({ id, updatedAt: now, scope: 'self' }, satRoot, satShared)
  const text = fs.readFileSync(file, 'utf8').replace(/^importance:.*$/m, 'importance: 9')
  fs.writeFileSync(file, text)
}
const satSidecars = buildSidecars(loadOrbs(satRoot, satShared).entries, {}, now)
writeSidecars(satSidecarDir, satSidecars)
const satRun = runJanitor({
  dataRoot: satRoot,
  sharedRoot: satShared,
  sidecarDir: satSidecarDir,
  sidecars: satSidecars,
  options: { maxOrbs: 100 },
  apply: true,
  merge: true,
  orbPathFor: (record) => orbPathFor(record, satRoot, satShared),
  now,
})
ok(satRun.merged.length === 1, 'G-12：importance 已饱和（9）时合并照常执行，不误报字段缺失')

// 默认 scope：不给 scope 且没 projectPath → self（不再落公共区）
const dfltRoot = path.join(tmp, 'dflt')
const dfltShared = path.join(tmp, 'dflt-shared')
const dflt = saveOrb({ title: '默认归属', content: '默认归属正文' }, dfltRoot, dfltShared)
ok(dflt.record.scope === 'self' && dflt.file.includes(`${path.sep}self${path.sep}`), 'S-6：不传 scope 默认写 self，不落公共区')
const dfltProject = saveOrb({ title: '项目归属', content: '项目归属正文', projectPath: 'L:\DSH\work' }, dfltRoot, dfltShared)
ok(dfltProject.record.scope === 'project', 'S-6：给了 projectPath 才按项目记')

// latest：多份普通快照取「按时间最新」的那份（不是目录名最大）
const latestRoot = path.join(tmp, 'latest')
createSnapshot(latestRoot, null, { now: now + 5000 })
createSnapshot(latestRoot, null, { now: now + 1000 })
createSnapshot(latestRoot, null, { now: now + 9000 })
ok(latestSnapshot(latestRoot)?.at === new Date(now + 9000).toISOString(), 'S-1：latest 取时间最新的普通快照')
ok(listSnapshots(latestRoot).length === 3, 'S-1：快照数不受乱序创建影响')

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n第 3–7 期自测：${total - failures.length}/${total} 通过`)
if (failures.length > 0) {
  console.log(`失败项：${failures.join(' ｜ ')}`)
  process.exit(1)
}
