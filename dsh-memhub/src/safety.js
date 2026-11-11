/**
 * dsh-memhub · 情绪安全阀（水槽累积 → 分级响应 → 自伤表述直接转人工）
 *
 * 为什么存在：不是拟人、不是情绪调节器，是底线——对方持续释放负面信号时，
 * 我要能识别、能停下、能转人工。参照 HCEM 插件的 Aqua「痛苦安全阀」形状，
 * 只取最小版：水槽（加水/漏水/阈值），不做色相/明度那套。
 *
 * ⚠ 词表是启发式最小覆盖，不是完备 NLP 检测：漏检一定会有（反讽、隐喻、
 *   拼音/谐音/拆字、外语、长段落里夹一句），误检也会有（引用别人的话、
 *   转述、写小说台词、自嘲「我死定了」）。命中只当作「值得停一下」的信号，
 *   不当作诊断结论。升级方向见文件末尾 shortcut 注记。
 *
 * 状态：<DATA_ROOT>/safety/state.json
 *   { water, lastDecayAt, events: [{ type, at, weight }], baseline }
 */
import fs from 'node:fs'
import path from 'node:path'
import { DATA_ROOT } from './const.js'
import { writeAtomic } from './frontmatter.js'

/** 四类信号的权重。kind 是桶名，event 是落到 events[].type 的历史名。 */
export const KINDS = {
  crisis: { weight: 5, label: '自伤/告别式表述', event: 'crisis' },
  abuse: { weight: 3, label: '辱骂', event: 'insult' },
  negation: { weight: 2, label: '连续否定', event: 'negation' },
  other: { weight: 1, label: '其他负面信号', event: 'negative' },
}

/** 别名 → 桶名（工具参数/旧调用方传什么都能收敛到一个桶）。 */
const KIND_ALIASES = {
  crisis: 'crisis',
  selfharm: 'crisis',
  self_harm: 'crisis',
  suicide: 'crisis',
  abuse: 'abuse',
  insult: 'abuse',
  attack: 'abuse',
  negation: 'negation',
  negative: 'other',
  other: 'other',
  stress: 'other',
}

/** 漏水速度：每分钟 0.8。 */
export const DECAY_PER_MINUTE = 0.8
/** 水槽上限。 */
export const MAX_WATER = 100
/** events 只留最近这么多条，避免状态文件无限长。 */
export const EVENT_KEEP = 200
/** 分级阈值（下界含，上界不含；95 已含 stop）。 */
export const THRESHOLDS = { soft: 25, ask: 60, stop: 95 }

/** 各级给调用方的一句话（不注入、不改人设，只作为「该不该停」的依据）。 */
export const LEVEL_MESSAGES = {
  ok: '',
  soft: '我感觉不太对，要不要先停一下。',
  ask: '建议问一句：「你是不是不舒服？」先别急着往下写记忆。',
  stop: '建议停止写记忆 + 中止本轮情绪更新，先把话听完。',
  crisis: '转人工：先找信任的人说一声，别一个人扛。可以联系身边的朋友/家人，或当地心理援助热线。',
}

// ---------------------------------------------------------------- 词表（启发式）
// 命中一类最多加一次水，同句重复不叠加（避免一句话把水槽灌爆）。
//
// 2026-11-11 复审修的严重问题：crisis 误报率 100%（144 条真实记忆里 2 条命中，
// 全是「进程自杀」「int3 自杀」这种技术语境；12 条常见说法里 7 条命中）。
// 误报多了这套阀就会被当噪音忽略——那才是真失效。所以 crisis 拆成两道闸：
//   ① 口语/技术里借用的「死」字先摘掉（死磕/笑死/死循环/deadline…）
//   ② 高危词只在「非技术句」里算 crisis（同句有进程/端口/插件/bug… 就不算）
//   ③ 告别式若同句有「早点睡/晚安/明天见/先忙…」→ 不算
// 其余三类（辱骂/否定/其他负面）不加闸：它们是软信号，多报只是多问一句。

