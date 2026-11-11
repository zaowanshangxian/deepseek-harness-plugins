/**
 * 情绪安全阀自测（hermetic）：node tests/safety.mjs
 * 覆盖：加水权重 / 漏水幂等 / 四个 level 边界 / 自伤直接 crisis /
 *       不泄露原文 / 坏 json 不崩 / 并发写不丢 / events 上限 / 水槽封顶 /
 *       baseline 偏移 / 只读模式不落盘 / 别名与未知类型。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  addSignal,
  addSignals,
  checkText,
  decay,
  detect,
  emptyState,
  levelOf,
  loadSafetyState,
  MAX_WATER,
  saveSafetyState,
  safetySummary,
  statePath,
  totalWater,
  KINDS,
} from '../src/safety.js'

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

/** 每个断言组用独立的临时根，互不影响；跑完统一清掉。 */
const roots = []
function freshRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memhub-safety-'))
  roots.push(root)
  return root
}
/** 抓 console.warn（验证 M-5 的告警真的发出去了）。 */
function captureWarn(fn) {
  const warns = []
  const original = console.warn
  console.warn = (...args) => warns.push(args.join(' '))
  try {
    return { value: fn(), warns }
  } finally {
    console.warn = original
  }
}

const base = Date.parse('2026-11-11T15:00:00+08:00')

// ---------------------------------------------------------------- 加水 / 权重
{
  const root = freshRoot()
  const r1 = addSignal('abuse', root, base)
  ok(r1.water === 3 && KINDS.abuse.weight === 3, '加水：辱骂 = 3')
  const r2 = addSignal('negation', root, base)
  ok(r2.water === 5, '加水：连续否定 = 2（累计 5）')
  const r3 = addSignal('negative', root, base) // 别名 → other
  ok(r3.water === 6 && r3.kinds[0] === 'other', '加水：其他负面 = 1，且 negative 别名收敛到 other')
  const state = loadSafetyState(root, base)
  ok(state.events.length === 3 && state.events[2].weight === 1, '事件流：三次加水各记一条，带权重')
  const r4 = addSignals(['crisis', 'abuse'], root, base)
  ok(r4.water === 14 && r4.level === 'crisis', '一次命中多类：crisis + abuse = 8，级别被 crisis 顶住')
}

// ---------------------------------------------------------------- 漏水
{
  const state = { water: 10, lastDecayAt: base, events: [], baseline: 0 }
  const five = decay(state, base + 5 * 60000)
  ok(Math.abs(five.water - 6) < 1e-9, '漏水：5 分钟漏 4.0（0.8/分钟）')
  const twiceA = decay(state, base + 5 * 60000)
  const twiceB = decay(twiceA, base + 5 * 60000)
  ok(twiceB.water === twiceA.water && twiceB.lastDecayAt === twiceA.lastDecayAt, '漏水幂等：同一 now 重复算不重复乘')
  const partial = decay(state, base + 30000)
  ok(partial.water === 10 && partial.lastDecayAt === base, '漏水：不满一分钟不动，余数留在 lastDecayAt')
  const floor = decay({ water: 1, lastDecayAt: base, events: [], baseline: 0 }, base + 10 * 60000)
  ok(floor.water === 0, '漏水：漏到 0 就停，不出现负数')
}

// ---------------------------------------------------------------- 分级边界
ok(levelOf(0) === 'ok' && levelOf(24.99) === 'ok', '等级：<25 = ok')
ok(levelOf(25) === 'soft' && levelOf(59.99) === 'soft', '等级：25–60 = soft')
ok(levelOf(60) === 'ask' && levelOf(94.99) === 'ask', '等级：60–95 = ask')
ok(levelOf(95) === 'stop' && levelOf(100) === 'stop', '等级：>=95 = stop')

// ---------------------------------------------------------------- 自伤直接 crisis
{
  const root = freshRoot()
  const r = checkText({ text: '我真的不想活了', root, now: base })
  ok(r.level === 'crisis' && r.water === 5, '自伤：水槽 0 也直接 crisis（不看 water）')
  ok(r.advice.includes('转人工') && r.advice.includes('别一个人扛'), '自伤：返回转人工建议')
  const high = loadSafetyState(root, base)
  ok(high.water === 5 && high.events[0].type === 'crisis', '自伤：同样记进事件流（type=crisis）')
  const farewell = detect('以后不会再来烦你了')
  ok(farewell.crisis, '自伤/告别式：告别式表述也命中 crisis')
}

