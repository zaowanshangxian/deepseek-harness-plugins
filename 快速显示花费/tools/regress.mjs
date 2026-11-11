/**
 * 回归用例：把「已修的三条 high + 几条 medium」变成可重跑的断言。
 *
 * 每条用例都对应一个**具体错法**，所以它的价值在于「对着修之前的代码会红」——
 * 想验证这一点就把旧文件喂进来：
 *
 *     git show HEAD:快速显示花费/lib/client.js > /tmp/old-client.js
 *     INLINE_COST_CLIENT=/tmp/old-client.js node tools/regress.mjs     # 预期：多条 FAILED
 *     node tools/regress.mjs                                          # 预期：regress OK
 *
 * 用法：node tools/regress.mjs
 */
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createHarness } from './harness.mjs'

const CLIENT = process.env.INLINE_COST_CLIENT
  ? pathToFileURL(resolve(process.env.INLINE_COST_CLIENT))
  : new URL('../lib/client.js', import.meta.url)

const NOW = Date.UTC(2026, 10, 1, 4, 0, 0) // 2026-11-01 12:00 北京时间（周日 → 低谷价）
const TODAY = '2026-11-01'
const YESTERDAY = '2026-10-31'

const failures = []
function check(group, ok, message) {
  if (!ok) failures.push('[' + group + '] ' + message)
}

const plainCtx = () => ({ slots: { inject() {}, register() { return () => {} } } })

/** 调 mod.__internals 里的纯函数；修之前的版本没有这个窗口 → 返回 undefined（用例会红，正是我们要的） */
function callApi(mod, name, ...args) {
  const api = mod.__internals
  if (!api || typeof api[name] !== 'function') return undefined
  return api[name](...args)
}

async function mount({ responses = {}, now = NOW, build = () => {}, makeCtx = plainCtx } = {}) {
  const h = createHarness({ now, responses })
  build(h)
  h.load(CLIENT)
  const mod = h.module()
  const ctx = makeCtx()
  mod.apply(ctx)
  await new Promise((r) => setTimeout(r, 30))
  h.sync()
  return { h, mod, ctx }
}

const balanceOk = {
  ok: true,
  data: { supported: true, ok: true, source: 'account', balance_infos: [{ currency: 'CNY', total_balance: '48.85' }], total_costs: [{ currency: 'CNY', amount: '57.20' }] },
}
const balanceDisabled = { ok: true, data: { supported: false, reason: 'disabled' } }

const titleSession = { calls: 264, cny: 1.85, hit: 47228032, miss: 147477, out: 188784, lastTime: NOW, title: '重启 DSH 验收插件', isSubagent: false }
const olderSession = { calls: 40, cny: 5.0, hit: 1000, miss: 200, out: 300, lastTime: NOW - 86400000, title: '昨天的会话', isSubagent: false }

// ── 用例 1：high 1「今日累计」不能拿会话累计冒充当天花费 ──────────────────
{
  const { h, mod } = await mount({
    responses: {
      '/token-mb/summary': {
        ok: true,
        data: {
          today: TODAY,
          meterSource: 'official',
          days: { [TODAY]: { cny: 3.2, calls: 264, hit: 1, miss: 2, out: 3 }, [YESTERDAY]: { cny: 5 } },
          sessions: { s1: titleSession, s0: olderSession },
        },
      },
      '/token-mb/balance': balanceOk,
    },
    build: (x) => { x.addCrumb('重启 DSH 验收插件'); x.sessionCard() },
  })
  const tdd = h.el('inline-cost-today-dd')
  const tdt = h.el('inline-cost-today-dt')
  check('high1', tdt && tdt.textContent === '今日累计', '有分天数据时应叫「今日累计」，实际：' + (tdt && tdt.textContent))
  check('high1', tdd && tdd.textContent === '¥3.20',
    '今日累计应等于 summary.days[今天].cny = ¥3.20；若得到 ¥1.85 / ¥6.85 就是拿会话累计冒充当天花费，实际：' + (tdd && tdd.textContent))
  check('high1', tdd && /2026-11-01/.test(tdd.title), '悬停应写明是哪一天（北京时间）')

  // 纯函数口径：有 days 走 days，没有 days 时标成 source='sessions'（不许叫「今日累计」）
  const withDays = callApi(mod, 'todayTotal', { data: { today: TODAY, days: { [TODAY]: { cny: 3.2, calls: 9 } }, sessions: { s1: titleSession } } })
  check('high1', withDays && withDays.source === 'days' && withDays.cny === 3.2, 'todayTotal 应优先用分天聚合，实际：' + JSON.stringify(withDays))
  const noDays = callApi(mod, 'todayTotal', { data: { sessions: { s1: titleSession, s0: olderSession } } })
  check('high1', noDays && noDays.source === 'sessions' && noDays.cny === 1.85,
    '没有分天数据时应标 source=sessions 且只含今天有写入的会话，实际：' + JSON.stringify(noDays))
}

