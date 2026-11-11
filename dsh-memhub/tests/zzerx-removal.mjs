/**
 * 「zzerx 已卸载」回归测试（hermetic：fixture 全在临时目录，不读生产数据）。
 *
 * 验的是「物理删掉 @zzerx/dsh-plugin-memory + ~/.dsh/storages/memory 整个消失」之后：
 *   1. 默认配置不能再落到 zzerx 源（旧默认 = 空库 + 空注入 + 日志无声）
 *   2. 源读不出来必须有 warn（静默降级 → 可见）
 *   3. 星图旧实体/边目录不在 → 只用本地图 + 一条提示，不 500、不静默丢
 *   4. 星图迁移：migrate-memory --apply 把 entities/edges 一起搬（幂等）
 *   5. 原文回读：区分「旧库目录不在」和「这条没原文」；m_ 前缀能对上裸 id
 *   6. recall-index：源不可读时不覆盖 sidecar 索引
 *
 * 用法：node tests/zzerx-removal.mjs
 */
import { register } from 'node:module'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

register('./loader.mjs', import.meta.url)

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'memhub-nozzerx-'))
process.env.DSH_HOME = HOME
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ZZERX = path.join(HOME, 'storages', 'memory')
const PARKED = path.join(HOME, 'storages', 'memory.UNINSTALLED')
const SHARED = path.join(HOME, 'shared')
const MEMHUB = path.join(HOME, 'memhub')

const failures = []
let total = 0
function ok(condition, label) {
  total += 1
  if (condition) console.log(`PASS  ${label}`)
  else {
    console.log(`FAIL  ${label}`)
    failures.push(label)
  }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8')
}

// ── fixture：假 zzerx 库（2 条记忆 + 1 实体 + 1 边 + 1 份原文）─────────────
const now = Date.now()
for (const record of [
  { id: 'zz-a', kind: 'decision', scope: 'global', title: '旧库记忆 A', content: '旧库正文 A', importance: 4, updatedAt: now },
  { id: 'zz-b', kind: 'fact', scope: 'self', title: '旧库记忆 B', content: '旧库正文 B', importance: 3, updatedAt: now - 86_400_000 },
]) {
  writeJson(path.join(ZZERX, 'memories', `${record.id}.json`), { version: 1, record })
}
writeJson(path.join(ZZERX, 'entities', 'e_old.json'), { record: { id: 'e_old', name: '旧实体', kind: 'concept' } })
writeJson(path.join(ZZERX, 'edges', 'l_old.json'), {
  record: { id: 'l_old', from: { id: 'zz-a' }, to: { id: 'e_old' }, relation: 'mentions', origin: 'manual' },
})
writeJson(path.join(ZZERX, 'raw_documents', 'rd1.json'), { version: 1, record: { id: 'rd1', recordIds: ['zz-a'], text: 'L0 原文片段' } })

const { apply } = await import('../src/host.js')
const { saveOrb } = await import('../src/orb-store.js')
const { findRawText } = await import('../src/recall-store.js')
const { DATA_ROOT } = await import('../src/const.js')

// 迁移后的真源：orb（id 带 m_ 前缀，与生产一致）
saveOrb({ id: 'm_zz-a', title: '旧库记忆 A', content: '旧库正文 A', scope: 'global', kind: 'decision', importance: 4, updatedAt: now }, DATA_ROOT, SHARED)
saveOrb({ id: 'm_zz-b', title: '旧库记忆 B', content: '旧库正文 B', scope: 'self', kind: 'fact', importance: 3, updatedAt: now - 86_400_000 }, DATA_ROOT, SHARED)

function makeCtx() {
  const registered = []
  const contexts = []
  const routes = []
  const logs = []
  const mockCtx = {
    tools: { register: (definition) => registered.push(definition) },
    systemPrompt: { section: () => {}, context: (context) => contexts.push(context) },
    webServer: { register: (route) => routes.push(route) },
    effect: (factory) => factory(),
    logger: { info: (text) => logs.push(`info ${text}`), warn: (text) => logs.push(`warn ${text}`) },
  }
  const ctx = { inject: (_deps, callback) => { callback(mockCtx); return () => {} }, logger: mockCtx.logger }
  return { ctx, registered, contexts, routes, logs }
}

