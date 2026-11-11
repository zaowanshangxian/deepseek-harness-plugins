/**
 * 「进度旁白（简）」宿主半。
 *
 * 要解决的问题：模型闷头干活（连续思考、连续调工具）时，界面上很久没有正文，
 * 用户分不清它是在干活还是卡死了。
 *
 * 做法（只借鉴机制，不复用任何参考实现的行级代码，详见 ANALYSIS.md）：
 *
 *   ① 计时 —— 挂 `agent/assistant-stream`，只认「正文输出」，不认工具调用和思考帧。
 *   ② 记账 —— 静默超过阈值时不当场插话（那时可能正卡在两次工具调用之间，宿主会报错），
 *      只在内存里记一个 `due` 标记。
 *   ③ 注入 —— 等宿主跑到下一个 step 边界、走 `agent/pre-step` 这个 waterfall 时，
 *      把一条 user 消息并进本步的 `decision.messages`。消息带 `source.form = 'notice'`，
 *      宿主把它投影成 context 节点：界面上不显示，模型照样读得到。
 *      消息批次非空 → 宿主那条「messages 为空就判定回合结束」的规则判不出结束，
 *      任务因此继续跑（这是插话不打断任务的真正原因，不是提示词）。
 *
 * 与参考实现的差别：决策抽成纯函数 `evaluateSilence`；没有左下角浮窗、没有截取模型原文、
 * 没有自检计数路由。宿主半只多一条给设置页读写开关的 loopback 路由。
 *
 * @module dsh-plugin-narrator-lite
 */

import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import os from 'node:os'
import path from 'node:path'

export const name = 'narrator-lite'

// 事件总线走 ctx.on，不需要预注入任何服务；webServer 在 apply 里按需 inject。
export const inject = []

/** 阈值量程（秒）。下限 10 秒：再小就等于每一步都插一句，纯烧 token。 */
export const SILENT_SECONDS_MIN = 10
export const SILENT_SECONDS_MAX = 3600
/** 同时跟踪的会话上限，超了按「最久没有任何活动帧」淘汰（不是按最后一段正文）。 */
export const SESSION_LIMIT = 32

export const DEFAULTS = Object.freeze({
  /** 总开关：静默超阈值时让模型汇报一次 */
  enabled: true,
  /** 距最后一次正文输出多久算「沉默」 */
  silentSeconds: 90,
  /** 两次注入之间的最小间隔，防刷屏 */
  cooldownSeconds: 120,
  /** 单回合最多注入几次；0 = 不限，由冷却兜底 */
  maxPerTurn: 4,
  /** 自定义注入提示词；空则用内置中文默认文案 */
  prompt: null,
})

/**
 * 内置注入提示词。
 *
 * 写法刻意贴近「用户中途插一句话」：先让它停一下，按四点说清楚，最后明确要求
 * 「说完继续、不要等确认、不要重做」——这句是防止模型把这次汇报当成任务终点。
 */
export const DEFAULT_PROMPT = [
  '【进度提醒】你已经有一段时间没有输出正文了。',
  '',
  '先用一小段正文说清现在的进展，然后立刻继续原来的工作：',
  '1. 现在在做哪一件事；',
  '2. 已经完成了什么（改了哪个文件、跑了什么命令、得到什么结论）；',
  '3. 接下来准备做什么；',
  '4. 有没有卡住或不确定的地方。',
  '',
  '这是中途插话，不是任务结束：说完继续执行原来的任务，不要停下来等确认，也不要重做已经完成的部分。',
].join('\n')

/** 注入消息的来源标记：`form: 'notice'` 让宿主投影成 context 节点（界面隐藏、模型可见）。 */
export const NOTICE_SOURCE = Object.freeze({
  kind: 'narrator-lite',
  form: 'notice',
  summary: '要求模型中途汇报进度',
})

/** 提示词硬上限（字符）。它会作为 user 消息持久化进会话，不设闸门等于给 token 炸弹开口子。 */
export const PROMPT_MAX_CHARS = 2048

// ---------------------------------------------------------------------------
// 配置归一化
// ---------------------------------------------------------------------------

/** Cordis 的配置可能是响应式引用（有 .get()）。 */
function unwrap(value) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
    try {
      return value.get()
    } catch {
      return value
    }
  }
  return value
}

