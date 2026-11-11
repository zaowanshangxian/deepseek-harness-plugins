/**
 * 「进度旁白（简）」自检 —— 可重跑：`node --test test/host.test.mjs`
 *
 * 只测宿主半：计时语义、注入位置、开关、限流、清理。没有真宿主也能跑，
 * 因为决策路径（`evaluateSilence`）和消息构造（`buildProgressMessage`）都是纯函数/可桩。
 *
 * 注意：DSH_HOME 必须在本模块 import 插件**之前**指向临时目录，
 * 否则会读到你真实的覆盖层配置，断言随用户设置漂移。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'

const TEST_HOME = path.join(os.tmpdir(), `narrator-lite-test-${process.pid}`)
process.env.DSH_HOME = TEST_HOME

const {
  apply,
  evaluateSilence,
  normalizeConfig,
  isSubagentSession,
  pickEvictionVictim,
  configFilePath,
  readOverride,
  writeOverride,
  DEFAULTS,
  DEFAULT_PROMPT,
  SILENT_SECONDS_MIN,
} = await import('../lib/index.js')

const SID = 'session-1'

function makeAgent(sessionId = SID, header = {}) {
  return { session: { id: sessionId, header } }
}

function makeHarness(config = {}) {
  const handlers = new Map()
  const disposers = []
  const ctx = {
    logger: { info() {}, warn() {} },
    on(event, fn) {
      const list = handlers.get(event) ?? []
      list.push(fn)
      handlers.set(event, list)
      return () => {
        const index = list.indexOf(fn)
        if (index >= 0) list.splice(index, 1)
      }
    },
    effect(fn) {
      const off = fn()
      if (typeof off === 'function') disposers.push(off)
      return () => {}
    },
    inject() {},
  }
  apply(ctx, config)

  const emit = (event, ...args) => {
    for (const fn of [...(handlers.get(event) ?? [])]) fn(...args)
  }
  const preStep = async (payload) => {
    const list = handlers.get('agent/pre-step') ?? []
    const run = (index) => (index >= list.length
      ? Promise.resolve({ kind: 'enter', messages: [] })
      : list[index](payload, () => run(index + 1)))
    return run(0)
  }
  const dispose = () => {
    for (const off of disposers.splice(0)) off()
  }
  return { ctx, handlers, emit, preStep, dispose }
}

const start = (agent = makeAgent(), turn = 1, step = 1) =>
  ({ agent, frame: { type: 'start', turn, step } })
const chunk = (type, extra = {}, agent = makeAgent()) =>
  ({ agent, frame: { type: 'chunk', chunk: { type, ...extra } } })

// ---------------------------------------------------------------------------
// 纯函数：静默判定
// ---------------------------------------------------------------------------

test('evaluateSilence：没到阈值只排下一个检查点', () => {
  const verdict = evaluateSilence({
    state: { due: false, lastVisibleAt: 1000, turn: 1 },
    ledger: { lastInjectAt: 0, byTurn: new Map() },
    config: { silentSeconds: 90, cooldownSeconds: 0, maxPerTurn: 0 },
    now: 5000,
  })
  assert.equal(verdict.action, 'wait')
  assert.equal(verdict.delayMs, 86_000)
})

test('evaluateSilence：到阈值且无冷却 → due，并带上真实静默时长', () => {
  const verdict = evaluateSilence({
    state: { due: false, lastVisibleAt: 0, turn: 1 },
    ledger: { lastInjectAt: 0, byTurn: new Map() },
    config: { silentSeconds: 10, cooldownSeconds: 0, maxPerTurn: 0 },
    now: 12_000,
  })
  assert.equal(verdict.action, 'due')
  assert.equal(verdict.silentMs, 12_000)
})

test('evaluateSilence：冷却中 → cooldown，延迟到冷却结束', () => {
  const verdict = evaluateSilence({
    state: { due: false, lastVisibleAt: 0, turn: 1 },
    ledger: { lastInjectAt: 10_000, byTurn: new Map() },
    config: { silentSeconds: 10, cooldownSeconds: 30, maxPerTurn: 0 },
    now: 20_000,
  })
  assert.equal(verdict.action, 'cooldown')
  assert.equal(verdict.delayMs, 20_000)
})

test('evaluateSilence：单回合上限到了 → cap，不再排期', () => {
  const verdict = evaluateSilence({
    state: { due: false, lastVisibleAt: 0, turn: 3 },
    ledger: { lastInjectAt: 0, byTurn: new Map([[3, 2]]) },
    config: { silentSeconds: 10, cooldownSeconds: 0, maxPerTurn: 2 },
    now: 60_000,
  })
  assert.equal(verdict.action, 'cap')
})

test('evaluateSilence：已经排过（due）就不重复排', () => {
  const verdict = evaluateSilence({
    state: { due: true, lastVisibleAt: 0, turn: 1 },
    ledger: { lastInjectAt: 0, byTurn: new Map() },
    config: { silentSeconds: 10, cooldownSeconds: 0, maxPerTurn: 0 },
    now: 60_000,
  })
  assert.equal(verdict.action, 'wait')
  assert.equal(verdict.delayMs, undefined)
})

// ---------------------------------------------------------------------------
// 纯函数：配置归一化、子代理判据
// ---------------------------------------------------------------------------

test('normalizeConfig：缺省值、覆盖层优先、阈值夹紧', () => {
  const base = normalizeConfig()
  assert.equal(base.enabled, true)
  assert.equal(base.silentSeconds, DEFAULTS.silentSeconds)
  assert.equal(base.prompt, DEFAULT_PROMPT)

  const overridden = normalizeConfig({ silentSeconds: 300, cooldownSeconds: 600 }, { silentSeconds: 45 })
  assert.equal(overridden.silentSeconds, 45)

  // 1 秒阈值等于每步都插一句，必须被抬到下限
  assert.equal(normalizeConfig({ silentSeconds: 1 }).silentSeconds, SILENT_SECONDS_MIN)
  // 冷却允许 0（表示不限）
  assert.equal(normalizeConfig({ cooldownSeconds: 0 }).cooldownSeconds, 0)
  // 「没配过」不能被当成 0
  assert.equal(normalizeConfig({ silentSeconds: null }).silentSeconds, DEFAULTS.silentSeconds)
  // 布尔只认显式 false
  assert.equal(normalizeConfig({ enabled: false }).enabled, false)
  assert.equal(normalizeConfig({ enabled: 'no' }).enabled, true)
})

test('normalizeConfig：自定义提示词去空、超长截断不劈开代理对', () => {
  assert.equal(normalizeConfig({ prompt: '   ' }).prompt, DEFAULT_PROMPT)
  const long = '甲'.repeat(3000)
  const cut = normalizeConfig({ prompt: long }).prompt
  assert.equal(cut.length, 2048)
})

test('normalizeConfig：冷却与单回合上限不许同时为 0（两个刹车不能一起松）', () => {
  // 阈值下限只有 10 秒，0/0 等于每个 step 边界都插一句，纯烧 token
  const bothOff = normalizeConfig({ silentSeconds: 10, cooldownSeconds: 0, maxPerTurn: 0 })
  assert.equal(bothOff.cooldownSeconds, DEFAULTS.cooldownSeconds, '冷却必须被抬回默认值')
  assert.equal(bothOff.maxPerTurn, 0, '单回合不限是合法选择，别顺手改掉')
  assert.equal(bothOff.silentSeconds, 10, '阈值不改')

  // 留了一个刹车就照用户说的办
  assert.equal(normalizeConfig({ cooldownSeconds: 0, maxPerTurn: 4 }).cooldownSeconds, 0)
  assert.equal(normalizeConfig({ cooldownSeconds: 30, maxPerTurn: 0 }).cooldownSeconds, 30)
})

test('isSubagentSession：只认 origin=subagent，分支会话不算', () => {
  assert.equal(isSubagentSession(makeAgent(SID, { origin: 'subagent', delegationDepth: 1 })), true)
  // 分支会话：用户看得见，不能被静音
  assert.equal(isSubagentSession(makeAgent(SID, { parentSession: 'p', isSeeded: true })), false)
  assert.equal(isSubagentSession(makeAgent(SID, {})), false)
  assert.equal(isSubagentSession(undefined), false)
})

test('configFilePath 跟随 DSH_HOME', () => {
  assert.equal(configFilePath(), path.join(TEST_HOME, 'narrator-lite', 'config.json'))
})

// ---------------------------------------------------------------------------
// 会话淘汰（Map 不会无限长，也不会把正在干活的会话挤掉）
// ---------------------------------------------------------------------------

test('pickEvictionVictim：按「最后一次任何帧」淘汰，不按「最后一次正文」', () => {
  // busy：正文时间最旧（一直只在调工具），但它刚刚还有帧 —— 正在干活，不能挤掉
  const busy = { sessionId: 'busy', lastVisibleAt: 0, lastActivityAt: 5_000, due: false }
  const idle = { sessionId: 'idle', lastVisibleAt: 4_000, lastActivityAt: 5_000 - 1_000, due: false }
  const stale = { sessionId: 'stale', lastVisibleAt: 4_500, lastActivityAt: 1_000, due: false }

  assert.equal(pickEvictionVictim([busy, idle, stale]).sessionId, 'stale')
  // 按正文时间挑会挑到 busy —— 那正是这次要修掉的错误
  assert.equal(pickEvictionVictim([busy, idle]).sessionId, 'idle')
  assert.equal(pickEvictionVictim([]), null)
})

test('pickEvictionVictim：已排期待注入的会话优先保留', () => {
  const waiting = { sessionId: 'waiting', lastVisibleAt: 0, lastActivityAt: 0, due: true }
  const ready = { sessionId: 'ready', lastVisibleAt: 9_000, lastActivityAt: 2_000, due: false }
  assert.equal(pickEvictionVictim([waiting, ready]).sessionId, 'ready')

  // 全都在等注入：退一步也要淘汰一个，不能让表越过上限
  const other = { sessionId: 'other', lastVisibleAt: 0, lastActivityAt: 7, due: true }
  assert.equal(pickEvictionVictim([waiting, other]).sessionId, 'waiting')
})

// ---------------------------------------------------------------------------
// 覆盖层写盘
// ---------------------------------------------------------------------------

test('writeOverride：临时文件 + rename，落盘内容完整、不留 .tmp', async () => {
  const file = path.join(TEST_HOME, 'atomic', 'config.json')
  await writeOverride({ silentSeconds: 45, enabled: false }, file)

  const written = JSON.parse(await readFile(file, 'utf8'))
  assert.deepEqual(written, { silentSeconds: 45, enabled: false })
  assert.deepEqual(await readOverride(file), written)

  const leftovers = (await readdir(path.dirname(file))).filter((name) => name.endsWith('.tmp'))
  assert.deepEqual(leftovers, [], '写完不该留下临时文件')

  // 覆盖已有文件同样原子
  await writeOverride({ silentSeconds: 60 }, file)
  assert.deepEqual(await readOverride(file), { silentSeconds: 60 })
})

test('writeOverride：写到不存在的目录会自己建，坏路径抛错而不是写半截', async () => {
  // 拿一个「目录名被文件占住」的路径制造失败：写不进去就必须抛错，让上层落 persisted=false
  const blocker = path.join(TEST_HOME, 'blocker-file')
  await writeFile(blocker, 'x', 'utf8')
  await assert.rejects(writeOverride({ enabled: true }, path.join(blocker, 'nested', 'config.json')))
})

// ---------------------------------------------------------------------------
// 设置页通道：覆盖层读不到 / 读坏了（不能把用户设置当成「没有配置」冲掉）
// ---------------------------------------------------------------------------

/** 只够跑 handleConfigRequest 的假 webServer：把注册进去的 handler 抓出来。 */
function makeHttpHarness(config = {}) {
  let captured = null
  apply({
    logger: { info() {}, warn() {} },
    on() { return () => {} },
    effect(fn) {
      const off = fn()
      return typeof off === 'function' ? off : () => {}
    },
    inject(names, setup) {
      if (!names.includes('webServer')) return
      setup({
        webServer: {
          register(route) {
            captured = route.handler
            return () => { captured = null }
          },
        },
        effect(fn) {
          const off = fn()
          return typeof off === 'function' ? off : () => {}
        },
      })
    },
  }, config)
  assert.equal(typeof captured, 'function', 'webServer 路由应该注册上')
  return () => captured
}