function readStats() {
  return JSON.parse(fs.readFileSync(path.join(MEMHUB, 'self-check.json'), 'utf8'))
}

async function fetchGraph(routes) {
  const route = routes.find((item) => String(item.path).includes('/memhub/api'))
  const res = { statusCode: 0, body: '', writeHead(code) { this.statusCode = code }, end(text) { this.body = text } }
  await route.handler({ url: '/memhub/api/graph', method: 'GET', headers: {} }, res)
  return { status: res.statusCode, graph: JSON.parse(res.body || '{}').graph || null }
}

// ── 1. 默认配置不许再落到 zzerx 源 ────────────────────────────────────────
const plain = makeCtx()
apply(plain.ctx, { vault: path.join(HOME, 'skills'), sharedRoot: SHARED })
const first = readStats()
ok(first.recallSource === 'memhub', `不写 recall.source 时默认走 memhub（实际 ${first.recallSource}）`)
ok(first.memories === 2, `迁移后的 orb 被读到（memories=${first.memories}）`)
const plainBlock = String(plain.contexts[0]?.text?.() || '')
ok(plainBlock.includes('旧库记忆'), '注入块里有迁移后的条目（不是空块）')

// ── 2. 有 zzerx 时星图能读到旧实体 ────────────────────────────────────────
const withZzerx = makeCtx()
apply(withZzerx.ctx, { vault: path.join(HOME, 'skills'), sharedRoot: SHARED, recall: { source: 'memhub' } })
const graphBefore = await fetchGraph(withZzerx.routes)
ok(graphBefore.status === 200 && graphBefore.graph?.stats?.entities === 1, `有旧库时星图含旧实体（${JSON.stringify(graphBefore.graph?.stats)}）`)

// ── 3. 卸载：zzerx 目录整个消失 ───────────────────────────────────────────
fs.renameSync(ZZERX, PARKED)
const after = makeCtx()
apply(after.ctx, { vault: path.join(HOME, 'skills'), sharedRoot: SHARED, recall: { source: 'memhub' } })
const gone = readStats()
ok(gone.memoryErrors === 0, `无旧库时 memhub 源照常读（memoryErrors=${gone.memoryErrors}）`)
ok(gone.memories === first.memories, `无旧库时记忆条数不变（${gone.memories}/${first.memories}）`)
const goneBlock = String(after.contexts[0]?.text?.() || '')
ok(goneBlock.length === plainBlock.length, `无旧库时注入块长度不变（${goneBlock.length}/${plainBlock.length}）`)

const graphAfter = await fetchGraph(after.routes)
ok(graphAfter.status === 200, `无旧库时 /api/graph 不 500（实际 ${graphAfter.status}）`)
ok(graphAfter.graph?.stats?.entities === 0, '无旧库时只剩本地图（entities=0）')
const graphWarns = after.logs.filter((line) => line.startsWith('warn') && line.includes('星图'))
ok(graphWarns.length === 1, `旧图目录不在时留一条提示（实际 ${graphWarns.length} 条）`)

// ── 4. 显式回滚到 zzerx 源但旧库不在 → 必须 warn（不静默）────────────────
const rolledBack = makeCtx()
apply(rolledBack.ctx, { vault: path.join(HOME, 'skills'), sharedRoot: SHARED, recall: { source: 'zzerx' } })
const rollbackStats = readStats()
const readWarns = rolledBack.logs.filter((line) => line.startsWith('warn') && line.includes('读取有'))
ok(rollbackStats.memories === 0, '显式 zzerx 源 + 旧库不在 = 0 条（行为可预测）')
ok(readWarns.length === 1, `这种静默空库要留 warn（实际 ${readWarns.length} 条）`)
ok(String(readWarns[0] || '').includes('zzerx'), 'warn 里点出是哪个源读不出来')

