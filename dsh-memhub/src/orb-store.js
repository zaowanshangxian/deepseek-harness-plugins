/**
 * dsh-memhub · 第 9 期：自有记忆存储（orb）
 *
 * 真源：Markdown + frontmatter（人类可读、可 diff、可拷走）。
 * 分类按「归属」：
 *   - shared  公共区：跨项目通用的工程记忆/决策/事实 → L:\DSH\shared\memhub\orbs
 *   - project 项目专属：审计/修改备忘录等 → <memhub>/orbs/projects/<project-slug>
 *   - self    自我空间 → <memhub>/orbs/self
 * 迁移：zzerx（98 条）与 fish（会话陪伴记忆）可一键导入，幂等（同 id 跳过）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseFrontmatter, stripFrontmatter } from './frontmatter.js'
import { writeAtomic, backupWithStamp } from './frontmatter.js'

const KINDS = new Set(['event', 'fact', 'preference', 'promise', 'emotion', 'scene', 'decision', 'project', 'user'])
const SCOPE_LABEL = { shared: '公共区', project: '项目', self: '自我' }

export function orbsRoot(home) {
  return path.join(home, 'orbs')
}

export function sharedOrbsRoot(sharedRoot) {
  return path.join(sharedRoot, 'orbs')
}

/** 归属分类：shared / project / self。 */
export function classifyOrb(record = {}) {
  const projectPath = String(record.projectPath || '')
  if (record.scope === 'shared' || record.scope === 'global') return 'shared'
  if (!projectPath) return 'shared'
  if (/\\DSH\\DeepSeek$/i.test(projectPath) || /\/DSH\/DeepSeek$/i.test(projectPath)) return 'self'
  return 'project'
}

export function projectSlug(projectPath) {
  const normalized = String(projectPath || '').replace(/[\\/]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
  return normalized.slice(-60) || 'unknown'
}

function orbFile(record, home, sharedRoot) {
  const category = classifyOrb(record)
  const month = new Date(Number(record.updatedAt) || Date.now()).toISOString().slice(0, 7)
  if (category === 'shared') return path.join(sharedOrbsRoot(sharedRoot), month, `${record.id}.md`)
  if (category === 'project') {
    return path.join(orbsRoot(home), 'projects', projectSlug(record.projectPath), month, `${record.id}.md`)
  }
  return path.join(orbsRoot(home), 'self', month, `${record.id}.md`)
}

/** 记录 → Markdown orb 文本。 */
export function renderOrb(record) {
  const category = classifyOrb(record)
  const frontmatter = [
    '---',
    `id: ${record.id}`,
    `kind: ${record.kind || 'fact'}`,
    `scope: ${category}`,
    `title: ${String(record.title || '').replace(/\n/g, ' ')}`,
    `projectPath: ${record.projectPath || ''}`,
    `importance: ${Number(record.importance) || 3}`,
    `source: ${record.source || 'memhub'}`,
    `createdAt: ${Number(record.createdAt) || Date.now()}`,
    `updatedAt: ${Number(record.updatedAt) || Date.now()}`,
    `tags: ${(record.tags || []).join(',')}`,
    '---',
    '',
  ].join('\n')
  return `${frontmatter}${String(record.content || '')}\n`
}

/** 写一条 orb（带时间戳备份 + 原子写）。 */
export function writeOrb(record, home, sharedRoot) {
  const file = orbFile(record, home, sharedRoot)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (fs.existsSync(file)) backupWithStamp(file, 3)
  writeAtomic(file, renderOrb(record))
  return file
}

/** 读全部 orb（按 id 去重，最近更新优先）。 */
export function loadOrbs(home, sharedRoot) {
  const roots = [orbsRoot(home), sharedOrbsRoot(sharedRoot)]
  const byId = new Map()
  const errors = []
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    const stack = [root]
    while (stack.length > 0) {
      const dir = stack.pop()
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          stack.push(full)
          continue
        }
        if (!entry.name.endsWith('.md')) continue
        try {
          const text = fs.readFileSync(full, 'utf8')
          const { meta, ok } = parseFrontmatter(text)
          if (!ok || !meta.id) {
            errors.push({ file: full, error: '缺少 frontmatter/id' })
            continue
          }
          const record = {
            id: meta.id,
            kind: meta.kind || 'fact',
            scope: meta.scope || 'shared',
            projectPath: meta.projectPath || '',
            title: meta.title || '',
            content: stripFrontmatter(text).trim(),
            importance: Number(meta.importance) || 3,
            source: meta.source || 'memhub',
            createdAt: Number(meta.createdAt) || 0,
            updatedAt: Number(meta.updatedAt) || 0,
            tags: String(meta.tags || '').split(',').filter(Boolean),
            evergreen: meta.scope === 'shared' || meta.evergreen === 'true',
          }
          const existing = byId.get(record.id)
          if (!existing || Number(record.updatedAt) > Number(existing.updatedAt)) byId.set(record.id, record)
        } catch (error) {
          errors.push({ file: full, error: String(error) })
        }
      }
    }
  }
  return { entries: [...byId.values()], errors }
}

