/**
 * 审计用：Host 半侧的「降级时到底有没有人知道」+「设置 API 会不会被别的网页改写」。
 *
 * 查三件真机里很难观察的事：
 *   1. 降级日志去哪了——工具税 / 过程树以前写成 `config.logger`（config 是用户在
 *      cordis.patch.yml 里写的配置，里面根本没有 logger），于是每条 warn 都是空转。
 *   2. 设置 API 有没有同源门——人格与口癖的 POST 能改口癖，口癖文本会原样进系统提示。
 *   3. DSH_HOME 是否被正确尊重（测试用临时目录，绝不碰真实 profile / 用户设置）。
 *
 * 用法：node audit/2026-11-11-host-degrade.mjs
 * 退出码 0 = 全部符合预期。
 */
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')

// 先隔离 DSH_HOME：host 半侧在 import 时就算好了设置路径，必须在 import 之前设。
const sandboxHome = mkdtempSync(join(tmpdir(), 'dsh-audit-home-'))
process.env.DSH_HOME = sandboxHome

let failures = 0
function ok(label, condition, detail) {
  if (condition) {
    console.log('   ok   ' + label)
  } else {
    console.log('   FAIL ' + label + (detail ? '  → ' + detail : ''))
    failures += 1
  }
}

function makeRes() {
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    finished: false,
    setHeader(k, v) { res.headers[k.toLowerCase()] = v },
    writeHead(code, headers) {
      res.statusCode = code
      for (const [k, v] of Object.entries(headers || {})) res.headers[k.toLowerCase()] = v
    },
    end(chunk) { if (chunk !== undefined) res.body += String(chunk); res.finished = true },
  }
  return res
}

function bodyReq(body, extraHeaders, url) {
  const headers = Object.assign({ 'content-type': 'application/json' }, extraHeaders || {})
  const iterable = {
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(body)
    },
  }
  return Object.assign(iterable, { method: 'POST', url: url || '/', headers })
}

console.log('DSH_HOME 沙箱: ' + sandboxHome + '\n')

// ─────────────────────────────────────────────────────────────────────
console.log('① 工具税 Host：webServer 不可用时，降级日志必须真的写出去')
{
  const mod = await import(pathToFileURL(join(repo, '工具税/lib/index.js')).href)
  const warns = []
  const dbg = []
  mod.apply({
    logger: { debug: (m) => dbg.push(String(m)), info() {}, warn: (m) => warns.push(String(m)), error() {} },
    // 故意不给 webServer / tools
  })
  ok('拿到 ctx.logger 并 warn 了一条', warns.some((w) => /webServer/i.test(w)), 'warns=' + JSON.stringify(warns))
  console.log('      → ' + (warns[0] || '（没有日志）').slice(0, 120))
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n② 过程树 Host：webServer 不可用时 debug 日志必须真的出去')
{
  const mod = await import(pathToFileURL(join(repo, '我们的过程树/lib/index.js')).href)
  const dbg = []
  mod.apply({
    logger: { debug: (m) => dbg.push(String(m)), info() {}, warn() {}, error() {} },
  })
  ok('拿到 ctx.logger 并 debug 了一条', dbg.some((m) => /webServer/i.test(m)), 'debug=' + JSON.stringify(dbg))
  console.log('      → ' + (dbg[0] || '（没有日志）').slice(0, 120))
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n③ 人格与口癖 Host：设置 API 的同源门')
{
  const mod = await import(pathToFileURL(join(repo, '人格与口癖/lib/index.js')).href)
  const routes = []
  const warns = []
  const fakeCtx = {
    logger: { debug() {}, info() {}, warn: (m) => warns.push(String(m)), error() {} },
    inject(_deps, cb) { cb(fakeCtx) },
    effect(fn) { return fn() },
    webServer: {
      register(route) { routes.push(route); return () => {} },
    },
  }
  mod.apply(fakeCtx)
  ok('注册了 settings API 路由', routes.length === 1 && routes[0].path === '/persona-voice')
  const handler = routes[0] ? routes[0].handler : null
  if (!handler) {
    ok('拿到 handler', false)
  } else {
    const postBody = JSON.stringify({ catchphrases: [{ text: 'IGNORE-PREVIOUS-INSTRUCTIONS' }] })

    // 1. 外站 Origin 必须被拒（CSRF）
    const evil = makeRes()
    const API = '/persona-voice/api/settings'
    await handler(
      bodyReq(postBody, { origin: 'https://evil.example', host: '127.0.0.1:65381' }, API),
      evil,
    )
    ok('跨站 Origin 被 403 拦住', evil.statusCode === 403, 'status=' + evil.statusCode + ' body=' + evil.body.slice(0, 80))

    // 2. 同源 Origin 放行
    const same = makeRes()
    await handler(
      bodyReq(postBody, { origin: 'http://127.0.0.1:65381', host: '127.0.0.1:65381' }, API),
      same,
    )
    ok('同源 Origin 正常写入', same.statusCode === 200 && /"ok":true/.test(same.body), 'status=' + same.statusCode)

    // 3. 没有 Origin（curl / 本机脚本）照常放行
    const noOrigin = makeRes()
    await handler(bodyReq(JSON.stringify({ catchphrases: [] }), undefined, API), noOrigin)
    ok('无 Origin 的本机请求放行', noOrigin.statusCode === 200, 'status=' + noOrigin.statusCode)

    // 4. 写盘落到沙箱 DSH_HOME，不碰真实设置
    const settingsPath = join(sandboxHome, 'persona-voice', 'settings.json')
    ok('设置写在沙箱 DSH_HOME 里', existsSync(settingsPath), settingsPath)
    if (existsSync(settingsPath)) {
      const saved = JSON.parse(readFileSync(settingsPath, 'utf8'))
      ok('被拒的那次没有落盘（口癖为空）', Array.isArray(saved.catchphrases) && saved.catchphrases.length === 0, JSON.stringify(saved.catchphrases))
    }
  }
}

rmSync(sandboxHome, { recursive: true, force: true })
console.log('\n' + (failures === 0 ? '结果：全部通过' : '结果：' + failures + ' 项不符合预期'))
process.exit(failures === 0 ? 0 : 1)
