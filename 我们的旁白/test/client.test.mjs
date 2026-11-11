/**
 * 「进度旁白（简）」客户端半自检 —— 可重跑：`node --test test/client.test.mjs`
 *
 * 为什么要有这一份：`lib/client.js` 曾经把槽位注册直接写在 `factory(require)` 体里、
 * 引用了没有来源的自由变量 `ctx`，而宿主只认 `exports.apply(ctx)` + `exports.inject`。
 * 结果是设置页压根注册不上，而宿主那一侧的 21 项测试全绿 —— 因为 client.js 完全没被覆盖。
 *
 * 这里做两层：
 *   ① 静态断言：确实导出了 apply / 确实声明了 inject / 源码里没有落在 apply 之外的 `ctx`；
 *   ② 行为断言：用 vm 把 client.js 当作浏览器脚本跑起来，喂一个假 ctx，
 *      看它真的注册了两个槽位、卸载时真的移掉 <style> 并注销槽位。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

// 不用 import.meta.dirname：它要 Node 20.11+，而 package.json 只声明 engines >=20
const CLIENT = fileURLToPath(new URL('../lib/client.js', import.meta.url))
const SOURCE = readFileSync(CLIENT, 'utf8')

/**
 * 把注释与字符串内容替换成空格（换行保留），字符偏移不变。
 *
 * 这样既能「只认代码里的标识符」（字符串里出现 ctx 不算引用），
 * 又能继续按偏移量做括号配对（CSS 文本里全是 `{}`，不挖掉就会数错）。
 */
function codeOnly(source) {
  let out = ''
  let index = 0
  let mode = 'code'
  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]
    if (mode === 'code') {
      if (char === '/' && next === '/') { mode = 'line'; out += '  '; index += 2; continue }
      if (char === '/' && next === '*') { mode = 'block'; out += '  '; index += 2; continue }
      if (char === "'" || char === '"' || char === '`') { mode = char; out += char; index += 1; continue }
      out += char
      index += 1
      continue
    }
    if (mode === 'line') {
      if (char === '\n') { mode = 'code'; out += char } else out += ' '
      index += 1
      continue
    }
    if (mode === 'block') {
      if (char === '*' && next === '/') { mode = 'code'; out += '  '; index += 2; continue }
      out += char === '\n' ? '\n' : ' '
      index += 1
      continue
    }
    // 字符串内部：整体抹成空格，只留结束引号
    if (char === '\\') { out += '  '; index += 2; continue }
    if (char === mode) { mode = 'code'; out += char; index += 1; continue }
    out += char === '\n' ? '\n' : ' '
    index += 1
  }
  return out
}

/** `exports.apply = function (ctx) { ... }` 的花括号区间，起点取 `exports.apply` 本身。 */
function applyBodyRange(code) {
  const head = code.indexOf('exports.apply')
  assert.ok(head >= 0, 'client.js 必须写 `exports.apply = …`（宿主只从 apply 传 ctx 进来）')
  const open = code.indexOf('{', head)
  assert.ok(open >= 0, 'apply 后面得跟着函数体')
  let depth = 0
  for (let index = open; index < code.length; index += 1) {
    if (code[index] === '{') depth += 1
    else if (code[index] === '}') {
      depth -= 1
      if (depth === 0) return [head, index]
    }
  }
  throw new Error('apply 的函数体没闭合')
}

// ---------------------------------------------------------------------------
// ① 静态断言（回归 high #1 / #2）
// ---------------------------------------------------------------------------

