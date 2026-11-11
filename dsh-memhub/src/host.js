/**
 * dsh-memhub · Host 侧组装器（第 1–9 期）
 *
 * 读配置 → 建缓存 → 注册模块（技能/记忆/学习/自我/情感/人格/面板）→ 自检。
 * 具体逻辑都在纯模块里；写用户文件的路径全部「时间戳备份 + 原子写」。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { HINT_TEXT, DEFAULT_VAULT, DEFAULT_SHARED_ROOT, DATA_ROOT } from './const.js'
import { loadSkillVaults, skillCategory } from './indexer.js'
import { loadZzerxMemories, buildSidecars, writeSidecars, readSidecarMap, zzerxRoot, sidecarRoot } from './recall-store.js'
import { loadOrbs, orbPathFor } from './orb-store.js'
import { buildRecallBlock, DEFAULT_BUDGET_CHARS } from './recall-scheduler.js'
import { loadState, effectiveState, renderAffectBlock } from './affect.js'
import { checkText, loadSafetyState, totalWater, levelOf } from './safety.js'
import { noteSummary } from './selfnote.js'
import { loadLessons } from './lessons.js'
import { loadLedger, summarizeLedger, revisionProposal } from './promote.js'
import { planGovernance, applyArchive } from './govern.js'
import { runJanitor, planJanitor, DEFAULT_MAX_ORBS, DEFAULT_DEDUPE_THRESHOLD, SNAPSHOT_KEEP } from './janitor.js'
import { buildGraph, loadEntities, loadEdges } from './graph.js'
import { graphRoot, mergeById } from './graph-store.js'
import { graphPageHtml } from '../lib/graph-page.js'
import { loadPersona, savePersona, effectivePersona, renderPersonaBlock, evolvePersona } from './persona.js'
import { buildIndexDoc, writeIndexDoc } from './index-doc.js'
import { registerSkillTools } from './tools-skill.js'
import { registerRecallTools } from './tools-recall.js'
import { registerLearnTools } from './tools-learn.js'
import { ensureDir } from './tooling.js'
import { addFlag, removeFlag, writeAtomic, backupWithStamp } from './frontmatter.js'

export const name = 'dsh-memhub'
export const inject = []

function expandHome(input) {
  const value = String(input || '')
  return value.startsWith('~') ? path.join(os.homedir(), value.slice(1)) : value
}

function normalizeConfig(config = {}) {
  const recall = config.recall || {}
  const owners = (value) => (Array.isArray(value) ? value.map(String) : [])
  return {
    vault: expandHome(String(config.vault || DEFAULT_VAULT)),
    // 额外技能库（如游戏技能库）：单独目录、按需检索，不写回主库
    extraVaults: (Array.isArray(config.extraVaults) ? config.extraVaults : [])
      .map((item) => (typeof item === 'string' ? { path: item, label: '' } : item || {}))
      .map((item) => ({ path: expandHome(String(item.path || '')), label: String(item.label || '') }))
      .filter((item) => item.path)
      .map((item) => ({ path: item.path, label: item.label || path.basename(item.path).replace(/^skills-/, '') || 'extra' })),
    sharedRoot: expandHome(String(config.sharedRoot || DEFAULT_SHARED_ROOT)),
    allowRegister: config.allowRegister !== false,
    owner: {
      only: config.ownerOnly === true || recall.ownerOnly === true,
      sessions: owners(config.ownerSessions || recall.ownerSessions),
    },
    recall: {
      enabled: recall.enabled !== false,
      // 2026-11-11：默认 memhub。zzerx 已卸，旧默认 'zzerx' + 配置漏写/写错 =
      // 读到空库、注入块只剩标题，而且日志里看不出来。回滚旧库要显式写 'zzerx'。
      source: recall.source === 'zzerx' ? 'zzerx' : 'memhub',
      sourceRoot: expandHome(String(recall.sourceRoot || zzerxRoot())),
      budgetChars: Number(recall.budgetChars ?? DEFAULT_BUDGET_CHARS),
    },
    learn: { enabled: config.learn?.enabled !== false },
    self: { enabled: config.self?.enabled !== false },
    affect: { enabled: config.affect?.enabled !== false },
    persona: {
      enabled: config.persona?.enabled !== false,
      // auto：工程会话（L:\DSH\work）只用蓝图；always：一直带情感偏置；baseline：永远只有蓝图
      mode: ['auto', 'always', 'baseline'].includes(config.persona?.mode) ? config.persona.mode : 'auto',
      evolveIntervalDays: Number(config.persona?.evolveIntervalDays ?? 7),
    },
    panel: { enabled: config.panel?.enabled !== false },
    // 安全阀（2026-11-11 新增）：检测 + 分级 + 转人工。默认开。
    safety: { enabled: config.safety?.enabled !== false },
    // janitor：容量上限 + 淘汰；去重合并只出报告，要靠 CLI --apply 人工确认
    janitor: {
      enabled: config.janitor?.enabled !== false,
      autoEvict: config.janitor?.autoEvict !== false,
      maxOrbs: Number(config.janitor?.maxOrbs ?? DEFAULT_MAX_ORBS),
      dedupeThreshold: Number(config.janitor?.dedupeThreshold ?? DEFAULT_DEDUPE_THRESHOLD),
      snapshotKeep: Number(config.janitor?.snapshotKeep ?? SNAPSHOT_KEEP),
      archiveBuffer: Number(config.janitor?.archiveBuffer ?? 1.2),
    },
  }
}

/** 技能索引缓存：内容签名 = 所有 SKILL.md mtime 之和（多库合并）。 */
function createIndexCache(vaults) {
  let cached = null
  return {
    get() {
      const index = loadSkillVaults(vaults)
      if (cached && cached.signature === index.signature) return cached.index
      cached = { signature: index.signature, index }
      return index
    },
    invalidate() {
      cached = null
    },
  }
}

