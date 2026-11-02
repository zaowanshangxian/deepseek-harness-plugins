/* 诊断：打开沙箱页面，打印可见文本与可疑的会话链接（找点击目标用）。 */
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
const r = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    text: (document.body.innerText||'').slice(0, 900),
    links: Array.from(document.querySelectorAll('a')).map(a => ({ href: a.getAttribute('href'), text: (a.textContent||'').trim().slice(0,40) })).slice(0, 20),
    buttons: Array.from(document.querySelectorAll('button')).map(b => (b.textContent||'').trim().slice(0,30)).filter(Boolean).slice(0, 25),
  })`,
  returnByValue: true,
}, sessionId)
console.log(r.result.value)
ws.close()