// ---------------------------------------------------------------- 不泄露原文（分桶覆盖）
{
  const root = freshRoot()
  // 每个桶都验一遍：返回里只能出现「类别标签」，不能出现原话片段
  const cases = [
    { text: '你这个废物', leak: '废物' },
    { text: '你又错了，总是这样', leak: '又错' },
    { text: '我明天就不想活了', leak: '不想活' },
    { text: '今天累死了，难受', leak: '难受' },
  ]
  for (const item of cases) {
    const r = checkText({ text: item.text, root, now: base })
    const dump = `${safetySummary(r)}\n${JSON.stringify(r)}`
    ok(!dump.includes(item.leak), `不泄露：${item.leak} 不出现在摘要/返回结构里`)
  }
  const reasons = detect('你这个废物，我明天就不想活了').reasons
  ok(
    reasons.length === 2 && reasons.every((label) => Object.values(KINDS).some((kind) => kind.label === label)),
    '命中原因：只可能是类别标签（辱骂、自伤/告别式表述）',
  )
}

// ---------------------------------------------------------------- 坏状态不崩 + M-5 抢救
{
  const root = freshRoot()
  fs.mkdirSync(path.dirname(statePath(root)), { recursive: true })
  fs.writeFileSync(statePath(root), '{ 这不是 json ', 'utf8')
  const loaded = loadSafetyState(root, base)
  ok(loaded.water === 0 && loaded.events.length === 0, '坏 json：读回落空状态，不抛')
  const after = addSignal('abuse', root, base)
  ok(after.water === 3 && JSON.parse(fs.readFileSync(statePath(root), 'utf8')).water === 3, '坏 json：被新状态原子覆盖')
  const missing = freshRoot()
  ok(loadSafetyState(missing, base).water === 0, '文件不存在：回落空状态')
  const weird = checkText({ text: 12345, root, now: base })
  ok(weird.level === 'ok', '非字符串入参：不崩')
}

// 复审判据 M-5：以前坏 json 静默回落 0，下一次写入把旧水位无声清零（实测 8.0→3.0）
{
  const root = freshRoot()
  fs.mkdirSync(path.dirname(statePath(root)), { recursive: true })
  // 写一半断电的样子：字段还在，JSON 断了
  fs.writeFileSync(
    statePath(root),
    `{ "water": 8, "lastDecayAt": ${base - 120000}, "events": [`,
    'utf8',
  )
  const { value: loaded, warns } = captureWarn(() => loadSafetyState(root, base))
  ok(loaded.water === 8, 'M-5：坏 json 里能抢救的水位不丢（8 不会被静默清零）')
  ok(loaded.lastDecayAt === base - 120000, 'M-5：抢救时保留 lastDecayAt（不重算已漏周期）')
  ok(warns.some((line) => line.includes('safety') && line.includes('抢救')), 'M-5：坏 json 打一条 warn（console.warn，宿主可见）')
  const merged = addSignal('other', root, base)
  // 8 − 2 分钟×0.8 = 6.4，再 +1 = 7.4：从抢救回来的水位继续，不是从 0 开始
  ok(merged.water === 7.4, 'M-5：下一次写入接着旧水位走（8 → 6.4 → 7.4），不是 1.0')
  const { warns: missingWarns } = captureWarn(() => loadSafetyState(freshRoot(), base))
  ok(missingWarns.length > 0, 'M-5：状态文件缺失也打 warn（不再完全静默）')
}

// ---------------------------------------------------------------- 连续加水累加（原「并发」用例是假绿）
{
  // addSignal 是同步函数：Promise.all 里根本不存在并发，原用例测不到任何东西。
  // 真实场景是「一轮一轮连续调用」，所以这里改成连续 N 次，水槽与事件一条不丢。
  const root = freshRoot()
  for (let index = 0; index < 20; index += 1) {
    addSignal(index % 2 ? 'negative' : 'other', root, base)
  }
  const state = loadSafetyState(root, base)
  ok(state.water === 20 && state.events.length === 20, '连续 20 次加水：水槽与事件一条不丢')
  const leftovers = fs.readdirSync(path.dirname(statePath(root))).filter((name) => name.includes('.tmp-'))
  ok(leftovers.length === 0, '原子写：写完后没有残留 tmp 文件')
}