/** 记忆缓存：zzerx 或自有 orb；合并旧 sidecar 的 recall/archived/evergreen。 */
function createRecallCache(cfg) {
  let cached = null
  return {
    get() {
      const dir = path.join(cfg.recall.sourceRoot, 'memories')
      let signature = 0
      if (cfg.recall.source === 'zzerx') {
        try {
          for (const file of fs.readdirSync(dir)) signature += fs.statSync(path.join(dir, file)).mtimeMs
        } catch {
          /* 记忆库不存在 */
        }
      } else {
        try {
          signature = fs.statSync(path.join(DATA_ROOT, 'orbs')).mtimeMs
        } catch {
          /* orbs 不存在 */
        }
      }
      if (cached && cached.signature === signature) return cached.data
      const { entries, errors } =
        cfg.recall.source === 'memhub'
          ? loadOrbs(DATA_ROOT, cfg.sharedRoot)
          : loadZzerxMemories(cfg.recall.sourceRoot)
      const sidecarDir = sidecarRoot()
      const usage = {}
      for (const [id, old] of readSidecarMap(sidecarDir)) usage[id] = old.recall || { count: 0, last: null }
      const fresh = buildSidecars(entries, usage)
      let sidecars = fresh
      try {
        sidecars = writeSidecars(sidecarDir, fresh).sidecars
      } catch {
        /* sidecar 写失败不影响注入 */
      }
      cached = { signature, data: { entries, sidecars, errors } }
      return cached.data
    },
    invalidate() {
      cached = null
    },
  }
}

