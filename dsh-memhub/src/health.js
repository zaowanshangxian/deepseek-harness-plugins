/**
 * dsh-memhub · 体检（纯函数）：只读现有数据，算库存 / 分层 / 注入成本 / 治理余量 / 异常。
 *
 * 为什么单独成模块：旧的 `memory_audit.py` 读的是 `~/.dsh/storages/memory`（zzerx 旧库），
 * 迁移后每天 23:10 还在量一个**已经停用的库**，对 memhub 完全失明。
 * 这里只吃调用方传进来的数据，不碰盘，方便单测与换源。
 *
 * 判据（都能从数据现算，不写死）：
 *  - `memoryErrors > 0` / 没有 self-check → 严重（静默失败的唯一信号就是产物缺失）
 *  - self-check 超过 48h 没更新 → 警告（宿主可能没重启或插件没加载）
 *  - 有可归档条目 / 有重复对 → 提示跑 `tools/janitor.mjs`
 *  - `capped`（protected 占满上限）→ 警告，上限达不到
 *  - 注入预算用掉 ≥90% → 提示
 *  - 休眠占比 ≥40% → 提示（淡了的太多，检索命中会变差）
 */
import { isDormant } from './recall-store.js'
import { planGovernance } from './govern.js'
import { planJanitor, isProtected } from './janitor.js'
import { buildRecallBlock, DEFAULT_BUDGET_CHARS } from './recall-scheduler.js'

export const SELF_CHECK_STALE_MS = 48 * 3_600_000
/** INDEX.md 和 self-check 是同一次自检里先后写的，差几毫秒是正常的；超过这个才算没生成。 */
export const INDEX_LAG_TOLERANCE_MS = 5 * 60_000
export const SEVERE = '严重'
export const WARN = '警告'
export const NOTE = '提示'

function countBy(items, keyOf) {
  const acc = {}
  for (const item of items) {
    const key = keyOf(item) || '未知'
    acc[key] = (acc[key] || 0) + 1
  }
  return acc
}

/**
 * @param {{
 *   sidecars: object[], now?: number, maxOrbs?: number, budgetChars?: number, workspace?: string,
 *   skills?: number|null, memoryErrors?: number, recallSource?: string,
 *   selfCheck?: {mtime:number}|null, indexFile?: {mtime:number, bytes:number}|null,
 *   snapshots?: object[], duplicates?: number|null,
 *   lessons?: number, diary?: number, selfNotes?: {active:number, archived:number},
 *   graph?: {entities:number, edges:number},
 *   artifacts?: {checked:number, stale:number, missing:number},
 * }} input
 */
export function buildHealth(input = {}) {
  const sidecars = Array.isArray(input.sidecars) ? input.sidecars : []
  const now = Number(input.now) || Date.now()
  const maxOrbs = Number(input.maxOrbs) > 0 ? Number(input.maxOrbs) : 300
  const budgetChars = Number(input.budgetChars) > 0 ? Number(input.budgetChars) : DEFAULT_BUDGET_CHARS
  const active = sidecars.filter((item) => !item.archived && item.status !== 'archived')
  const archived = sidecars.filter((item) => item.archived || item.status === 'archived')
  const plan = planJanitor(sidecars, { maxOrbs, dedupe: false })
  const governance = planGovernance(sidecars, now)
  const toArchive = governance.filter((item) => item.action === 'archive').length
  const dormant = active.filter((item) => isDormant(item, now)).length
  const block = buildRecallBlock(sidecars, { budgetChars, workspace: input.workspace || '', now })
  const injectionChars = block.text ? block.text.length : 0
  const injectionItems = Array.isArray(block.picked) ? block.picked.length : 0
  const issues = []

  const push = (level, text) => issues.push({ level, text })

  if (Number(input.memoryErrors) > 0) push(SEVERE, `加载记忆有 ${input.memoryErrors} 个错误（先修 orb/frontmatter）`)
  if (!input.selfCheck) push(SEVERE, '没有 self-check.json：插件可能没加载（静默失败只看产物）')
  else if (now - Number(input.selfCheck.mtime || 0) > SELF_CHECK_STALE_MS) {
    const hours = Math.round((now - Number(input.selfCheck.mtime)) / 3_600_000)
    push(WARN, `self-check.json 已 ${hours} 小时没更新：宿主可能没重启，或插件没加载`)
  }
  if (input.recallSource && input.recallSource !== 'memhub') {
    push(WARN, `recall.source 还是 ${input.recallSource}（没切到 memhub）`)
  }
  if (
    input.indexFile &&
    input.selfCheck &&
    Number(input.selfCheck.mtime) - Number(input.indexFile.mtime) > INDEX_LAG_TOLERANCE_MS
  ) {
    push(WARN, 'INDEX.md 比 self-check 旧：索引没生成成功（注入里的分类目录会过期）')
  }
  if (toArchive > 0) push(NOTE, `有 ${toArchive} 条已过衰减阈值，可跑 \`node tools/janitor.mjs --apply\` 归档`)
  if (plan.capped) push(WARN, `capped：上限 ${maxOrbs} 达不到（protected ${active.length - plan.evictable} 条不参与淘汰）`)
  const headroom = maxOrbs - active.length
  if (headroom <= Math.max(5, Math.round(maxOrbs * 0.1))) {
    push(NOTE, `容量余量 ${headroom} 条（上限 ${maxOrbs}），快满了`)
  }
  if (active.length > 0 && dormant / active.length >= 0.4) {
    push(NOTE, `${dormant}/${active.length} 条休眠（淡了且近期没想起），注入会变少；必要时用 memhub_open 唤醒`)
  }
  if (budgetChars > 0 && injectionChars >= budgetChars * 0.9) {
    push(NOTE, `注入预算用到 ${injectionChars}/${budgetChars} 字符（≥90%），再涨会开始截行`)
  }
  if (input.duplicates === 0) push(NOTE, '没有达到阈值的重复条目（去重不用做）')
  if (Number(input.duplicates) > 0) push(NOTE, `有 ${input.duplicates} 对疑似重复，可跑 \`node tools/janitor.mjs --apply\``)
  if (!Array.isArray(input.snapshots) || input.snapshots.length === 0) {
    push(NOTE, '还没有维护快照（第一次 `janitor --apply` 前会自动建）')
  }
  if (Number(input.artifacts?.stale) > 0) {
    push(NOTE, `${input.artifacts.stale} 条记忆引用的产物文件已被外部修改（指纹不符），引用前先核对`)
  }
  if (Number(input.artifacts?.missing) > 0) {
    push(NOTE, `${input.artifacts.missing} 条记忆引用的产物文件找不到了`)
  }
  if (input.selfNotes && Number(input.selfNotes.active) === 0) {
    push(NOTE, 'self_note 还是空的：人格漂移没有「自我叙述」兜底')
  }

  return {
    at: new Date(now).toISOString(),
    localTime: formatLocal(now),
    totals: {
      total: sidecars.length,
      active: active.length,
      archived: archived.length,
      protected: active.filter((item) => isProtected(item)).length,
      evictable: plan.evictable,
    },
    byTier: countBy(sidecars, (item) => item.tier),
    byScope: countBy(sidecars, (item) => item.scope),
    capacity: {
      maxOrbs,
      headroom,
      overflow: plan.overflow,
      capped: plan.capped,
    },
    governance: {
      toArchive,
      dormant,
      superseded: active.filter((item) => item.supersededBy).length,
      archivedRatio: sidecars.length ? archived.length / sidecars.length : 0,
    },
    artifacts: input.artifacts || null,
    injection: { chars: injectionChars, budget: budgetChars, items: injectionItems },
    duplicates: input.duplicates ?? null,
    skills: input.skills ?? null,
    snapshots: input.snapshots || [],
    lessons: input.lessons ?? null,
    diary: input.diary ?? null,
    selfNotes: input.selfNotes || null,
    graph: input.graph || null,
    indexFile: input.indexFile || null,
    selfCheck: input.selfCheck || null,
    issues,
  }
}

