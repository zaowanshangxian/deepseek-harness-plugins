/**
 * 审计用：把每个插件的 Client 半侧（以及两个有逻辑的 Host 半侧）真的跑一遍 apply()，
 * 对着一个「照 DSH 契约挑错」的假运行时。查两件在 Electron 里只能靠肉眼发现的事：
 *
 *   1. **注册静默失败**：DSH 里 slot 注册失败只 console.warn，界面看起来一切正常——
 *      「slot "undefined" is not declared」这条错误就是这样活了一周多。
 *      校验规则来自 DSH 0.2.2 的 slot 契约（app.asar 内 client-runner 的 registerOptions）：
 *        - 每个 register 必须带 name，且必须等于所 inject 的槽位名；
 *        - list 槽位（settings.section / settings.general.item / conversation.input.left …）必须有 id；
 *        - keyed 槽位（plugins.bundle.config）必须有 key。
 *
 *   2. **卸载后没收干净**：跑一遍 apply 收集到的 effect 清理函数，看还有没有活着的
 *      interval / observer / 事件监听。以前工具税就是裸 setInterval + 裸监听，插件卸了
 *      还每 900ms 扫一遍整棵 DOM。
 *
 * 用法：node audit/2026-11-11-client-apply.mjs
 * 退出码 0 = 全部通过；1 = 有插件注册失败或卸载后仍留着定时器/observer。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')

const LIST_SLOTS = new Set([
  'settings.section',
  'settings.section.icon',
  'settings.general.item',
  'settings.plugins.tab',
  'conversation.input.left',
  'conversation.input.overlay',
  'conversation.input.right',
  'conversation.message.actions',
])
const KEYED_SLOTS = new Set(['plugins.bundle.config', 'plugins.row.config'])

const PLUGINS = [
  { file: '快速显示花费/lib/client.js', label: '快速显示花费' },
  { file: '人格与口癖/lib/client.js', label: '人格与口癖' },
  { file: '更多表情和颜文字/lib/client.js', label: '更多表情和颜文字' },
  { file: '我们的旁白/lib/client.js', label: '我们的旁白' },
  { file: '我们的过程树/lib/client.js', label: '我们的过程树' },
  { file: '工具税/lib/client.js', label: '工具税' },
]

/** 极简 DOM：够 apply() 走完注册与安装路径，不够跑 React。 */
function makeElement(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    nodeType: 1,
    id: '',
    className: '',
    textContent: '',
    title: '',
    style: {},
    dataset: {},
    children: [],
    childNodes: [],
    parentNode: null,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute(k, v) { el[k] = v; if (k === 'id') el.id = v },
    getAttribute(k) { return k in el ? el[k] : null },
    removeAttribute(k) { delete el[k] },
    hasAttribute: () => false,
    appendChild(child) { child.parentNode = el; el.children.push(child); el.childNodes.push(child); return child },
    insertBefore(child) { child.parentNode = el; el.children.push(child); el.childNodes.push(child); return child },
    removeChild(child) {
      el.children = el.children.filter((c) => c !== child)
      el.childNodes = el.childNodes.filter((c) => c !== child)
      return child
    },
    remove() { if (el.parentNode) el.parentNode.removeChild(el) },
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    matches: () => false,
    contains: () => false,
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
    focus() {},
    blur() {},
    scrollIntoView() {},
    cloneNode: () => makeElement(tag),
  }
  // addEventListener / removeEventListener 由 makeEnv 挂上来（要记账）
  return el
}