// ── 用例 2：high 1 的降级形态 —— 没有分天数据时文案必须改口 ────────────────
{
  const { h } = await mount({
    responses: {
      '/token-mb/summary': { ok: true, data: { sessions: { s1: titleSession, s0: olderSession } } },
      '/token-mb/balance': balanceOk,
    },
    build: (x) => { x.addCrumb('重启 DSH 验收插件'); x.sessionCard() },
  })
  const tdt = h.el('inline-cost-today-dt')
  const tdd = h.el('inline-cost-today-dd')
  check('high1-fallback', tdt && tdt.textContent === '涉及会话累计',
    '没有分天数据时不能叫「今日累计」，应叫「涉及会话累计」，实际：' + (tdt && tdt.textContent))
  check('high1-fallback', tdd && tdd.textContent === '¥1.85', '降级值应是今天有写入的会话累计之和 ¥1.85，实际：' + (tdd && tdd.textContent))
  check('high1-fallback', tdd && /不等于今天花了多少/.test(tdd.title), '降级的悬停必须写明「不等于今天花了多少」')
}

// ── 用例 2b：有分天数据但今天这一桶是空的 → 今天没花钱，不许退回会话累计凑数 ──
{
  const { h } = await mount({
    responses: {
      '/token-mb/summary': {
        ok: true,
        data: { today: TODAY, days: { [YESTERDAY]: { cny: 5 } }, sessions: { s1: titleSession } },
      },
      '/token-mb/balance': balanceOk,
    },
    build: (x) => { x.addCrumb('重启 DSH 验收插件'); x.sessionCard() },
  })
  check('high1-empty-day', !h.el('inline-cost-today-dt'),
    '分天数据里今天没有桶时应不显示今日行（也不许退回「涉及会话累计」），实际：' + (h.el('inline-cost-today-dt') || {}).textContent)
}

// ── 用例 3：high 2 上游关了 showBalance 时不能画出一行「账户余额 —」─────────
{
  const { h, mod } = await mount({
    responses: { '/token-mb/summary': { ok: true, data: { sessions: { s1: titleSession } } }, '/token-mb/balance': balanceDisabled },
    build: (x) => { x.addCrumb('重启 DSH 验收插件'); x.sessionCard() },
  })
  check('high2', !h.el('inline-cost-balance-dt') && !h.el('inline-cost-balance-dd'),
    'supported:false（showBalance 关闭）时不应渲染余额行')
  check('high2', h.window.__inlineCostStatus && h.window.__inlineCostStatus.balance === false, '定位状态应记录余额不可用')
  const parsed = callApi(mod, 'balanceOf', balanceDisabled)
  check('high2', parsed && parsed.disabled === true, 'balanceOf 仍应返回 {disabled:true}（配置页要靠它区分「被上游关闭」）')
  // 有余额时这条排查用：确认不是「全都画不出来」
  check('high2', (callApi(mod, 'balanceOf', balanceOk) || {}).balance === 48.85, '正常余额解析不应被改坏')
}

// ── 用例 4：high 3 单轮卡片要按「提供方 / 模型」选价格档 ──────────────────
{
  const { h, mod } = await mount({
    responses: { '/token-mb/balance': balanceOk },
    build: (x) => x.turnCard({ model: 'deepseek-account/deepseek-v4-pro' }),
  })
  const dd = h.el('inline-cost-dd')
  // 低谷 pro 价：0.15 + 4.5 + 13.5 = 18.15（flash 只会是 5.02）
  check('high3', dd && dd.textContent === '≈ ¥18.15',
    'v4-pro 一轮各 1M tok 应估 ¥18.15；若得到 ¥5.02 就是全套 flash 价，实际：' + (dd && dd.textContent))
  check('high3', dd && /deepseek-v4-pro/.test(dd.title), '悬停应写明用的是哪一档价目')
  check('high3', callApi(mod, 'priceTierOf', 'deepseek-v4-pro') === 'pro', 'priceTierOf(v4-pro) 应为 pro')
  check('high3', callApi(mod, 'priceTierOf', 'deepseek-v4-flash') === 'flash', 'priceTierOf(v4-flash) 应为 flash')
  check('high3', callApi(mod, 'priceTierOf', 'some-other-model') === null, '认不出的模型应返回 null，不许静默当 flash')
}

