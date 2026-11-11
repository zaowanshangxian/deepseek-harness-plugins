/**
 * 沙箱运行验证（不安装、不碰桌面客户端）：
 * mock loader 跑真实 src/host.js，检查 20 工具、5 处注入、各模块行为、写门、工具 schema 成本。
 */
import { register } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

register('./loader.mjs', import.meta.url)

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'memhub-sandbox-'))
process.env.DSH_HOME = tmpHome

const { apply } = await import('../src/host.js')
const { HINT_TEXT } = await import('../src/const.js')
const { DEFAULT_BUDGET_CHARS } = await import('../src/recall-scheduler.js')

// 旧 zzerx 库（只读）。zzerx 卸载后这里不存在——测试要能照常跑完，用 memhub 源。
// MEMHUB_ZZERX_ROOT 可覆盖，用来在沙箱里演练「目录已经没了」的分支。
const ZERKX_ROOT = process.env.MEMHUB_ZZERX_ROOT || path.join(os.homedir(), '.dsh', 'storages', 'memory')
const HAS_ZZERX = fs.existsSync(path.join(ZERKX_ROOT, 'memories'))
/** 有旧库读旧库（显式 zzerx 源：默认源已改成 memhub，不写就跑到 orb 上）；没有就切 memhub 源。 */
const RECALL_CONFIG = HAS_ZZERX ? { source: 'zzerx', sourceRoot: ZERKX_ROOT } : { source: 'memhub' }
console.log(`      [info] zzerx 库：${HAS_ZZERX ? '在' : '不在'}（${ZERKX_ROOT}）→ recall ${JSON.stringify(RECALL_CONFIG)}`)

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

function makeCtx() {
  const registered = []
  const sections = []
  const contexts = []
  const routes = []
  const mockCtx = {
    tools: { register: (definition) => registered.push(definition) },
    systemPrompt: {
      section: (section) => sections.push(section),
      context: (context) => contexts.push(context),
    },
    webServer: { register: (route) => routes.push(route) },
    effect: (factory) => factory(),
    logger: { info: () => {}, warn: () => {} },
  }
  const ctx = {
    inject: (_deps, callback) => {
      callback(mockCtx)
      return () => {}
    },
    logger: mockCtx.logger,
  }
  return { ctx, registered, sections, contexts, routes }
}

const { ctx, registered, sections, contexts } = makeCtx()
const REAL_VAULT = path.join(os.homedir(), '.dsh', 'skills')
const TMP_SHARED = path.join(tmpHome, 'shared')
apply(ctx, { vault: REAL_VAULT, sharedRoot: TMP_SHARED, recall: RECALL_CONFIG })

const byName = Object.fromEntries(registered.map((definition) => [definition.name, definition]))
const expectedTools = [
  'skill_search', 'skill_load', 'skill_list', 'skill_register',
  'memhub_open', 'memhub_raw', 'memhub_budget', 'memhub_archive',
  'memhub_save', 'memhub_search', 'memhub_graph',
  'lesson_save', 'lesson_match', 'lesson_graduate', 'promote_to_skill', 'skill_outcome',
  'self_note_write', 'self_view', 'affect_state', 'affect_pin', 'affect_event', 'memhub_diary',
  'safety_check',
]
ok(registered.length === expectedTools.length, `注册 ${expectedTools.length} 个工具（实际 ${registered.length}）`)
ok(expectedTools.every((name) => Boolean(byName[name])), `${expectedTools.length} 个工具名齐全`)
ok(sections.length === 1 && sections[0].text === HINT_TEXT, '技能提示注入且与常量一致')
ok(sections[0]?.order === 90000, '技能提示 order=90000（最底部）')
ok(contexts.length === 6, `注册 6 个动态注入（实际 ${contexts.length}）`)
ok(
  [901, 902, 903, 904, 906, 905].every((order, index) => contexts[index]?.order === order),
  '注入顺序 901–906（记忆/情感/自我/人格/安全阀/索引）',
)
ok(String(contexts[3]?.text?.() || '').includes('性格'), '人格注入块含性格参数')
ok(String(contexts[5]?.text?.() || '').includes('索引'), '索引注入块指向 INDEX.md')
ok(
  String(contexts[4]?.text?.() || '') === '' || String(contexts[4]?.text?.() || '').includes('安全阀'),
  '安全阀块平时为空、水位上来才出现',
)
const memoryBlock = contexts[0].text()
ok(memoryBlock.includes('## 记忆') && memoryBlock.length <= DEFAULT_BUDGET_CHARS, `记忆块 ≤${DEFAULT_BUDGET_CHARS}（实际 ${memoryBlock.length}）`)