/**
 * 转数字，但把「压根没给数」的形态（null / 空串 / 布尔）判成 null。
 *
 * `Number(null) === 0`、`Number('') === 0`、`Number(false) === 0` 都是有限值，
 * 直接走夹紧会把「没配过」当成「想设成 0」，配置里缺这个键时值就凭空变了。
 */
function toNumber(value) {
  const raw = unwrap(value)
  if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function clampInt(value, fallback, min, max) {
  const n = toNumber(value)
  if (n === null) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** 按 UTF-16 截断但不劈开代理对（否则会话里会留下一个乱码方块）。 */
function safeSlice(text, max) {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

function promptText(value) {
  const raw = unwrap(value)
  if (typeof raw !== 'string') return DEFAULT_PROMPT
  const trimmed = raw.trim()
  return trimmed === '' ? DEFAULT_PROMPT : safeSlice(trimmed, PROMPT_MAX_CHARS)
}

/**
 * 合并三层来源（默认值 / cordis.patch.yml / 设置页覆盖层）并夹紧。
 * @param {object} [base] cordis 配置
 * @param {object} [override] 设置页存盘的覆盖层
 * @returns {{enabled:boolean, silentSeconds:number, cooldownSeconds:number, maxPerTurn:number, prompt:string}}
 */
export function normalizeConfig(base = {}, override = {}) {
  const root = unwrap(base)
  const top = root !== null && typeof root === 'object' ? root : {}
  const over = override !== null && typeof override === 'object' ? override : {}
  const pick = (key) => (over[key] !== undefined ? over[key] : top[key])
  const cooldownSeconds = clampInt(pick('cooldownSeconds'), DEFAULTS.cooldownSeconds, 0, SILENT_SECONDS_MAX)
  const maxPerTurn = clampInt(pick('maxPerTurn'), DEFAULTS.maxPerTurn, 0, 50)

  return {
    // 布尔默认值一律用 `!== false` / `=== true` 写，别让「没配过」被当成「打开」
    enabled: unwrap(pick('enabled')) !== false,
    silentSeconds: clampInt(pick('silentSeconds'), DEFAULTS.silentSeconds, SILENT_SECONDS_MIN, SILENT_SECONDS_MAX),
    // 两个刹车不许同时松开：silentSeconds 下限只有 10 秒，冷却和单回合上限同时为 0
    // 就等于每个 step 边界都插一句，纯烧 token。这时把冷却抬回默认值，
    // 想完全不限就必须先给单回合一个上限（反过来同理）。
    cooldownSeconds: cooldownSeconds === 0 && maxPerTurn === 0 ? DEFAULTS.cooldownSeconds : cooldownSeconds,
    maxPerTurn,
    prompt: promptText(pick('prompt')),
  }
}

// ---------------------------------------------------------------------------
// 纯函数：这次「静默到期」该做什么
// ---------------------------------------------------------------------------

/**
 * 判断定时器醒来后的去向。所有时间判断都在这里，定时器只负责按 `delayMs` 重新排期，
 * 所以整条决策路径能脱离宿主单测。
 *
 * @param {object} input
 * @param {{due:boolean, lastVisibleAt:number, turn:number}} input.state 会话状态
 * @param {{lastInjectAt:number, byTurn:Map<number, number>}} input.ledger 本会话注入账本
 * @param {object} input.config 已归一化配置
 * @param {number} input.now 当前时刻（毫秒）
 * @returns {{action:'wait'|'due'|'cooldown'|'cap', delayMs?:number, silentMs?:number}}
 */
export function evaluateSilence({ state, ledger, config, now }) {
  // 已经排过、还没等到 step 边界：不重复排队，等 pre-step 取走
  if (state.due === true) return { action: 'wait' }

  const silentMs = now - state.lastVisibleAt
  const thresholdMs = config.silentSeconds * 1000
  if (silentMs < thresholdMs) return { action: 'wait', delayMs: thresholdMs - silentMs }

  const used = ledger.byTurn.get(state.turn) ?? 0
  if (config.maxPerTurn > 0 && used >= config.maxPerTurn) return { action: 'cap' }

  const cooldownMs = config.cooldownSeconds * 1000
  // `lastInjectAt` 为 0 表示「本会话还没注入过」，不能当成「在纪元时刻刚注入过」
  const sinceInject = ledger.lastInjectAt > 0 ? now - ledger.lastInjectAt : Number.POSITIVE_INFINITY
  if (cooldownMs > 0 && sinceInject < cooldownMs) return { action: 'cooldown', delayMs: cooldownMs - sinceInject }

  return { action: 'due', silentMs }
}

/**
 * 判断是不是子代理会话。
 *
 * 只认 `session.header.origin === 'subagent'`。**不能只看 parentSession**：从某个对话
 * 「分叉」出来的新会话同样带 parentSession，但它是用户正在看的会话，判错会把主窗口
 * 的提醒全部静音。
 */
export function isSubagentSession(agent) {
  const header = agent?.session?.header
  return header !== null && typeof header === 'object' && header.origin === 'subagent'
}

/**
 * 会话 Map 超上限时挑一个淘汰（纯函数，抛进单测）。
 *
 * 排序用 `lastActivityAt`（最后一次收到任何帧）而**不是** `lastVisibleAt`（最后一次正文）：
 * 只顾调工具、只顾思考的会话正文时间可以很旧，但它恰恰是正在跑的那个；按正文时间淘汰
 * 会把它挤掉，之后它的提醒就静默停止了。已经排期待注入（`due`）的会话优先保留 ——
 * 它正等着下一个 step 边界，扔了就等于白排一次。
 *
 * @param {Iterable<{sessionId:string, lastActivityAt:number, due:boolean}>} states
 * @returns {{sessionId:string}|null} 没有可淘汰的就返回 null
 */
export function pickEvictionVictim(states) {
  let victim = null
  let fallback = null
  for (const state of states) {
    if (fallback === null || state.lastActivityAt < fallback.lastActivityAt) fallback = state
    if (state.due === true) continue
    if (victim === null || state.lastActivityAt < victim.lastActivityAt) victim = state
  }
  // 全都在等注入时才退一步淘汰最久没活动的那个：不然表会越过上限。
  return victim ?? fallback
}

// ---------------------------------------------------------------------------
// 注入消息构造
// ---------------------------------------------------------------------------

let createUserMessageImpl

/**
 * 优先用宿主自己的 `createUserMessage`（若该包在这个 profile 里可见），
 * 否则退化成手搓的同形状对象。两条路都只带 `id / role / content / source`，
 * 不碰 `stream`、`reasoning`、`sourceEventSeqs` 这些宿主会硬校验的字段。
 */
async function resolveCreateUserMessage() {
  if (createUserMessageImpl !== undefined) return createUserMessageImpl
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : path.join(os.homedir(), '.dsh')
  const anchors = [process.argv[1], path.join(home, 'profiles', 'node_modules')]
    .filter((anchor) => typeof anchor === 'string' && anchor !== '')

  for (const anchor of anchors) {
    try {
      const require = createRequire(anchor)
      const mod = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href)
      if (typeof mod.createUserMessage === 'function') {
        createUserMessageImpl = mod.createUserMessage
        return createUserMessageImpl
      }
    } catch {
      // 换下一个锚点；全都不行就用手搓版本
    }
  }

  createUserMessageImpl = (input) => ({ id: randomUUID(), role: 'user', ...input })
  return createUserMessageImpl
}

/** 测试用：清掉缓存，方便注入桩实现。 */
export function __resetCreateUserMessage() {
  createUserMessageImpl = undefined
}

/** 造一条「请汇报进度」的注入消息。 */
export async function buildProgressMessage(prompt) {
  const makeUserMessage = await resolveCreateUserMessage()
  return makeUserMessage({
    content: [{ type: 'text', text: prompt }],
    source: { ...NOTICE_SOURCE },
  })
}

// ---------------------------------------------------------------------------
// 覆盖层配置存储（设置页写这里，跨重装存活）
// ---------------------------------------------------------------------------

/** 覆盖层文件路径。`DSH_HOME` 变了它就跟着变。 */
export function configFilePath(home) {
  const root = typeof home === 'string' && home !== ''
    ? home
    : (typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== ''
      ? process.env.DSH_HOME
      : path.join(os.homedir(), '.dsh'))
  return path.join(root, 'narrator-lite', 'config.json')
}

/** 读覆盖层。文件不存在返回 `{}`；文件损坏把原因抛给调用方记日志，不让插件挂掉。 */
export async function readOverride(file = configFilePath()) {
  let raw
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
  const parsed = JSON.parse(raw)
  return parsed !== null && typeof parsed === 'object' ? parsed : {}
}

/**
 * 写覆盖层（整份覆盖，调用方负责合并）。
 *
 * 先写临时文件再 rename：直接 `writeFile` 盖上去时进程被杀会留下半截 JSON，
 * 下次 parse 抛错 → 退回 `{}` → 用户设置静默丢失。同目录 rename 是原子的，
 * 要么是旧内容、要么是新内容，不会有第三种。
 */
export async function writeOverride(values, file = configFilePath()) {
  const dir = path.dirname(file)
  await fs.mkdir(dir, { recursive: true })
  const body = JSON.stringify(values, null, 2)
  // 临时文件必须和目标是同一个目录（跨卷 rename 会退化成复制，就不再原子了）
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  try {
    await fs.writeFile(tmp, body, 'utf8')
    await fs.rename(tmp, file)
  } catch (error) {
    // 写失败别把临时文件堆在用户目录里
    try {
      await fs.unlink(tmp)
    } catch {
      // 临时文件可能压根没建出来，删不掉也无所谓
    }
    throw error
  }
}

/** 备份文件名里的时间戳：本地时间 `YYYYMMDD-HHMMSS`，人一眼能看出什么时候坏的。 */
export function timestampTag(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  const day = [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('')
  const clock = [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join('')
  return `${day}-${clock}`
}

/**
 * 把解析不了的覆盖层挪到一边：`config.json.broken-<时间戳>`。
 *
 * 只在「读到了内容但解析失败」时用 —— 那时文件还在手里，挪走不会丢东西。
 * 挪不动就把错误抛给调用方：备份都没成功，这次绝不能继续往下写，
 * 否则下一次保存会把用户原来那份设置永久盖掉。
 */
export async function backupBrokenOverride(file = configFilePath()) {
  const backup = `${file}.broken-${timestampTag()}`
  await fs.rename(file, backup)
  return backup
}

// ---------------------------------------------------------------------------
// 挂载
// ---------------------------------------------------------------------------

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const MAX_BODY_BYTES = 16 * 1024

function hostnameOf(value) {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return null
  }
}

export function apply(ctx, config = {}) {
  /** @type {Map<string, {sessionId:string, turn:number, step:number, lastVisibleAt:number, lastActivityAt:number, timer:any, due:boolean, dueSilentMs:number|null}>} */
  const sessions = new Map()
  /** @type {Map<string, {lastInjectAt:number, byTurn:Map<number, number>}>} */
  const ledgers = new Map()

  let override = {}
  /** 'pending'（还没读过）| 'ok'（手里这份可信）| 'unreadable'（读不到：拒绝写入，每次请求重试） */
  let overrideStatus = 'pending'
  /** 给设置页看的一句话（损坏已备份 / 读不到）；没问题时为 null。 */
  let overrideNote = null
  let loading = null

  const log = (level, text) => {
    try {
      ctx.logger?.[level]?.(text)
    } catch {
      // 日志永不阻断主流程
    }
  }

  const effective = () => normalizeConfig(config, override)

  /**
   * 读一次覆盖层。三种结果必须分开处理，**不能都当「没有配置」**：
   *
   * - 读到 → 用文件里的值；
   * - 文件损坏（JSON 解析失败）→ 先备份成 `.broken-<时间戳>` 再按「没有配置」跑。
   *   备份成功之前绝不往下走：没有它，下一次保存会把用户原来的设置永久盖掉；
   * - 读失败（Windows 上 EBUSY/EPERM 很常见）→ 标成 `unreadable`，**不是终态**：
   *   下一次请求会重试；期间拒绝写入，因为手里这份 `{}` 是假的，整份覆盖写等于清空用户配置。
   */
  async function loadOverride() {
    try {
      override = await readOverride()
      overrideStatus = 'ok'
      overrideNote = null
    } catch (error) {
      if (error instanceof SyntaxError) {
        try {
          const backup = await backupBrokenOverride()
          override = {}
          overrideStatus = 'ok'
          overrideNote = `上次的配置文件解析失败，已备份为 ${path.basename(backup)}，当前用默认值`
          log('warn', `[narrator-lite] 配置文件损坏，已备份为 ${backup}：${String(error)}`)
        } catch (backupError) {
          overrideStatus = 'unreadable'
          overrideNote = `配置文件损坏且无法备份（${String(backupError)}），为避免覆盖已有设置，暂时不能保存`
          log('warn', `[narrator-lite] 配置文件损坏且备份失败，已禁用写入：${String(backupError)}`)
        }
        return
      }
      overrideStatus = 'unreadable'
      overrideNote = `读不到配置文件（${String(error)}），为避免覆盖已有设置，暂时不能保存`
      log('warn', `[narrator-lite] 读不到配置文件，已禁用写入，下次请求会重试：${String(error)}`)
    }
  }

  const ensureOverride = () => {
    // 只有读到可信内容才算读完：读失败不置终态，下一次请求还会再试
    if (overrideStatus === 'ok') return Promise.resolve()
    if (loading === null) {
      loading = loadOverride().finally(() => {
        loading = null
      })
    }
    return loading
  }
  void ensureOverride()

  const ledgerOf = (sessionId) => {
    let ledger = ledgers.get(sessionId)
    if (ledger === undefined) {
      ledger = { lastInjectAt: 0, byTurn: new Map() }
      ledgers.set(sessionId, ledger)
    }
    return ledger
  }

  function clearTimer(state) {
    if (state !== undefined && state !== null && state.timer !== null) {
      clearTimeout(state.timer)
      state.timer = null
    }
  }

  function arm(state, delayMs) {
    clearTimer(state)
    const timer = setTimeout(() => {
      state.timer = null
      onSilence(state)
    }, Math.max(0, delayMs))
    // 定时器不该拖住进程退出
    if (typeof timer.unref === 'function') timer.unref()
    state.timer = timer
  }

  /** 定时器醒来：只决定「要不要排期」，真正的注入留到 step 边界。 */
  function onSilence(state) {
    if (sessions.get(state.sessionId) !== state) return
    const current = effective()
    if (!current.enabled) return

    const verdict = evaluateSilence({ state, ledger: ledgerOf(state.sessionId), config: current, now: Date.now() })
    if (verdict.action === 'due') {
      state.due = true
      state.dueSilentMs = verdict.silentMs
      log('info', `[narrator-lite] 静默 ${Math.round((verdict.silentMs ?? 0) / 1000)}s，已排期，等下一个 step 边界`)
      return
    }
    if (verdict.action === 'wait') {
      if (typeof verdict.delayMs === 'number') arm(state, verdict.delayMs)
      return
    }
    if (verdict.action === 'cooldown') {
      arm(state, verdict.delayMs)
      return
    }
    // cap：本回合不再提醒，等新回合重排
  }

  /** 会话太多时按「最久没活动」淘汰，防止 Map 无限长。 */
  function pruneSessions() {
    while (sessions.size > SESSION_LIMIT) {
      const victim = pickEvictionVictim(sessions.values())
      if (victim === null) return
      clearTimer(victim)
      sessions.delete(victim.sessionId)
      // 账本必须跟状态一起删：只删 sessions 的话，被淘汰会话的 {lastInjectAt, byTurn} 永远留着，
      // 长时间开着 DSH 就是一条无界增长的泄漏。
      ledgers.delete(victim.sessionId)
    }
  }

  function dropSession(sessionId) {
    const state = sessions.get(sessionId)
    if (state !== undefined) {
      clearTimer(state)
      sessions.delete(sessionId)
    }
    ledgers.delete(sessionId)
  }

  // -------------------------------------------------------------------------
  // ① 计时
  // -------------------------------------------------------------------------

  function onStream(payload) {
    const current = effective()
    if (!current.enabled) return

    const agent = payload?.agent
    const frame = payload?.frame
    const sessionId = agent?.session?.id
    if (typeof sessionId !== 'string' || sessionId === '') return
    if (frame === undefined || frame === null || typeof frame.type !== 'string') return
    if (isSubagentSession(agent)) return

    if (frame.type === 'start') {
      const now = Date.now()
      const prev = sessions.get(sessionId)
      // 同一回合内换 step 不清零：用户感知的「等了很久」是连续的，单步只有几秒，
      // 每步归零就永远到不了阈值。换回合才归零——用户刚发言，他自己就是最新内容。
      const sameTurn = prev !== undefined && prev.turn === (frame.turn ?? 0)
      const lastVisibleAt = sameTurn ? prev.lastVisibleAt : now
      clearTimer(prev)
      const state = {
        sessionId,
        turn: frame.turn ?? 0,
        step: frame.step ?? 0,
        lastVisibleAt,
        lastActivityAt: now,
        timer: null,
        due: false,
        dueSilentMs: null,
      }
      sessions.set(sessionId, state)
      pruneSessions()
      arm(state, current.silentSeconds * 1000 - (now - lastVisibleAt))
      return
    }

    const state = sessions.get(sessionId)
    if (state === undefined) return
    // 任何帧（含工具调用、思考、step 结束）都算「这个会话还活着」——
    // 它只用于淘汰排序，不参与静默计时。
    state.lastActivityAt = Date.now()

    // step 结束到下一步开始之间，模型在等响应，用户同样什么都看不到，计时必须继续
    if (frame.type === 'end') return
    if (frame.type !== 'chunk') return

    const chunk = frame.chunk
    if (chunk === undefined || chunk === null || typeof chunk.type !== 'string') return

    if (chunk.type === 'text-delta') {
      if (typeof chunk.text !== 'string' || chunk.text === '') return
      markVisible(state)
      return
    }
    if (chunk.type === 'block-start' && chunk.blockType === 'text') {
      markVisible(state)
      return
    }
    // tool-call-delta / block-start(tool-call) / reasoning-delta：
    // 调工具和纯思考都不算「用户看见了东西」，不重置计时——密集调工具恰恰最该提示。
  }

  function markVisible(state) {
    state.lastVisibleAt = Date.now()
    state.lastActivityAt = state.lastVisibleAt
    const hadDue = state.due === true
    // 模型自己开口了：之前排的那次汇报不用再补一刀，否则会出现一段自问自答
    state.due = false
    state.dueSilentMs = null
    // `due` 意味着此刻**没有**定时器在跑。迟到的正文把它清掉之后必须重新排一次，
    // 否则本步余下的静默就永远算不到（单步长执行的回合会整段漏掉提醒）。
    if (hadDue && state.timer === null) arm(state, effective().silentSeconds * 1000)
  }

  // -------------------------------------------------------------------------
  // ② 注入（唯一入口）
  // -------------------------------------------------------------------------

  /**
   * 这一步是不是已经被取消了（用户在等的时候按了停止）。
   *
   * 除了看 `aborted`，还调用宿主自己的 `throwIfAborted()`（存在时）：它和宿主在用完
   * decision 之后要做的那一下是同一个判断，提前做一次能把「我们已经知道被取消、
   * 却还是把冷却和次数记掉」的窗口压到最小。
   */
  function isAborted(signal) {
    if (signal === null || signal === undefined) return false
    if (signal.aborted === true) return true
    if (typeof signal.throwIfAborted !== 'function') return false
    try {
      signal.throwIfAborted()
      return false
    } catch {
      return true
    }
  }

  async function onPreStep(payload, next) {
    const decision = await next()

    try {
      const current = effective()
      if (!current.enabled) return decision

      // waterfall 契约：只有宿主决定「进入这一步」时才能往里塞消息
      if (decision === null || typeof decision !== 'object' || decision.kind !== 'enter') return decision
      if (!Array.isArray(decision.messages)) return decision

      // 宿主的准入规则：空的首批消息不能被我们变成一次「新请求」。
      // 落在这里的两种情形——新回合的第 1 步、或本来就有待处理输入——都该放它自己去发请求。
      //
      // 注意语义：宿主的 step 从 1 开始数，所以 `step <= 1` 实际等于「每个回合第 1 步永不参与」。
      // 代价是「整个回合只有一步、模型在这一步里想了很久」拿不到中途提醒 —— 那段时间里
      // 根本没有 step 边界可插。README「已知限制」里写明了这个例外，别当成 bug 再改一遍。
      if (decision.messages.length === 0) {
        const step = typeof payload?.step === 'number' ? payload.step : 0
        const pending = Array.isArray(payload?.messages) ? payload.messages.length : 0
        if (step <= 1 || pending > 0) return decision
      }

      const signal = payload?.signal
      if (isAborted(signal)) return decision

      const agent = payload?.agent
      const sessionId = agent?.session?.id
      if (typeof sessionId !== 'string' || sessionId === '') return decision
      if (isSubagentSession(agent)) return decision

      const state = sessions.get(sessionId)
      if (state !== undefined) {
        // 走到 step 边界 = 这个会话还活着（长工具的会话在这期间没有 assistant-stream 帧）
        state.lastActivityAt = Date.now()
      }
      if (state === undefined || state.due !== true) return decision

      const turn = typeof payload.turn === 'number' ? payload.turn : state.turn
      const ledger = ledgerOf(sessionId)
      const used = ledger.byTurn.get(turn) ?? 0
      if (current.maxPerTurn > 0 && used >= current.maxPerTurn) {
        state.due = false
        return decision
      }

      const message = await buildProgressMessage(current.prompt)
      // 顺序很重要：先构造消息、再确认这一步没被取消、最后才记账。
      // 记账（due / lastVisibleAt / lastInjectAt / byTurn）写下去之后，宿主拿到 decision
      // 还会自己再 `signal.throwIfAborted()` 一次 —— 那一下我们拦不住，但至少不能让
      // 「消息最后没进批次」的这次白白吃掉一次冷却和一次单回合配额。
      if (isAborted(signal)) return decision
      const now = Date.now()

      state.due = false
      state.dueSilentMs = null
      state.turn = turn
      // 注入本身算一次可见进展：不推进计时，定时器一醒就会判「仍然静默」而连发
      state.lastVisibleAt = now
      state.lastActivityAt = now
      ledger.lastInjectAt = now
      ledger.byTurn.set(turn, used + 1)
      arm(state, current.silentSeconds * 1000)

      log('info', `[narrator-lite] 注入进度提醒 turn=${turn} step=${payload.step ?? state.step}`)
      return { ...decision, messages: [...decision.messages, message] }
    } catch (error) {
      log('warn', `[narrator-lite] 注入失败（已跳过，不影响本步）：${String(error)}`)
      return decision
    }
  }

  // -------------------------------------------------------------------------
  // ③ 生命周期
  // -------------------------------------------------------------------------

  function onSessionEvent(session, event) {
    const sessionId = session?.id
    if (typeof sessionId !== 'string' || sessionId === '') return
    // 会话上有任何事件都说明它还活着：长工具执行期间没有 assistant-stream 帧，
    // 只靠那些帧判活会把它当成最不活跃的那个淘汰掉。
    const state = sessions.get(sessionId)
    if (state !== undefined) state.lastActivityAt = Date.now()
    if (event?.type !== 'turn/end') return
    const turn = event?.data?.turn
    const ledger = ledgers.get(sessionId)
    if (ledger !== undefined && typeof turn === 'number') ledger.byTurn.delete(turn)
    // 回合彻底结束：清掉计时状态，下一回合由用户发言从零开始
    dropSession(sessionId)
  }

  function onDisposed({ agent } = {}) {
    const sessionId = agent?.session?.id
    if (typeof sessionId !== 'string' || sessionId === '') return
    dropSession(sessionId)
  }

  // -------------------------------------------------------------------------
  // 设置页通道（loopback + 同源）
  // -------------------------------------------------------------------------

  function publicConfig() {
    const current = effective()
    return {
      enabled: current.enabled,
      silentSeconds: current.silentSeconds,
      cooldownSeconds: current.cooldownSeconds,
      maxPerTurn: current.maxPerTurn,
      // 设置页据此决定提示和「能不能保存」：读不到配置时这几个值是默认值，不是用户存过的东西
      configWritable: overrideStatus === 'ok',
      configNote: overrideNote,
    }
  }

  function isLoopback(req) {
    const addr = req.socket?.remoteAddress
    return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
  }

  /**
   * 只校验 loopback 不够：浏览器里任何网页都能 fetch 到 127.0.0.1。
   * Host 头必须是本机（挡 DNS rebinding），带了 Origin 时 Origin 也必须是本机。
   */
  function isCrossOrigin(req) {
    const hostHeader = req.headers?.host
    if (typeof hostHeader === 'string' && hostHeader !== '') {
      const hostName = hostnameOf(`http://${hostHeader}`)
      if (hostName === null || !LOOPBACK_HOSTNAMES.has(hostName)) return true
    }
    const origin = req.headers?.origin
    if (typeof origin !== 'string' || origin === '') return false
    const originHost = hostnameOf(origin)
    return originHost === null || !LOOPBACK_HOSTNAMES.has(originHost)
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          reject(new Error('body too large'))
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8').trim()
        resolve(raw === '' ? {} : JSON.parse(raw))
      })
      req.on('error', reject)
    })
  }

  /** 只接受设置页能改的字段，其余一律丢弃（防止有人往覆盖层里塞任意键）。 */
  function sanitizePatch(body) {
    const patch = {}
    if (body === null || typeof body !== 'object') return patch
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
    if (body.silentSeconds !== undefined) {
      patch.silentSeconds = clampInt(body.silentSeconds, DEFAULTS.silentSeconds, SILENT_SECONDS_MIN, SILENT_SECONDS_MAX)
    }
    if (body.cooldownSeconds !== undefined) {
      patch.cooldownSeconds = clampInt(body.cooldownSeconds, DEFAULTS.cooldownSeconds, 0, SILENT_SECONDS_MAX)
    }
    return patch
  }

  async function handleConfigRequest(req, res) {
    const json = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    const reply = (status, payload) => {
      res.writeHead(status, json)
      res.end(JSON.stringify(payload))
    }

    if (!isLoopback(req) || isCrossOrigin(req)) return reply(403, { ok: false, error: 'forbidden' })
    // 每次请求都走 ensureOverride：读到可信内容后它直接返回，读失败过的话这里就是重试点
    await ensureOverride()

    if (req.method === 'GET') return reply(200, { ok: true, config: publicConfig() })
    if (req.method !== 'POST') return reply(405, { ok: false, error: 'method-not-allowed' })

    // 读不到现有配置时不能整份覆盖写：手里这份 `{}` 是假的，合并进去等于把用户存的设置抹掉
    if (overrideStatus !== 'ok') {
      return reply(409, {
        ok: false,
        error: 'config-unreadable',
        message: '读不到现有配置文件，为避免覆盖你的设置，这次修改没有保存；修好文件后点「重新读取」再试',
      })
    }

    const contentType = req.headers?.['content-type']
    if (typeof contentType === 'string' && !contentType.includes('application/json')) {
      return reply(415, { ok: false, error: 'unsupported-media-type' })
    }

    try {
      const patch = sanitizePatch(await readBody(req))
      override = { ...override, ...patch }
      let persisted = true
      try {
        await writeOverride(override)
        // 写成功了：损坏备份的提示就没意义了（那次坏文件已经备份走，现在是全新一份）
        overrideNote = null
      } catch (error) {
        persisted = false
        log('warn', `[narrator-lite] 配置写入失败（本次仍然生效）：${String(error)}`)
      }
      // 关掉开关时立刻停表，不用等下一次 tick
      if (override.enabled === false) {
        for (const state of sessions.values()) clearTimer(state)
        sessions.clear()
        // 账本一起清：否则重新打开时，旧回合的配额还会挡着第一次提醒
        ledgers.clear()
      }
      return reply(200, { ok: true, config: publicConfig(), persisted })
    } catch (error) {
      return reply(400, { ok: false, error: String(error) })
    }
  }

  function registerRoutes(child) {
    const server = child?.webServer
    if (server === undefined || server === null || typeof server.register !== 'function') return
    child.effect(() => {
      const route = server.register({
        kind: 'exact',
        path: '/narrator-lite/api/config',
        handler: (req, res) => {
          void handleConfigRequest(req, res)
        },
      })
      return () => {
        try {
          route?.()
        } catch {
          // 卸载时关掉路由失败不该抛给宿主
        }
      }
    })
  }

  if (typeof ctx.inject === 'function') ctx.inject(['webServer'], registerRoutes)

  // 注册事件监听 + 定时器清理，统一挂在一个 effect 上：插件卸载时定时器必须一起收掉。
  ctx.effect(() => {
    const offs = [
      ctx.on('agent/assistant-stream', onStream, { global: true }),
      ctx.on('agent/pre-step', onPreStep, { global: true }),
      ctx.on('session/event', onSessionEvent, { global: true }),
      ctx.on('agent/disposed', onDisposed, { global: true }),
    ]

    return () => {
      for (const off of offs) {
        if (typeof off === 'function') {
          try {
            off()
          } catch {
            // 卸载期间的监听器移除失败不致命
          }
        }
      }
      for (const state of sessions.values()) clearTimer(state)
      sessions.clear()
      ledgers.clear()
    }
  })
}