/** 本地时间 `YYYY-MM-DD HH:mm`（ISO 是 UTC，直接切片会差 8 小时）。 */
export function formatLocal(now) {
  const date = new Date(now)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 渲染成 Markdown（给每天 23:10 的报表和人工看）。 */
export function renderHealthMarkdown(report) {
  const lines = []
  const pct = (value) => (report.injection.budget ? Math.round((value / report.injection.budget) * 100) : 0)
  lines.push(`# memhub 体检 · ${report.localTime || formatLocal(Date.parse(report.at))}`)
  lines.push('')
  lines.push('## 库存')
  lines.push('| 项 | 值 |')
  lines.push('|---|---|')
  lines.push(`| 记忆总数 | ${report.totals.total} |`)
  lines.push(`| 活跃 / 归档 | ${report.totals.active} / ${report.totals.archived} |`)
  lines.push(`| protected（不参与淘汰） | ${report.totals.protected} |`)
  lines.push(`| 可淘汰 | ${report.totals.evictable} |`)
  lines.push(`| 技能 | ${report.skills ?? '未读'} |`)
  lines.push('')
  lines.push('## 分层 / 归属')
  lines.push(`- 分层：${Object.entries(report.byTier).map(([k, v]) => `${k} ${v}`).join(' · ') || '无'}`)
  lines.push(`- 归属：${Object.entries(report.byScope).map(([k, v]) => `${k} ${v}`).join(' · ') || '无'}`)
  lines.push('')
  lines.push('## 注入成本')
  lines.push(`- 记忆块：${report.injection.chars}/${report.injection.budget} 字符（${pct(report.injection.chars)}%，${report.injection.items} 条）`)
  lines.push('')
  lines.push('## 治理')
  lines.push(`- 容量：活跃 ${report.totals.active} / 上限 ${report.capacity.maxOrbs}（余量 ${report.capacity.headroom}）${report.capacity.capped ? '，**capped**' : ''}`)
  lines.push(`- 可归档（衰减 < 0.2）：${report.governance.toArchive}`)
  lines.push(`- 休眠（不注入）：${report.governance.dormant}`)
  lines.push(`- 已被取代（检索降权/不注入）：${report.governance.superseded}`)
  if (report.artifacts) {
    lines.push(`- 产物指纹：校验 ${report.artifacts.checked} 条｜外部修改 ${report.artifacts.stale} 条｜文件缺失 ${report.artifacts.missing} 条`)
  }
  lines.push(`- 重复对：${report.duplicates === null ? '未算（加 --dupes）' : report.duplicates}`)
  lines.push(`- 快照：${report.snapshots.length}${report.snapshots.length ? `（最新 ${report.snapshots[report.snapshots.length - 1].id}）` : ''}`)
  lines.push('')
  lines.push('## 其它数据')
  lines.push(`- 教训：${report.lessons ?? '未读'} ｜ 日记：${report.diary ?? '未读'} 篇`)
  lines.push(`- 自我叙述：${report.selfNotes ? `${report.selfNotes.active} 段活跃 / ${report.selfNotes.archived} 段归档` : '未读'}`)
  lines.push(`- 实体图：${report.graph ? `${report.graph.entities} 实体 / ${report.graph.edges} 边` : '未读'}`)
  lines.push('')
  lines.push('## 结论')
  if (report.issues.length === 0) {
    lines.push('- 没发现异常。')
  } else {
    for (const issue of report.issues) lines.push(`- **[${issue.level}]** ${issue.text}`)
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}