// ── 5. 原文回读：m_ 前缀 + 目录不在要分开说 ──────────────────────────────
const rawDocs = JSON.parse(fs.readFileSync(path.join(PARKED, 'raw_documents', 'rd1.json'), 'utf8')).record
ok(findRawText('m_zz-a', [{ file: 'rd1.json', record: rawDocs }])?.text === 'L0 原文片段', 'm_ 前缀 id 能对上裸 id 的原文')
const rawMissing = findRawText('m_zz-a')
ok(rawMissing?.missingRoot === true, '旧库目录不在 → 明确 missingRoot（不是「可能已被裁剪」）')
const rawTool = after.registered.find((definition) => definition.name === 'memhub_raw')
const rawText = String((await rawTool.execute({ id: 'm_zz-a' }, {})).text)
ok(rawText.includes('raw_documents 目录不存在'), `memhub_raw 说清原因（${rawText.slice(0, 40)}…）`)

// ── 6. 星图迁移：--apply 把实体/边搬进 memhub，且幂等 ────────────────────
// （临时把旧库放回去跑两遍，验完再卸掉）
fs.renameSync(PARKED, ZZERX)
const cli = path.join(REPO, 'tools', 'migrate-memory.mjs')
const run = (args) =>
  execFileSync(process.execPath, [cli, ...args, '--shared', SHARED], { env: { ...process.env, DSH_HOME: HOME }, encoding: 'utf8' })
const migrateOnce = run(['--apply'])
ok(fs.existsSync(path.join(MEMHUB, 'graph', 'entities', 'e_old.json')), '迁移把旧实体搬进 memhub/graph/entities')
ok(fs.existsSync(path.join(MEMHUB, 'graph', 'edges', 'l_old.json')), '迁移把旧边搬进 memhub/graph/edges')
ok(/复制 2，跳过 0/.test(migrateOnce), `首次迁移报告复制 2（${migrateOnce.split('\n')[0]}）`)
const migrateTwice = run(['--apply'])
ok(/复制 0，跳过 2/.test(migrateTwice), '再跑一次幂等（复制 0 / 跳过 2）')
fs.renameSync(ZZERX, PARKED) // 回到「已卸载」状态，后面两步都要求旧库不在

// ── 7. recall-index：源不可读时不能覆盖 sidecar 索引 ─────────────────────
const recallDir = path.join(MEMHUB, 'recall')
fs.mkdirSync(recallDir, { recursive: true })
const sentinel = path.join(recallDir, 'recall-index.jsonl')
fs.writeFileSync(sentinel, 'SENTINEL\n', 'utf8')
let recallIndexExit = 0
try {
  execFileSync(process.execPath, [path.join(REPO, 'tools', 'recall-index.mjs')], {
    env: { ...process.env, DSH_HOME: HOME, MEMHUB_ZZERX_ROOT: ZZERX },
    encoding: 'utf8',
    stdio: 'pipe',
  })
} catch (error) {
  recallIndexExit = error.status ?? 1
}
ok(recallIndexExit === 1, `源不可读时 recall-index 退出 1（实际 ${recallIndexExit}）`)
ok(fs.readFileSync(sentinel, 'utf8') === 'SENTINEL\n', '源不可读时不覆盖 recall-index.jsonl')

// ── 8. 迁移脚本在「旧库已卸」时给出可读原因 ──────────────────────────────
let migrateExit = 0
let migrateOut = ''
try {
  migrateOut = run([])
} catch (error) {
  migrateExit = error.status ?? 1
  migrateOut = String(error.stdout || '') + String(error.stderr || '')
}
ok(migrateExit === 1, `旧库不在时 migrate-memory 退出 1（实际 ${migrateExit}）`)
ok(migrateOut.includes('目录不存在'), `报错说清是目录不存在（${migrateOut.split('\n').find((line) => line.includes('没有可迁移')) || ''}）`)

fs.rmSync(HOME, { recursive: true, force: true })
console.log(`\n无 zzerx 回归：${total - failures.length}/${total} 通过`)
if (failures.length > 0) {
  console.log(`失败项：${failures.join(' ｜ ')}`)
  process.exit(1)
}
