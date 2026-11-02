// 侦察：会话日志里 tool/call 与 assistant/message(usage) 的事件结构（只打印结构，不打印内容）
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import zlib from 'node:zlib'

const root = join(process.env.USERPROFILE, '.dsh', 'sessions')
const want = process.argv[2]
let target = null
const stack = [root]
while (stack.length) {
  const dir = stack.pop()
  let entries = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { continue }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) stack.push(p)
    else if (/session\.v\d+\.jsonl\.zstd$/.test(e.name) && (!want || p.includes(want))) {
      const st = statSync(p)
      if (!target || st.size > target.st.size) target = { p, st }
    }
  }
}
if (!target) { console.log('no session'); process.exit(1) }
console.log('file', target.p, 'bytes', target.st.size)

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const buf = readFileSync(target.p)
const parts = []
let start = 0
for (let i = 0; i <= buf.length - 4; i++) {
  if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) {
    if (i > start) parts.push([start, i])
    start = i
  }
}
parts.push([start, buf.length])
let text = ''
for (const [a, b] of parts) {
  try { text += zlib.zstdDecompressSync(buf.subarray(a, b)).toString('utf8') } catch {}
}
const types = new Map()
const samples = {}
for (const line of text.split('\n')) {
  if (!line.trim()) continue
  let rec
  try { rec = JSON.parse(line) } catch { continue }
  types.set(rec.type, (types.get(rec.type) || 0) + 1)
  if (!samples[rec.type]) samples[rec.type] = rec
}
console.log('types', [...types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20))

const shape = (o, depth = 0) => {
  if (o === null || typeof o !== 'object') return typeof o
  if (depth > 2) return Array.isArray(o) ? '[…]' : '{…}'
  if (Array.isArray(o)) return '[' + (o.length ? shape(o[0], depth + 1) : '') + ']'
  return '{' + Object.keys(o).map((k) => k + ':' + shape(o[k], depth + 1)).join(', ') + '}'
}
for (const key of ['tool/call', 'tool/result', 'assistant/message', 'assistant/attempt', 'turn/start', 'turn/end']) {
  const rec = samples[key]
  if (!rec) continue
  console.log('\n=== ' + key)
  console.log(shape(rec).slice(0, 900))
  if (key === 'tool/call') {
    console.log('data keys:', Object.keys(rec.data || {}))
    console.log('data sample:', JSON.stringify(rec.data).slice(0, 600))
    if (rec.data?.message?.content) console.log('content blocks:', JSON.stringify(rec.data.message.content).slice(0, 400))
  }
  if (key === 'assistant/message') {
    console.log('usage:', JSON.stringify(rec.data?.usage))
    console.log('source:', JSON.stringify(rec.data?.message?.source))
  }
}
