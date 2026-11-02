import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(join(root, 'lib'), { recursive: true })

// 客户端：原样复制（浏览器侧不做打包，保持零依赖可读）
copyFileSync(join(root, 'src', 'client.js'), join(root, 'lib', 'client.js'))
// 宿主：原样复制（ESM，无第三方依赖）
copyFileSync(join(root, 'src', 'host.mjs'), join(root, 'lib', 'index.js'))

console.log('[build] lib/client.js + lib/index.js 已生成')