function makeReq(method, body) {
  const listeners = new Map()
  let delivered = false
  // 只在「handler 挂上 end 监听」之后才把 body 喂进去：路由里可能先 await 读配置，
  // 抢在监听之前发数据，POST 就会永远等不到 end（这是夹具的坑，不是产品逻辑）。
  const deliver = () => {
    if (delivered) return
    delivered = true
    if (body !== undefined) listeners.get('data')?.(Buffer.from(JSON.stringify(body), 'utf8'))
    listeners.get('end')?.()
  }
  const req = {
    method,
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:55920', 'content-type': 'application/json' },
    on(event, callback) {
      listeners.set(event, callback)
      if (event === 'end') setImmediate(deliver)
      return req
    },
  }
  return req
}

function makeRes() {
  const res = {
    status: 0,
    body: null,
    ended: false,
    writeHead(status) { res.status = status },
    end(payload) {
      res.body = typeof payload === 'string' && payload !== '' ? JSON.parse(payload) : null
      res.ended = true
    },
  }
  return res
}

async function callRoute(handler, { method = 'GET', body } = {}) {
  const res = makeRes()
  handler(makeReq(method, body), res)
  // 真的会落盘（临时文件 + rename），200 轮 setImmediate 不够：用真实定时器给足 2 秒
  const deadline = Date.now() + 2_000
  while (!res.ended && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.ok(res.ended, '路由没在 2 秒内回应')
  return res
}

async function useHome(name) {
  const previous = process.env.DSH_HOME
  const home = path.join(TEST_HOME, name)
  await rm(home, { recursive: true, force: true })
  await mkdir(home, { recursive: true })
  process.env.DSH_HOME = home
  return {
    file: path.join(home, 'narrator-lite', 'config.json'),
    async restore() {
      process.env.DSH_HOME = previous
      await rm(home, { recursive: true, force: true })
    },
  }
}

test('覆盖层读不到：拒绝保存、不动用户文件，修好后下一次请求会重读', async () => {
  const env = await useHome('override-unreadable')
  try {
    // 让 readFile 抛 EISDIR：模拟 Windows 上 EBUSY/EPERM 这类「文件在那儿但读不到」
    await mkdir(path.dirname(env.file), { recursive: true })
    await mkdir(env.file)
    const handler = makeHttpHarness()

    const first = await callRoute(handler())
    assert.equal(first.status, 200)
    assert.equal(first.body.config.configWritable, false, '读不到配置时不能标成「可写」')
    assert.match(first.body.config.configNote, /读不到配置文件/)

    const refused = await callRoute(handler(), { method: 'POST', body: { silentSeconds: 200 } })
    assert.equal(refused.status, 409)
    assert.equal(refused.body.ok, false)
    assert.equal(refused.body.error, 'config-unreadable')
    assert.ok((await stat(env.file)).isDirectory(), '拒绝保存时不能往用户配置里写一个字节')

    // 修好文件 → 下一次请求自己重读（以前这里会永久停在空配置上）
    await rm(env.file, { recursive: true })
    await writeFile(env.file, JSON.stringify({ silentSeconds: 55 }), 'utf8')

    const retried = await callRoute(handler())
    assert.equal(retried.body.config.configWritable, true)
    assert.equal(retried.body.config.silentSeconds, 55)
    assert.equal(retried.body.config.configNote, null)

    const saved = await callRoute(handler(), { method: 'POST', body: { silentSeconds: 66 } })
    assert.equal(saved.status, 200)
    assert.equal(saved.body.persisted, true)
    assert.equal(JSON.parse(await readFile(env.file, 'utf8')).silentSeconds, 66)
  } finally {
    await env.restore()
  }
})

test('覆盖层损坏：先备份成 .broken-*，提示给设置页，之后照常能存', async () => {
  const env = await useHome('override-corrupt')
  try {
    await mkdir(path.dirname(env.file), { recursive: true })
    await writeFile(env.file, '{ 这不是 JSON', 'utf8')
    const handler = makeHttpHarness()

    const first = await callRoute(handler())
    assert.equal(first.status, 200)
    assert.equal(first.body.config.configWritable, true, '坏文件备份走了，写入是安全的')
    assert.match(first.body.config.configNote, /已备份为 config\.json\.broken-/)

    const dir = path.dirname(env.file)
    const backups = (await readdir(dir)).filter((name) => name.includes('.broken-'))
    assert.equal(backups.length, 1, '必须留一份原始内容')
    assert.equal(await readFile(path.join(dir, backups[0]), 'utf8'), '{ 这不是 JSON')

    const saved = await callRoute(handler(), { method: 'POST', body: { silentSeconds: 33 } })
    assert.equal(saved.status, 200)
    assert.equal(saved.body.persisted, true)
    assert.deepEqual(JSON.parse(await readFile(env.file, 'utf8')), { silentSeconds: 33 })

    const after = await callRoute(handler())
    assert.equal(after.body.config.configNote, null, '存过一份新的之后提示就该消失')
  } finally {
    await env.restore()
  }
})

// ---------------------------------------------------------------------------
// 链路：计时 → 排期 → step 边界注入
// ---------------------------------------------------------------------------

test('沉默到点 → 下一个 step 边界注入一条 notice 用户消息', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const h = makeHarness({ silentSeconds: 10, cooldownSeconds: 0 })

  h.emit('agent/assistant-stream', start())
  t.mock.timers.tick(10_000)

  // 硬闸：新回合第 1 步不允许被改成一次「新请求」
  const firstStep = await h.preStep({ agent: makeAgent(), turn: 1, step: 1 })
  assert.equal(firstStep.messages.length, 0)

  const decision = await h.preStep({ agent: makeAgent(), turn: 1, step: 2 })
  assert.equal(decision.kind, 'enter')
  assert.equal(decision.messages.length, 1)

  const message = decision.messages[0]
  assert.equal(message.role, 'user')
  assert.equal(message.source.form, 'notice', '必须是界面隐藏、模型可见的 context 节点')
  assert.equal(message.source.kind, 'narrator-lite')
  assert.match(message.content[0].text, /中途插话/)
  assert.match(message.content[0].text, /不要停下来等确认/)
  assert.equal(typeof message.id, 'string')

  h.dispose()
})

