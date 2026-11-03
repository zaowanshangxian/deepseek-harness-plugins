/**
 * dsh-memhub · 第 7 期：记忆星图（派生视图，不搬数据）
 *
 * 节点 = 记忆 + 实体；边 = zzerx 图里的边（默认过滤 origin=auto 的 related，占 82%，不过滤就是一团毛线）。
 * 输出只给面板渲染，不落盘。
 */
import fs from 'node:fs'
import path from 'node:path'
import { zzerxRoot } from './recall-store.js'

export function loadEntities(root = zzerxRoot()) {
  const dir = path.join(root, 'entities')
  const out = []
  let files = []
  try {
    files = fs.readdirSync(dir).filter((name) => name.endsWith('.json'))
  } catch {
    return out
  }
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
      const record = raw && raw.record ? raw.record : raw
      if (record?.id) out.push(record)
    } catch {
      /* 坏文件跳过 */
    }
  }
  return out
}

export function loadEdges(root = zzerxRoot()) {
  const dir = path.join(root, 'edges')
  const out = []
  let files = []
  try {
    files = fs.readdirSync(dir).filter((name) => name.endsWith('.json'))
  } catch {
    return out
  }
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
      const record = raw && raw.record ? raw.record : raw
      if (record?.from && record?.to) out.push(record)
    } catch {
      /* 坏文件跳过 */
    }
  }
  return out
}

/**
 * 组装星图。
 * @param {{memories: object[], sidecars: object[], entities: object[], edges: object[], options?: {includeAuto?: boolean, maxNodes?: number}}} input
 */
export function buildGraph(input = {}) {
  const sidecars = input.sidecars || []
  const entities = input.entities || []
  const edges = input.edges || []
  const options = input.options || {}
  const includeAuto = options.includeAuto === true
  const maxNodes = Number(options.maxNodes) > 0 ? Number(options.maxNodes) : 300

  const nodes = []
  const nodeIds = new Set()
  const byAlias = new Map()
  const aliasOf = (id) => (String(id).startsWith('m_') ? String(id).slice(2) : String(id))
  for (const sidecar of sidecars.slice(0, maxNodes)) {
    nodes.push({
      id: sidecar.id,
      kind: 'memory',
      label: String(sidecar.title || sidecar.id).slice(0, 16),
      tier: sidecar.tier,
      importance: sidecar.importance,
    })
    nodeIds.add(sidecar.id)
    byAlias.set(aliasOf(sidecar.id), sidecar.id)
  }
  for (const entity of entities) {
    nodes.push({
      id: entity.id,
      kind: 'entity',
      entityKind: entity.kind,
      label: String(entity.name || entity.id).slice(0, 16),
    })
    nodeIds.add(entity.id)
    byAlias.set(entity.id, entity.id)
  }

  const links = []
  for (const edge of edges) {
    if (!includeAuto && edge.origin === 'auto' && edge.relation === 'related') continue
    const source = byAlias.get(edge.from?.id) || (nodeIds.has(edge.from?.id) ? edge.from.id : null)
    const target = byAlias.get(edge.to?.id) || (nodeIds.has(edge.to?.id) ? edge.to.id : null)
    if (!source || !target) continue
    links.push({ source, target, relation: edge.relation || 'related', origin: edge.origin || 'unknown' })
  }

  return {
    nodes,
    edges: links,
    stats: {
      memories: sidecars.length,
      entities: entities.length,
      edgesRaw: edges.length,
      edgesRendered: links.length,
      autoFiltered: edges.length - links.length,
    },
  }
}
