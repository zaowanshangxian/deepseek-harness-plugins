/**
 * dsh-memhub · 自有实体/边存储（与 zzerx 同格式，星图直接可读）
 *
 * 为什么单独存而不塞进 orb frontmatter：
 *   - 一条记忆可以连多个实体、多条边，frontmatter 存不下；
 *   - 星图（graph.js）本来就按 entities/edges 目录扫，同格式可零改动复用。
 *
 * 目录：`<memhub>/graph/entities/<id>.json`、`<memhub>/graph/edges/<id>.json`
 * 文件格式：`{ "record": {...} }`（与 zzerx 一致，graph.js 两种都能读）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { writeAtomic } from './frontmatter.js'

export function graphRoot(home) {
  return path.join(home, 'graph')
}

export function entitiesDir(home) {
  return path.join(graphRoot(home), 'entities')
}

export function edgesDir(home) {
  return path.join(graphRoot(home), 'edges')
}

/** 稳定 id：中文/英文都留，其余折成 `-`；同名实体反复写会落同一个文件。 */
function slugId(prefix, text) {
  const base = String(text || '')
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `${prefix}_${base || Date.now().toString(36)}`
}

export function saveEntity(input = {}, home) {
  const name = String(input.name || '').trim()
  if (!name) throw new Error('实体缺 name')
  const record = {
    id: String(input.id || slugId('e', name)),
    name,
    kind: String(input.kind || 'concept'),
    aliases: Array.isArray(input.aliases) ? input.aliases.map(String).slice(0, 6) : [],
    updatedAt: Date.now(),
  }
  const dir = entitiesDir(home)
  fs.mkdirSync(dir, { recursive: true })
  writeAtomic(path.join(dir, `${record.id}.json`), JSON.stringify({ record }, null, 2))
  return record
}

export function saveLink(input = {}, home) {
  const from = String(input.from || '').trim()
  const to = String(input.to || '').trim()
  if (!from || !to) throw new Error('边缺 from / to')
  const relation = String(input.relation || 'related')
  const record = {
    id: String(input.id || slugId('l', `${from}-${relation}-${to}`)),
    from: { id: from },
    to: { id: to },
    relation,
    origin: 'manual',
    note: String(input.note || '').slice(0, 200),
    updatedAt: Date.now(),
  }
  const dir = edgesDir(home)
  fs.mkdirSync(dir, { recursive: true })
  writeAtomic(path.join(dir, `${record.id}.json`), JSON.stringify({ record }, null, 2))
  return record
}

/** 按 id 合并两批（zzerx 与本地同 id 时本地优先）。 */
export function mergeById(primary = [], secondary = []) {
  const map = new Map()
  for (const item of [...primary, ...secondary]) {
    if (item?.id) map.set(item.id, item)
  }
  return [...map.values()]
}
