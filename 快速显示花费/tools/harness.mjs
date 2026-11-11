/**
 * 离线测试底座：零依赖的假 DOM + 假 window + 假 fetch + 可控时钟。
 *
 * 为什么单独抽出来：`smoke.mjs`（主链路「卡片打开 → 两行出现」）和 `regress.mjs`
 * （口径/定价/余额/性能/生命周期的回归用例）需要同一套桩；写两份桩代码迟早会漂移。
 *
 * 只实现插件真的用到的那几个 DOM API：querySelector / querySelectorAll / getElementById /
 * createElement / appendChild / insertBefore / removeChild / children / textContent / title /
 * getAttribute / hasAttribute / setAttribute / shadowRoot。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.attrs = {}
    this.children = []
    this.parentNode = null
    this._text = ''
    this.title = ''
    this.shadowRoot = null
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
  insertBefore(child, anchor) {
    const at = anchor ? this.children.indexOf(anchor) : -1
    if (at < 0) return this.appendChild(child)
    child.parentNode = this
    this.children.splice(at, 0, child)
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
  // 只走 light DOM：真实浏览器里 document.querySelector / querySelectorAll **不穿透** shadowRoot，
  // 桩也必须一样，否则会掩盖「卡片在 shadow DOM 里、快路径命中不到」这类真实行为。
  fn(root)
  for (const child of root.children) walk(child, fn)
}

/** 支持：tag / .class / [attr] / [attr="v"] / [attr*="v"] */
function matches(node, compound) {
  if (!compound) return false
  const tagMatch = compound.match(/^([a-zA-Z]+)/)
  if (tagMatch && node.tagName !== tagMatch[1].toUpperCase()) return false
  const attrRe = /\[([a-zA-Z-]+)(?:([*^$]?=)["']([^"']*)["'])?\]/g
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

/** 按空格切选择器，忽略属性值里的空格（例如 [aria-label="Token 用量"]） */
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
  let current = node
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    if (!current) return false
    if (!matches(current, chain[i])) return false
    if (i > 0) current = current.parentNode
  }
  return true
}

/** 会话卡片的默认明细行（取自真实「Token 用量」卡片）。 */
export const SESSION_ROWS = [
  ['缓存命中', '99.7%'],
  ['未缓存输入', '147,477 tok'],
  ['缓存读取', '47,228,032 tok'],
  ['输出', '188,784 tok'],
]

/** 单轮卡片的默认明细行（不含「提供方 / 模型」，那条由 model 参数决定）。 */
export const TURN_ROWS = [
  ['缓存命中', '99%'],
  ['未缓存输入', '1,000,000 tok'],
  ['缓存读取', '1,000,000 tok'],
  ['缓存写入', '0 tok'],
  ['输出', '1,000,000 tok'],
]