test('到点排期之后又冒出正文：due 被清掉，必须重新排一次定时器', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const h = makeHarness({ silentSeconds: 10, cooldownSeconds: 0 })

  h.emit('agent/assistant-stream', start())
  t.mock.timers.tick(10_000)
  // 到点了（due=true，此刻没有定时器），但模型在这一步里又说了句话
  h.emit('agent/assistant-stream', chunk('text-delta', { text: '刚说完一句' }))

  t.mock.timers.tick(9_999)
  assert.equal((await h.preStep({ agent: makeAgent(), turn: 1, step: 2 })).messages.length, 0, '刚说完不该马上提醒')

  t.mock.timers.tick(1)
  assert.equal(
    (await h.preStep({ agent: makeAgent(), turn: 1, step: 2 })).messages.length,
    1,
    '清理 due 之后没有重新排期，本步余下的静默就永远算不到',
  )

  h.dispose()
})

test('注入后计时推到 now：紧接着的边界不会再插一句', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const h = makeHarness({ silentSeconds: 10, cooldownSeconds: 0 })

  h.emit('agent/assistant-stream', start())
  t.mock.timers.tick(10_000)
  const injected = await h.preStep({ agent: makeAgent(), turn: 1, step: 2 })
  assert.equal(injected.messages.length, 1)

  t.mock.timers.tick(1_000)
  const again = await h.preStep({ agent: makeAgent(), turn: 1, step: 3 })
  assert.equal(again.messages.length, 0, '刚汇报过就不该再来一次')

  h.dispose()
})