// ── 提示注入：技能一行（最底部）+ 记忆 / 情感 / 自我 / 人格 / 索引 ─────
function registerPrompt(ctx, cfg, caches) {
  ctx.inject(['systemPrompt'], (promptCtx) => {
    const addContext = (name, order, text) => {
      try {
        promptCtx.systemPrompt.context({ name, order, text })
      } catch (error) {
        promptCtx.logger?.warn?.(`[memhub] ${name} context skipped: ${String(error)}`)
      }
    }
    try {
      promptCtx.systemPrompt.section({ name: 'memhub:skills', order: 90000, text: HINT_TEXT })
    } catch (error) {
      promptCtx.logger?.warn?.(`[memhub] skill hint skipped: ${String(error)}`)
    }
    if (cfg.recall.enabled) {
      addContext('memhub:recall', 901, () => {
        try {
          return buildRecallBlock(caches.recall.get().sidecars, {
            budgetChars: cfg.recall.budgetChars,
            workspace: /DSH[\/]/i.test(process.cwd()) ? process.cwd() : '',
          }).text
        } catch {
          return ''
        }
      })
    }
    if (cfg.affect.enabled) {
      addContext('memhub:affect', 902, () => {
        try {
          return renderAffectBlock(effectiveState(loadState(DATA_ROOT)))
        } catch {
          return ''
        }
      })
    }
    if (cfg.self.enabled) {
      addContext('memhub:self', 903, () => {        try {
          const summary = noteSummary(DATA_ROOT)
          return summary ? `## 自我\n最新：${summary.title}（${summary.count} 段活跃）` : ''
        } catch {
          return ''
        }
      })
    }
    if (cfg.persona.enabled) {
      addContext('memhub:persona', 904, () => {
        try {
          const persona = loadPersona(DATA_ROOT)
          // 工程模式只用蓝图：工作区在 L:\DSH\work 时不叠加情感偏置
          const engineering =
            cfg.persona.mode === 'baseline' ||
            (cfg.persona.mode === 'auto' && /DSH[\\/]work/i.test(process.cwd()))
          // 派生 mood 并进性格参数块（一个参数，不单独开块 —— 规格 v3 L466）
          const affect = effectiveState(loadState(DATA_ROOT))
          const moodParam = { mood: affect.mood, intensity: affect.intensity }
          return renderPersonaBlock(
            engineering ? { ...persona, offsets: {}, ...moodParam } : { ...effectivePersona(persona), ...moodParam },
          )
        } catch {
          return ''
        }
      })
    }
    // 2026-11-11：安全阀只在「水位上来」时才占文字；平时 0 字符。
    // 为什么值得占：这是底线，不是拟人（规格 v3 没有这条，属新增——见 CHANGELOG）。
    if (cfg.safety.enabled) {
      addContext('memhub:safety', 906, () => {
        try {
          const water = totalWater(loadSafetyState(DATA_ROOT))
          if (water < 25) return ''
          return `## 安全阀\nlevel ${levelOf(water)}｜水位 ${water.toFixed(1)}｜对方状态可能不对，先关心再干活`
        } catch {
          return ''
        }
      })
    }
    addContext(
      'memhub:index',
      905,
      () => `## 索引\n分类目录：${path.join(DATA_ROOT, 'INDEX.md')}（记忆/技能/教训/自我）`,
    )
  })
}

// ── 面板 API ────────────────────────────────────────────────────────────
function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 64 * 1024) throw new Error('body too large')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw.trim() ? JSON.parse(raw) : {}
}

function toggleSkill(cache, name, enabled) {
  const entry = cache.get().entries.find((item) => item.name === name)
  if (!entry) return { ok: false, error: `没有技能「${name}」` }
  const text = fs.readFileSync(entry.file, 'utf8')
  const next = enabled ? removeFlag(text) : addFlag(text)
  if (next === null) return { ok: false, error: '技能没有 frontmatter，无法启停' }
  if (next === text) return { ok: true, changed: false }
  backupWithStamp(entry.file)
  writeAtomic(entry.file, next)
  cache.invalidate()
  return { ok: true, changed: true }
}

function setMemoryTier(id, tier) {
  if (!['core', 'long', 'mid', 'event'].includes(tier)) {
    return { ok: false, error: 'tier 必须是 core/long/mid/event' }
  }
  const file = path.join(sidecarRoot(), `${id}.json`)
  if (!fs.existsSync(file)) return { ok: false, error: '没有这条记忆' }
  const sidecar = JSON.parse(fs.readFileSync(file, 'utf8'))
  backupWithStamp(file)
  sidecar.tier = tier
  sidecar.tierOverride = tier
  sidecar.status = tier === 'core' ? 'core' : sidecar.archived ? 'archived' : 'active'
  writeAtomic(file, JSON.stringify(sidecar, null, 2))
  return { ok: true, tier }
}

