/**
 * 静态校验：预设完整性 + 构建产物存在 + 语法可解析。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { PERSONAS, PERSONA_CATCHPHRASES } = await import(pathToFileURL(join(root, 'src', 'persona.mjs')).href)

const problems = []
const ids = new Set()
const KINDS = new Set(['emoji', 'kaomoji', 'art', 'phrase'])

for (const persona of PERSONAS) {
  if (ids.has(persona.id)) problems.push('重复人格 id: ' + persona.id)
  ids.add(persona.id)
  for (const kind of persona.kinds || []) {
    if (!KINDS.has(kind)) problems.push(persona.id + ' 含未知大类: ' + kind)
  }
  if (!persona.guide || persona.guide.length < 4) problems.push(persona.id + ' 缺 guide')
  if (typeof persona.maxPerReply !== 'number' || persona.maxPerReply < 0 || persona.maxPerReply > 6) {
    problems.push(persona.id + ' maxPerReply 越界')
  }
  for (const key of ['cuteness', 'formality', 'bite', 'intimacy']) {
    const value = persona.dims && persona.dims[key]
    if (typeof value !== 'number' || value < 0 || value > 1) problems.push(persona.id + ' dims.' + key + ' 越界（应为 0–1）')
  }
  const density = persona.dims && persona.dims.density
  if (typeof density !== 'number' || density < 1 || density > 6) problems.push(persona.id + ' dims.density 越界（应为 1–6）')
}
for (const id of Object.keys(PERSONA_CATCHPHRASES)) {
  if (!ids.has(id)) problems.push('口癖表里有未知人格: ' + id)
}

for (const file of ['lib/index.js', 'lib/persona.mjs', 'lib/client.js']) {
  try {
    readFileSync(join(root, file), 'utf8')
  } catch {
    problems.push('缺少构建产物: ' + file)
  }
}

if (problems.length > 0) {
  console.error('校验失败：')
  for (const problem of problems) console.error('  - ' + problem)
  process.exit(1)
}
console.log('校验通过 ✓ （' + PERSONAS.length + ' 个人格档，' + Object.keys(PERSONA_CATCHPHRASES).length + ' 份默认口癖）')