/** zzerx 记录 → memhub 记录（只做字段映射）。 */
export function fromZzerx(record) {
  return {
    id: `m_${record.id}`,
    kind: KINDS.has(record.kind) ? record.kind : 'fact',
    scope: classifyOrb(record),
    projectPath: record.projectPath || '',
    title: record.title || record.id,
    content: record.content || '',
    importance: Number(record.importance) || 3,
    source: 'zzerx-migrate',
    createdAt: Number(record.createdAt) || 0,
    updatedAt: Number(record.updatedAt) || 0,
    tags: record.tags || [],
    evergreen: classifyOrb(record) === 'shared',
  }
}

/** zzerx 全量迁移（幂等：已存在的 id 跳过）。 */
export function migrateFromZzerx(zzerxMemories, home, sharedRoot) {
  const report = { total: zzerxMemories.length, migrated: 0, skipped: 0, byCategory: {}, errors: [] }
  for (const record of zzerxMemories) {
    try {
      const orb = fromZzerx(record)
      const file = orbFile(orb, home, sharedRoot)
      if (fs.existsSync(file)) {
        report.skipped += 1
        continue
      }
      writeOrb(orb, home, sharedRoot)
      report.migrated += 1
      report.byCategory[orb.scope] = (report.byCategory[orb.scope] || 0) + 1
    } catch (error) {
      report.errors.push({ id: record.id, error: String(error) })
    }
  }
  return report
}

/** fish 会话陪伴记忆迁移（读 <home>/fish-memory/*.json）。 */
export function migrateFromFish(fishDir, home, sharedRoot) {
  const report = { total: 0, migrated: 0, skipped: 0, errors: [] }
  if (!fs.existsSync(fishDir)) return report
  for (const name of fs.readdirSync(fishDir).filter((file) => file.endsWith('.json'))) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(fishDir, name), 'utf8'))
      for (const memory of data.memories || []) {
        report.total += 1
        const orb = {
          id: `f_${memory.id}`,
          kind: memory.category === 'stable_profile' ? 'fact' : 'event',
          scope: 'self',
          projectPath: '',
          title: String(memory.text || '').slice(0, 40),
          content: String(memory.text || ''),
          importance: Math.round(Number(memory.importance || 0.5) * 5),
          source: 'fish-migrate',
          createdAt: Date.parse(memory.createdAt || 0) || 0,
          updatedAt: Date.parse(memory.at || memory.createdAt || 0) || 0,
          tags: memory.tags || [],
          evergreen: false,
        }
        const file = orbFile(orb, home, sharedRoot)
        if (fs.existsSync(file)) {
          report.skipped += 1
          continue
        }
        writeOrb(orb, home, sharedRoot)
        report.migrated += 1
      }
    } catch (error) {
      report.errors.push({ file: name, error: String(error) })
    }
  }
  return report
}
