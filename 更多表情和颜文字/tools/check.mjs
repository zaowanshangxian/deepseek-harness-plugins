/**
 * 内容库校验：npm run check
 *  - 分类 id / kind / 名称唯一性
 *  - 条目非空、无首尾空白、无 U+FFFD 替换字符
 *  - 同一分类内重复（错误）、跨分类重复（提示）
 *  - 打印各大类统计
 */
import { KINDS, PACKS } from '../src/packs.mjs'

const problems = []
const warnings = []

const kindIds = new Set(KINDS.map((kind) => kind.id))
const seenIds = new Set()
const seenNames = new Map()
const globalItems = new Map()

for (const pack of PACKS) {
  if (!kindIds.has(pack.kind)) problems.push('分类 ' + pack.id + ' 的 kind 非法：' + pack.kind)
  if (seenIds.has(pack.id)) problems.push('分类 id 重复：' + pack.id)
  seenIds.add(pack.id)

  const nameKey = pack.kind + '/' + pack.name
  if (seenNames.has(nameKey)) problems.push('同 kind 下分类名重复：' + nameKey)
  seenNames.set(nameKey, pack.id)

  if (!Array.isArray(pack.items) || pack.items.length === 0) {
    problems.push('分类 ' + pack.id + ' 没有条目')
    continue
  }

  const local = new Set()
  for (const item of pack.items) {
    if (typeof item !== 'string') {
      problems.push('分类 ' + pack.id + ' 有非字符串条目')
      continue
    }
    if (item.trim() === '') problems.push('分类 ' + pack.id + ' 有空条目')
    if (item !== item.trim()) problems.push('分类 ' + pack.id + ' 条目首尾有空白：' + JSON.stringify(item))
    if (item.includes('\uFFFD')) problems.push('分类 ' + pack.id + ' 含替换字符：' + JSON.stringify(item))
    if (local.has(item)) problems.push('分类 ' + pack.id + ' 内部重复：' + item)
    local.add(item)

    const list = globalItems.get(item) || []
    list.push(pack.id)
    globalItems.set(item, list)
  }
}

for (const [item, owners] of globalItems) {
  if (owners.length > 1) warnings.push('跨分类重复：' + JSON.stringify(item) + ' → ' + owners.join(', '))
}

const totals = new Map(KINDS.map((kind) => [kind.id, 0]))
for (const pack of PACKS) {
  totals.set(pack.kind, (totals.get(pack.kind) || 0) + pack.items.length)
}

console.log('分类数：' + PACKS.length)
for (const kind of KINDS) {
  const packs = PACKS.filter((pack) => pack.kind === kind.id).length
  console.log('  ' + kind.label + '（' + kind.id + '）：' + packs + ' 个分类 / ' + (totals.get(kind.id) || 0) + ' 条')
}
console.log('总条数：' + PACKS.reduce((sum, pack) => sum + pack.items.length, 0))

if (warnings.length > 0) {
  // 跨分类重复是刻意的（同一主题词出现在多个分类里），只给摘要，避免刷屏。
  console.log('\n提示：' + warnings.length + ' 条跨分类重复（同一主题词落在多个分类，属预期）')
  for (const warning of warnings.slice(0, 8)) console.log('  - ' + warning)
  if (warnings.length > 8) console.log('  … 其余 ' + (warnings.length - 8) + ' 条略')
}

if (problems.length > 0) {
  console.error('\n错误（' + problems.length + '）：')
  for (const problem of problems) console.error('  - ' + problem)
  process.exitCode = 1
} else {
  console.log('\n校验通过 ✓')
}