test('client.js：导出了 apply，并且声明了 inject', () => {
  const code = codeOnly(SOURCE)
  const [open, close] = applyBodyRange(code)
  assert.ok(close > open)
  // inject 的字符串内容在 codeOnly 里被抹掉了，所以这条对原文断言
  assert.match(SOURCE, /exports\.inject\s*=\s*\[[^\]]*['"]slots['"]/, '依赖必须写成 exports.inject = [\'slots\']')
})

test('client.js：所有 ctx 引用都在 apply(ctx) 里面，没有裸自由变量', () => {
  const code = codeOnly(SOURCE)
  const [open, close] = applyBodyRange(code)
  const outside = []
  const pattern = /\bctx\b/g
  let match = pattern.exec(code)
  while (match !== null) {
    const at = match.index
    if (at < open || at > close) outside.push(at)
    match = pattern.exec(code)
  }
  assert.deepEqual(
    outside.map((at) => code.slice(Math.max(0, at - 40), at + 40).replace(/\s+/g, ' ')),
    [],
    'ctx 只能来自 apply(ctx)，写在 factory 体里就是未定义的自由变量',
  )
})

test('client.js：注册与样式注入都在 ctx.effect 里（有清理函数）', () => {
  const code = codeOnly(SOURCE)
  const [open, close] = applyBodyRange(code)
  const body = code.slice(open, close)
  assert.match(body, /ensureStyle\s*\(/, '样式要在 apply 里插')
  assert.match(body, /style\.remove\s*\(/, '样式要能被卸载时移掉')
  assert.match(body, /disposers\.push/, '槽位注销函数要收起来')
  // factory 体里不该再有「物化期就注册」的老写法
  const factoryBody = code.slice(0, open) + code.slice(close)
  assert.doesNotMatch(factoryBody, /ctx\.slots/, 'factory 体里不许出现 ctx.slots')
  assert.doesNotMatch(factoryBody, /guard\(\s*'样式'\s*,\s*ensureStyle\s*\)/, '样式不该在 factory 物化期就插')
})

// ---------------------------------------------------------------------------
// ② 行为断言：真的当浏览器脚本跑一遍
// ---------------------------------------------------------------------------

const REACT_STUB = {
  createElement() { return null },
  useState() { return [null, () => {}] },
  useEffect() {},
  useRef() { return { current: 0 } },
}

function loadClient(options = {}) {
  let factory = null
  const styles = []
  const head = {
    appendChild(node) { styles.push(node) },
  }
  const document = {
    head,
    getElementById(id) { return styles.find((node) => node.id === id) ?? null },
    createElement() {
      return {
        id: '',
        textContent: '',
        remove() {
          const index = styles.indexOf(this)
          if (index >= 0) styles.splice(index, 1)
        },
      }
    },
  }
  const React = options.React ?? REACT_STUB
  const sandbox = {
    window: { __ModuleLoader__: { load(loaded) { factory = loaded.factory } } },
    document,
    console,
    fetch: options.fetch ?? (() => Promise.reject(new Error('测试里没有网络'))),
  }
  sandbox.window.window = sandbox.window
  vm.runInNewContext(SOURCE, sandbox, { filename: CLIENT })
  assert.equal(typeof factory, 'function', 'client.js 得用 window.__ModuleLoader__.load 挂载')

  const module = factory((id) => {
    if (id === 'react') return React
    throw new Error('不该 require：' + id)
  })
  return { module, styles }
}

test('client.js：apply 注册两个槽位，卸载时移掉 <style> 并注销槽位', () => {
  const { module, styles } = loadClient()
  assert.equal(typeof module.apply, 'function')
  // 模块在 vm 的另一个 realm 里跑，数组跨 realm 直接 deepEqual 会挂，比一下内容
  assert.equal([...module.inject].join(','), 'slots')

  const pending = []
  const registered = []
  const unregistered = []
  const disposers = []

  const ctx = {
    effect(fn) {
      const off = fn()
      if (typeof off === 'function') disposers.push(off)
      return () => {}
    },
    slots: {
      inject(name, callback) { pending.push({ name, callback }) },
      register(options) {
        registered.push(options)
        return () => { unregistered.push(options) }
      },
    },
  }

  module.apply(ctx)

  // 样式在 apply 里插入，而且只有一个
  assert.equal(styles.length, 1)
  assert.equal(styles[0].id, 'dsh-narrator-lite-style')
  assert.match(styles[0].textContent, /\.nl-page/)

  // 两个槽位都 inject 了（延迟回调模拟宿主「槽位可用时才调用」）
  assert.deepEqual(pending.map((item) => item.name), ['settings.section', 'plugins.bundle.config'])
  for (const item of pending) item.callback()
  assert.deepEqual(registered.map((options) => options.id ?? options.key), [
    'narrator-lite-settings',
    'dsh-plugin-narrator-lite',
  ])

  // 卸载：样式没了、槽位注销了
  assert.equal(disposers.length, 2, '样式与槽位各一个 effect')
  for (const off of disposers) off()
  assert.equal(styles.length, 0, '卸载后不该留下孤儿 <style>')
  assert.equal(unregistered.length, 2, '卸载后两个槽位都要注销')

  // 已卸载之后宿主才回调 inject：不能再注册一次
  for (const item of pending) item.callback()
  assert.equal(registered.length, 2, '卸载后到达的 inject 回调不能再注册')
})

test('client.js：重复 apply 不会叠出第二个 <style>', () => {
  const { module, styles } = loadClient()
  const ctx = {
    effect(fn) {
      const off = fn()
      return typeof off === 'function' ? off : () => {}
    },
    slots: { inject() {}, register() {} },
  }
  module.apply(ctx)
  module.apply(ctx)
  assert.equal(styles.length, 1)
})

// ---------------------------------------------------------------------------
// ③ 设置页真的跑一遍：GET / POST 失败时不能装成功
// ---------------------------------------------------------------------------

/** 够把设置页跑起来的极简 hooks 运行时（不是 React，也不打算是）。 */
function createHooks() {
  const slots = []
  let cursor = 0
  let effects = []
  return {
    React: {
      createElement(type, props, ...children) {
        const merged = Object.assign({}, props ?? {})
        if (children.length === 1) merged.children = children[0]
        else if (children.length > 1) merged.children = children
        return { type, props: merged }
      },
      useState(initial) {
        const index = cursor++
        if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
        return [slots[index], (next) => {
          slots[index] = typeof next === 'function' ? next(slots[index]) : next
        }]
      },
      useRef(initial) {
        const index = cursor++
        if (!(index in slots)) slots[index] = { current: initial }
        return slots[index]
      },
      useEffect(fn) {
        cursor += 1
        effects.push(fn)
      },
    },
    render(Component) {
      cursor = 0
      effects = []
      const tree = Component()
      return { tree, effects }
    },
  }
}

const flush = async () => {
  // fetch 的 then/catch 链有好几跳，多冲几轮微任务比算跳数稳
  for (let round = 0; round < 20; round += 1) await Promise.resolve()
}

function findAll(node, predicate, out = []) {
  if (node === null || node === undefined) return out
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out)
    return out
  }
  if (typeof node !== 'object') return out
  if (predicate(node)) out.push(node)
  findAll(node.props?.children, predicate, out)
  return out
}

function textOf(node) {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node !== null && typeof node === 'object') return textOf(node.props?.children)
  return ''
}

/** 挂载设置页：真跑 apply → 取到组件 → 用假 hooks 渲染。 */
function mountSettings(fetchImpl) {
  const hooks = createHooks()
  const { module, styles } = loadClient({ React: hooks.React, fetch: fetchImpl })
  const registered = []
  module.apply({
    effect(fn) {
      const off = fn()
      return typeof off === 'function' ? off : () => {}
    },
    slots: {
      inject(name, callback) { callback() },
      register(options, component) {
        registered.push({ options, component })
        return () => {}
      },
    },
  })
  const entry = registered.find((item) => item.options.id === 'narrator-lite-settings')
  assert.ok(entry, 'apply 必须把设置页注册到 settings.section')
  let mounted = false

  // 槽位里放的是 `function () { return h(SettingsPage) }` 这一层壳，得一路展开到真正的树
  const renderPage = () => hooks.render(() => {
    let node = entry.component()
    for (let depth = 0; depth < 5 && node !== null && typeof node === 'object' && typeof node.type === 'function'; depth += 1) {
      node = node.type(node.props)
    }
    return node
  })

  return {
    styles,
    /** 渲染一帧；第一帧跑 useEffect 并等所有 promise 落地，返回稳定后的那棵树。 */
    async paint() {
      const first = renderPage()
      if (!mounted) {
        mounted = true
        for (const effect of first.effects) effect()
      }
      await flush()
      return renderPage().tree
    },
  }
}

const okConfig = (patch = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({
    ok: true,
    config: { enabled: true, silentSeconds: 90, cooldownSeconds: 120, maxPerTurn: 4, ...patch },
  }),
})