test('正文输出重置计时，工具调用不重置', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const h = makeHarness({ silentSeconds: 10, cooldownSeconds: 0 })

  h.emit('agent/assistant-stream', start())
  t.mock.timers.tick(5_000)
  h.emit('agent/assistant-stream', chunk('text-delta', { text: '正在读文件' }))

  // 原定时器在 10s 响：此时静默只有 5s，还没到
  t.mock.timers.tick(5_000)
  t.mock.timers.tick(4_999)
  const notYet = await h.preStep({ agent: makeAgent(), turn: 1, step: 2 })
  assert.equal(notYet.messages.length, 0)

  t.mock.timers.tick(1)
  const decision = await h.preStep({ agent: makeAgent(), turn: 1, step: 2 })
  assert.equal(decision.messages.length, 1)

  h.dispose()
})

test('纯工具调用与纯思考都不算「用户看见了东西」', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const k = makeHarness({ silentSeconds: 10, cooldownSeconds: 0 })
  k.emit('agent/assistant-stream', start())
  k.emit('agent/assistant-stream', chunk('tool-call-delta'))
  k.emit('agent/assistant-stream', chunk('reasoning-delta'))
  t.mock.timers.tick(10_000)
  const viaTools = await k.preStep({ agent: makeAgent(), turn: 1, step: 2 })
  assert.equal(viaTools.messages.length, 1, '密集调工具恰恰是最该提醒的场景')
  k.dispose()
})