export function createHarness(options = {}) {
  const counts = {
    interval: 0,
    cleared: 0,
    listened: 0,
    unlistened: 0,
    observed: 0,
    disconnected: 0,
    fullScans: 0,   // document.querySelectorAll('*') 的次数 —— 全文档遍历的计数器
  }

  const body = new El('body')
  const documentStub = {
    body,
    hidden: false,
    createElement(tag) { return new El(tag) },
    getElementById(id) {
      let found = null
      walk(body, (node) => { if (!found && node.id === id) found = node })
      return found
    },
    querySelectorAll(sel) {
      if (sel === '*') counts.fullScans += 1
      const chain = splitSelector(sel)
      const out = []
      walk(body, (node) => { if (node !== body && matchesChain(node, chain)) out.push(node) })
      return out
    },
    querySelector(sel) {
      const all = this.querySelectorAll(sel)
      return all.length ? all[0] : null
    },
    addEventListener(type, handler, capture) {
      counts.listened += 1
      ;(this._listeners ||= []).push([type, handler, capture])
    },
    removeEventListener(type, handler, capture) {
      counts.unlistened += 1
      if (!this._listeners) return
      const at = this._listeners.findIndex(([t, h, c]) => t === type && h === handler && c === capture)
      if (at >= 0) this._listeners.splice(at, 1)
    },
  }

  const storage = new Map()
  let intervalSeq = 0
  const liveIntervals = new Set()
  const windowStub = {
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => { storage.set(k, String(v)) },
      removeItem: (k) => { storage.delete(k) },
    },
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    __ModuleLoader__: { load(def) { windowStub.__def = def } },
  }

  const setIntervalStub = (fn, ms) => {
    intervalSeq += 1
    counts.interval += 1
    liveIntervals.add(intervalSeq)
    return intervalSeq
  }
  const clearIntervalStub = (id) => {
    if (liveIntervals.delete(id)) counts.cleared += 1
  }

  class MutationObserverStub {
    observe() { counts.observed += 1 }
    disconnect() { counts.disconnected += 1 }
  }

  const now = options.now ?? Date.UTC(2026, 10, 1, 4, 0, 0) // 2026-11-01 12:00 北京时间（周日 → 低谷）
  class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(now)
      else super(...args)
    }
    static now() { return now }
  }

  const responses = options.responses || {}
  const fetchStub = async (url) => {
    const key = String(url).split('?')[0]
    if (!Object.prototype.hasOwnProperty.call(responses, key)) {
      return { ok: false, status: 404, json: async () => ({}) }
    }
    return { ok: true, status: 200, json: async () => responses[key] }
  }

  const silentConsole = { warn() {}, error() {}, log() {} }
  const ReactStub = {
    createElement: () => null,
    useState: (v) => [v, () => {}],
    useEffect() {},
    useRef: (v) => ({ current: v }),
  }

  const card = { dialog: null, dl: null }

  const api = {
    El,
    window: windowStub,
    document: documentStub,
    counts,
    now,
    card,
    body,
    setResponses(next) { for (const k of Object.keys(next)) responses[k] = next[k] },

    /** 面包屑（用来把 token-mb 记录按标题对上号） */
    addCrumb(title) {
      const nav = new El('nav')
      nav.className = 'an3WzG_crumbs'
      const span = new El('span')
      span.className = 'an3WzG_crumbCurrent'
      span.textContent = title
      nav.appendChild(span)
      body.appendChild(nav)
      return nav
    },

    /** 会话卡片：div[role=dialog][aria-label="Token 用量"] > dl */
    sessionCard(rows = SESSION_ROWS) {
      const dialog = new El('div')
      dialog.setAttribute('role', 'dialog')
      dialog.setAttribute('aria-label', 'Token 用量')
      const dl = new El('dl')
      appendRows(dl, rows)
      dialog.appendChild(dl)
      body.appendChild(dialog)
      card.dialog = dialog
      card.dl = dl
      return { dialog, dl }
    },

    /** 单轮卡片：dl 带 data-turn-usage-details，可带「提供方 / 模型」行 */
    turnCard({ model = null, rows = TURN_ROWS } = {}) {
      const dialog = new El('div')
      dialog.setAttribute('role', 'dialog')
      dialog.setAttribute('aria-label', '本轮用量')
      const dl = new El('dl')
      dl.setAttribute('data-turn-usage-details', 'true')
      if (model) appendRows(dl, [['提供方 / 模型', model]])
      appendRows(dl, rows)
      dialog.appendChild(dl)
      body.appendChild(dialog)
      card.dialog = dialog
      card.dl = dl
      return { dialog, dl }
    },

    closeCard() {
      if (card.dialog && card.dialog.parentNode) card.dialog.parentNode.removeChild(card.dialog)
      card.dialog = null
      card.dl = null
    },

    el(id) { return documentStub.getElementById(id) },

    /** 读 client.js 并执行（只注册 factory，不物化） */
    load(path) {
      const file = path instanceof URL ? fileURLToPath(path) : path
      const code = readFileSync(file, 'utf8')
      const run = new Function(
        'window', 'document', 'MutationObserver', 'fetch', 'navigator',
        'setTimeout', 'setInterval', 'clearInterval', 'console', 'Date',
        code,
      )
      run(windowStub, documentStub, MutationObserverStub, fetchStub,
        { userAgent: 'node-harness' }, setTimeout, setIntervalStub, clearIntervalStub,
        silentConsole, FakeDate)
      return api
    },

    /** 物化 factory → module.exports */
    module() {
      const def = windowStub.__def
      if (!def || typeof def.factory !== 'function') throw new Error('模块没有通过 __ModuleLoader__ 注册')
      return def.factory((name) => (name === 'react' ? ReactStub : {}))
    },

    /** 手动跑一次同步（plugin 把 sync 挂在 window.__inlineCostSync 上） */
    sync() {
      if (typeof windowStub.__inlineCostSync !== 'function') throw new Error('window.__inlineCostSync 未挂载')
      windowStub.__inlineCostSync()
    },

    /** 直接看 window 上挂着什么（清理是否真的删干净） */
    globals() {
      return {
        sync: typeof windowStub.__inlineCostSync,
        resync: typeof windowStub.__inlineCostResync,
        installed: !!windowStub.__inlineCostInstalled,
      }
    },

    liveIntervals() { return liveIntervals.size },
    listeners() { return documentStub._listeners ? documentStub._listeners.length : 0 },
  }

  return api
}

function appendRows(dl, rows) {
  for (const [label, value] of rows) {
    const dt = new El('dt')
    dt.textContent = label
    const dd = new El('dd')
    dd.textContent = value
    dl.appendChild(dt)
    dl.appendChild(dd)
  }
}