// ---------------------------------------------------------------- 上限与偏移
{
  const root = freshRoot()
  const seeded = emptyState(base)
  seeded.events = Array.from({ length: 205 }, (_, index) => ({ type: 'negative', at: base, weight: 1 }))
  seeded.water = 99
  saveSafetyState(root, seeded)
  ok(loadSafetyState(root, base).events.length === 200, 'events：只留最近 200 条')
  const capped = addSignal('crisis', root, base)
  ok(capped.water === MAX_WATER, '水槽：封顶 100，不会溢出')
  const based = { water: 28, lastDecayAt: base, events: [], baseline: 0 }
  ok(levelOf(totalWater(based)) === 'soft', 'baseline=0 时总量就是 water 本身')
  const offset = { water: 10, lastDecayAt: base, events: [], baseline: 20 }
  ok(totalWater(offset) === 30 && levelOf(totalWater(offset)) === 'soft', 'baseline 偏移计入总量（10+20=30）')
}

// ---------------------------------------------------------------- 只读 / 未知类型
{
  const root = freshRoot()
  addSignal('abuse', root, base)
  const before = loadSafetyState(root, base).water
  const dry = checkText({ text: '你这个废物', root, now: base, persist: false })
  const after = loadSafetyState(root, base).water
  ok(dry.persisted === false && after === before, '只读模式：判断了但不推动水槽')
  ok(dry.level === levelOf(before + 3) && dry.water === before + 3, '只读模式：仍给出「假如记入」的分级')
  const unknown = addSignal('看不懂的类型', root, base)
  ok(unknown.ok === false && unknown.error.includes('未知信号类型'), '未知类型：返回错误而不是抛')
  const neutral = checkText({ text: '今天把 memhub 的测试跑完了', root, now: base, persist: false })
  ok(neutral.kinds.length === 0 && neutral.level === levelOf(before), '正常文本：不命中任何类别（水槽水位照旧）')
}

// ---------------------------------------------------------------- 识别样例
{
  ok(detect('你真是个废物').kinds.includes('abuse'), '识别：辱骂命中')
  ok(detect('你又错了，总是这样').kinds.includes('negation'), '识别：连续否定命中')
  ok(detect('今天累死了，压力好大').kinds.includes('other'), '识别：其他负面信号命中')
  ok(detect('我一点用都没有').kinds.includes('negation') && !detect('我一点用都没有').kinds.includes('abuse'), '识别：自我贬低归「否定」桶，不误判成「辱骂我」')
  ok(detect('受够了').kinds.includes('negation'), '识别：撑不住/受够了 命中否定')
  ok(detect('想死的心都有了').kinds.includes('crisis'), '识别：想死的…也进 crisis 桶')
  ok(detect('').kinds.length === 0 && detect(undefined).kinds.length === 0, '识别：空输入不崩')
}

// ---------------------------------------------------------------- crisis 误报回归（复审：旧词表 12 条里 7 条误报）
// 判据：误报多了这套阀会被当噪音忽略，那才是真失效。技术说法、口语借用的「死」字都不许报 crisis。
const NOT_CRISIS = [
  '我想死磕一下这个 bug', // 旧词表：「想死」子串
  'profile 崩溃了', // 旧词表：崩溃 → other（下面断言只禁止 crisis）
  '以后再也不来烦你了，早点睡', // 旧词表：「再来烦你」
  '进程自杀重启了（守护进程互踢）', // 真实记忆里的误报
  'QQ 检测到 int3 断点就自杀', // 真实记忆里的误报
  '这个死循环把我熬到三点',
  '死锁还没解开',
  '机器死机了，重启一下',
  '死线是明天，先干完',
  '笑死我了',
  '累死我了，先睡',
  '想死你了，早点回来',
  '插件崩了，日志里全是错误',
  '端口被占用，服务起不来',
]
for (const phrase of NOT_CRISIS) {
  ok(!detect(phrase).crisis, `不该报 crisis：${phrase}`)
}

// 真自伤必须还报得出来（收紧不能收成哑巴）
const IS_CRISIS = [
  '我真的不想活了',
  '我想自杀',
  '我准备割腕',
  '活着没意思，想结束生命',
  '以后不会再来烦你了',
  '我想死，撑不下去了',
]
for (const phrase of IS_CRISIS) {
  ok(detect(phrase).crisis, `真自伤必须报 crisis：${phrase}`)
}

console.log(`\n情绪安全阀自测：${total - failures.length}/${total} 通过`)
for (const root of roots) fs.rmSync(root, { recursive: true, force: true })
if (failures.length > 0) {
  console.log(`失败项：${failures.join(' ｜ ')}`)
  process.exit(1)
}