function makeEnv() {
  const registered = []
  const failures = []
  const warnings = []
  const errors = []

  // ── 生命周期台账 ───────────────────────────────────────────────────
  const lifecycle = {
    intervals: new Map(), // id -> {cleared, ms}
    listeners: [], // {where, type, fn, removed}
    observers: [], // {kind, disconnected}
    rafs: 0,
  }
  let nextTimerId = 1

  function makeTarget(where) {
    return {
      addEventListener(type, fn) { lifecycle.listeners.push({ where, type, fn, removed: false }) },
      removeEventListener(type, fn) {
        for (const item of lifecycle.listeners) {
          if (item.where === where && item.type === type && item.fn === fn) item.removed = true
        }
      },
      dispatchEvent: () => true,
    }
  }

  const body = makeElement('body')
  const head = makeElement('head')
  const documentElement = makeElement('html')
  const document = Object.assign(
    {
      nodeType: 9,
      body,
      head,
      documentElement,
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: (tag) => makeElement(tag),
      createElementNS: (_ns, tag) => makeElement(tag),
      createTextNode: (text) => ({ nodeType: 3, textContent: String(text), parentNode: null }),
      activeElement: body,
      visibilityState: 'visible',
      hidden: false,
      readyState: 'complete',
    },
    makeTarget('document'),
  )

  const window = Object.assign(
    {
      document,
      navigator: { userAgent: 'audit-harness', clipboard: { writeText: () => Promise.resolve() } },
      location: { href: 'http://127.0.0.1:65381/', origin: 'http://127.0.0.1:65381', host: '127.0.0.1:65381' },
      localStorage: (() => {
        const store = new Map()
        return {
          getItem: (k) => (store.has(k) ? store.get(k) : null),
          setItem: (k, v) => store.set(k, String(v)),
          removeItem: (k) => store.delete(k),
          clear: () => store.clear(),
          key: () => null,
          get length() { return store.size },
        }
      })(),
      setInterval: (fn, ms) => {
        const id = nextTimerId++
        lifecycle.intervals.set(id, { cleared: false, ms })
        return id
      },
      clearInterval: (id) => {
        const item = lifecycle.intervals.get(id)
        if (item) item.cleared = true
      },
      setTimeout: (fn) => { nextTimerId++; return nextTimerId },
      clearTimeout: () => {},
      requestAnimationFrame: (fn) => { lifecycle.rafs += 1; return lifecycle.rafs },
      cancelAnimationFrame: () => {},
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
      getComputedStyle: () => ({ getPropertyValue: () => '' }),
      open: () => null,
      focus() {},
      confirm: () => false,
    },
    makeTarget('window'),
  )
  window.window = window
  window.self = window
  window.top = window
  window.parent = window
  window.console = {
    log() {},
    info() {},
    debug() {},
    warn: (...args) => warnings.push(args.map((a) => String(a)).join(' ')),
    error: (...args) => errors.push(args.map((a) => String(a)).join(' ')),
  }

  function makeObserver(kind) {
    const Observer = class {
      constructor(cb) { this.cb = cb; lifecycle.observers.push(this) }
      observe() { this.observed = true }
      unobserve() {}
      disconnect() { this.disconnected = true }
      takeRecords() { return [] }
    }
    Object.defineProperty(Observer, 'name', { value: kind })
    return Observer
  }
  window.MutationObserver = makeObserver('MutationObserver')
  window.IntersectionObserver = makeObserver('IntersectionObserver')
  window.ResizeObserver = makeObserver('ResizeObserver')
  window.fetch = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}), text: () => Promise.resolve('') })
  window.URL = URL

  function h(type, props, ...kids) {
    return { __el: true, type, props: props || {}, children: kids.flat() }
  }
  window.React = {
    createElement: h,
    Fragment: 'Fragment',
    useState: (v) => [v, () => {}],
    useEffect: () => {},
    useLayoutEffect: () => {},
    useMemo: (f) => f(),
    useRef: (v) => ({ current: v }),
    useCallback: (f) => f(),
    createContext: () => ({ Provider: 'p', Consumer: 'c' }),
  }

  // ── 照契约挑错的假 slots 服务 ─────────────────────────────────────────
  const slots = {
    inject(name, callback) {
      if (typeof name !== 'string' || name === '') {
        failures.push('slots.inject 收到非法槽位名: ' + JSON.stringify(name))
        return
      }
      if (!LIST_SLOTS.has(name) && !KEYED_SLOTS.has(name)) {
        failures.push('槽位 "' + name + '" 未声明（真实运行时会抛 not declared）')
        return
      }
      try {
        callback()
      } catch (error) {
        failures.push('slots.inject("' + name + '") 回调抛错: ' + String(error && error.message ? error.message : error))
      }
    },
    register(options, component) {
      const opts = options && typeof options === 'object' ? options : {}
      const name = opts.name
      if (typeof name !== 'string' || name === '') {
        failures.push('register 缺 name（真实运行时就是 slot "undefined" is not declared）: ' + JSON.stringify(opts))
        return () => {}
      }
      if (!LIST_SLOTS.has(name) && !KEYED_SLOTS.has(name)) {
        failures.push('register 的 name "' + name + '" 不是已声明槽位')
        return () => {}
      }
      if (LIST_SLOTS.has(name) && (typeof opts.id !== 'string' || opts.id === '')) {
        failures.push(name + ' 是 list 槽位，register 缺 id: ' + JSON.stringify(opts))
      }
      if (KEYED_SLOTS.has(name) && (typeof opts.key !== 'string' || opts.key === '')) {
        failures.push(name + ' 是 keyed 槽位，register 缺 key: ' + JSON.stringify(opts))
      }
      if (typeof component !== 'function') failures.push(name + ' 的 component 不是函数')
      registered.push({ slot: name, id: opts.id, key: opts.key })
      return () => {}
    },
  }

  const disposers = []
  const ctx = {
    slots,
    logger: {
      debug() {},
      info() {},
      warn: (...a) => warnings.push(a.join(' ')),
      error: (...a) => errors.push(a.join(' ')),
    },
    effect(fn) {
      try {
        const dispose = fn()
        if (typeof dispose === 'function') disposers.push(dispose)
        return dispose
      } catch (error) {
        errors.push('effect 抛错: ' + String(error && error.message ? error.message : error))
        return undefined
      }
    },
    on() { return () => {} },
    inject(_deps, cb) {
      try {
        cb(ctx)
      } catch (error) {
        errors.push('inject 回调抛错: ' + String(error))
      }
    },
    get() { return undefined },
    emit() {},
  }

  return { window, document, ctx, registered, failures, warnings, errors, lifecycle, disposers }
}

