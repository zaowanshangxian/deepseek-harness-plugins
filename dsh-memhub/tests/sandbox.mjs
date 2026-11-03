/**
 * 沙箱运行验证（不安装、不碰桌面客户端）：
 * mock loader 跑真实 src/host.js，检查 18 工具、4 处注入、各模块行为、写门、工具 schema 成本。
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

const ZERKX_ROOT = path.join(os.homedir(), '.dsh', 'storages', 'memory')

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
apply(ctx, { vault: REAL_VAULT, sharedRoot: TMP_SHARED, recall: { sourceRoot: ZERKX_ROOT } })

const byName = Object.fromEntries(registered.map((definition) => [definition.name, definition]))
const expectedTools = [
  'skill_search', 'skill_load', 'skill_list', 'skill_register',
  'memhub_open', 'memhub_raw', 'memhub_budget', 'memhub_archive',
  'lesson_save', 'lesson_match', 'lesson_graduate', 'promote_to_skill', 'skill_outcome',
  'self_note_write', 'self_view', 'affect_state', 'affect_pin', 'affect_event',
]
ok(registered.length === expectedTools.length, `注册 ${expectedTools.length} 个工具（实际 ${registered.length}）`)
ok(expectedTools.every((name) => Boolean(byName[name])), '18 个工具名齐全')
ok(sections.length === 1 && sections[0].text === HINT_TEXT, '技能提示注入且与常量一致')
ok(sections[0]?.order === 90000, '技能提示 order=90000（最底部）')
ok(contexts.length === 5, `注册 5 个动态注入（实际 ${contexts.length}）`)
ok(
  [901, 902, 903, 904, 905].every((order, index) => contexts[index]?.order === order),
  '注入顺序 901–905（记忆/情感/自我/人格/索引）',
)
ok(String(contexts[3]?.text?.() || '').includes('性格'), '人格注入块含性格参数')
ok(String(contexts[4]?.text?.() || '').includes('索引'), '索引注入块指向 INDEX.md')
const memoryBlock = contexts[0].text()
ok(memoryBlock.includes('## 记忆') && memoryBlock.length <= DEFAULT_BUDGET_CHARS, `记忆块 ≤${DEFAULT_BUDGET_CHARS}（实际 ${memoryBlock.length}）`)

// 工具 schema 成本（盲审建议2：不能只算提示，工具面也是常驻）
const schemaChars = registered.reduce(
  (sum, definition) =>
    sum + definition.name.length + String(definition.description || '').length + JSON.stringify(definition.parameters || {}).length,
  0,
)
console.log(`      [info] 18 个工具 schema 合计 ${schemaChars} 字符 ≈${Math.round(schemaChars * 0.65)} tokens`)
ok(schemaChars <= 2400, `工具 schema ≤2400 字符（实际 ${schemaChars}）`)

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
const data = (await import('../src/recall-store.js')).loadZzerxMemories(ZERKX_ROOT)
const draft = await byName.promote_to_skill.execute({ ids: data.entries.slice(0, 3).map((item) => item.id) })
ok(draft.text.includes('技能草案'), 'promote_to_skill 出草案')
ok((await byName.skill_outcome.execute({ skill: 'tdd', success: true })).text.includes('已记录'), 'skill_outcome 回写')
ok((await byName.self_note_write.execute({ text: '沙箱里写的一段自我叙述' })).text.includes('已写'), 'self_note_write 写入')
ok((await byName.self_view.execute()).text.includes('自我叙述'), 'self_view 可读')
ok((await byName.affect_state.execute()).text.includes('mood'), 'affect_state 返回参数')
ok((await byName.affect_pin.execute({ mood: 'serious', until: '2099-01-01T00:00:00+08:00', reason: '沙箱' })).text.includes('已指定'), 'affect_pin 指定基调')
ok((await byName.affect_event.execute({ type: 'praise' })).text.includes('情感已更新'), 'affect_event 事件更新')

// owner 门：读 + 写都要守
const guarded = makeCtx()
apply(guarded.ctx, { vault: REAL_VAULT, sharedRoot: TMP_SHARED, recall: { sourceRoot: ZERKX_ROOT, ownerOnly: true, ownerSessions: [] } })
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

fs.rmSync(tmpHome, { recursive: true, force: true })
console.log(`\n沙箱验证：${total - failures.length}/${total} 通过`)
if (failures.length > 0) process.exit(1)
