/**
 * 冒烟测试：用零依赖的假 DOM 跑一遍 client.js 的注入逻辑。
 * 目的不是模拟浏览器全部行为，而是盯住「卡片打开 → 花费/余额/今日三行出现」这条主链路，
 * 以及「官方卡片结构变了会不会静默失败」——CI 里跑，防止再出现 0.8.x 那种「线上根本没插入」的回归。
 *
 * 口径/定价/余额/性能/生命周期的回归用例在 regress.mjs。
 * 用法：node tools/smoke.mjs
 */
import { createHarness } from './harness.mjs'

// 固定时钟：2026-11-01 12:00 北京时间（周日 → 低谷价），让金额可断言
const NOW = Date.UTC(2026, 10, 1, 4, 0, 0)
const TODAY = '2026-11-01'
const YESTERDAY = '2026-10-31'

const h = createHarness({
  now: NOW,
  responses: {
    '/token-mb/summary': {
      ok: true,
      data: {
        // 分天聚合：token-mb 按每次调用实际峰谷/模型算好的当天金额（这里是权威口径）
        days: {
          [TODAY]: { cny: 3.2, calls: 264, hit: 47228032, miss: 147477, out: 188784 },
          [YESTERDAY]: { cny: 5.0, calls: 40, hit: 1000, miss: 200, out: 300 },
        },
        today: TODAY,
        meterSource: 'official',
        sessions: {
          // 昨天的会话：不应计入今日
          s0: { calls: 40, cny: 5.0, hit: 1000, miss: 200, out: 300, lastTime: NOW - 86400000, title: '昨天的会话', isSubagent: false },
          // 当前会话（标题与面包屑一致）
          s1: { calls: 264, cny: 1.85, hit: 47228032, miss: 147477, out: 188784, lastTime: NOW, title: '重启 DSH 验收插件', isSubagent: false },
          // 子代理会话：不参与
          s2: { calls: 9, cny: 0.42, hit: 100, miss: 100, out: 100, lastTime: NOW, title: '子代理', isSubagent: true },
        },
      },
    },
    '/token-mb/balance': {
      ok: true,
      data: {
        supported: true,
        ok: true,
        source: 'account',
        balance_infos: [{ currency: 'CNY', total_balance: '48.85' }],
        total_costs: [{ currency: 'CNY', amount: '57.20' }],
      },
    },
  },
})

h.addCrumb('重启 DSH 验收插件')
h.sessionCard()
h.load(new URL('../lib/client.js', import.meta.url))

const mod = h.module()
mod.apply({ slots: { inject() {}, register() { return () => {} } } })

// 等两轮微任务/定时，让 fetch 的 then 链跑完
await new Promise((r) => setTimeout(r, 50))
h.sync()

const dt = h.el('inline-cost-dt')
const dd = h.el('inline-cost-dd')
const tdt = h.el('inline-cost-today-dt')
const tdd = h.el('inline-cost-today-dd')
const bdt = h.el('inline-cost-balance-dt')
const bdd = h.el('inline-cost-balance-dd')
const dl = h.card.dl

const failures = []
const expect = (ok, message) => { if (!ok) failures.push(message) }

expect(dt && dt.textContent === '花费金额', '缺少「花费金额」行')
expect(dd && dd.textContent === '≈ ¥1.85', '花费金额应取 token-mb 记录 ¥1.85，实际：' + (dd && dd.textContent))
expect(dd && /官方记录/.test(dd.title), '花费金额的悬停提示应说明来源')
expect(tdt && tdt.textContent === '今日累计', '缺少「今日累计」行')
expect(tdd && tdd.textContent === '¥3.20',
  '今日累计应取 summary.days[今天].cny = ¥3.20（不是会话累计之和 ¥1.85 / ¥6.85），实际：' + (tdd && tdd.textContent))
expect(tdd && /2026-11-01/.test(tdd.title), '今日累计悬停提示应写明是哪一天（北京时间）')
expect(tdd && /平台用量接口/.test(tdd.title), '今日累计悬停提示应说明数据来源')
expect(bdt && bdt.textContent === '账户余额', '缺少「账户余额」行')
expect(bdd && bdd.textContent === '¥48.85', '账户余额应为 ¥48.85，实际：' + (bdd && bdd.textContent))
expect(bdd && /累计消费/.test(bdd.title), '余额悬停提示应带累计消费')
expect(dt && dt.parentNode === dl, '追加的节点应挂在官方 <dl> 里')

// 顺序：花费金额 → 今日累计 → 账户余额
const order = dl.children.map((c) => c.id).filter(Boolean)
const iCost = order.indexOf('inline-cost-dt')
const iToday = order.indexOf('inline-cost-today-dt')
const iBal = order.indexOf('inline-cost-balance-dt')
expect(iCost >= 0 && iToday > iCost && iBal > iToday, '三行顺序应为 花费金额 → 今日累计 → 账户余额，实际：' + order.join(','))
expect(h.window.__inlineCostStatus && h.window.__inlineCostStatus.row === true, '定位状态应标记已插入')
expect(h.window.__inlineCostStatus && h.window.__inlineCostStatus.balance === true, '定位状态应标记余额可用')

// 关掉卡片（模拟 portal 卸载）→ 重新同步，不应报错、行应消失
h.closeCard()
h.sync()
expect(!h.el('inline-cost-dt'), '节点应随卡片一起消失')
expect(h.window.__inlineCostStatus && h.window.__inlineCostStatus.card === false, '定位状态应记录卡片已关闭')

if (failures.length) {
  console.error('SMOKE FAILED:')
  failures.forEach((f) => console.error('  - ' + f))
  process.exit(1)
}
console.log('smoke OK: 花费金额 ≈¥1.85 / 今日累计 ¥3.20（分天口径，昨天与子代理不计）/ 账户余额 ¥48.85；三行顺序正确，节点挂在官方 <dl> 内，卡片关闭后状态与节点都收回')
process.exit(0)