function loadClient(absPath, env) {
  const code = readFileSync(absPath, 'utf8')
  let registeredModule = null
  const moduleLoader = {
    load(entry) {
      if (!entry || typeof entry.factory !== 'function') {
        throw new Error('__ModuleLoader__.load 收到的 entry 没有 factory')
      }
      registeredModule = entry.factory((id) => {
        if (id === 'react') return env.window.React
        if (id === 'react-dom') return { createPortal: (x) => x, render: () => {} }
        throw new Error('未预期的 require: ' + id)
      })
    },
    register() {},
    get() { return undefined },
  }

  env.window.__ModuleLoader__ = moduleLoader
  const sandbox = {
    window: env.window,
    document: env.document,
    console: env.window.console,
    navigator: env.window.navigator,
    localStorage: env.window.localStorage,
    location: env.window.location,
    fetch: env.window.fetch,
    setTimeout: env.window.setTimeout,
    clearTimeout: env.window.clearTimeout,
    setInterval: env.window.setInterval,
    clearInterval: env.window.clearInterval,
    requestAnimationFrame: env.window.requestAnimationFrame,
    cancelAnimationFrame: env.window.cancelAnimationFrame,
    MutationObserver: env.window.MutationObserver,
    IntersectionObserver: env.window.IntersectionObserver,
    ResizeObserver: env.window.ResizeObserver,
    matchMedia: env.window.matchMedia,
    getComputedStyle: env.window.getComputedStyle,
    __ModuleLoader__: moduleLoader,
    URL,
    Date,
    JSON,
    Math,
    Number,
    String,
    Object,
    Array,
    Set,
    Map,
    Promise,
    Error,
    TypeError,
    Symbol,
    Boolean,
    RegExp,
    Intl,
    Buffer,
    structuredClone,
    encodeURIComponent,
    decodeURIComponent,
  }
  const context = vm.createContext(sandbox)
  vm.runInContext(code, context, { filename: absPath })
  return registeredModule
}

/** 卸载后还活着的东西按严重度分两堆。
 *  apply 之前就存在的（模块级 / 错误上报器）标成 noise：effect 本来就管不到它，
 *  属于「热重载会叠加」的 P2，不算 apply/effect 的回收责任。
 */