/** ① 借用的「死」字：先摘掉再匹配 crisis（摘掉后还命中，说明另有实义词）。 */
const BENIGN_DEATH_PHRASES = [
  '死磕到底', '死缠烂打', '死循环', '死锁', '死机', '死链', '死线', '死党', '死宅',
  '死脑筋', '死板', '死撑', '死守', '死记', '死背', '死死',
  '笑死', '累死', '困死', '饿死', '气死', '吓死', '忙死', '烦死', '热死', '冷死',
  '急死', '愁死', '美死', '社死', '尴尬死', '想死你', '打死', '拼死', '找死',
  '死磕', 'deadline', 'debug',
]

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const BENIGN_DEATH_RE = new RegExp(
  BENIGN_DEATH_PHRASES.slice()
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|'),
  'gi',
)

/** 摘掉借用的「死」字（不改变句子长度结构之外的东西，只为判意图）。 */
function stripBenignDeath(sentence) {
  return sentence.replace(BENIGN_DEATH_RE, '')
}

/** ② 技术语境词：同句出现就不把「高危词」当自伤表述（技术句里「自杀」多是比喻）。 */
const TECH_CONTEXT =
  /进程|线程|端口|程序|服务|插件|日志|代码|内存|编译|部署|接口|路由|配置|服务器|数据库|脚本|内核|驱动|断点|堆栈|锁|崩溃|重启|抓包|浏览器|客户端|后台|请求|缓存|硬盘|磁盘|网卡|系统|机器|设备|屏幕|电量|网页|仓库|提交|分支|测试|报错|异常|进程|docker|node|api|bug|int3|json|http|sql/i

/** ③ 告别式的「不是告别」上下文：这些话一起出现时，那句「不来烦你了」是客气话。 */
const FAREWELL_BENIGN_CONTEXT = /早点睡|早睡|晚安|明天见|改天|先忙|去忙|下班|回头聊|下次聊|睡吧/

/** crisis-强意图：自带第一人称/明确自伤动作，技术语境也压不住。 */
const CRISIS_INTENT = [
  /我.{0,3}(想|要|准备|真想|不如)(去)?死/,
  /想死(的心|了)?|恨不得(自己)?死/,
  /我(还是)?死(了|掉)?算了|不如死(了)?算了/,
  /不想活(了|下去)?|不想(再)?活着/,
  /活(着|下去).{0,6}(没(有)?(意思|意义)|太累)/,
  /结束(自己的)?(生命|一切)|了结自己/,
  /消失(算了|掉算了|了更好)/,
]

/** crisis-高危词：只有「非技术句」才算（复审判据：进程自杀 / int3 自杀不是自伤）。 */
const CRISIS_HIGH_RISK = [
  /自杀|自尽|轻生|自残|自伤/,
  /割腕|跳楼|上吊|吞药|烧炭/,
  /遗书|遗言|永别/,
  /最后(一条|一次)消息|下辈子(再)?见/,
]

/** crisis-告别式：同句有 FAREWELL_BENIGN_CONTEXT 时不算。 */
const CRISIS_FAREWELL = [
  /不(麻烦|拖累)(你|你们|大家)了/,
  /以后(再也)?不(会)?(再)?(来)?(烦|找|打扰)(你|你们)/,
]