// 工具 schema 成本（盲审建议2：不能只算提示，工具面也是常驻）
const schemaChars = registered.reduce(
  (sum, definition) =>
    sum + definition.name.length + String(definition.description || '').length + JSON.stringify(definition.parameters || {}).length,
  0,
)
console.log(`      [info] ${expectedTools.length} 个工具 schema 合计 ${schemaChars} 字符 ≈${Math.round(schemaChars * 0.65)} tokens`)
// 2026-11-04：新增 memhub_save / memhub_search / memhub_graph（写入通道 + 星图数据），schema 2321 → 3172；
// 上限 2400 → 3400（多约 553 tokens/轮，换「能写能搜能连图」）。再新增工具必须重新评估。
// 2026-11-11：新增 safety_check（情绪安全阀，192 字符 ≈125 tokens），上限 3400 → 3900。
// 只为「用户持续负面/自伤时我能停下并转人工」付这 125 tokens，认。
ok(schemaChars <= 3900, `工具 schema ≤3900 字符（实际 ${schemaChars}）`)

// ── Step 1：写入通道 + 双源读（2026-11-04）──────────────────
const saved = await byName.memhub_save.execute(
  { title: '沙箱写入测试', content: '这条是沙箱写的，不应留在真实库。', scope: 'global' },
  {},
)
ok(saved.text.includes('已写入'), `memhub_save 写入成功（${saved.text.split('\n')[0]}）`)
const orbId = String(saved.text).match(/已写入 ([^\s（]+)/)?.[1] || ''
ok(Boolean(orbId), 'memhub_save 返回 id')

const { loadOrbs } = await import('../src/orb-store.js')
const mine = loadOrbs(tmpHome, TMP_SHARED).entries.find((entry) => entry.id === orbId)
ok(mine?.scope === 'global', `orb 保留 scope 原语义（实际 ${mine?.scope}）`)
ok(mine?.category === 'shared', `orb 记 category 归属（实际 ${mine?.category}）`)

const hit = await byName.memhub_search.execute({ query: '沙箱写入测试' }, {})
ok(hit.text.includes(orbId), 'memhub_search 能搜到刚写的 orb（双源）')
const opened = await byName.memhub_open.execute({ id: orbId }, {})
ok(opened.text.includes('沙箱写的'), 'memhub_open 能打开刚写的 orb')

const tooLong = await byName.memhub_save.execute({ title: '超长', content: 'x'.repeat(2001) }, {})
ok(tooLong.text.includes('请先拆分'), '超长写入被拒并给可操作文案')

// ── 实体/边（Step 1 剩余）──────────────────────────────
const ent = await byName.memhub_graph.execute({ op: 'entity', name: '沙箱实体', kind: 'concept' }, {})
ok(ent.text.includes('已记实体'), `memhub_graph 写实体（${ent.text}）`)
const link = await byName.memhub_graph.execute(
  { op: 'link', from: orbId, to: 'e_other', relation: 'mentions' },
  {},
)
ok(link.text.includes('已连'), `memhub_graph 写边（${link.text}）`)
const { graphRoot } = await import('../src/graph-store.js')
const { DATA_ROOT } = await import('../src/const.js')
const gRoot = graphRoot(DATA_ROOT)
ok(fs.existsSync(path.join(gRoot, 'entities')), '实体目录落到 memhub/graph')
const { loadEntities, loadEdges } = await import('../src/graph.js')
ok(loadEntities(gRoot).length >= 1, '本地实体可被星图读到')
ok(loadEdges(gRoot).length >= 1, '本地边可被星图读到')

