/**
 * 冒烟测试：用零依赖的假 DOM 跑一遍 lib/client.js 的注入逻辑。
 * 目的不是模拟浏览器全部行为，而是盯住「卡片打开 → 花费/余额两行出现」这条主链路，
 * 以及「官方卡片结构变了会不会静默失败」——CI 里跑，防止再出现 0.8.x 那种「线上根本没插入」的回归。
 *
 * 用法：node tools/smoke.mjs
 */
import { readFileSync } from 'node:fs'

// ── 迷你 DOM：只实现插件实际用到的 API 与选择器 ────────────────────────────
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.attrs = {}
    this.children = []
    this.parentNode = null
    this._text = ''
    this.title = ''
    this.style = { cssText: '' }
  }
  setAttribute(k, v) { this.attrs[k] = String(v) }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null }
  hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) }
  get id() { return this.attrs.id || '' }
  set id(v) { this.attrs.id = String(v) }
  get className() { return this.attrs.class || '' }
  set className(v) { this.attrs.class = String(v) }
  appendChild(child) {
    child.parentNode = this
    this.children.push(child)
    return child
  }
  removeChild(child) {
    const at = this.children.indexOf(child)
    if (at >= 0) this.children.splice(at, 1)
    child.parentNode = null
    return child
  }
  get textContent() {
    if (this.children.length === 0) return this._text
    return this.children.map((c) => c.textContent).join('')
  }
  set textContent(v) {
    this.children.forEach((c) => { c.parentNode = null })
    this.children = []
    this._text = String(v)
  }
  getBoundingClientRect() { return { x: 0, y: 0, width: 100, height: 20, top: 0, left: 0 } }
  querySelector(sel) {
    const all = this.querySelectorAll(sel)
    return all.length ? all[0] : null
  }
  querySelectorAll(sel) {
    const out = []
    walk(this, (node) => {
      if (node !== this && matches(node, splitSelector(sel).pop() || '')) out.push(node)
    })
    return out
  }
}

function walk(root, fn) {
  fn(root)
  for (const child of root.children) walk(child, fn)
}