test('设置页：GET 403 显示读取失败，不把默认值当成真实设置渲染', async () => {
  const page = mountSettings(async () => ({
    ok: false,
    status: 403,
    json: async () => ({ ok: false, error: 'forbidden' }),
  }))
  const tree = await page.paint()

  const text = textOf(tree)
  assert.match(text, /读取失败：HTTP 403/)
  assert.equal(findAll(tree, (node) => node.props?.type === 'checkbox').length, 0, '读不到配置就不该渲染出「有一份设置」')
  assert.equal(findAll(tree, (node) => node.props?.type === 'number').length, 0)
})

test('设置页：GET 正常时把服务端值原样铺开（0 是「不限」，不是「没配过」）', async () => {
  const page = mountSettings(async () => okConfig({ silentSeconds: 45, cooldownSeconds: 0 }))
  const tree = await page.paint()

  const checkboxes = findAll(tree, (node) => node.props?.type === 'checkbox')
  const numbers = findAll(tree, (node) => node.props?.type === 'number')
  assert.equal(checkboxes.length, 1)
  assert.equal(checkboxes[0].props.checked, true)
  assert.equal(numbers.length, 2)
  assert.equal(numbers[0].props.defaultValue, 45)
  assert.equal(numbers[1].props.defaultValue, 0)
})

