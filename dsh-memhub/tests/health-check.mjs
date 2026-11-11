/**
 * 体检模块自测（纯函数，hermetic）：node tests/health-check.mjs
 * 覆盖：库存/分层/归属、protected 与可淘汰、休眠与可归档、注入预算、
 *       各类问题判定（严重/警告/提示）、Markdown 渲染与本地时间。
 */
import { buildHealth, renderHealthMarkdown, SEVERE, WARN, NOTE, formatLocal } from '../src/health.js'

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

const now = Date.parse('2026-11-10T09:30:00+08:00')
const DAY = 86_400_000
const recent = now - 1000

function sidecar(overrides = {}) {
  return {
    id: 's',
    tier: 'event',
    status: 'active',
    archived: false,
    evergreen: false,
    pinned: false,
    working: false,
    importance: 3,
    decay: 1,
    updatedAt: recent,
    title: '标题',
    summary: '一句话',
    content: '正文',
    scope: 'self',
    recall: { count: 0, last: null },
    ...overrides,
  }
}

const sidecars = [
  sidecar({ id: 'a', tier: 'long', importance: 4, scope: 'self', title: '长期甲' }),
  sidecar({ id: 'b', tier: 'working', scope: 'project', projectPath: 'L:\\DSH\\work', working: true, title: '项目乙' }),
  sidecar({ id: 'c', tier: 'event', evergreen: true, scope: 'global', title: '公共区丙' }),
  sidecar({ id: 'd', tier: 'event', importance: 4, scope: 'self', decay: 0.1, updatedAt: now - 200 * DAY, title: '淡了的丁' }),
  sidecar({ id: 'e', tier: 'event', archived: true, status: 'archived', title: '归档戊' }),
  sidecar({ id: 'f', tier: 'core', pinned: true, importance: 5, title: '固定己' }),
]

const base = {
  sidecars,
  now,
  maxOrbs: 300,
  budgetChars: 280,
  selfCheck: { mtime: now - 60_000 },
  indexFile: { mtime: now - 60_000, bytes: 4000 },
  snapshots: [{ id: 'snap1', at: new Date(now).toISOString() }],
  memoryErrors: 0,
  recallSource: 'memhub',
  lessons: 3,
  diary: 1,
  selfNotes: { active: 1, archived: 0 },
  graph: { entities: 2, edges: 3 },
}

const report = buildHealth(base)
ok(report.totals.total === 6 && report.totals.active === 5 && report.totals.archived === 1, '库存：总量 / 活跃 / 归档')
ok(report.byTier.long === 1 && report.byTier.working === 1 && report.byTier.core === 1, '分层计数')
ok(report.byScope.project === 1 && report.byScope.global === 1, '归属计数')
ok(report.totals.protected === 3, `protected：pinned/core + working + evergreen（实际 ${report.totals.protected}）`)
ok(report.totals.evictable === 2, `可淘汰 = 普通 self 条目（实际 ${report.totals.evictable}）`)
ok(report.governance.toArchive === 1, `可归档：只有淡了的丁（实际 ${report.governance.toArchive}）`)
ok(report.governance.dormant === 1, `休眠：只有淡了的丁（实际 ${report.governance.dormant}）`)
ok(report.injection.chars > 0 && report.injection.chars <= 280, `注入块在预算内（${report.injection.chars}/280）`)
ok(report.injection.items > 0, `注入条目数 > 0（${report.injection.items}）`)
ok(report.issues.every((issue) => issue.level !== SEVERE), '正常数据没有「严重」问题')

const severe = buildHealth({ ...base, memoryErrors: 2 })
ok(severe.issues.some((issue) => issue.level === SEVERE), 'memoryErrors > 0 → 严重')

const missing = buildHealth({ ...base, selfCheck: null })
ok(missing.issues.some((issue) => issue.level === SEVERE && issue.text.includes('self-check')), '没有 self-check → 严重（静默失败信号）')

const stale = buildHealth({ ...base, selfCheck: { mtime: now - 3 * DAY } })
ok(stale.issues.some((issue) => issue.level === WARN && issue.text.includes('小时')), 'self-check 超过 48h → 警告')

const oldIndex = buildHealth({ ...base, indexFile: { mtime: now - DAY, bytes: 1 } })
ok(oldIndex.issues.some((issue) => issue.text.includes('INDEX.md')), 'INDEX 明显旧于 self-check → 警告')

const freshIndex = buildHealth({ ...base, indexFile: { mtime: now - 30_000, bytes: 1 } })
ok(!freshIndex.issues.some((issue) => issue.text.includes('INDEX.md')), 'INDEX 比 self-check 晚几秒不误报')

const capped = buildHealth({ ...base, maxOrbs: 2 })
ok(capped.capacity.capped === true && capped.issues.some((issue) => issue.level === WARN), '上限低于 protected → capped + 警告')

const tight = buildHealth({ ...base, maxOrbs: 6 })
ok(tight.issues.some((issue) => issue.level === NOTE && issue.text.includes('余量')), '余量不足 → 提示')

const dupes = buildHealth({ ...base, duplicates: 2 })
ok(dupes.issues.some((issue) => issue.text.includes('疑似重复')), '有重复对 → 提示跑 janitor')

const emptyNotes = buildHealth({ ...base, selfNotes: { active: 0, archived: 0 } })
ok(emptyNotes.issues.some((issue) => issue.text.includes('self_note')), 'self_note 空 → 提示')

const artifactStale = buildHealth({ ...base, artifacts: { checked: 2, stale: 1, missing: 1 } })
ok(
  artifactStale.issues.filter((issue) => issue.text.includes('产物')).length === 2,
  '产物指纹：stale 与 missing 各出一条提示',
)
const supersededReport = buildHealth({
  ...base,
  sidecars: [...sidecars, sidecar({ id: 'g', tier: 'long', importance: 4, title: '被取代的', supersededBy: 'a' })],
})
ok(supersededReport.governance.superseded === 1, `取代计数（实际 ${supersededReport.governance.superseded}）`)

const markdown = renderHealthMarkdown(report)
ok(markdown.includes('# memhub 体检') && markdown.includes('## 库存') && markdown.includes('## 结论'), 'Markdown 结构完整')
ok(markdown.includes('2026-11-10 09:30'), `Markdown 用本地时间（${formatLocal(now)}）`)
ok(renderHealthMarkdown(stale).includes('**['), 'Markdown 把问题分级渲染')

console.log(`\n体检模块自测：${total - failures.length}/${total} 通过`)
if (failures.length > 0) {
  console.log(`失败项：${failures.join(' ｜ ')}`)
  process.exit(1)
}