function buildState(cfg, caches) {
  const skills = caches.skill.get()
  const data = caches.recall.get()
  const governance = planGovernance(data.sidecars)
  const ledger = summarizeLedger(loadLedger(DATA_ROOT))
  const lessons = loadLessons(cfg.sharedRoot).items
  const persona = loadPersona(DATA_ROOT)
  return {
    ok: true,
    skills: skills.entries.map((entry) => ({
      name: entry.name,
      group: entry.group,
      category: skillCategory(entry),
      description: entry.description,
      hidden: entry.hidden,
    })),
    recall: {
      count: data.sidecars.length,
      byTier: data.sidecars.reduce((acc, item) => {
        acc[item.tier] = (acc[item.tier] || 0) + 1
        return acc
      }, {}),
      toArchive: governance.filter((item) => item.action === 'archive').length,
      source: cfg.recall.source,
    },
    affect: effectiveState(loadState(DATA_ROOT)),
    self: noteSummary(DATA_ROOT),
    persona: { baseline: persona, effective: effectivePersona(persona) },
    lessons: lessons.slice(-10),
    ledger: ledger.slice(0, 20),
    revisions: revisionProposal(ledger),
    indexPath: path.join(DATA_ROOT, 'INDEX.md'),
  }
}

function registerPanelApi(ctx, cfg, caches) {
  if (!cfg.panel.enabled) return
  ctx.inject(['webServer'], (webCtx) => {
    try {
      let warnedLegacyGraph = false // 只在首次拉图时提示一次，不刷日志
      const handler = async (req, res) => {
        try {
          // ownerOnly 时面板写接口一律禁用：HTTP 请求没有会话身份，不能绕过工具层的门
          if (req.method === 'POST' && cfg.owner.only) {
            sendJson(res, 403, { ok: false, error: 'ownerOnly 已开：面板写操作被禁用，请走工具调用。' })
            return
          }
          const pathname = String(req.url || '').split('?')[0].replace(/\/+$/, '')
          if (pathname.endsWith('/api/state') && req.method === 'GET') {
            sendJson(res, 200, buildState(cfg, caches))
            return
          }
          if (pathname.endsWith('/api/graph') && req.method === 'GET') {
            const data = caches.recall.get()
            // 双源：zzerx 的实体/边（迁移前） + memhub 自有的（迁移后/新写入），同 id 本地优先
            const localRoot = graphRoot(DATA_ROOT)
            const localEntities = loadEntities(localRoot)
            const localEdges = loadEdges(localRoot)
            // 旧 zzerx 图只是可选遗留源：插件卸掉后目录不存在 → 只用本地。
            // 本地也没有图（= 没迁移过）才提示；否则 82 实体 / 2013 边会「安静地」消失。
            if (!warnedLegacyGraph && !fs.existsSync(path.join(zzerxRoot(), 'entities'))) {
              warnedLegacyGraph = true
              if (localEntities.length === 0 && localEdges.length === 0) {
                webCtx.logger?.warn?.(
                  '[memhub] 星图：旧 zzerx 实体/边目录不存在，本地也没迁移过（先跑 tools/migrate-memory.mjs --apply），星图会是空的',
                )
              }
            }
            const entities = mergeById(loadEntities(zzerxRoot()), localEntities)
            const edges = mergeById(loadEdges(zzerxRoot()), localEdges)
            sendJson(res, 200, {
              ok: true,
              graph: buildGraph({ sidecars: data.sidecars, entities, edges }),
            })
            return
          }
          if (pathname.endsWith('/api/index') && req.method === 'GET') {
            try {
              sendJson(res, 200, { ok: true, text: fs.readFileSync(path.join(DATA_ROOT, 'INDEX.md'), 'utf8') })
            } catch {
              sendJson(res, 200, { ok: true, text: '（索引还没生成）' })
            }
            return
          }
          if (pathname.endsWith('/api/skill/toggle') && req.method === 'POST') {
            const body = await readBody(req)
            sendJson(res, 200, toggleSkill(caches.skill, String(body.name || ''), body.enabled !== false))
            return
          }
          if (pathname.endsWith('/api/memory/archive') && req.method === 'POST') {
            const body = await readBody(req)
            const sidecar = applyArchive(sidecarRoot(), String(body.id || ''), body.archived !== false)
            caches.recall.invalidate()
            sendJson(res, 200, { ok: true, archived: sidecar.archived })
            return
          }
          if (pathname.endsWith('/api/memory/tier') && req.method === 'POST') {
            const body = await readBody(req)
            const result = setMemoryTier(String(body.id || ''), String(body.tier || ''))
            caches.recall.invalidate()
            sendJson(res, result.ok ? 200 : 400, result)
            return
          }
          if (pathname.endsWith('/api/persona/evolve') && req.method === 'POST') {
            const body = await readBody(req)
            const result = evolvePersona(
              loadPersona(DATA_ROOT),
              { key: body.key, delta: body.delta },
              { intervalMs: cfg.persona.evolveIntervalDays * 86_400_000 },
            )
            if (result.error) {
              sendJson(res, 400, { ok: false, error: result.error })
              return
            }
            savePersona(DATA_ROOT, result.persona)
            sendJson(res, 200, { ok: true, persona: result.persona })
            return
          }
          sendJson(res, 404, { ok: false, error: 'unknown memhub endpoint' })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error) })
        }
      }
      webCtx.effect(
        () => webCtx.webServer.register({ kind: 'prefix', path: '/memhub/api', handler }),
        'memhub: panel API',
      )
      // 独立星图页：打开才拉一次数据，不轮询、不常驻
      webCtx.effect(
        () =>
          webCtx.webServer.register({
            kind: 'prefix',
            path: '/memhub/graph',
            handler: (req, res) => {
              try {
                res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
                res.end(graphPageHtml())
              } catch (error) {
                res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
                res.end(String(error))
              }
            },
          }),
        'memhub: graph page',
      )
      webCtx.logger?.info?.('[memhub] panel API registered at /memhub/api；独立星图页 /memhub/graph')
    } catch (error) {
      webCtx.logger?.warn?.(`[memhub] panel API skipped: ${String(error)}`)
    }
  })
}