// ── 用例 5：high 3 的边界 —— 认不出型号时必须标注「按 flash 估算」─────────
{
  const { h } = await mount({
    responses: { '/token-mb/balance': balanceOk },
    build: (x) => x.turnCard({ model: 'deepseek-account/deepseek-v9-unknown' }),
  })
  const dd = h.el('inline-cost-dd')
  check('high3-unknown', dd && dd.textContent === '≈ ¥5.02', '认不出型号时按 flash 价算，实际：' + (dd && dd.textContent))
  check('high3-unknown', dd && /按 flash 价估算/.test(dd.title), '认不出型号时悬停必须写明「按 flash 价估算」，不能假装知道')
}

// ── 用例 6：medium 5 —— 记录里没有金额时不许出现「≈ —」───────────────────
{
  const noCny = { calls: 264, cny: null, hit: 1, miss: 2, out: 3, lastTime: NOW, title: '重启 DSH 验收插件', isSubagent: false }
  const { h } = await mount({
    responses: { '/token-mb/summary': { ok: true, data: { sessions: { s1: noCny } } }, '/token-mb/balance': balanceOk },
    build: (x) => { x.addCrumb('重启 DSH 验收插件'); x.sessionCard() },
  })
  const dd = h.el('inline-cost-dd')
  check('medium5', dd && dd.textContent !== '≈ —', '没有 cny 的记录不能渲染成「≈ —」，实际：' + (dd && dd.textContent))
  check('medium5', dd && /^≈ ¥[0-9]/.test(dd.textContent), '应退回按卡片数字估算，实际：' + (dd && dd.textContent))
}

// ── 用例 7：medium 6 —— 缓存写入不计费（官方价目表没有这一档）────────────
{
  const { h } = await mount({
    responses: { '/token-mb/balance': balanceOk },
    build: (x) => x.turnCard({
      model: 'deepseek-account/deepseek-flash',
      rows: [['缓存命中', '0%'], ['未缓存输入', '0 tok'], ['缓存读取', '0 tok'], ['缓存写入', '1,000,000 tok'], ['输出', '0 tok']],
    }),
  })
  const dd = h.el('inline-cost-dd')
  check('medium6', dd && dd.textContent === '≈ ¥0.00',
    '只有缓存写入时不该产生金额（之前按未缓存输入价算成 ¥1.00），实际：' + (dd && dd.textContent))
  check('medium6', dd && /缓存写入/.test(dd.title) && /不计费/.test(dd.title), '悬停应说明缓存写入不计费')
}

// ── 用例 8：medium 4 —— 卡片关着时不许每次 sync 都扫全文档 ───────────────
{
  const { h } = await mount({ responses: {}, build: () => {} })
  h.counts.fullScans = 0
  for (let i = 0; i < 5; i += 1) h.sync()
  check('medium4', h.counts.fullScans === 0,
    '卡片关着时 5 次 sync 不应发生任何全文档遍历（querySelectorAll("*")），实际：' + h.counts.fullScans + ' 次')
}

// ── 用例 9：medium 4 的保险 —— 页面里确实有 dialog 时，慢路径仍会兜底扫描 shadow DOM ──
// 前提说明：官方用量卡片是 createPortal(document.body)（见 DSH 的 TurnUsagePanel / stats dialog），
// 不在 shadow DOM 里；慢路径是给「万一将来进了 web component」留的。这里连同限制一起测。
{
  const { h, dl } = mountShadow()
  h.counts.fullScans = 0
  h.sync()
  check('medium4-guard', h.counts.fullScans > 0, '页面存在 dialog 时慢路径仍应兜底扫描（不能把 shadow DOM 兜底砍掉）')
  // 注意：只断言「扫到了并插进那个 <dl>」。节点回收走 document.getElementById，穿不透 shadowRoot ——
  // 这是已知限制（官方卡片是 createPortal(document.body)，不在 shadow DOM 里），写进了 docs/DESIGN.md。
  const ids = dl.children.map((c) => c.id).filter(Boolean)
  check('medium4-guard', ids.includes('inline-cost-dt'), 'shadow DOM 里的卡片经慢路径应能插入花费行，实际：' + ids.join(','))
}