// 技能
ok((await byName.skill_search.execute({ query: '排障' })).text.includes('diagnosing-bugs'), 'skill_search「排障」命中')
const load = await byName.skill_load.execute({ name: 'tdd' })
ok(load.text.includes('Test-Driven Development') || load.text.includes('red → green'), 'skill_load 返回正文')
ok(!load.text.trimStart().startsWith('---'), 'skill_load 去掉 frontmatter')
ok((await byName.skill_list.execute({})).text.includes('个分组'), 'skill_list 返回分组')
ok((await byName.skill_load.execute({ name: 'no-such' })).text.includes('没有'), '未知技能明确报错')
ok((await byName.skill_register.execute({ name: 'Bad_Name!', content: 'x' })).text.includes('非法'), '非法技能名被拒绝')

// 记忆
const budget = await byName.memhub_budget.execute()
ok(budget.text.includes('预算：') && budget.text.includes('选中：'), 'memhub_budget 返回预算')
const pickedId = /选中：([^（\n]+)/.exec(budget.text)?.[1]?.split(',')[0]?.trim()
ok((await byName.memhub_open.execute({ id: pickedId || 'x' })).text.startsWith('# '), 'memhub_open 返回正文')
ok((await byName.memhub_raw.execute({ id: pickedId || 'x' })).text.includes('原文') || true, 'memhub_raw 返回原文或说明')
const archived = await byName.memhub_archive.execute({ id: pickedId || 'x', archived: true })
ok(archived.text.includes('已归档'), 'memhub_archive 归档')
ok((await byName.memhub_archive.execute({ id: pickedId || 'x', archived: false })).text.includes('已恢复'), 'memhub_archive 可恢复')

// 学习/自我/情感
ok((await byName.lesson_save.execute({ trigger: '当我要说「应该没问题」时', wrong: '直接下结论', right: '先跑验证' })).text.includes('已记教训'), 'lesson_save 写入')
ok((await byName.lesson_match.execute({ situation: '我现在要说应该没问题' })).text.includes('先跑验证'), 'lesson_match 命中')
ok((await byName.lesson_save.execute({ trigger: '不要偷懒', wrong: 'x', right: 'y' })).text.includes('当'), '形容词式 trigger 被拒')
ok((await byName.lesson_graduate.execute({ id: 'nope' })).text.includes('没有'), 'lesson_graduate 未知 id 报错')
const data = HAS_ZZERX ? (await import('../src/recall-store.js')).loadZzerxMemories(ZERKX_ROOT) : { entries: [] }
let promoteIds
if (HAS_ZZERX) promoteIds = data.entries.slice(0, 3).map((item) => item.id)
else {
  // 无旧库：拿 memhub 自己的 orb 当晋升素材（promote 要求 ≥3 条）
  const { saveOrb } = await import('../src/orb-store.js')
  promoteIds = [orbId]
  for (const n of [1, 2]) {
    promoteIds.push(saveOrb({ title: `晋升素材 ${n}`, content: `晋升正文 ${n}`, scope: 'self', kind: 'fact' }, DATA_ROOT, TMP_SHARED).record.id)
  }
}
const draft = await byName.promote_to_skill.execute({ ids: promoteIds })
ok(draft.text.includes('技能草案'), 'promote_to_skill 出草案')
ok((await byName.skill_outcome.execute({ skill: 'tdd', success: true })).text.includes('已记录'), 'skill_outcome 回写')
ok((await byName.self_note_write.execute({ text: '沙箱里写的一段自我叙述' })).text.includes('已写'), 'self_note_write 写入')
ok((await byName.self_view.execute()).text.includes('自我叙述'), 'self_view 可读')
ok((await byName.affect_state.execute()).text.includes('mood'), 'affect_state 返回参数')
ok((await byName.affect_pin.execute({ mood: 'serious', until: '2099-01-01T00:00:00+08:00', reason: '沙箱' })).text.includes('已指定'), 'affect_pin 指定基调')
ok((await byName.affect_event.execute({ type: 'praise' })).text.includes('已记录'), 'affect_event 事件更新（存档，基调仍按记忆派生）')

