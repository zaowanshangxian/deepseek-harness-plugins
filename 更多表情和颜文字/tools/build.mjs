/**
 * 构建 lib/：
 *   lib/packs.mjs  ← src/packs.mjs 的数据（Host 侧 import 用）
 *   lib/index.js   ← src/host.mjs（原样拷贝）
 *   lib/client.js  ← src/client.template.js + 注入打包好的数据
 *
 * Client 半侧在浏览器里拿不到包内文件，所以数据必须以字面量形式内联。
 * 单一数据源仍是 src/packs.mjs。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { KINDS, PACKS } from '../src/packs.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'lib')
mkdirSync(outDir, { recursive: true })

const data = JSON.stringify({ KINDS, PACKS })

const packsSource =
  '// 由 tools/build.mjs 从 src/packs.mjs 生成，请改源文件。\n' +
  'export const KINDS = ' + JSON.stringify(KINDS, null, 2) + '\n\n' +
  'export const PACKS = ' + JSON.stringify(PACKS, null, 2) + '\n'
writeFileSync(join(outDir, 'packs.mjs'), packsSource)

const hostSource = readFileSync(join(root, 'src', 'host.mjs'), 'utf8')
writeFileSync(join(outDir, 'index.js'), hostSource)

const clientTemplate = readFileSync(join(root, 'src', 'client.template.js'), 'utf8')
if (!clientTemplate.includes('__PACKS_JSON__')) {
  throw new Error('src/client.template.js 缺少 __PACKS_JSON__ 占位符')
}
writeFileSync(join(outDir, 'client.js'), clientTemplate.replaceAll('__PACKS_JSON__', data))

console.log('[build] lib/packs.mjs, lib/index.js, lib/client.js 已生成：' +
  PACKS.length + ' 个分类 / ' +
  PACKS.reduce((sum, pack) => sum + pack.items.length, 0) + ' 条内容')
