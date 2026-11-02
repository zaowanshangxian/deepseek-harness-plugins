/* 侦察：点侧栏「Token」后，dump 中栏面板的 DOM 骨架（找可追加的锚点）。 */
const URL_ = process.argv[2]
const PORT = Number(process.env.CDP_PORT || 9333)
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
  return new Promise((res, rej) => pending.set(msg.id, { resolve: res, reject: rej }))
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
let page = list.find((t) => t.type === 'page')
if (!page) page = { id: (await send('Target.createTarget', { url: 'about:blank' })).targetId }
const { sessionId } = await send('Target.attachToTarget', { targetId: page.id, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Page.navigate', { url: URL_ }, sessionId)
await sleep(12000)
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true }, sessionId)
  if (r.exceptionDetails) return { __error: JSON.stringify(r.exceptionDetails).slice(0, 400) }
  return r.result.value
}
const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }, sessionId)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId)
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId)
}
await ev(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent||'').trim() === '继续'); if (b) b.click(); return true })()`)
await sleep(800)

// 点 Token
const pos = await ev(`(() => {
  const els = Array.from(document.querySelectorAll('span, div, a, button'))
    .filter((e) => (e.textContent || '').trim() === 'Token' && e.getBoundingClientRect().height > 0)
  const el = els[0]
  if (!el) return null
  const r = el.getBoundingClientRect()
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
})()`)
if (pos && pos.startsWith('{')) { const p = JSON.parse(pos); await click(p.x, p.y); await sleep(5000) }

const dom = await ev(`JSON.stringify((() => {
  const col = document.querySelector('.mP3x-q_centerCol')
  if (!col) return { err: 'no centerCol' }
  const out = []
  const walk = (node, depth, path) => {
    if (depth > 10 || out.length > 80) return
    let idx = 0
    for (const child of node.children || []) {
      const cls = String(child.className || '').slice(0, 40)
      const own = (child.childElementCount === 0 ? (child.textContent || '') : '').trim().slice(0, 24)
      const scroll = child.scrollHeight > child.clientHeight + 4
      out.push({ d: depth, i: idx, tag: child.tagName, cls, t: own, scroll, h: child.clientHeight, sh: child.scrollHeight })
      walk(child, depth + 1, path + '/' + idx)
      idx++
    }
  }
  walk(col, 0, '')
  return out
})())`)
console.log(dom)
ws.close()