// ── 启动治理：只做「超容量淘汰」，合并/删库一类动作永远留给人工 CLI ──────────
function runStartupJanitor(ctx, cfg, caches) {
  if (!cfg.janitor.enabled || !cfg.janitor.autoEvict) return null
  try {
    const data = caches.recall.get()
    // 启动只算淘汰，不算去重（O(n²) 同步阻塞，见 REVIEW-janitor G-7）
    const plan = planJanitor(data.sidecars, { maxOrbs: cfg.janitor.maxOrbs, archiveBuffer: cfg.janitor.archiveBuffer, dedupe: false })
    if (plan.overflow === 0) return { plan, result: null }
    if (plan.capped) {
      ctx.logger?.warn?.(
        `[memhub] janitor：上限 ${plan.maxOrbs} 达不到——protected ${plan.active - plan.evictable} 条不参与淘汰`,
      )
    }
    const result = runJanitor({
      dataRoot: DATA_ROOT,
      sharedRoot: cfg.sharedRoot,
      sidecarDir: sidecarRoot(),
      sidecars: data.sidecars,
      options: { maxOrbs: cfg.janitor.maxOrbs, snapshotKeep: cfg.janitor.snapshotKeep, archiveBuffer: cfg.janitor.archiveBuffer, dedupe: false },
      apply: true,
      merge: false, // 自动治理只淘汰；去重合并走 tools/janitor.mjs --apply
      orbPathFor: (record) => orbPathFor(record, DATA_ROOT, cfg.sharedRoot),
    })
    caches.recall.invalidate()
    if (result.evicted.length > 0) {
      ctx.logger?.info?.(
        `[memhub] janitor 淘汰 ${result.evicted.length} 条（上限 ${plan.maxOrbs}），快照 ${result.snapshot?.id}`,
      )
    }
    return { plan, result }
  } catch (error) {
    ctx.logger?.warn?.(`[memhub] janitor 跳过：${String(error)}`)
    return null
  }
}

