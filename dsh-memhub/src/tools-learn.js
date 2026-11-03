/** 学习/自我/情感工具（第 3–5 期）。写类工具统一过 owner 门。 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { DATA_ROOT } from './const.js'
import { makeLesson, loadLessons, saveLessons, matchLessons, bumpRecurrence } from './lessons.js'
import { recordOutcome, loadLedger, summarizeLedger, revisionProposal, draftSkillFromMemories } from './promote.js'
import { writeNote, noteSummary, buildIslands } from './selfnote.js'
import { loadState, saveState, updateFromEvent, blend, explainState, pinMood, effectiveState } from './affect.js'
import { textOutput, ensureDir, isOwner } from './tooling.js'
import { loadPersona, savePersona, affectOffsets } from './persona.js'

const WRITE_DENIED = '这个写操作只允许 owner 会话（ownerOnly 已开）。'

export function registerLearnTools(ctx, cfg, caches) {
  if (!cfg.learn.enabled) return
  ctx.inject(['tools'], (toolsCtx) => {
    const tools = toolsCtx.tools
    if (!tools || typeof tools.register !== 'function') return
    const output = textOutput()
    const definitions = [
      defineTool({
        name: 'lesson_save',
        description: '记教训；trigger 必须「当 X 时」，同 trigger 复发+1。',
        parameters: {
          trigger: { type: 'string', description: '当 X 时。' },
          wrong: { type: 'string', description: '错在哪。' },
          right: { type: 'string', description: '正确做法。' },
          evidence: { type: 'string', description: '证据。' },
        },
        output,
        execute: async (args = {}, context) => {
          try {
            if (!isOwner(cfg, context)) return { text: WRITE_DENIED }
            const built = makeLesson(args)
            if (built.error) return { text: built.error }
            ensureDir(DATA_ROOT)
            const { items, badLines } = loadLessons(cfg.sharedRoot)
            const existing = items.find((item) => item.trigger === built.lesson.trigger)
            if (existing) {
              bumpRecurrence(items, existing.id)
              saveLessons(cfg.sharedRoot, items, badLines)
              return { text: `同 trigger 已存在，复发 +1（当前 ${existing.recurrence} 次）。` }
            }
            items.push(built.lesson)
            saveLessons(cfg.sharedRoot, items, badLines)
            return { text: `已记教训 ${built.lesson.id}：${built.lesson.trigger}` }
          } catch (error) {
            return { text: `记教训失败：${String(error)}` }
          }
        },
      }),
      defineTool({
        name: 'lesson_match',
        description: '动手前查教训（≤3 条，只读）。',
        parameters: { situation: { type: 'string', description: '当前情境。' } },
        output,
        execute: async (args = {}) => {
          try {
            const { items } = loadLessons(cfg.sharedRoot)
            const matched = matchLessons(items, args.situation || '', 3)
            if (matched.length === 0) return { text: '没有匹配的教训。' }
            return { text: matched.map((lesson) => `- ${lesson.trigger} → ${lesson.right}`).join('\n') }
          } catch (error) {
            return { text: `匹配教训失败：${String(error)}` }
          }
        },
      }),
      defineTool({
        name: 'lesson_graduate',
        description: '复发≥3 教训升格提案（人确认才落盘）。',
        parameters: { id: { type: 'string', description: '教训 id。' } },
        output,
        execute: async (args = {}) => {
          try {
            const lesson = loadLessons(cfg.sharedRoot).items.find((item) => item.id === args.id)
            if (!lesson) return { text: `没有 id 为「${args.id}」的教训。` }
            if (Number(lesson.recurrence || 0) < 3) {
              return { text: `这条只复发 ${lesson.recurrence || 0} 次（门槛 3 次），先继续累积。` }
            }
            return {
              text: [
                '## 升格提案（需人工确认）',
                `教训：${lesson.trigger}`,
                `正确做法：${lesson.right}`,
                '',
                '可落成：技能的一段「陷阱」或 AGENTS.md 一条硬规则；确认后手动写入。',
              ].join('\n'),
            }
          } catch (error) {
            return { text: `升格提案失败：${String(error)}` }
          }
        },
      }),
      defineTool({
        name: 'promote_to_skill',
        description: '≥3 条记忆→技能草案（不写库）。',
        parameters: {
          ids: { type: 'array', description: '记忆 id，≥3 条。', items: { type: 'string' } },
          name: { type: 'string', description: '技能名。' },
          trigger: { type: 'string', description: '可选：触发语。' },
        },
        output,
        execute: async (args = {}) => {
          try {
            const data = caches.recall.get()
            const result = draftSkillFromMemories(data.entries, Array.isArray(args.ids) ? args.ids : [], {
              name: args.name,
              trigger: args.trigger,
            })
            if (result.error) return { text: result.error }
            return { text: `# 技能草案：${result.draft.name}\n\n${result.draft.content}` }
          } catch (error) {
            return { text: `生成技能草案失败：${String(error)}` }
          }
        },
      }),
      defineTool({
        name: 'skill_outcome',
        description: '回写技能成败，用于成功率与改版。',
        parameters: {
          skill: { type: 'string', description: '技能名。' },
          success: { type: 'boolean', description: '是否成功。' },
          note: { type: 'string', description: '失败原因。' },
        },
        output,
        execute: async (args = {}, context) => {
          try {
            if (!isOwner(cfg, context)) return { text: WRITE_DENIED }
            ensureDir(DATA_ROOT)
            recordOutcome(DATA_ROOT, args.skill, args.success, args.note)
            const summary = summarizeLedger(loadLedger(DATA_ROOT)).find((item) => item.skill === args.skill)
            const revised = revisionProposal(summarizeLedger(loadLedger(DATA_ROOT))).some(
              (item) => item.skill === args.skill,
            )
            return {
              text: `已记录：${args.skill} ${args.success ? '成功' : '失败'}。${
                summary ? `累计 ${summary.total} 次，成功率 ${Math.round(summary.rate * 100)}%。` : ''
              }${revised ? '\n⚠ 失败率偏高，可提改版提案。' : ''}`,
            }
          } catch (error) {
            return { text: `回写技能结果失败：${String(error)}` }
          }
        },
      }),
      defineTool({
        name: 'self_note_write',
        description: '写自我叙述（≤320 字，超 8 段归档最旧）。',
        parameters: { text: { type: 'string', description: '≤320 字。' } },
        output,
        execute: async (args = {}, context) => {
          try {
            if (!isOwner(cfg, context)) return { text: WRITE_DENIED }
            ensureDir(DATA_ROOT)
            const result = writeNote(DATA_ROOT, args.text || '')
            if (result.error) return { text: result.error }
            return {
              text: `已写自我叙述 ${result.file}（${result.chars} 字）${result.archived ? `，最旧一段 ${result.archived} 已归档` : ''}。`,
            }
          } catch (error) {
            return { text: `写自我叙述失败：${String(error)}` }
          }
        },
      }),
      defineTool({
        name: 'self_view',
        description: '查看自我叙述与岛屿。',
        parameters: {},
        output,
        execute: async () => {
          try {
            const summary = noteSummary(DATA_ROOT)
            const islands = buildIslands(caches.recall.get().sidecars)
            const lines = [
              '## 自我叙述',
              summary ? `最新：${summary.title}（${summary.count} 段活跃）` : '（还没有自我叙述）',
              '',
              '## 岛屿（派生）',
              islands.length ? islands.map((island) => `- ${island.sentence}`).join('\n') : '（暂无核心记忆，岛屿为空）',
            ]
            return { text: lines.join('\n') }
          } catch (error) {
            return { text: `查看自我失败：${String(error)}` }
          }
        },
      }),
      defineTool({
        name: 'affect_state',
        description: '情感参数 + 依据。',
        parameters: {},
        output,
        execute: async () => {
          try {
            const state = effectiveState(loadState(DATA_ROOT))
            const explained = explainState(state)
            return {
              text: [
                `mood: ${state.mood} ｜ 强度 ${Number(state.intensity).toFixed(2)} ｜ 亲近 ${Number(state.closeness).toFixed(2)} ｜ 语气软硬 ${Number(state.softness).toFixed(2)} ｜ 表情密度 ${Number(state.emoji_density).toFixed(2)}`,
                `依据：${explained.basis.length ? explained.basis.join(', ') : '（无依据，回落到中性）'}`,
                `约束：${(state.boundaries || []).join('；')}`,
              ].join('\n'),
            }
          } catch (error) {
            return { text: `查看情感失败：${String(error)}` }
          }
        },
      }),
      defineTool({
        name: 'affect_pin',
        description: '指定基调（要原因+期限，到期回落）。',
        parameters: {
          mood: { type: 'string', description: 'warm / playful / neutral / serious / tired / hurt' },
          until: { type: 'string', description: 'ISO 时间。' },
          reason: { type: 'string', description: '原因。' },
        },
        output,
        execute: async (args = {}, context) => {
          try {
            if (!isOwner(cfg, context)) return { text: WRITE_DENIED }
            const result = pinMood(loadState(DATA_ROOT), args.mood, args.until, args.reason)
            if (result.error) return { text: result.error }
            saveState(DATA_ROOT, result.state)
            return { text: `已指定基调：${args.mood}，到 ${args.until}（原因：${args.reason}）。` }
          } catch (error) {
            return { text: `指定基调失败：${String(error)}` }
          }
        },
      }),
      defineTool({
        name: 'affect_event',
        description: '按事件更新情感（规则层+混合公式）。',
        parameters: {
          type: { type: 'string', enum: ['praise', 'correction', 'task', 'chat'], description: '事件类型。' },
          text: { type: 'string', description: '事件摘要。' },
        },
        output,
        execute: async (args = {}, context) => {
          try {
            if (!isOwner(cfg, context)) return { text: WRITE_DENIED }
            const state = loadState(DATA_ROOT)
            const next = updateFromEvent(state, { type: args.type, text: args.text })
            const blended = blend(state, next)
            saveState(DATA_ROOT, blended)
            // 情感 → 性格临时偏置（按记忆 tier 加权；24h 半衰期衰减到 0，不改 baseline）
            try {
              const tiers = (blended.basis || [])
                .map((id) => caches.recall.get().sidecars.find((item) => item.id === id)?.tier)
                .filter(Boolean)
              const persona = loadPersona(DATA_ROOT)
              persona.offsets = affectOffsets(blended, tiers)
              savePersona(DATA_ROOT, persona)
            } catch {
              /* 偏置失败不影响情感状态 */
            }
            return { text: `情感已更新：${blended.mood}（强度 ${blended.intensity}）。` }
          } catch (error) {
            return { text: `更新情感失败：${String(error)}` }
          }
        },
      }),
    ]
    for (const definition of definitions) {
      try {
        tools.register(definition)
      } catch (error) {
        toolsCtx.logger?.warn?.(`[memhub] 工具注册失败 ${definition.name}：${String(error)}`)
      }
    }
    toolsCtx.logger?.info?.('[memhub] learn/self/affect tools registered')
  })
}