test('开关关掉后不注入', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const h = makeHarness({ enabled: false, silentSeconds: 10, cooldownSeconds: 0 })

  h.emit('agent/assistant-stream', start())
  t.mock.timers.tick(120_000)
  const decision = await h.preStep({ agent: makeAgent(), turn: 1, step: 2 })
  assert.equal(decision.messages.length, 0)

  h.dispose()
})

test('冷却期挡住第二次注入，冷却结束才放行', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const h = makeHarness({ silentSeconds: 10, cooldownSeconds: 30 })

  h.emit('agent/assistant-stream', start())
  t.mock.timers.tick(10_000)
  assert.equal((await h.preStep({ agent: makeAgent(), turn: 1, step: 2 })).messages.length, 1)

  // t=20s：又静默 10s 了，但距上次注入只有 10s < 30s 冷却
  t.mock.timers.tick(10_000)
  assert.equal((await h.preStep({ agent: makeAgent(), turn: 1, step: 3 })).messages.length, 0)

  // t=40s：冷却结束（注入在 t=10s，+30s = 40s）
  t.mock.timers.tick(20_000)
  assert.equal((await h.preStep({ agent: makeAgent(), turn: 1, step: 4 })).messages.length, 1)

  h.dispose()
})

test('被取消的那一次不记账：冷却和单回合配额都还在', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const h = makeHarness({ silentSeconds: 10, cooldownSeconds: 30, maxPerTurn: 1 })

  h.emit('agent/assistant-stream', start())
  t.mock.timers.tick(10_000)

  // 模拟「消息造好之后、记账之前被叫停」：宿主自己的 throwIfAborted 在第二次问的时候才抛。
  // 宿主拿到 decision 之后还会自己再 throwIfAborted 一次 —— 那一下我们拦不住，
  // 能保证的是「我们这边已经知道被取消」时不要把这次配额吃掉。
  let checks = 0
  const signal = {
    aborted: false,
    throwIfAborted() {
      checks += 1
      if (checks >= 2) throw new Error('aborted')
    },
  }
  const cancelled = await h.preStep({ agent: makeAgent(), turn: 1, step: 2, signal })
  assert.equal(cancelled.messages.length, 0, '取消的那一步不能塞消息')
  assert.ok(checks >= 2, '记账前必须再问一次 signal')

  // 同一时刻、同一个 step 边界：配额和冷却都还在，应该照常注入
  const retried = await h.preStep({ agent: makeAgent(), turn: 1, step: 3 })
  assert.equal(retried.messages.length, 1, '上一次没进批次，不该把冷却和 maxPerTurn 扣掉')

  h.dispose()
})