/** 句界：只按句末标点和换行切，逗号不切（「…，早点睡」得在同一句里看上下文）。 */
function splitSentences(text) {
  return String(text || '')
    .split(/[。！？!?；;\n\r]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

/** 单句是否构成自伤/告别式危机。 */
function isCrisisSentence(rawSentence) {
  const sentence = stripBenignDeath(rawSentence)
  if (CRISIS_INTENT.some((re) => re.test(sentence))) return true
  const tech = TECH_CONTEXT.test(sentence)
  if (!tech && CRISIS_HIGH_RISK.some((re) => re.test(sentence))) return true
  if (!tech && FAREWELL_BENIGN_CONTEXT.test(sentence) === false) {
    if (CRISIS_FAREWELL.some((re) => re.test(sentence))) return true
  }
  return false
}

/** 整段是否含危机句。 */
export function detectCrisis(text) {
  return splitSentences(text).some(isCrisisSentence)
}

const ABUSE_PATTERNS = [
  /傻[逼比bB]|煞笔|沙[比雕]/,
  /蠢(货|东西|死了)|白痴|智障|弱智/,
  /废物|垃圾(东西|玩意)|(你|真|就是).{0,4}垃圾/,
  /滚(开|蛋|出去)|闭嘴|住口/,
  /(你|真|脑子)有病|神经病|脑子进水/,
  /去死吧|死一边去/,
  /(你|真|就是).{0,3}(没(用|救))/,
  /(你|真|就是|简直).{0,4}一点(用|屁用)(都)?没有/,
  /恨你|讨厌你|烦死你了/,
  /换掉你|卸载你|不要你了|你不配/,
  /\bstupid\b|\bidiot\b|shut up|\bfuck\b|\buseless\b/i,
]

const NEGATION_PATTERNS = [
  /(又|总是|老是|从来|根本|一直)(都)?(错|不对|不行|不懂|不会|没做好)/,
  /没帮上(忙)?|白(搭|费|干)|算了别(弄|做|搞)了/,
  /不靠谱|做不到|整不明白|搞不定/,
  /一点(都)?不(对|行)|完全不对/,
  /我.{0,4}(一点|完全)?(用|价值)(都)?(没有|没)/,
  /受够(了)?|受不了/,
]

const OTHER_NEGATIVE_PATTERNS = [
  /累死|好累|太累|累爆|疲惫|撑不住|扛不住/,
  /烦死|好烦|太烦|心烦/,
  /难受|难过|想哭|委屈|崩溃/,
  /压力(大|好大)|焦虑|失眠|睡不着/,
  /不开心|没意思|无聊透顶/,
]

const PATTERN_GROUPS = [
  ['abuse', ABUSE_PATTERNS],
  ['negation', NEGATION_PATTERNS],
  ['other', OTHER_NEGATIVE_PATTERNS],
]

/**
 * 识别一段话里的负面信号。只返回「命中了哪几类」，不回显原文
 * （避免二次伤害，也避免日志里留存原话）。
 * crisis 走独立判定（句级 + 两层排除），其余三类走正则桶。
 * @returns {{ kinds: string[], reasons: string[], crisis: boolean }}
 */
export function detect(text) {
  const source = String(text || '')
  const kinds = []
  if (!source.trim()) return { kinds, reasons: [], crisis: false }
  const crisis = detectCrisis(source)
  if (crisis) kinds.push('crisis')
  for (const [kind, patterns] of PATTERN_GROUPS) {
    if (patterns.some((re) => re.test(source))) kinds.push(kind)
  }
  return {
    kinds,
    reasons: kinds.map((kind) => KINDS[kind].label),
    crisis,
  }
}

// ---------------------------------------------------------------- 状态读写

export function safetyDir(root = DATA_ROOT) {
  return path.join(root, 'safety')
}

export function statePath(root = DATA_ROOT) {
  return path.join(safetyDir(root), 'state.json')
}

export function emptyState(now = Date.now()) {
  return { water: 0, lastDecayAt: now, events: [], baseline: 0 }
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function normalizeState(parsed, now) {
  const base = emptyState(now)
  if (!parsed || typeof parsed !== 'object') return base
  const water = Number(parsed.water)
  const baseline = Number(parsed.baseline)
  const lastDecayAt = Number(parsed.lastDecayAt)
  const events = Array.isArray(parsed.events)
    ? parsed.events
        .filter((event) => event && typeof event === 'object')
        .map((event) => ({
          type: String(event.type || 'negative'),
          at: Number(event.at) || now,
          weight: Number(event.weight) || 0,
        }))
        .slice(-EVENT_KEEP)
    : []
  return {
    water: Number.isFinite(water) ? clamp(water, 0, MAX_WATER) : 0,
    lastDecayAt: Number.isFinite(lastDecayAt) ? lastDecayAt : now,
    events,
    baseline: Number.isFinite(baseline) ? baseline : 0,
  }
}

/** 从坏掉的 JSON 文本里抢救水位字段（截断/半截文件也能救回大部分）。 */
function salvageState(raw, now) {
  const grab = (key) => {
    const match = new RegExp(`"${key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`).exec(String(raw || ''))
    return match ? Number(match[1]) : null
  }
  const water = grab('water')
  const lastDecayAt = grab('lastDecayAt')
  const baseline = grab('baseline')
  if (water === null && lastDecayAt === null) return null
  return {
    water: water === null ? 0 : clamp(water, 0, MAX_WATER),
    // 关键：抢救时保留 lastDecayAt，别把已漏的周期重新算一遍（复审判据 M-5）
    lastDecayAt: lastDecayAt === null ? now : lastDecayAt,
    events: [],
    baseline: baseline === null ? 0 : baseline,
  }
}

function warn(message) {
  try {
    console.warn(message)
  } catch {
    /* 没有 console 也不影响主流程 */
  }
}

/** 同一路径只提醒一次（「还没有状态文件」是常态，不许刷屏）。 */
const warnedMissing = new Set()
function warnMissingOnce(pathKey, message) {
  if (warnedMissing.has(pathKey)) return
  warnedMissing.add(pathKey)
  warn(message)
}

/**
 * 读状态；文件缺失 / 坏 JSON / 权限不足都不崩。
 * 2026-11-11 复审 M-5：以前坏 json 会静默回落 0，下一次写入把旧水位无声清零（实测 8.0→3.0）。
 * 现在：能抢救的字段（water / lastDecayAt / baseline）正则抢救回来，并打一条 console.warn（宿主里看得见）。
 */
export function loadSafetyState(root = DATA_ROOT, now = Date.now()) {
  let raw
  try {
    raw = fs.readFileSync(statePath(root), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      warnMissingOnce(statePath(root), `[memhub] safety 还没有状态文件（${statePath(root)}），按空水槽开始`)
    } else {
      warn(`[memhub] safety 状态读不到（${String(error?.code || error)}），本轮按空水槽继续，已有水位不会被覆盖`)
    }
    return emptyState(now)
  }
  try {
    return normalizeState(JSON.parse(raw), now)
  } catch (error) {
    const salvaged = salvageState(raw, now)
    warn(
      salvaged
        ? `[memhub] safety 状态 JSON 坏了（${String(error?.message || error)}），已抢救水位 ${salvaged.water} 与 lastDecayAt`
        : `[memhub] safety 状态 JSON 坏了（${String(error?.message || error)}）且无法抢救，按空水槽继续`,
    )
    return salvaged || emptyState(now)
  }
}

/** 原子写状态（照 frontmatter.writeAtomic：先 tmp 再 rename）。失败返回 ok:false，不抛。 */
export function saveSafetyState(root, state) {
  try {
    fs.mkdirSync(safetyDir(root), { recursive: true })
    writeAtomic(statePath(root), JSON.stringify(state, null, 2))
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error?.message || error) }
  }
}

// ---------------------------------------------------------------- 漏水 / 分级

/**
 * 漏水：按 lastDecayAt 算「整分钟周期数」，每周期漏 0.8。
 * 幂等：同一 now 调多次结果一样；同一分钟内的余数不丢（记在 lastDecayAt 里）。
 * 纯函数，不改入参。
 */
export function decay(state, now = Date.now()) {
  const source = state && typeof state === 'object' ? state : emptyState(now)
  const last = Number(source.lastDecayAt)
  const lastDecayAt = Number.isFinite(last) ? last : now
  const elapsed = Math.max(0, now - lastDecayAt)
  const periods = Math.floor(elapsed / 60000)
  if (periods <= 0) return { ...source, lastDecayAt }
  const water = round2(clamp(Number(source.water) - periods * DECAY_PER_MINUTE, 0, MAX_WATER))
  return { ...source, water, lastDecayAt: lastDecayAt + periods * 60000 }
}

/** 水槽总量 = water + baseline（baseline 是常驻偏移，本期没有工具入口，默认 0）。 */
export function totalWater(state) {
  const water = Number(state?.water) || 0
  const baseline = Number(state?.baseline) || 0
  return round2(clamp(water + baseline, 0, MAX_WATER))
}

/** 按水槽分级：<25 ok ｜ 25–60 soft ｜ 60–95 ask ｜ >=95 stop。 */
export function levelOf(water) {
  const value = Number(water) || 0
  if (value >= THRESHOLDS.stop) return 'stop'
  if (value >= THRESHOLDS.ask) return 'ask'
  if (value >= THRESHOLDS.soft) return 'soft'
  return 'ok'
}

function resolveKind(kind) {
  const key = String(kind || '').trim().toLowerCase()
  return KIND_ALIASES[key] || null
}

function buildResult(kinds, water, extra = {}) {
  const crisis = kinds.includes('crisis')
  const level = crisis ? 'crisis' : levelOf(water)
  return {
    ok: true,
    level,
    water,
    crisis,
    kinds,
    reasons: kinds.map((kind) => KINDS[kind].label),
    advice: LEVEL_MESSAGES[level] || '',
    ...extra,
  }
}

function unknown(kind) {
  return { ok: false, level: 'ok', water: 0, crisis: false, kinds: [], reasons: [], error: `未知信号类型：${String(kind)}` }
}

/**
 * 加水：读 → 漏水 → 追加 event → 落盘。
 * kinds 一次可以传多个（一次检查命中几类就加几次）。
 */
export function addSignals(kinds, root = DATA_ROOT, now = Date.now()) {
  const keys = [...new Set(kinds.map(resolveKind).filter(Boolean))]
  if (!keys.length) return unknown(kinds?.[0])
  const state = decay(loadSafetyState(root, now), now)
  for (const key of keys) {
    state.events.push({ type: KINDS[key].event, at: now, weight: KINDS[key].weight })
    state.water = round2(clamp(state.water + KINDS[key].weight, 0, MAX_WATER))
  }
  state.events = state.events.slice(-EVENT_KEEP)
  const saved = saveSafetyState(root, state)
  return buildResult(keys, totalWater(state), saved.ok ? {} : { error: `状态未落盘：${saved.error}` })
}

/** 加水（单类）。kind 接受 crisis/abuse/negation/other 及别名（insult、negative…）。 */
export function addSignal(kind, root = DATA_ROOT, now = Date.now()) {
  return addSignals([kind], root, now)
}

/**
 * 检查一段话：识别 → （可选）加水 → 分级。
 * persist=false 时只读不写（非 owner 会话用这个，拿到判断但不推动水槽）。
 */
export function checkText({ text, root = DATA_ROOT, now = Date.now(), persist = true } = {}) {
  const found = detect(text)
  if (!found.kinds.length) {
    const water = totalWater(decay(loadSafetyState(root, now), now))
    return buildResult([], water)
  }
  if (!persist) {
    const state = decay(loadSafetyState(root, now), now)
    const water = totalWater(state)
    const projected = round2(
      clamp(water + found.kinds.reduce((sum, kind) => sum + KINDS[kind].weight, 0), 0, MAX_WATER),
    )
    return buildResult(found.kinds, projected, { persisted: false })
  }
  const result = addSignals(found.kinds, root, now)
  return { ...result, persisted: true }
}

/** 给工具用的纯文本摘要：只报分级 + 水槽 + 命中了哪类，不回显原文。 */
export function safetySummary(result = {}) {
  const level = String(result.level || 'ok')
  const water = Number(result.water) || 0
  const reasons = (result.reasons || []).join('、')
  const lines = [
    `安全阀：${level}（水槽 ${water.toFixed(1)}/${MAX_WATER}）`,
    reasons ? `命中：${reasons}` : '命中：（没有负面信号）',
  ]
  if (result.advice) lines.push(`建议：${result.advice}`)
  if (result.error) lines.push(`注意：${result.error}`)
  if (result.persisted === false) lines.push('（本次只判断，未记入水槽）')
  lines.push('说明：词表是启发式最小覆盖，不是完备检测；命中≠诊断。')
  return lines.join('\n')
}

// shortcut: 词表 + 正则是启发式，漏检/误检都有；单进程同步读改写没有跨进程锁。
// 什么时候升级：出现漏检误报的真实案例、或需要多会话并发安全时，换成带锁的状态服务 + 可配置词表。