function mountShadow() {
  const h = createHarness({ now: NOW, responses: { '/token-mb/balance': balanceOk, '/token-mb/summary': { ok: true, data: { sessions: { s1: titleSession } } } } })
  // 一个不相干的 light DOM dialog（扮演「页面上确实有 dialog」这个信号）
  const decoy = new h.El('div')
  decoy.setAttribute('role', 'dialog')
  decoy.setAttribute('aria-label', '设置')
  h.body.appendChild(decoy)
  // 真正的卡片藏在 shadowRoot 里：querySelector 快路径命中不到，只能靠慢路径
  const host = new h.El('div')
  const shadow = new h.El('shadow-root')
  const dialog = new h.El('div')
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-label', 'Token 用量')
  const dl = new h.El('dl')
  for (const [label, value] of [['未缓存输入', '1,000,000 tok'], ['缓存读取', '0 tok'], ['输出', '0 tok']]) {
    const dt = new h.El('dt')
    dt.textContent = label
    const dd = new h.El('dd')
    dd.textContent = value
    dl.appendChild(dt)
    dl.appendChild(dd)
  }
  dialog.appendChild(dl)
  shadow.appendChild(dialog)
  host.shadowRoot = shadow
  h.body.appendChild(host)
  h.load(CLIENT)
  h.module().apply(plainCtx())
  return { h, dl }
}

// ── 用例 10：medium 7 —— 运行时挂在 ctx.effect 上，卸载时全部收回 ──────────
{
  const disposers = []
  const ctx = {
    slots: { inject() {}, register() { return () => {} } },
    effect(fn, label) {
      check('medium7', typeof label === 'string' && label.length > 0, 'ctx.effect 应带一个可读的标签')
      const dispose = fn()
      check('medium7', typeof dispose === 'function', 'ctx.effect 的回调必须返回清理函数')
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
  }
  const { h } = await mount({
    responses: { '/token-mb/summary': { ok: true, data: { sessions: { s1: titleSession } } }, '/token-mb/balance': balanceOk },
    build: (x) => { x.addCrumb('重启 DSH 验收插件'); x.sessionCard() },
    makeCtx: () => ctx,
  })
  check('medium7', disposers.length === 1, 'apply 应把运行时注册到 ctx.effect 上')
  check('medium7', h.counts.interval === 2, '应装 2 个定时器（60s 预热刷新 + 1.5s 同步），实际：' + h.counts.interval)
  check('medium7', h.counts.observed === 1, '应装 1 个 MutationObserver')
  check('medium7', h.listeners() === 3, '应挂 3 个 document 监听，实际：' + h.listeners())
  check('medium7', h.el('inline-cost-dt'), '挂载后行应已插入')

  for (const dispose of disposers) dispose()
  check('medium7', h.counts.cleared === 2, '卸载应 clearInterval 两个定时器，实际：' + h.counts.cleared)
  check('medium7', h.liveIntervals() === 0, '卸载后不应有存活的定时器，实际：' + h.liveIntervals())
  check('medium7', h.counts.disconnected === 1, '卸载应 disconnect observer')
  check('medium7', h.counts.unlistened === 3, '卸载应摘掉 3 个 document 监听，实际：' + h.counts.unlistened)
  check('medium7', h.listeners() === 0, '卸载后 document 上不应还有本插件的监听')
  check('medium7', !h.el('inline-cost-dt'), '卸载后应把追加的行收回')
  check('medium7', h.globals().sync === 'undefined' && h.globals().resync === 'undefined', '卸载后 window 上的诊断入口应删掉')
}

// ── 用例 11：纯函数口径（时钟 / 日期键 / 分档）───────────────────────────
{
  const { mod } = await mount({ responses: {} })
  check('units', callApi(mod, 'cstDayKey', NOW) === TODAY, '北京时间日期键应为 ' + TODAY + '，实际：' + callApi(mod, 'cstDayKey', NOW))
  check('units', callApi(mod, 'isPeak', NOW) === false, '周日的 12:00 应为低谷价')
  check('units', callApi(mod, 'isPeak', Date.UTC(2026, 10, 2, 2, 0, 0)) === true, '周一 10:00 北京时间应为高峰价')
  check('units', callApi(mod, 'money', Number.NaN) === '—' && callApi(mod, 'money', 3.2) === '¥3.20', 'money() 的行为不应改变')
  check('units', JSON.stringify(mod.inject) === '["slots"]', 'exports.inject 仍是 cordis 服务名 [\'slots\']')
}

if (failures.length) {
  console.error('REGRESS FAILED (' + failures.length + '):')
  failures.forEach((f) => console.error('  - ' + f))
  process.exit(1)
}
console.log('regress OK: 今日口径（分天数据 + 降级改口）/ 余额禁用 / 模型分档定价 / 无金额不显示 — / 缓存写入不计费 / 卡片关着不扫文档 / effect 生命周期回收 / 纯函数口径')
process.exit(0)