test('单回合上限生效', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const h = makeHarness({ silentSeconds: 10, cooldownSeconds: 0, maxPerTurn: 1 })

  h.emit('agent/assistant-stream', start())
  t.mock.timers.tick(10_000)
  assert.equal((await h.preStep({ agent: makeAgent(), turn: 1, step: 2 })).messages.length, 1)

  t.mock.timers.tick(60_000)
  assert.equal((await h.preStep({ agent: makeAgent(), turn: 1, step: 3 })).messages.length, 0)

  h.dispose()
})

test('子代理会话完全不参与（不静音主窗口，也不浪费调用）', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const h = makeHarness({ silentSeconds: 10, cooldownSeconds: 0 })
  const sub = makeAgent('sub-1', { origin: 'subagent' })

  h.emit('agent/assistant-stream', start(sub))
  t.mock.timers.tick(60_000)
  const decision = await h.preStep({ agent: sub, turn: 1, step: 2 })
  assert.equal(decision.messages.length, 0)

  h.dispose()
})

test('step 结束不重置计时（换步之间用户同样看不到东西）', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const h = makeHarness({ silentSeconds: 10, cooldownSeconds: 0 })

  h.emit('agent/assistant-stream', start(makeAgent(), 1, 1))
  t.mock.timers.tick(6_000)
  h.emit('agent/assistant-stream', { agent: makeAgent(), frame: { type: 'end' } })
  // 下一个 step 开始：同回合沿用计时
  h.emit('agent/assistant-stream', start(makeAgent(), 1, 2))
  t.mock.timers.tick(4_000)
  assert.equal((await h.preStep({ agent: makeAgent(), turn: 1, step: 2 })).messages.length, 1)

  h.dispose()
})

