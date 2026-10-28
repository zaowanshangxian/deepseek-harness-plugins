/**
 * 构建 lib/：
 *   lib/index.js    ← src/host.mjs（原样拷贝）
 *   lib/persona.mjs ← src/persona.mjs（原样拷贝，host 运行时 import './persona.mjs'）
 *   lib/client.js   ← src/client.template.js（注入预设与频率档位）
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { EMOJI_FREQUENCY, PERSONAS } from '../src/persona.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'lib')
mkdirSync(outDir, { recursive: true })

writeFileSync(join(outDir, 'index.js'), readFileSync(join(root, 'src', 'host.mjs'), 'utf8'))
writeFileSync(join(outDir, 'persona.mjs'), readFileSync(join(root, 'src', 'persona.mjs'), 'utf8'))

const data = JSON.stringify({ PERSONAS, EMOJI_FREQUENCY })
const template = readFileSync(join(root, 'src', 'client.template.js'), 'utf8')
writeFileSync(join(outDir, 'client.js'), template.replace('__PERSONA_JSON__', data))

console.log('[build] lib/index.js + lib/persona.mjs + lib/client.js 已生成：' + PERSONAS.length + ' 个人格档')