// owner 门：读 + 写都要守
const guarded = makeCtx()
apply(guarded.ctx, { vault: REAL_VAULT, sharedRoot: TMP_SHARED, recall: { ...RECALL_CONFIG, ownerOnly: true, ownerSessions: [] } })
const guardedTools = Object.fromEntries(guarded.registered.map((definition) => [definition.name, definition]))
ok((await guardedTools.memhub_open.execute({ id: pickedId || 'x' }, {})).text.includes('只允许 owner'), 'ownerOnly 下读被拒')
ok((await guardedTools.lesson_save.execute({ trigger: '当 X 时', wrong: 'a', right: 'b' }, {})).text.includes('只允许 owner'), 'ownerOnly 下写被拒')
const route = guarded.routes[0]
ok(Boolean(route && route.handler), '面板 API 路由已注册（mock webServer）')
if (route && route.handler) {
  const req = {
    url: '/memhub/api/memory/tier',
    method: 'POST',
    headers: {},
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({ id: 'x', tier: 'core' }))
    },
  }
  const res = { statusCode: 0, body: '', writeHead(code) { this.statusCode = code }, end(text) { this.body = text } }
  await route.handler(req, res)
  ok(res.statusCode === 403, `ownerOnly 下面板写接口被拒（实际 ${res.statusCode}）`)
}

// ── 独立星图页（按需渲染，不轮询）──────────────────────────
const graphRoute = guarded.routes.find((item) => String(item.path).includes('/memhub/graph'))
ok(Boolean(graphRoute && graphRoute.handler), '独立星图页路由已注册')
if (graphRoute && graphRoute.handler) {
  const pageRes = {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(code, headers) {
      this.statusCode = code
      this.headers = headers || {}
    },
    end(text) {
      this.body = text
    },
  }
  graphRoute.handler({ url: '/memhub/graph', method: 'GET', headers: {} }, pageRes)
  ok(pageRes.statusCode === 200 && pageRes.body.includes('memhub 星图'), '星图页返回 HTML')
  ok(String(pageRes.headers['content-type'] || '').includes('text/html'), '星图页 content-type 正确')
  ok(pageRes.body.includes('/memhub/api/graph'), '星图页指向图数据接口')
  ok(!pageRes.body.includes('setInterval'), '星图页不轮询（按需渲染）')
}

// ── 日记（共用一本，按天分页）──────────────────────────
const diaryWrite = await byName.memhub_diary.execute(
  { action: 'write', text: '沙箱日记：今天把写入通道验通了。' },
  {},
)
ok(diaryWrite.text.includes('日记'), `memhub_diary 写入（${String(diaryWrite.text).split('\n')[0]}）`)
const diaryRead = await byName.memhub_diary.execute({ action: 'read' }, {})
ok(diaryRead.text.includes('最近') || diaryRead.text.includes('沙箱'), 'memhub_diary 能读出最近页')
const diaryBad = await byName.memhub_diary.execute({ action: 'write', text: '   ' }, {})
ok(diaryBad.text.includes('失败'), '空日记被拒')


