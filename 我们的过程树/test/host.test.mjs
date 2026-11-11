import test from 'node:test'
import assert from 'node:assert/strict'

import { apply, name, ROUTE, VERSION } from '../lib/index.js'

/** 假 res：把 setHeader / end 记下来，好断言我们真的回了 JSON。 */
function fakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value
    },
    end(payload) {
      this.body = String(payload ?? '')
    },
  }
}

/** 假 ctx：effect 立刻执行并记住 disposer；webServer.register 记住路由。 */
function fakeContext({ withServer = true } = {}) {
  const routes = []
  const effects = []
  const unregistered = []
  const ctx = {
    effect(fn, label) {
      const dispose = fn()
      effects.push({ label, dispose })
      return dispose
    },
  }
  if (withServer) {
    ctx.webServer = {
      register(route) {
        routes.push(route)
        return () => unregistered.push(route.path)
      },
    }
  }
  return { ctx, routes, effects, unregistered }
}

test('宿主半：注册一个只读探针，卸载时注销', () => {
  const { ctx, routes, effects, unregistered } = fakeContext()
  apply(ctx)

  assert.equal(routes.length, 1)
  assert.equal(routes[0].path, ROUTE)
  assert.equal(routes[0].kind, 'exact')
  assert.equal(typeof routes[0].handler, 'function')
  assert.equal(effects.length, 1, '必须把注册塞进 ctx.effect，才会在卸载时被回收')
  assert.equal(typeof effects[0].dispose, 'function', 'ctx.effect 的回调必须返回清理函数')

  effects[0].dispose()
  assert.deepEqual(unregistered, [ROUTE], '卸载后路由必须注销')
})

test('宿主半：GET 返回 JSON，写方法被拒', async () => {
  const { ctx, routes } = fakeContext()
  apply(ctx)
  const handler = routes[0].handler

  const ok = fakeResponse()
  await handler({ method: 'GET' }, ok)
  assert.equal(ok.statusCode, 200)
  assert.match(ok.headers['content-type'], /application\/json/)
  const payload = JSON.parse(ok.body)
  assert.equal(payload.ok, true)
  assert.equal(payload.plugin, name)
  assert.equal(payload.version, VERSION)
  assert.ok(Array.isArray(payload.anchors) && payload.anchors.includes('data-chat-call-id'))

  const rejected = fakeResponse()
  await handler({ method: 'POST' }, rejected)
  assert.equal(rejected.statusCode, 405)
  assert.equal(JSON.parse(rejected.body).ok, false)
})

test('宿主半：没有 webServer 时安静跳过，不抛', () => {
  const { ctx, effects } = fakeContext({ withServer: false })
  assert.doesNotThrow(() => apply(ctx))
  assert.equal(effects.length, 0)
})

test('宿主半：res 已经断了也不能抛（探针不值得炸插件）', async () => {
  const { ctx, routes } = fakeContext()
  apply(ctx)
  const broken = {
    setHeader() {
      throw new Error('socket hang up')
    },
    end() {
      throw new Error('socket hang up')
    },
  }
  await assert.doesNotReject(async () => {
    await routes[0].handler({ method: 'GET' }, broken)
  })
})
