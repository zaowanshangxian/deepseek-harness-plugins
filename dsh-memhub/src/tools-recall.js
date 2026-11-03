/** 记忆工具（第 2–3 期）：memhub_open / memhub_raw / memhub_budget / memhub_archive。 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { findRawText, sidecarRoot } from './recall-store.js'
import { buildRecallBlock } from './recall-scheduler.js'
import { recordRecall, applyArchive } from './govern.js'
import { textOutput, isOwner } from './tooling.js'

export function registerRecallTools(ctx, cfg, recallCache) {
  if (!cfg.recall.enabled) return
  ctx.inject(['tools'], (toolsCtx) => {
    const tools = toolsCtx.tools
    if (!tools || typeof tools.register !== 'function') return
    const output = textOutput()
    const definitions = [
      defineTool({
        name: 'memhub_open',
        description: '打开记忆全文 + 元数据 + 来源指针。',
        parameters: { id: { type: 'string', description: '记忆 id。' } },
        output,
        execute: async (args = {}, context) => {
          try {
            if (!isOwner(cfg, context)) return { text: '这条记忆只允许 owner 会话打开全文（ownerOnly 已开）。' }
            const data = recallCache.get()
            const sidecar = data.sidecars.find((item) => item.id === args.id)
            if (!sidecar) return { text: `没有 id 为「${args.id}」的记忆。` }
            try {
              recordRecall(sidecarRoot(), sidecar.id)
              recallCache.invalidate()
            } catch {
              /* 召回计数失败不影响打开 */
            }
            return {
              text: [
                `# ${sidecar.title}`,
                `id: ${sidecar.id} ｜ tier: ${sidecar.tier} ｜ kind: ${sidecar.kind} ｜ importance: ${sidecar.importance}`,
                `scope: ${sidecar.scope}${sidecar.projectPath ? ` ｜ project: ${sidecar.projectPath}` : ''}`,
                `来源: ${sidecar.source} ｜ session: ${sidecar.sessionId || '（无）'} ｜ 更新: ${new Date(sidecar.updatedAt).toISOString()}`,
                '',
                sidecar.content,
              ].join('\n'),
            }
          } catch (error) {
            return { text: `打开记忆失败：${String(error)}` }
          }
        },
      }),
      defineTool({
        name: 'memhub_raw',
        description: '回读 L0 原始会话片段（只留最近一批）。',
        parameters: { id: { type: 'string', description: '记忆 id。' } },
        output,
        execute: async (args = {}, context) => {
          try {
            if (!isOwner(cfg, context)) return { text: '原文只允许 owner 会话回读（ownerOnly 已开）。' }
            const found = findRawText(args.id)
            if (!found) return { text: `「${args.id}」没有可回读的原文（只留最近一批，可能已被裁剪）。` }
            const clipped = found.text.length > 4000 ? `${found.text.slice(0, 4000)}\n…（截断）` : found.text
            return { text: `# 原文（${found.file}）\n\n${clipped}` }
          } catch (error) {
            return { text: `原文回读失败：${String(error)}` }
          }
        },
      }),
      defineTool({
        name: 'memhub_budget',
        description: '查看注入预算：选中 id/字符/估算 token。',
        parameters: {},
        output,
        execute: async () => {
          try {
            const data = recallCache.get()
            const block = buildRecallBlock(data.sidecars, {
              budgetChars: cfg.recall.budgetChars,
              workspace: process.cwd(),
            })
            return {
              text: [
                `预算：${block.chars}/${block.budgetChars} 字符 ≈ ${Math.round(block.chars * 0.65)} tokens`,
                `选中：${block.picked.join(', ') || '（无）'}`,
                '',
                block.text,
              ].join('\n'),
            }
          } catch (error) {
            return { text: `预算查看失败：${String(error)}` }
          }
        },
      }),
      defineTool({
        name: 'memhub_archive',
        description: '归档/恢复记忆（只改 sidecar，可恢复）。',
        parameters: {
          id: { type: 'string', description: '记忆 id。' },
          archived: { type: 'boolean', description: '默认归档。' },
        },
        output,
        execute: async (args = {}, context) => {
          try {
            if (!isOwner(cfg, context)) return { text: '归档/恢复只允许 owner 会话（ownerOnly 已开）。' }
            const sidecar = applyArchive(sidecarRoot(), args.id, args.archived !== false)
            try {
              recallCache.invalidate()
            } catch {
              /* 缓存失效失败不影响 */
            }
            return { text: `已${sidecar.archived ? '归档' : '恢复'}「${sidecar.title || sidecar.id}」。` }
          } catch (error) {
            return { text: `归档失败：${String(error)}` }
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
    toolsCtx.logger?.info?.('[memhub] recall tools registered')
  })
}