test('新回合从零开始数', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const h = makeHarness({ silentSeconds: 10, cooldownSeconds: 0 })

  h.emit('agent/assistant-stream', start(makeAgent(), 1, 1))
  t.mock.timers.tick(9_000)
  // 用户在 t=9s 发了新消息：新回合 start
  h.emit('agent/assistant-stream', start(makeAgent(), 2, 1))
  t.mock.timers.tick(9_999)
  assert.equal((await h.preStep({ agent: makeAgent(), turn: 2, step: 2 })).messages.length, 0)
  t.mock.timers.tick(1)
  assert.equal((await h.preStep({ agent: makeAgent(), turn: 2, step: 2 })).messages.length, 1)

  h.dispose()
})

test('回合结束清状态：旧回合的 due 不会漏到新回合', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const h = makeHarness({ silentSeconds: 10, cooldownSeconds: 0 })

  h.emit('agent/assistant-stream', start(makeAgent(), 1, 1))
  t.mock.timers.tick(10_000)
  h.emit('session/event', makeAgent().session, { type: 'turn/end', data: { turn: 1 } })
  t.mock.timers.tick(1_000)
  assert.equal((await h.preStep({ agent: makeAgent(), turn: 2, step: 2 })).messages.length, 0)

  h.dispose()
})

test('卸载 effect 会清掉定时器与监听，之后不再注入', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const h = makeHarness({ silentSeconds: 10, cooldownSeconds: 0 })

  h.emit('agent/assistant-stream', start())
  h.dispose()
  // 定时器已清，tick 不应触发任何回调；监听已摘，emit 是空操作
  t.mock.timers.tick(600_000)
  assert.equal(h.handlers.get('agent/pre-step')?.length ?? 0, 0)
})