test('设置页：POST 403 要显示保存失败并回滚，不能显示「已保存」', async () => {
  const page = mountSettings(async (url, init) => {
    if (init === undefined || init.method === undefined) return okConfig()
    return { ok: false, status: 403, json: async () => ({ ok: false, error: 'forbidden' }) }
  })

  let tree = await page.paint()
  const checkbox = findAll(tree, (node) => node.props?.type === 'checkbox')[0]
  checkbox.props.onChange({ target: { checked: false } })

  tree = await page.paint()
  const status = textOf(findAll(tree, (node) => node.props?.className === 'nl-status'))
  assert.match(status, /保存失败：forbidden/)
  assert.doesNotMatch(status, /已保存/)
  assert.equal(
    findAll(tree, (node) => node.props?.type === 'checkbox')[0].props.checked,
    true,
    '保存失败要把界面回滚成上一次确认过的值',
  )
})

test('设置页：POST 403 且响应体读不出 error 时，退回用状态码报错', async () => {
  const page = mountSettings(async (url, init) => {
    if (init === undefined || init.method === undefined) return okConfig()
    return {
      ok: false,
      status: 403,
      json: async () => { throw new SyntaxError('not json') },
    }
  })

  const tree = await page.paint()
  const checkbox = findAll(tree, (node) => node.props?.type === 'checkbox')[0]
  checkbox.props.onChange({ target: { checked: false } })
  const after = await page.paint()
  const status = textOf(findAll(after, (node) => node.props?.className === 'nl-status'))
  assert.match(status, /保存失败：HTTP 403/)
})

test('设置页：写盘失败（persisted:false）单独一句文案，不能吞成「已保存」', async () => {
  const page = mountSettings(async (url, init) => {
    if (init === undefined || init.method === undefined) return okConfig()
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, config: { enabled: false, silentSeconds: 90, cooldownSeconds: 120, maxPerTurn: 4 }, persisted: false }),
    }
  })

  const tree = await page.paint()
  const checkbox = findAll(tree, (node) => node.props?.type === 'checkbox')[0]
  checkbox.props.onChange({ target: { checked: false } })
  const after = await page.paint()
  const status = textOf(findAll(after, (node) => node.props?.className === 'nl-status'))
  assert.match(status, /已生效，但写盘失败/)
})

test('设置页：配置读不到时给出提示、锁住控件、留一个「重新读取」', async () => {
  let calls = 0
  const page = mountSettings(async () => {
    calls += 1
    if (calls === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          config: {
            enabled: true,
            silentSeconds: 90,
            cooldownSeconds: 120,
            maxPerTurn: 4,
            configWritable: false,
            configNote: '读不到配置文件（EISDIR），为避免覆盖已有设置，暂时不能保存',
          },
        }),
      }
    }
    return okConfig({ silentSeconds: 77 })
  })

  let tree = await page.paint()
  const warn = findAll(tree, (node) => node.props?.className === 'nl-warn')
  assert.equal(warn.length, 1, '必须把「这份是默认值」说出来')
  assert.match(textOf(warn), /读不到配置文件/)

  assert.equal(findAll(tree, (node) => node.props?.type === 'checkbox')[0].props.disabled, true, '开关要锁住')
  for (const input of findAll(tree, (node) => node.props?.type === 'number')) {
    assert.equal(input.props.disabled, true, '数字框要锁住')
  }

  const retry = findAll(tree, (node) => node.type === 'button')[0]
  assert.ok(retry, '要留一个重新读取的入口')
  assert.equal(textOf(retry), '重新读取')
  retry.props.onClick()

  tree = await page.paint()
  assert.equal(findAll(tree, (node) => node.props?.className === 'nl-warn').length, 0, '读好之后提示要消失')
  assert.equal(findAll(tree, (node) => node.props?.type === 'checkbox')[0].props.disabled, false)
})

test('设置页：宿主拒绝写入（409）时把宿主给的原因原样说出来', async () => {
  const page = mountSettings(async (url, init) => {
    if (init === undefined || init.method === undefined) return okConfig()
    return {
      ok: false,
      status: 409,
      json: async () => ({
        ok: false,
        error: 'config-unreadable',
        message: '读不到现有配置文件，为避免覆盖你的设置，这次修改没有保存',
      }),
    }
  })

  let tree = await page.paint()
  findAll(tree, (node) => node.props?.type === 'checkbox')[0].props.onChange({ target: { checked: false } })
  tree = await page.paint()
  const status = textOf(findAll(tree, (node) => node.props?.className === 'nl-status'))
  assert.match(status, /保存失败：读不到现有配置文件/)
})
