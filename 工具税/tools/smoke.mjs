/**
 * 冒烟测试：零依赖、不碰真实 profile / 真实 DSH。
 *
 * 覆盖三块：
 *   1. Host：normalizeSchemas / measure / attributeTools / buildReport / 路由 handler
 *   2. Host：会话日志扫描（构造一段假会话，验证「按 (turn,step) 平摊」与峰谷判断）
 *   3. Client：注册侧栏 + 主面板（mock React + mock slots）
 *
 * 用法：node tools/smoke.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let passed = 0
let failed = 0
function ok(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log('  ✓', name)
  } else {
    failed += 1
    console.log('  ✗', name, detail)
  }
}

// ── Host 半测试 ───────────────────────────────────────────────────────────
console.log('\n[host]')
const host = await import(pathToFileURL(join(process.cwd(), 'lib', 'index.js')).href)
const scan = await import(pathToFileURL(join(process.cwd(), 'lib', 'session-scan.mjs')).href)

ok('normalizeSchemas 接受数组', host.normalizeSchemas([
  { name: 'a', description: 'A', parameters: { type: 'object', properties: {} } },
]).length === 1)

ok('normalizeSchemas 接受 Map', host.normalizeSchemas(
  new Map([['b', { name: 'b', description: 'B' }]]),
).length === 1)

ok('normalizeSchemas 忽略坏数据', host.normalizeSchemas([null, 42, {}, { name: '' }]).length === 0)

const tools = [
  { name: 'alpha_tool', description: '做一件事', parameters: { type: 'object', properties: { q: { type: 'string' } } } },
  { name: 'beta_tool', description: '做另一件事', parameters: null },
]
const measured = host.measure(tools)
ok('measure 统计字符 > 0', measured.chars > 0)
ok('measure 行数正确', measured.rows.length === 2)
ok('measure token 估算 = 字符/3.5', measured.tokens === Math.round(measured.chars / 3.5))

const owners = new Map([['alpha_tool', ['pkg-a']], ['beta_tool', []]])
const report = host.buildReport({ schemas: tools, owners, profileFound: true })
ok('buildReport 归对了插件', report.plugins.length === 1 && report.plugins[0].name === 'pkg-a')
ok('buildReport 记录未归属', report.unattributed.tools === 1)
ok('buildReport 带方法说明', typeof report.method === 'string' && report.method.includes('3.5'))
ok('buildReport 工具总数正确', report.toolCount === 2)

// 归属：造一个临时 profile，放一个声明了 alpha_tool 的包
const tmp = mkdtempSync(join(tmpdir(), 'tooltax-'))
try {
  const profile = join(tmp, 'profile')
  const pkgDir = join(profile, 'node_modules', 'pkg-a')
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { 'pkg-a': '1.0.0' } }))
  writeFileSync(join(profile, 'cordis.patch.yml'), '- id: pkg-a\n  name: pkg-a\n')
  writeFileSync(join(pkgDir, 'index.js'), 'export const t = defineTool({ name: "alpha_tool", description: "x" })\n')
  mkdirSync(join(pkgDir, 'client'), { recursive: true })
  writeFileSync(join(pkgDir, 'client', 'client.js'), 'export const t = defineTool({ name: "beta_tool" })\n')

  const mapped = host.attributeTools(profile, ['alpha_tool', 'beta_tool'])
  ok('attributeTools 命中宿主源码', JSON.stringify(mapped.get('alpha_tool')) === '["pkg-a"]')
  ok('attributeTools 跳过 client 半', (mapped.get('beta_tool') || []).length === 0)

  // ── 路由 handler：mock ctx，注入假 schema，跑一遍请求 ──
  const handlers = {}
  const fakeCtx = {
    tools: { schemas: () => tools.map((t) => ({ ...t })) },
    webServer: { register: (route) => { handlers[route.path] = route.handler; return () => {} } },
    effect: (fn) => { const dispose = fn(); return () => dispose?.() },
  }
  host.apply(fakeCtx, {})
  ok('apply 注册了 report 路由', typeof handlers['/api/tool-tax/report'] === 'function')
  ok('apply 注册了 tools 路由', typeof handlers['/api/tool-tax/tools'] === 'function')

  const run = (path, method = 'POST', body = '{}') => new Promise((resolve) => {
    const listeners = {}
    const req = { method, on: (event, cb) => { listeners[event] = cb } }
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(k, v) { this.headers[k] = v },
      end(payload) { resolve({ status: this.statusCode, body: JSON.parse(payload || '{}') }) },
    }
    handlers[path](req, res).catch(() => resolve({ status: -1, body: null }))
    setTimeout(() => {
      if (listeners.data && body) listeners.data(Buffer.from(body))
      if (listeners.end) listeners.end()
    }, 0)
  })

  const good = await run('/api/tool-tax/report')
  ok('report 正常请求返回 200', good.status === 200)
  ok('report 返回里带 totalTokens', typeof good.body?.value?.totalTokens === 'number')

  const wrongMethod = await run('/api/tool-tax/report', 'GET')
  ok('report 非 POST 返回 405', wrongMethod.status === 405)

  const badJson = await run('/api/tool-tax/report', 'POST', '{not json')
  ok('report 坏 JSON 返回 400', badJson.status === 400)

  // ── 会话扫描：构造一段假会话，验证平摊 ──
  const fakeSession = [
    { type: 'tool/call', time: 1000, data: { turn: 1, step: 1, callId: 'a', name: 'alpha_tool', arguments: '{}' } },
    { type: 'tool/call', time: 1000, data: { turn: 1, step: 1, callId: 'b', name: 'beta_tool', arguments: '{}' } },
    { type: 'assistant/message', time: 1000, data: { turn: 1, step: 1, usage: { inputTokens: 1000, cacheReadTokens: 0, outputTokens: 400, totalTokens: 1400 }, message: { source: { provider: 'deepseek-account', model: 'deepseek-flash' } } } },
    { type: 'tool/call', time: 2000, data: { turn: 2, step: 1, callId: 'c', name: 'alpha_tool', arguments: '{}' } },
    { type: 'assistant/message', time: 2000, data: { turn: 2, step: 1, usage: { inputTokens: 500, cacheReadTokens: 0, outputTokens: 100, totalTokens: 600 }, message: { source: { provider: 'deepseek-account', model: 'deepseek-flash' } } } },
  ].map((r) => JSON.stringify(r)).join('\n')
  const parsed = scan.parseSessionText(fakeSession)
  ok('扫描解析出 3 次工具调用', parsed.calls.length === 3)
  ok('扫描解析出 2 轮用量', parsed.usageByStep.size === 2)

  const byTool = new Map()
  scan.foldInto(byTool, parsed)
  const alpha = byTool.get('alpha_tool')
  const beta = byTool.get('beta_tool')
  ok('alpha 调用 2 次', alpha.calls === 2)
  ok('alpha 平摊 1300 tokens（700+600）', alpha.tokens === 1300, String(alpha.tokens))
  ok('beta 平摊 700 tokens', beta.tokens === 700, String(beta.tokens))
  ok('金额已计价（>0）', alpha.cny > 0)

  const wed10 = Date.UTC(2026, 10, 4, 2, 0, 0)
  const sun10 = Date.UTC(2026, 10, 8, 2, 0, 0)
  ok('北京时间周三 10 点算高峰', scan.isPeakHour(wed10) === true)
  ok('北京时间周日 10 点不算高峰', scan.isPeakHour(sun10) === false)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

// ── Client 半测试（v0.4：注入到 Token 面板底部）────────────────────────────
console.log('\n[client]')
const clientSrc = readFileSync(join(process.cwd(), 'lib', 'client.js'), 'utf8')
let loaded = null
const g = globalThis
const prevWindow = g.window
const prevFetch = g.fetch
try {
  g.window = { __ModuleLoader__: { load: (opts) => { loaded = opts } } }
  g.fetch = () => Promise.reject(new Error('no network in smoke'))
  const vm = await import('node:vm')
  vm.runInNewContext(clientSrc, { window: g.window, fetch: g.fetch, console })
  ok('客户端脚本调用了 __ModuleLoader__.load', loaded !== null && loaded.id === 'dsh-plugin-tool-tax')

  const plugin = loaded.factory(() => ({}))
  ok('导出 apply', typeof plugin.apply === 'function')
  ok('不再注册官方槽位（inject 为空）', Array.isArray(plugin.inject) && plugin.inject.length === 0)

  const inst = plugin._internal
  ok('金额格式（大数）', inst.money(2.4752) === '¥2.48')
  ok('金额格式（小数）', inst.money(0.0079) === '¥0.0079')
  ok('token 格式（万）', inst.fmt(77998626).includes('万'))
  ok('token 格式（亿）', inst.fmt(108428472).includes('亿'))

  ok('识别 Token 面板（今日消费）', inst.isTokenPanel({ textContent: '今日消费 · 2026-11-02' }) === true)
  ok('识别 Token 面板（账户余额）', inst.isTokenPanel({ textContent: '账户余额 ¥17' }) === true)
  ok('不认识别的页面', inst.isTokenPanel({ textContent: '插件列表' }) === false)
  ok('会话页（缓存命中 + 输入框）不识别', inst.isTokenPanel({ textContent: '11 轮 423 步 · 缓存命中 99.8% · 发送消息或创建任务' }) === false)
  ok('只有缓存命中、没有今日消费，不识别', inst.isTokenPanel({ textContent: '缓存命中 99.8% 输出 304,492' }) === false)
} finally {
  g.window = prevWindow
  g.fetch = prevFetch
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} · ${passed} 通过 / ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
