/**
 * 冒烟测试：零依赖、不碰真实 profile / 真实 DSH。
 *
 * 覆盖两半：
 *   1. Host：normalizeSchemas / measure / attributeTools / buildReport / 路由 handler
 *   2. Client：迷你 DOM 上跑一遍「卡片出现 → 工具税行插入 → 不重复插入」
 *
 * 用法：node tools/smoke.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
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

// ── 迷你 DOM：只实现插件用到的 API 与选择器 ───────────────────────────────
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.attrs = {}
    this.children = []
    this.parentNode = null
    this._text = ''
    this.title = ''
    this.style = {}
  }
  setAttribute(k, v) { this.attrs[k] = String(v) }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null }
  hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) }
  get shadowRoot() { return null }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child }
  removeChild(child) {
    const at = this.children.indexOf(child)
    if (at >= 0) this.children.splice(at, 1)
    child.parentNode = null
    return child
  }
  addEventListener() {}
  get textContent() {
    if (this.children.length === 0) return this._text
    return this.children.map((c) => c.textContent).join('')
  }
  set textContent(v) { this._text = String(v); this.children = [] }
  all(out = []) {
    for (const child of this.children) {
      out.push(child)
      child.all(out)
    }
    return out
  }
  matches(selector) {
    // 支持：tag、[attr]、[attr="v"]、以及它们的串联
  }
  querySelectorAll(selector) {
    return this.all().filter((el) => matchSelector(el, selector))
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }
}

/** 极简选择器：tag / [attr] / [attr="value"] / [attr][attr2="v"] 串联。 */
function matchSelector(el, selector) {
  const parts = selector.match(/^[a-zA-Z]+|\[[^\]]+\]/g) || []
  for (const part of parts) {
    if (part.startsWith('[')) {
      const m = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(part)
      if (!m) return false
      const [, name, value] = m
      if (!el.hasAttribute(name)) return false
      if (value !== undefined && el.getAttribute(name) !== value) return false
    } else if (el.tagName !== part.toUpperCase()) {
      return false
    }
  }
  return parts.length > 0
}

function makeDocument() {
  const html = new El('html')
  const body = new El('body')
  html.appendChild(body)
  const doc = {
    documentElement: html,
    body,
    createElement: (tag) => new El(tag),
    querySelector: (sel) => html.querySelector(sel),
    querySelectorAll: (sel) => html.querySelectorAll(sel),
    addEventListener() {},
  }
  return { doc, html, body }
}

function makeDialog(label) {
  const dialog = new El('div')
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-label', label)
  const dl = new El('dl')
  const dt = new El('dt')
  dt.textContent = '缓存读取'
  const dd = new El('dd')
  dd.textContent = '1,024 tokens'
  dl.appendChild(dt)
  dl.appendChild(dd)
  dialog.appendChild(dl)
  return { dialog, dl }
}

// ── Host 半测试 ───────────────────────────────────────────────────────────
console.log('\n[host]')
const host = await import(pathToFileURL(join(process.cwd(), 'lib', 'index.js')).href)

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
  let handler = null
  const fakeCtx = {
    tools: { schemas: () => tools.map((t) => ({ ...t })) },
    webServer: { register: (route) => { handler = route.handler; return () => {} } },
    effect: (fn) => { const dispose = fn(); return () => dispose?.() },
  }
  host.apply(fakeCtx, {})
  ok('apply 注册了 /api/tool-tax/report', handler !== null)

  const run = (method = 'POST', body = '{}') => new Promise((resolve) => {
    const listeners = {}
    const req = {
      method,
      on: (event, cb) => { listeners[event] = cb },
    }
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(k, v) { this.headers[k] = v },
      end(payload) { resolve({ status: this.statusCode, body: JSON.parse(payload || '{}') }) },
    }
    handler(req, res).catch(() => resolve({ status: -1, body: null }))
    setTimeout(() => {
      if (listeners.data && body) listeners.data(Buffer.from(body))
      if (listeners.end) listeners.end()
    }, 0)
  })

  const good = await run('POST', '{}')
  ok('正常请求返回 200', good.status === 200)
  ok('返回里带 totalTokens', typeof good.body?.value?.totalTokens === 'number')

  const wrongMethod = await run('GET', '{}')
  ok('非 POST 返回 405', wrongMethod.status === 405)

  const badJson = await run('POST', '{not json')
  ok('坏 JSON 返回 400', badJson.status === 400)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

// ── Client 半测试 ─────────────────────────────────────────────────────────
console.log('\n[client]')
const clientSrc = (await import('node:fs')).readFileSync(join(process.cwd(), 'lib', 'client.js'), 'utf8')

const { doc, body } = makeDocument()
const g = globalThis
const prevWindow = g.window
const prevDocument = g.document
const prevFetch = g.fetch
const prevMutationObserver = g.MutationObserver
const prevSetTimeout = g.setTimeout
let loaded = null
try {
  g.window = {
    __ModuleLoader__: { load: (opts) => { loaded = opts } },
  }
  g.document = doc
  g.fetch = () => Promise.reject(new Error('no network in smoke'))
  g.MutationObserver = class { observe() {} disconnect() {} }
  g.setTimeout = (fn) => { fn(); return 0 } // 立即执行，避免异步等待

  // 在受控上下文里执行客户端脚本
  const vm = await import('node:vm')
  vm.runInNewContext(clientSrc, { window: g.window, document: g.document, setTimeout: g.setTimeout, console })
  ok('客户端脚本调用了 __ModuleLoader__.load', loaded !== null && loaded.id === 'dsh-plugin-tool-tax')

  const plugin = loaded.factory(() => ({ createElement: () => ({}) }))
  ok('客户端导出了 apply', typeof plugin.apply === 'function')

  // 造一张「Token 用量」卡片
  const { dialog, dl } = makeDialog('Token 用量')
  body.appendChild(dialog)

  const fakeReport = {
    ok: true,
    totalTokens: 16571,
    tokenRange: [14500, 19300],
    method: '测试方法',
    plugins: [{ name: 'pkg-a', tools: 3, tokens: 9000 }],
    unattributed: { tools: 1, tokens: 500 },
  }
  const internal = plugin._internal
  internal.setReport(fakeReport)
  internal.insertRow(dialog, fakeReport)

  const rows = dl.querySelectorAll('[data-tool-tax-row]')
  ok('插入两行（工具税 + 工具账单）', rows.length === 4)
  ok('dt 文案是「工具税」', rows[0] && rows[0].textContent === '工具税')
  ok('dd 文案带估算值', rows[1] && rows[1].textContent.includes('16.6k'))
  ok('第二行是「工具账单」', rows[2] && rows[2].textContent === '工具账单')

  internal.insertRow(dialog, fakeReport)
  ok('重复打开不会插第二组', dl.querySelectorAll('[data-tool-tax-row]').length === 4)

  internal.uninstall()
  ok('卸载后零残留', dl.querySelectorAll('[data-tool-tax-row]').length === 0)
} finally {
  g.window = prevWindow
  g.document = prevDocument
  g.fetch = prevFetch
  g.MutationObserver = prevMutationObserver
  g.setTimeout = prevSetTimeout
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} · ${passed} 通过 / ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
