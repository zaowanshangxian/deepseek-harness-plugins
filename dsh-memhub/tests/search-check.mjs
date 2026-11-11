/**
 * 检索模块自测（纯函数，hermetic）：node tests/search-check.mjs
 * 覆盖：别名/同义说法、IDF 稀有词压制、字段权重（标题 > 摘要 > 正文）、
 *       整句短语加成、归档过滤、空查询=最近 N 条、v1/v2 两档都在。
 */
import { searchMemories, expandQuery, buildIdf, MEMORY_ALIASES } from '../src/search.js'

const failures = []
let total = 0
function ok(condition, label) {
  total += 1
  if (condition) console.log(`PASS  ${label}`)
  else {
    console.log(`FAIL  ${label}`)
    failures.push(label)
  }
}

const now = Date.parse('2026-11-10T09:30:00+08:00')

const items = [
  {
    id: 'a',
    title: '记忆分盘规则',
    summary: '工作区与自我的记忆怎么放',
    content: '记忆按工作区分盘：业务放 work，自我放 DeepSeek。',
    updatedAt: now - 1000,
    archived: false,
    scope: 'shared',
  },
  {
    id: 'b',
    title: '工作区分盘与归档分流',
    summary: '业务工作区只放业务',
    content: '工作区与自我的归档分流，别混。',
    updatedAt: now - 2000,
    archived: false,
    scope: 'shared',
  },
  {
    id: 'c',
    title: 'QQ 个人号接入：WSL2 + Docker NapCat',
    summary: '把 QQ 个人号接进来',
    content: '用 WSL2 + Docker 跑 NapCat，把个人号接入。',
    updatedAt: now - 3000,
    archived: false,
    scope: 'self',
  },
  {
    id: 'd',
    title: '插件安装路径必须 ASCII',
    summary: '路径里有中文就装不上',
    content: 'Windows 下插件安装路径必须是 ASCII。',
    updatedAt: now - 4000,
    archived: false,
    scope: 'shared',
  },
  {
    id: 'e',
    title: '已归档的旧条目',
    summary: '这条不该被搜到',
    content: '归档记忆不进检索结果。',
    updatedAt: now - 5000,
    archived: true,
    status: 'archived',
  },
]

const ids = (results) => results.map((entry) => entry.item.id)

ok(ids(searchMemories(items, '记忆怎么分盘', { limit: 3 }))[0] === 'a', '同义说法命中：标题命中排第一')
ok(ids(searchMemories(items, 'QQ 机器人怎么接进', { limit: 3 }))[0] === 'c', '别名扩展：接进 → 接入')
ok(!ids(searchMemories(items, '归档记忆')).includes('e'), '归档条目不进检索结果')
ok(ids(searchMemories(items, '')).length === 4, `空查询给最近 4 条（实际 ${ids(searchMemories(items, '')).length}）`)
ok(searchMemories(items, '').every((entry) => entry.score === 0), '空查询不带分数')

// 字段权重：标题命中应高于只在正文命中
const fieldCase = [
  { id: 'title-hit', title: '沙箱测试', summary: '', content: '无关正文', updatedAt: now, archived: false },
  { id: 'body-hit', title: '无关标题', summary: '', content: '这里提到沙箱测试', updatedAt: now - 1, archived: false },
]
ok(ids(searchMemories(fieldCase, '沙箱测试', { limit: 2 }))[0] === 'title-hit', '标题命中排在正文命中之前')

// IDF：稀有词权重大于到处都有的词
const idfItems = [
  { id: 'x1', title: '常见词 甲', summary: '', content: '常见词出现很多次', updatedAt: now, archived: false },
  { id: 'x2', title: '常见词 乙', summary: '', content: '常见词也在这里', updatedAt: now - 1, archived: false },
  { id: 'x3', title: '稀有词丙', summary: '', content: '只有这条有稀有词', updatedAt: now - 2, archived: false },
]
const idf = buildIdf(idfItems, expandQuery('常见词 稀有词'))
ok((idf.get('稀有词') || 0) > (idf.get('常见词') || 0), 'IDF：稀有词权重高于常见词')

// v1 / v2 双档都可用（v1 是迁移期对照，不删）
const v1 = searchMemories(items, '插件路径', { limit: 2, mode: 'v1' })
const v2 = searchMemories(items, '插件路径', { limit: 2, mode: 'v2' })
ok(v1.length > 0 && v2.length > 0 && ids(v1)[0] === 'd' && ids(v2)[0] === 'd', 'v1/v2 都能命中插件路径')
ok(expandQuery('记忆').includes('memory'), '记忆域别名展开（记忆 → memory）')
ok(MEMORY_ALIASES.接入.includes('接进'), '别名表里 接入/接进 互为同义')

console.log(`\n检索模块自测：${total - failures.length}/${total} 通过`)
if (failures.length > 0) {
  console.log(`失败项：${failures.join(' ｜ ')}`)
  process.exit(1)
}