function survivingResources(lifecycle, baseline) {
  const leaks = []
  const noise = []
  for (const [id, item] of lifecycle.intervals) {
    if (item.cleared) continue
    const ms = item.ms
    if (id <= baseline.maxTimerId) noise.push('setInterval(' + ms + 'ms)（模块级，apply 之前就装了）')
    else leaks.push('setInterval(' + ms + 'ms) 没清')
  }
  for (const obs of lifecycle.observers) {
    if (obs.disconnected) continue
    if (lifecycle.observers.indexOf(obs) < baseline.observers) noise.push(obs.constructor.name + '（模块级，apply 之前就装了）')
    else leaks.push(obs.constructor.name + ' 没 disconnect')
  }
  lifecycle.listeners.forEach((item, index) => {
    if (item.removed) return
    const where = item.where + ' 上的 ' + item.type + ' 监听'
    if (index < baseline.listeners) {
      noise.push(where + '（模块级常驻；热重载会叠加一份）')
      return
    }
    const isReporter = item.where === 'window' && (item.type === 'error' || item.type === 'unhandledrejection')
    if (isReporter) noise.push(where + '（错误上报器）')
    else leaks.push(where + '没摘')
  })
  return { leaks, noise }
}

let failed = 0
console.log('把客户端 apply() 真的跑一遍：注册要对得上 DSH 槽位契约，卸载要收干净\n')

for (const plugin of PLUGINS) {
  const abs = join(repo, plugin.file)
  const env = makeEnv()
  console.log('── ' + plugin.label + '  (' + plugin.file.replace(/\\/g, '/') + ')')

  let mod = null
  let loadError = null
  try {
    mod = loadClient(abs, env)
  } catch (error) {
    loadError = error
  }
  if (loadError) {
    console.log('   ✗ 装载失败: ' + String(loadError && loadError.message ? loadError.message : loadError) + '\n')
    failed += 1
    continue
  }
  if (!mod || typeof mod.apply !== 'function') {
    console.log('   ✗ 没有导出 apply\n')
    failed += 1
    continue
  }

  let applyError = null
  // apply 之前的台账 = 模块级（factory 体里就装上的），effect 管不到，另算
  const baseline = {
    listeners: env.lifecycle.listeners.length,
    observers: env.lifecycle.observers.length,
    maxTimerId: Math.max(0, ...env.lifecycle.intervals.keys()),
  }
  try {
    mod.apply(env.ctx)
  } catch (error) {
    applyError = error
  }

  console.log('   exports.inject = ' + JSON.stringify(mod.inject))
  console.log(
    '   已注册槽位: ' +
      (env.registered.length
        ? env.registered.map((r) => r.slot + (r.id ? '#' + r.id : '') + (r.key ? '@' + r.key : '')).join(', ')
        : '（无，靠 DOM 注入）'),
  )
  if (env.warnings.length) console.log('   console.warn: ' + env.warnings.slice(0, 4).join(' | ').slice(0, 240))
  if (env.errors.length) console.log('   console.error: ' + env.errors.slice(0, 4).join(' | ').slice(0, 240))

  // 模拟卸载：把 apply 期间登记进 effect 的清理函数倒序跑一遍
  for (const dispose of [...env.disposers].reverse()) {
    try {
      dispose()
    } catch (error) {
      env.errors.push('清理函数抛错: ' + String(error))
    }
  }
  const { leaks, noise } = survivingResources(env.lifecycle, baseline)
  const installedCount = env.disposers.length
  console.log('   effect 清理函数: ' + installedCount + ' 个；卸载后存活: interval/observer/监听 = ' + (leaks.length + noise.length))

  if (applyError) {
    console.log('   ✗ apply 抛错: ' + String(applyError && applyError.message ? applyError.message : applyError))
    failed += 1
  } else if (env.failures.length) {
    for (const item of env.failures) console.log('   ✗ ' + item)
    failed += 1
  } else if (env.registered.length === 0 && plugin.file.includes('client.js')) {
    console.log('   ⚠ 一个槽位都没注册（这个插件靠 DOM 注入，属预期）')
  } else {
    console.log('   ✓ 注册全部通过契约校验')
  }

  if (leaks.length) {
    for (const item of leaks) console.log('   ✗ 卸载后仍存活: ' + item)
    failed += 1
  } else {
    console.log('   ✓ 卸载后没有残留的定时器 / observer / 监听' + (noise.length ? '（错误上报器的 window 监听除外）' : ''))
  }
  for (const item of noise) console.log('   ⚠ 常驻: ' + item)

  console.log()
}

console.log(failed === 0 ? '结果：全部通过' : '结果：' + failed + ' 个插件有问题')
process.exit(failed === 0 ? 0 : 1)
