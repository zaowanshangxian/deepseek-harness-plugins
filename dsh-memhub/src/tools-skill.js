/** 技能工具（第 1 期）：skill_search / skill_load / skill_list / skill_register。 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import fs from 'node:fs'
import path from 'node:path'
import { TOOLS } from './const.js'
import { searchSkills, formatCards, formatList } from './indexer.js'
import { textOutput, ensureDir, isOwner } from './tooling.js'
import { writeAtomic, backupWithStamp } from './frontmatter.js'

export function registerSkillTools(ctx, cfg, cache) {
  ctx.inject(['tools'], (toolsCtx) => {
    const tools = toolsCtx.tools
    if (!tools || typeof tools.register !== 'function') {
      toolsCtx.logger?.warn?.('[memhub] tools service not ready — skill tools unavailable')
      return
    }
    const output = textOutput()
    const definitions = [
      defineTool({
        name: TOOLS.search,
        description: '查技能库：关键词→候选卡；不返回全文，要用再 skill_load。',
        parameters: {
          query: { type: 'string', description: '任务/关键词。' },
          group: { type: 'string', description: '分组。' },
          limit: { type: 'integer', description: '1-8，默认 3。' },
        },
        output,
        execute: async (args = {}) => {
          try {
            const entries = searchSkills(cache.get().entries, args.query || '', {
              group: args.group,
              limit: args.limit,
            })
            return { text: formatCards(entries, args.query || '') }
          } catch (error) {
            return { text: `技能检索失败：${String(error)}` }
          }
        },
      }),
      defineTool({
        name: TOOLS.load,
        description: '加载技能全文（唯一大 token 调用）。名字不确定先 skill_search。',
        parameters: { name: { type: 'string', description: '技能名。' } },
        output,
        execute: async (args = {}) => {
          try {
            const entry = cache.get().entries.find((item) => item.name === args.name)
            if (!entry) return { text: `技能库里没有「${args.name}」。先 skill_search 查，或 skill_list 浏览。` }
            if (!fs.existsSync(entry.file)) return { text: `技能文件不见了：${entry.file}` }
            const raw = fs.readFileSync(entry.file, 'utf8')
            const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
            return {
              text: `# 技能：${entry.name}\n（源码：${entry.file} ｜ v${entry.version} ｜ 组:${entry.group}）\n\n${body}`,
            }
          } catch (error) {
            return { text: `技能加载失败：${String(error)}` }
          }
        },
      }),
      defineTool({
        name: TOOLS.list,
        description: '列出技能库分组与技能名。',
        parameters: {},
        output,
        execute: async () => {
          try {
            return { text: formatList(cache.get().entries) }
          } catch (error) {
            return { text: `技能列表失败：${String(error)}` }
          }
        },
      }),
      defineTool({
        name: TOOLS.register,
        description: '登记技能；覆盖需 confirm:true（带时间戳备份）。',
        parameters: {
          name: { type: 'string', description: '技能名（kebab-case）。' },
          content: { type: 'string', description: '正文。' },
          trigger: { type: 'string', description: '触发语。' },
          group: { type: 'string', description: '可选：分组。' },
          version: { type: 'string', description: '版本，默认 0.1.0。' },
          confirm: { type: 'boolean', description: '覆盖时必填。' },
        },
        output,
        execute: async (args = {}, context) => {
          try {
            if (!isOwner(cfg, context)) return { text: '技能登记只允许 owner 会话（ownerOnly 已开）。' }
            if (!cfg.allowRegister) return { text: '技能登记已被配置关闭（allowRegister: false）。' }
            const safeName = String(args.name || '').trim()
            if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(safeName)) {
              return { text: '技能名非法：只允许小写字母、数字、连字符，2-64 个字符。' }
            }
            const dir = path.join(cfg.vault, safeName)
            const file = path.join(dir, 'SKILL.md')
            if (fs.existsSync(file) && args.confirm !== true) {
              return { text: `技能 ${safeName} 已存在。覆盖需要 confirm: true（会先做带时间戳备份）。` }
            }
            ensureDir(dir)
            if (fs.existsSync(file)) backupWithStamp(file)
            const frontmatter = [
              '---',
              `name: ${safeName}`,
              `description: ${String(args.trigger || args.content || '').split('\n')[0].slice(0, 80)}`,
              `trigger: ${String(args.trigger || '').split('\n')[0].slice(0, 120)}`,
              `group: ${String(args.group || '未分组').slice(0, 40)}`,
              `version: ${String(args.version || '0.1.0')}`,
              '---',
              '',
            ].join('\n')
            writeAtomic(file, `${frontmatter}${String(args.content || '')}\n`)
            cache.invalidate()
            return { text: `已登记技能 ${safeName}：${file}（旧文件已带时间戳备份）。` }
          } catch (error) {
            return { text: `技能登记失败：${String(error)}` }
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
    toolsCtx.logger?.info?.('[memhub] skill tools registered')
  })
}