// ── 启动自检 + 索引生成 ──────────────────────────────────────────────────
function runSelfCheck(ctx, cfg, caches, janitor) {
  try {
    const skills = caches.skill.get()
    const stats = { skills: skills.entries.length, recallSource: cfg.recall.source }
    let data = { sidecars: [] }
    if (cfg.recall.enabled) {
      data = caches.recall.get()
      stats.memories = data.sidecars.length
      stats.memoryErrors = data.errors.length
      // 静默失败的可见信号：源读不出来（典型：zzerx 已卸、source 还指着它）
      // 以前只体现在 memories=0 这个数字上，日志里一句话都没有。
      if (data.errors.length > 0) {
        ctx.logger?.warn?.(
          `[memhub] 记忆源「${cfg.recall.source}」读取有 ${data.errors.length} 个错误，注入会变少：${String(data.errors[0]?.error || '')}`,
        )
      }
      stats.byTier = data.sidecars.reduce((acc, item) => {
        acc[item.tier] = (acc[item.tier] || 0) + 1
        return acc
      }, {})
    }
    // 治理产物也进自检：静默失败要看产物（淘汰几条、上限够不够、日志有没有断）
    stats.janitor = {
      evicted: janitor?.result?.evicted?.length || 0,
      merged: janitor?.result?.merged?.length || 0,
      skipped: janitor?.result?.skipped?.length || 0,
      overflow: janitor?.plan?.overflow || 0,
      capped: Boolean(janitor?.plan?.capped),
      evictable: janitor?.plan?.evictable || 0,
      logErrors: janitor?.result?.logErrors?.length || 0,
      snapshot: janitor?.result?.snapshot?.id || null,
    }
    ensureDir(DATA_ROOT)
    try {
      const personaFile = path.join(DATA_ROOT, 'persona', 'baseline.json')
      if (!fs.existsSync(personaFile)) savePersona(DATA_ROOT, loadPersona(DATA_ROOT))
      const indexText = buildIndexDoc({
        sidecars: data.sidecars,
        skills: skills.entries.map((entry) => ({ ...entry, category: skillCategory(entry) })),
        lessons: loadLessons(cfg.sharedRoot).items,
        self: noteSummary(DATA_ROOT),
        persona: loadPersona(DATA_ROOT),
      })
      stats.indexFile = writeIndexDoc(DATA_ROOT, indexText)
    } catch {
      /* 索引生成失败不影响插件 */
    }
    try {
      writeAtomic(path.join(DATA_ROOT, 'self-check.json'), JSON.stringify(stats, null, 2))
    } catch {
      /* 落盘失败不影响 */
    }
    ctx.logger?.info?.(`[memhub] self-check ${JSON.stringify(stats)}`)
  } catch (error) {
    ctx.logger?.warn?.(`[memhub] 自检跳过：${String(error)}`)
  }
}

/**
 * 安全阀的「自动触发点」。
 *
 * 为什么必须挂事件：盲审 B 指出只有 `safety_check` 工具入口 = 靠模型每轮记得调，
 * 当「底线」不够用。挂在 `agent/pre-step`：每个 step 前把用户这轮的话过一遍检测，
 * 触发后只推进水槽（不改 decision、不注入消息），下一轮由「## 安全阀」块自然出现。
 * 去重：同一段文本只算一次（pre-step 每步都会带同一批 messages）。
 */
function attachSafetyHook(ctx, cfg) {
  if (!cfg.safety?.enabled || typeof ctx.on !== 'function' || typeof ctx.effect !== 'function') return
  let lastText = ''
  ctx.effect(() => {
    const off = ctx.on(
      'agent/pre-step',
      async (payload, next) => {
        const decision = await next()
        try {
          if (decision === null || typeof decision !== 'object' || decision.kind !== 'enter') return decision
          const messages = Array.isArray(payload?.messages) ? payload.messages : []
          const text = messages
            .map((m) => (typeof m?.content === 'string' ? m.content : ''))
            .filter(Boolean)
            .join('\n')
            .slice(0, 4000)
            .trim()
          if (!text || text === lastText) return decision
          lastText = text
          checkText({ text, root: DATA_ROOT, persist: true })
        } catch {
          /* 安全阀不能妨碍主流程：检测失败按"没检测到"处理 */
        }
        return decision
      },
      { global: true },
    )
    return () => {
      if (typeof off === 'function') off()
    }
  })
}

export function apply(ctx, config = {}) {
  const cfg = normalizeConfig(config)
  const caches = {
    skill: createIndexCache([{ path: cfg.vault, label: 'core' }, ...cfg.extraVaults]),
    recall: createRecallCache(cfg),
  }
  registerSkillTools(ctx, cfg, caches.skill)
  registerRecallTools(ctx, cfg, caches.recall)
  registerLearnTools(ctx, cfg, caches)
  registerPrompt(ctx, cfg, caches)
  registerPanelApi(ctx, cfg, caches)
  attachSafetyHook(ctx, cfg)
  const janitorResult = runStartupJanitor(ctx, cfg, caches)
  runSelfCheck(ctx, cfg, caches, janitorResult)
}
