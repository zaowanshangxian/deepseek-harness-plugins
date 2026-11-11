/** 记忆工具（第 2–3 期）：memhub_open / memhub_raw / memhub_budget / memhub_archive。 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { findRawText, sidecarRoot } from './recall-store.js'
import { buildRecallBlock } from './recall-scheduler.js'
import { recordRecall, applyArchive } from './govern.js'
import { saveOrb, loadOrbs } from './orb-store.js'
import { saveEntity, saveLink } from './graph-store.js'
import { searchMemories } from './search.js'
import { DATA_ROOT } from './const.js'
import { loadState, effectiveState, resetMoodCache } from './affect.js'
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
            if (!sidecar) {
              // 双源并存期：sidecar（zzerx）里没有就读本地 orb
              const orb = loadOrbs(DATA_ROOT, cfg.sharedRoot).entries.find((item) => item.id === args.id)
              if (!orb) return { text: `没有 id 为「${args.id}」的记忆。` }
              return {
                text: [
                  `# ${orb.title}`,
                  `id: ${orb.id} ｜ kind: ${orb.kind} ｜ scope: ${orb.scope} ｜ category: ${orb.category || '（旧格式）'} ｜ 情绪: ${orb.emotion || '未标注'}`,
                  `project: ${orb.projectPath || '（无）'} ｜ source: ${orb.source} ｜ 更新: ${new Date(orb.updatedAt || 0).toISOString()}`,
                  '',
                  orb.content,
                ].join('\n'),
              }
            }
            try {
              recordRecall(sidecarRoot(), sidecar.id)
              recallCache.invalidate()
            } catch {
              /* 召回计数失败不影响打开 */
            }
            return {
              text: [
                `# ${sidecar.title}`,
                `id: ${sidecar.id} ｜ tier: ${sidecar.tier} ｜ kind: ${sidecar.kind} ｜ importance: ${sidecar.importance}${sidecar.emotion ? ` ｜ 情绪: ${sidecar.emotion}` : ''}`,
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
            // 「旧库目录不在」和「这条没原文」是两件事：以前一律说「可能已被裁剪」，会把人带偏
            if (found?.missingRoot) {
              return { text: `原文回读不可用：旧库 raw_documents 目录不存在（${found.dir}）。zzerx 卸掉后 L0 原文不再可读。` }
            }
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
      defineTool({
        name: 'memhub_save',
        description: '写记忆到自有 orb（带 id 则覆盖）。',
        parameters: {
          title: { type: 'string', description: '标题' },
          content: { type: 'string', description: '正文 ≤2000 字' },
          id: { type: 'string', description: '覆盖已有' },
          scope: { type: 'string', description: 'global/project/self；project 必填 projectPath' },
          kind: { type: 'string', description: 'fact/decision 等' },
          projectPath: { type: 'string', description: '项目路径' },
          importance: { type: 'number' },
          emotion: { type: 'string', description: 'joy/sad/anger/fear/disgust/anxiety/calm' },
          supersedes: { type: 'string', description: '取代的旧 id（逗号）' },
          contradicts: { type: 'string', description: '矛盾的 id（逗号）' },
          artifact: { type: 'string', description: '产物路径（存 sha256）' },
        },
        output,
        execute: async (args = {}, context) => {
          if (!isOwner(cfg, context)) return { text: '写入只允许 owner 会话（ownerOnly 已开）。' }
          try {
            // 第三层兜底要「写入时的当前 mood」——由派生层现算，不读存档里的旧值
            const mood = effectiveState(loadState(DATA_ROOT)).mood
            const { file, record } = saveOrb({ ...args, mood }, DATA_ROOT, cfg.sharedRoot)
            recallCache.invalidate()
            try {
              resetMoodCache() // 新球进了记忆流，下一秒的 mood 就该看得到
            } catch {
              /* 缓存清理失败不影响写入 */
            }
            return { text: `已写入 ${record.id}（${record.scope}／${record.emotion || '未标注'}）\n${file}` }
          } catch (error) {
            return { text: `写入失败：${String(error.message || error)}` }
          }
        },
      }),
      defineTool({
        name: 'memhub_search',
        description: '搜记忆（标题+正文）；空=最近 5 条。',
        parameters: {
          query: { type: 'string' },
          limit: { type: 'number', description: '1-10' },
        },
        output,
        execute: async (args = {}) => {
          try {
            const data = recallCache.get()
            const limit = Math.max(1, Math.min(10, Number(args.limit) || 5))
            const query = String(args.query || '').trim()
            // 双源并存期：当前源之外补上本地 orb（迁移动工前也能搜到刚写的）
            const known = new Set(data.sidecars.map((item) => item.id))
            const extras = loadOrbs(DATA_ROOT, cfg.sharedRoot).entries
              .filter((orb) => !known.has(orb.id))
              .map((orb) => ({ ...orb, tier: orb.evergreen ? 'long' : 'event', archived: false }))
            const scored = searchMemories([...data.sidecars, ...extras], query, { limit, mode: 'v2' })
            if (!scored.length) return { text: `没有匹配「${query}」的记忆。` }
            return {
              text: `${scored
                .map(
                  ({ item }) =>
                    `- ${item.id} ｜ ${item.tier} ｜${item.emotion ? ` [${item.emotion}] ｜` : ''} ${item.title}${item.supersededBy ? ' ｜（已被取代）' : ''}`,
                )
                .join('\n')}\n（全文用 memhub_open）`,
            }
          } catch (error) {
            return { text: `检索失败：${String(error)}` }
          }
        },
      }),
      defineTool({
        name: 'memhub_graph',
        description: '写实体或边（星图数据）。op=entity 或 link。',
        parameters: {
          op: { type: 'string', description: 'entity/link' },
          name: { type: 'string', description: '实体名（op=entity）' },
          kind: { type: 'string', description: '实体类别' },
          from: { type: 'string', description: '起点 id（op=link）' },
          to: { type: 'string', description: '终点 id（op=link）' },
          relation: { type: 'string', description: '关系，默认 related' },
        },
        output,
        execute: async (args = {}, context) => {
          if (!isOwner(cfg, context)) return { text: '写入只允许 owner 会话（ownerOnly 已开）。' }
          try {
            if (args.op === 'link') {
              const record = saveLink(args, DATA_ROOT)
              return { text: `已连 ${record.from.id} -${record.relation}-> ${record.to.id}` }
            }
            const record = saveEntity(args, DATA_ROOT)
            return { text: `已记实体 ${record.id}（${record.kind}）` }
          } catch (error) {
            return { text: `写图失败：${String(error.message || error)}` }
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
