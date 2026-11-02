/* 沙箱验收（v0.4）：打开页面 → 点侧栏「Token」→ 滚到底 → 检查「工具账单（近 14 天）」区块。
 * 用法：node tools/sandbox-verify.mjs <url> [截图路径]
 */
import { writeFileSync } from 'node:fs'

const URL_ = process.argv[2]
const SHOT = process.argv[3] || ''
const PORT = Number(process.env.CDP_PORT || 9333)
if (!URL_) { console.error('用法: node tools/sandbox-verify.mjs <url> [截图]'); process.exit(2) }

const info = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
let id = 0
const pending = new Map()
const ws = new WebSocket(info.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) }
}
const send = (method, params = {}, sessionId) => {
  const msg = { id: ++id, method, params }
  if (sessionId) msg.sessionId = sessionId
  ws.send(JSON.stringify(msg))
  return Promise.race([
    new Promise((res, rej) => pending.set(msg.id, { resolve: res, reject: rej })),
    new Promise((_, rej) => setTimeout(() => rej(new Error('cdp-timeout ' + method)), 15000)),
  ])
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
let page = list.find((t) => t.type === 'page')
if (!page) page = { id: (await send('Target.createTarget', { url: 'about:blank' })).targetId }
const { sessionId } = await send('Target.attachToTarget', { targetId: page.id, flatten: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId)
await send('Page.enable', {}, sessionId)
await send('Page.navigate', { url: URL_ }, sessionId)
await sleep(12000)

const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true }, sessionId)
  if (r.exceptionDetails) return { __error: JSON.stringify(r.exceptionDetails).slice(0, 300) }
  return r.result.value
}
const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }, sessionId)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId)
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId)
}

await evaluate(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent||'').trim() === '继续'); if (b) b.click(); return true })()`)
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId)
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId)
await sleep(1200)

// 点侧栏 Token
const pos = await evaluate(`(() => {
  const els = Array.from(document.querySelectorAll('span, div, a, button'))
    .filter((e) => (e.textContent || '').trim() === 'Token' && e.getBoundingClientRect().height > 0)
  const el = els[0]
  if (!el) return null
  const r = el.getBoundingClientRect()
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
})()`)
let clicked = false
if (pos && typeof pos === 'string' && pos.startsWith('{')) {
  const p = JSON.parse(pos)
  await click(p.x, p.y)
  clicked = true
  await sleep(6000)
}

// 滚到底（找中栏可滚动容器）
await evaluate(`(() => {
  const col = document.querySelector('[class*="centerCol"]') || document.body
  const stack = [col]
  let best = null
  for (let i = 0; i < 400 && stack.length; i++) {
    const n = stack.shift()
    for (const k of n.children || []) {
      if (k.scrollHeight > k.clientHeight + 20) { if (!best || k.scrollHeight > best.scrollHeight) best = k }
      stack.push(k)
    }
  }
  if (best) best.scrollTop = best.scrollHeight
  return true
})()`)
await sleep(2500)

const check = JSON.parse(await evaluate(`JSON.stringify((() => {
  const section = document.querySelector('[data-tool-tax-embed]')
  const body = document.body.innerText || ''
  return {
    section: !!section,
    hasTitle: body.includes('工具账单（近 14 天）'),
    hasRows: section ? section.querySelectorAll('tbody tr').length : 0,
    sub: section ? (section.querySelector('div div div') || {}).textContent || '' : '',
    around: section ? (section.innerText || '').slice(0, 260) : '',
  }
})())`))

if (SHOT) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
  writeFileSync(SHOT, Buffer.from(data, 'base64'))
}

const ok = clicked && check.section && check.hasRows > 0
console.log(JSON.stringify({ ok, clicked, check, screenshot: SHOT || null }, null, 1))
ws.close()
process.exit(ok ? 0 : 1)
