/* 沙箱验收：连到 dsh web 打印出来的 URL（带 token，自带鉴权），不伪造 cookie。
 * 用法：node tools/sandbox-verify.mjs <url> [会话标题] [截图路径]
 * 检查项：
 *   1. 页面能打开、会话能进
 *   2. 点开官方「Token 用量」卡片后，卡片里出现「工具税」一行（dt/dd 各一条）
 *   3. 该行带估算值（≈ N tokens/轮）
 */
import { writeFileSync } from 'node:fs'

const URL_ = process.argv[2]
const SESSION_TITLE = process.argv[3] || ''
const SHOT = process.argv[4] || ''
const PORT = Number(process.env.CDP_PORT || 9333)
if (!URL_) { console.error('用法: node tools/sandbox-verify.mjs <url> [会话标题] [截图]'); process.exit(2) }

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

// 关掉「预览版说明」等遮罩
await evaluate(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent||'').trim() === '继续'); if (b) b.click(); return true })()`)
await sleep(800)

// 关掉「QQ 机器人绑定」这类弹窗：ESC + 点可能的关闭按钮
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId)
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId)
await sleep(1200)

const base = JSON.parse(await evaluate(`JSON.stringify({ url: location.href, title: document.title, bodyLen: (document.body.innerText||'').length })`))
console.log('[verify] base', JSON.stringify(base))

// 打开会话
let opened = false
if (SESSION_TITLE) {
  const pos = await evaluate(`(() => {
    const el = Array.from(document.querySelectorAll('span, div, a, button'))
      .find((e) => (e.textContent || '').trim() === ${JSON.stringify(SESSION_TITLE)} && e.getBoundingClientRect().height > 0)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
  })()`)
  if (pos && typeof pos === 'string' && pos.startsWith('{')) {
    const p = JSON.parse(pos)
    await click(p.x, p.y)
    await sleep(6000)
    opened = true
  }
}

// 点用量胶囊
const pill = await evaluate(`(() => {
  const btns = Array.from(document.querySelectorAll('button')).filter((b) => b.getBoundingClientRect().height > 0)
  const hit = btns.find((b) => /缓存命中/.test(b.textContent || '')) || btns.find((b) => /^用量\\s/.test((b.textContent || '').trim()))
  if (!hit) return null
  const r = hit.getBoundingClientRect()
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, text: (hit.textContent || '').trim().slice(0, 28) })
})()`)
let pillText = null
if (pill && typeof pill === 'string' && pill.startsWith('{')) {
  const p = JSON.parse(pill)
  pillText = p.text
  await click(p.x, p.y)
  await sleep(4000)
}

const card = JSON.parse(await evaluate(`JSON.stringify((() => {
  const d = document.querySelector('[role="dialog"][aria-label="Token 用量"], [role="dialog"][aria-label="本轮用量"]')
  const row = d ? Array.from(d.querySelectorAll('[data-tool-tax-row]')).map((x) => x.textContent.trim()) : []
  return {
    dialogOpen: !!d,
    toolTaxRow: row,
    dts: d ? Array.from(d.querySelectorAll('dt')).map((x) => x.textContent.trim()) : [],
    dds: d ? Array.from(d.querySelectorAll('dd')).map((x) => x.textContent.trim()) : [],
  }
})())`))

// 点「工具账单 → 点击查看」，验证面板
let panel = { open: false, rows: 0, header: '', note: '' }
const billPos = await evaluate(`(() => {
  const d = document.querySelector('[role="dialog"][aria-label="Token 用量"], [role="dialog"][aria-label="本轮用量"]')
  if (!d) return null
  const dd = Array.from(d.querySelectorAll('dd')).find((x) => (x.textContent || '').trim() === '点击查看')
  if (!dd) return null
  const r = dd.getBoundingClientRect()
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
})()`)
if (billPos && typeof billPos === 'string' && billPos.startsWith('{')) {
  const p = JSON.parse(billPos)
  await click(p.x, p.y)
  await sleep(5000)
  panel = JSON.parse(await evaluate(`JSON.stringify((() => {
    const p = document.getElementById('tool-tax-panel')
    if (!p) return { open: false, rows: 0, header: '', note: '' }
    return {
      open: true,
      rows: p.querySelectorAll('tbody tr').length,
      header: (p.querySelector('div div') || {}).textContent || '',
      note: (p.querySelector('div:last-child') || {}).textContent || '',
    }
  })())`))
}


if (SHOT) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
  writeFileSync(SHOT, Buffer.from(data, 'base64'))
}

const ok = card.dialogOpen && card.toolTaxRow.length === 4 && /tokens\/轮/.test(card.toolTaxRow[1] || '') && panel.open && panel.rows > 0
console.log(JSON.stringify({ ok, sessionOpened: opened, pill: pillText, result: card, panel, screenshot: SHOT || null }, null, 1))
ws.close()
process.exit(ok ? 0 : 1)