/** 支持：tag / .class? / [attr] / [attr="v"] / [attr*="v"]，多段用后代关系 */
function matches(node, compound) {
  if (!compound) return false
  const tagMatch = compound.match(/^([a-zA-Z]+)/)
  if (tagMatch && node.tagName !== tagMatch[1].toUpperCase()) return false
  const attrRe = /\[([a-zA-Z-]+)(?:(\*?)=\"([^\"]*)\")?\]/g
  let m
  while ((m = attrRe.exec(compound)) !== null) {
    const [, name, op, value] = m
    const actual = node.getAttribute(name)
    if (actual === null) return false
    if (op === '=' && actual !== value) return false
    if (op === '*=' && !actual.includes(value)) return false
  }
  const classRe = /\.([\w-]+)/g
  while ((m = classRe.exec(compound)) !== null) {
    if (!node.className.split(/\s+/).includes(m[1])) return false
  }
  return true
}

/** 按空格切选择器，但要忽略属性值里的空格（例如 [aria-label="Token 用量"]） */
function splitSelector(sel) {
  const parts = []
  let buf = ''
  let inBracket = 0
  let quote = ''
  for (const ch of sel) {
    if (quote) {
      buf += ch
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue }
    if (ch === '[') inBracket += 1
    if (ch === ']') inBracket -= 1
    if (/\s/.test(ch) && inBracket === 0) {
      if (buf.trim()) parts.push(buf.trim())
      buf = ''
      continue
    }
    buf += ch
  }
  if (buf.trim()) parts.push(buf.trim())
  return parts
}

function matchesChain(node, chain) {
  // 从最右段开始向左匹配祖先
  let current = node
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    if (!current) return false
    if (!matches(current, chain[i])) return false
    if (i > 0) current = current.parentNode
  }
  return true
}

const documentStub = {
  body: new El('body'),
  createElement(tag) { return new El(tag) },
  getElementById(id) {
    let found = null
    walk(this.body, (node) => { if (!found && node.id === id) found = node })
    return found
  },
  querySelectorAll(sel) {
    const chain = splitSelector(sel)
    const out = []
    walk(this.body, (node) => { if (matchesChain(node, chain)) out.push(node) })
    return out
  },
  querySelector(sel) {
    const all = this.querySelectorAll(sel)
    return all.length ? all[0] : null
  },
  addEventListener() {},
}

// ── 场景数据：官方「Token 用量」会话卡片 ─────────────────────────────────
const dialog = documentStub.createElement('div')
dialog.setAttribute('role', 'dialog')
dialog.setAttribute('aria-label', 'Token 用量')
const dl = documentStub.createElement('dl')
for (const [label, value] of [
  ['缓存命中', '99.7%'],
  ['未缓存输入', '147,477 tok'],
  ['缓存读取', '47,228,032 tok'],
  ['输出', '188,784 tok'],
]) {
  const dt = documentStub.createElement('dt')
  dt.textContent = label
  const dd = documentStub.createElement('dd')
  dd.textContent = value
  dl.appendChild(dt)
  dl.appendChild(dd)
}
dialog.appendChild(dl)
documentStub.body.appendChild(dialog)

const crumbs = documentStub.createElement('nav')
crumbs.className = 'an3WzG_crumbs'
const crumb = documentStub.createElement('span')
crumb.className = 'an3WzG_crumbCurrent'
crumb.textContent = '重启 DSH 验收插件'
crumbs.appendChild(crumb)
documentStub.body.appendChild(crumbs)

// ── 假 fetch：token-mb 的两条公开路由 ────────────────────────────────────
const responses = {
  '/token-mb/summary': {
    ok: true,
    data: {
      sessions: {
        // 昨天的一条：不应计入「今日累计」
        s0: { calls: 40, cny: 5.0, hit: 1000, miss: 200, out: 300, lastTime: Date.now() - 86400000, title: '昨天的会话', isSubagent: false },
        s1: { calls: 264, cny: 1.85, hit: 47228032, miss: 147477, out: 188784, lastTime: Date.now(), title: '重启 DSH 验收插件', isSubagent: false },
        // 子代理会话：不计入
        s2: { calls: 9, cny: 0.42, hit: 100, miss: 100, out: 100, lastTime: Date.now(), title: '子代理', isSubagent: true },
      },
    },
  },
  '/token-mb/balance': {
    ok: true,
    data: {
      supported: true,
      ok: true,
      source: 'account',
      balance_infos: [{ currency: 'CNY', total_balance: '48.85' }],
      total_costs: [{ currency: 'CNY', amount: '57.20' }],
    },
  },
}

const fetchStub = async (url) => {
  const key = String(url).split('?')[0]
  if (!responses[key]) return { ok: false, status: 404, json: async () => ({}) }
  return { ok: true, status: 200, json: async () => responses[key] }
}

// ── 假 window / 其它全局 ────────────────────────────────────────────────
const localStorageStub = {
  store: new Map(),
  getItem(k) { return this.store.has(k) ? this.store.get(k) : null },
  setItem(k, v) { this.store.set(k, String(v)) },
}

const windowStub = {
  localStorage: localStorageStub,
  addEventListener() {},
  setInterval() { return 0 },
  clearInterval() {},
  requestAnimationFrame(fn) { return setTimeout(fn, 0) },
  __ModuleLoader__: { load(def) { windowStub.__def = def } },
}

// ── 载入 lib/client.js 并跑起来 ─────────────────────────────────────────
const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const run = new Function('window', 'document', 'MutationObserver', 'fetch', 'navigator', 'setTimeout', 'clearInterval', 'console', code)
class MutationObserverStub { observe() {} disconnect() {} }

run(windowStub, documentStub, MutationObserverStub, fetchStub, { userAgent: 'node-smoke' }, setTimeout, clearInterval, {
  warn() {},
  error() {},
  log() {},
})

const def = windowStub.__def
if (!def || typeof def.factory !== 'function') throw new Error('模块没有通过 __ModuleLoader__ 注册')

const ReactStub = { createElement: () => null, useState: (v) => [v, () => {}], useEffect() {}, useRef: (v) => ({ current: v }) }
const mod = def.factory((name) => (name === 'react' ? ReactStub : {}))
mod.apply({ slots: { inject() {}, register() { return () => {} } } })

// 等两轮微任务/定时，让 fetch 的 then 链跑完
await new Promise((r) => setTimeout(r, 50))
windowStub.__inlineCostSync()

const dt = documentStub.getElementById('inline-cost-dt')
const dd = documentStub.getElementById('inline-cost-dd')
const tdt = documentStub.getElementById('inline-cost-today-dt')
const tdd = documentStub.getElementById('inline-cost-today-dd')
const bdt = documentStub.getElementById('inline-cost-balance-dt')
const bdd = documentStub.getElementById('inline-cost-balance-dd')

const failures = []
const expect = (ok, message) => { if (!ok) failures.push(message) }
expect(dt && dt.textContent === '花费金额', '缺少「花费金额」行')
expect(dd && dd.textContent === '≈ ¥1.85', '花费金额应取 token-mb 记录 ¥1.85，实际：' + (dd && dd.textContent))
expect(dd && /官方记录/.test(dd.title), '花费金额的悬停提示应说明来源')
expect(tdt && tdt.textContent === '今日累计', '缺少「今日累计」行')
expect(tdd && tdd.textContent === '¥1.85', '今日累计应只算今天的非子代理会话（¥1.85），实际：' + (tdd && tdd.textContent))
expect(tdd && /今天 00:00 起/.test(tdd.title), '今日累计悬停提示应说明起算时间')
expect(tdd && /次调用/.test(tdd.title), '今日累计悬停提示应带调用次数')
expect(bdt && bdt.textContent === '账户余额', '缺少「账户余额」行')
expect(bdd && bdd.textContent === '¥48.85', '账户余额应为 ¥48.85，实际：' + (bdd && bdd.textContent))
expect(bdd && /累计消费/.test(bdd.title), '余额悬停提示应带累计消费')
expect(dt && dt.parentNode === dl, '追加的节点应挂在官方 <dl> 里')
// 顺序：花费金额 → 今日累计 → 账户余额
const order = dl.children.map((c) => c.id).filter(Boolean)
const iCost = order.indexOf('inline-cost-dt')
const iToday = order.indexOf('inline-cost-today-dt')
const iBal = order.indexOf('inline-cost-balance-dt')
expect(iCost >= 0 && iToday > iCost && iBal > iToday, '三行顺序应为 花费金额 → 今日累计 → 账户余额，实际：' + order.join(','))
expect(windowStub.__inlineCostStatus && windowStub.__inlineCostStatus.row === true, '定位状态应标记已插入')

// 关掉卡片（模拟 portal 卸载）→ 重新同步，不应报错
documentStub.body.removeChild(dialog)
windowStub.__inlineCostSync()
expect(!documentStub.getElementById('inline-cost-ddd'), '节点应随卡片一起消失')

if (failures.length) {
  console.error('SMOKE FAILED:')
  failures.forEach((f) => console.error('  - ' + f))
  process.exit(1)
}
console.log('smoke OK: 花费金额 ¥1.85 / 今日累计 ¥1.85（昨天与子代理不计入）/ 账户余额 ¥48.85；三行顺序正确，节点挂在官方 <dl> 内，卡片关闭不报错')
// 插件里还有 setInterval/requestAnimationFrame 的桩，可能挂着定时器，显式退出
process.exit(0)