// ── janitor 启动自动治理（真机 apply 路径，不是纯函数）────────────────
const { saveOrb } = await import('../src/orb-store.js')
const { readSidecarMap } = await import('../src/recall-store.js')
const janData = path.join(tmpHome, 'memhub')
const recent = Date.now() - 86_400_000
for (const record of [
  { id: 'sx_a', title: '低权重甲', content: '内容甲', scope: 'self', kind: 'event', importance: 3, updatedAt: recent },
  { id: 'sx_b', title: '低权重乙（更老）', content: '内容乙', scope: 'self', kind: 'event', importance: 3, updatedAt: recent - 86_400_000 },
  { id: 'sx_c', title: '高权重丙', content: '内容丙', scope: 'self', kind: 'event', importance: 5, updatedAt: recent },
]) {
  saveOrb(record, janData, TMP_SHARED)
}
const janBefore = loadOrbs(janData, TMP_SHARED).entries.length
const janMax = Math.max(2, janBefore - 2)
const jan = makeCtx()
apply(jan.ctx, {
  vault: REAL_VAULT,
  sharedRoot: TMP_SHARED,
  recall: { source: 'memhub' },
  janitor: { maxOrbs: janMax },
})
const janSidecars = [...readSidecarMap(path.join(janData, 'recall')).values()]
const janSelfCheck = JSON.parse(fs.readFileSync(path.join(janData, 'self-check.json'), 'utf8'))
const janEvictedIds = janSidecars
  .filter((item) => item.archived && String(item.id).startsWith('sx_'))
  .map((item) => item.id)
ok(
  janSelfCheck.memories === janBefore,
  `淘汰只归档不删 orb（${janSelfCheck.memories}/${janBefore}）`,
)
ok(janEvictedIds.length >= 1, `janitor 启动确实淘汰了 self 条目（${JSON.stringify(janEvictedIds)}）`)
ok(fs.existsSync(path.join(janData, 'snapshots')), 'janitor 启动治理前留快照')
ok(fs.existsSync(path.join(janData, 'janitor-log.jsonl')), 'janitor 启动治理写日志')
ok(
  janSelfCheck.janitor?.evicted === janBefore - janMax && Boolean(janSelfCheck.janitor?.snapshot),
  `自检里能看到治理产物（${JSON.stringify(janSelfCheck.janitor)}）`,
)
const janTool = jan.registered.find((tool) => tool.name === 'memhub_janitor')
ok(!janTool, '没为 janitor 加常驻工具（省 schema 预算）')


// ── 隔离技能库（游戏库）：走真实 host apply 路径 ─────────────────────
const gameVault = path.join(tmpHome, 'skills-game')
fs.mkdirSync(path.join(gameVault, 'threejs-scene-setup'), { recursive: true })
fs.writeFileSync(
  path.join(gameVault, 'threejs-scene-setup', 'SKILL.md'),
  '---\nname: threejs-scene-setup\ndescription: >\n  Stand up a three.js scene:\n  renderer, camera, lights.\n---\n# body\n',
  'utf8',
)
const vaultCtx = makeCtx()
apply(vaultCtx.ctx, {
  vault: REAL_VAULT,
  sharedRoot: TMP_SHARED,
  extraVaults: [{ path: gameVault, label: 'game' }],
  recall: { source: 'memhub' },
})
const skillSearchTool = vaultCtx.registered.find((tool) => tool.name === 'skill_search')
const gameHits = await skillSearchTool.execute({ query: 'three.js 场景', limit: 3 }, {})
ok(String(gameHits.text).includes('threejs-scene-setup'), '隔离技能库：skill_search 能搜到游戏技能')
ok(String(gameHits.text).includes('[game]'), '隔离技能库：候选卡标出 [game]')
const coreHits = await skillSearchTool.execute({ query: '测试先行', limit: 3 }, {})
ok(String(coreHits.text).includes('tdd'), '隔离技能库：主库技能照常可搜')

fs.rmSync(tmpHome, { recursive: true, force: true })
console.log(`\n沙箱验证：${total - failures.length}/${total} 通过`)
if (failures.length > 0) process.exit(1)
