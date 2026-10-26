/**
 * 冒烟测试（表情插件）：不连浏览器，只核对「构建产物是否完整、和源码数据是否一致」。
 * - lib/packs.mjs 与 src/packs.mjs 的分类/条数一致（44 / 911）
 * - lib/client.js 已经把数据内联进去（没有 __PACKS_JSON__ 占位符），且每个分类 id 都在
 * - 贴纸 manifest 与内联的 base64 对齐（36 张）
 * - Host 半侧导出 name / apply，客户端导出 inject / apply
 *
 * 用法：node tools/smoke.mjs
 */
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const failures = []
const expect = (ok, message) => { if (!ok) failures.push(message) }

const { KINDS, PACKS } = await import('../lib/packs.mjs')
const source = await import('../src/packs.mjs')

const total = PACKS.reduce((sum, pack) => sum + pack.items.length, 0)
const srcTotal = source.PACKS.reduce((sum, pack) => sum + pack.items.length, 0)
expect(PACKS.length === 44, `分类数应为 44，实际 ${PACKS.length}`)
expect(total === 911, `条数应为 911，实际 ${total}`)
expect(PACKS.length === source.PACKS.length && total === srcTotal, 'lib/packs.mjs 与 src/packs.mjs 不一致（忘了 build？）')
expect(KINDS.length === 4, `大类应为 4 个，实际 ${KINDS.length}`)

const client = read('../lib/client.js')
const host = read('../lib/index.js')
expect(!client.includes('__PACKS_JSON__'), 'lib/client.js 里还有 __PACKS_JSON__ 占位符（构建没插数据）')
for (const pack of PACKS) {
  if (!client.includes(pack.id)) { failures.push(`lib/client.js 缺少分类 ${pack.id}`); break }
}
expect(client.includes('dsh-plugin-more-emoji'), 'lib/client.js 缺少模块 id')
expect(/exports\.apply\s*=\s*function\s*\(\s*ctx\s*\)/.test(client), '客户端 apply 应接收 ctx 参数')
expect(/exports\.inject\s*=\s*\[/.test(client), '客户端缺少 inject 声明')

expect(/export\s+const\s+name\s*=\s*'dsh-plugin-more-emoji'/.test(host), 'Host 半侧缺少 name 导出')
expect(/export\s+function\s+apply\s*\(/.test(host), 'Host 半侧缺少 apply 导出')
expect(host.includes('emoji_pack'), 'Host 半侧没有注册 emoji_pack 工具')
expect(host.includes('/more-emoji'), 'Host 半侧没有注册配置 API 路由')

const manifest = JSON.parse(read('../assets/stickers/manifest.json'))
expect(manifest.length === 36, `贴纸应为 36 张，实际 ${manifest.length}`)
const inlined = (client.match(/data:image\/png;base64,/g) || []).length
expect(inlined === manifest.length, `内联贴纸 ${inlined} 张，与 manifest ${manifest.length} 张不一致`)

if (failures.length) {
  console.error('SMOKE FAILED:')
  failures.forEach((f) => console.error('  - ' + f))
  process.exit(1)
}
console.log(`smoke OK: ${PACKS.length} 分类 / ${total} 条 / ${manifest.length} 张贴纸，lib 与 src 一致，Host 与 Client 出口齐全`)
process.exit(0)
