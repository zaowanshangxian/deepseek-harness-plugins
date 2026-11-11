#!/usr/bin/env node
/**
 * 契约自检：这个插件是"只读宿主 DOM"的插件，它全部的本钱就是几个 data-* 锚点。
 * 宿主改版后锚点没了，插件会安静地什么都不画——所以用脚本把该核的东西核掉，
 * 而不是靠"我记得它还在"。
 *
 * 核四组（任何一组失败退出码 1）：
 *   1. 包清单自洽：name / version / main / exports / dsh.bundle.patch / dsh.client 都在。
 *   2. cordis.patch.yml 的 id 与 name 与包对得上，且 id 不和已知插件撞。
 *   3. 两个半侧的出口一致：Host 的 VERSION == package.version，Host 的 name == 包名，
 *      Client 的 ModuleLoader id == 包名，client 里确实引用了那 4 个锚点。
 *   4. 宿主真身（本机安装的 app.asar）里这 4 个锚点还在。找不到 app.asar 就 SKIP，
 *      不算失败（换机器/换安装方式都正常）。
 *
 * 用法：node test/host-contract.mjs [--asar <path>]
 */
import { readFile, open } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const ANCHORS = ['data-step-process-content', 'data-chat-call-id', 'data-subcalls', 'data-state']
const DEFAULT_ASAR =
  'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/app.asar'

const failures = []
const notes = []

function check(label, condition, detail) {
  if (condition) {
    console.log('  ok   ' + label)
    return true
  }
  console.log('  FAIL ' + label + (detail ? ' — ' + detail : ''))
  failures.push(label)
  return false
}

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))

console.log('1. 包清单')
check('name', /^dsh-plugin-[a-z0-9-]+$/.test(pkg.name), pkg.name)
check('type=module', pkg.type === 'module')
check('main 指向真实文件', existsSync(join(ROOT, pkg.main)), pkg.main)
check('exports["./client"]', Boolean(pkg.exports?.['./client']) && existsSync(join(ROOT, pkg.exports['./client'])))
check('dsh.bundle.patch 存在', Boolean(pkg.dsh?.bundle?.patch) && existsSync(join(ROOT, pkg.dsh.bundle.patch)))
check('dsh.client.platform=web', pkg.dsh?.client?.platform === 'web')
check('engines.dsh 未设版本门槛（参考项目的结论：门槛挡不住不兼容）', pkg.engines?.dsh === undefined)

console.log('2. cordis.patch.yml')
const patch = await readFile(join(ROOT, 'cordis.patch.yml'), 'utf8')
check('patch 里 name 与包名一致', patch.includes('name: ' + pkg.name))
const idMatch = patch.match(/^\s*-\s*id:\s*([a-z0-9-]+)/m)
check('patch 里有唯一的 row id', Boolean(idMatch), idMatch?.[1])
const KNOWN_IDS = ['token-meter', 'token-meter-mb', 'tool-tax', 'persona-voice', 'dsh-process-tree']
check('row id 不与已知插件冲突', idMatch ? !KNOWN_IDS.includes(idMatch[1]) : false, idMatch?.[1])

console.log('3. 两个半侧的出口')
const host = await import(new URL('../lib/index.js', import.meta.url))
check('Host name == 包名', host.name === pkg.name, host.name)
check('Host VERSION == package.version', host.VERSION === pkg.version, host.VERSION + ' vs ' + pkg.version)
check(
  'Host ROUTE 不占宿主的 /api 命名空间',
  typeof host.ROUTE === 'string' && host.ROUTE.startsWith('/') && !host.ROUTE.startsWith('/api/'),
  host.ROUTE,
)
check('Host apply 是函数', typeof host.apply === 'function')

const client = await readFile(join(ROOT, 'lib/client.js'), 'utf8')
check('Client ModuleLoader id == 包名', client.includes("id: '" + pkg.name + "'"))
check("Client 导出 apply", /function apply\(ctx\)/.test(client))
check('Client 用 ctx.effect 挂载', /ctx\.effect\(/.test(client))
check('Client 的 effect 返回了清理函数', /return \(\) => \{/.test(client))
for (const anchor of ANCHORS) {
  check('Client 引用锚点 ' + anchor, client.includes(anchor))
}

// 0.1.1 / 0.1.2 修的都是"形状级"的 bug，静态守卫便宜且不可能被无意改回去。
// （真正的行为证据在 test/browser-smoke.mjs。）
// 去掉注释再核：注释里会正当地提到这些被禁的写法（"不要用 X"）。
const clientCode = client
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n')
check('Client 不在 document.body 上挂 characterData（每个流式 token 都会进回调）',
  !/characterData\s*:\s*true/.test(clientCode))
check('Client 不用 :has() 写深色选择器（会把 :root 变成 has-root）', !clientCode.includes(':has('))
check('Client 不整块 replaceChildren（圆点要复用，动画才连续）', !clientCode.includes('replaceChildren'))
check('Client 的观察回调会跳过自有权重层', clientCode.includes('insideLayer('))
check('Client 有"签名没变就不画"的闸门', clientCode.includes('runtime.sigs.get(host) === sig'))
check('Client 圆点量的是卡片而不是整行', clientCode.includes('(cardOf(row) || row).getBoundingClientRect()'))
check('Client 在 host 重新可见时把它排回脏集（否则滚回视口不补画）',
  clientCode.includes('runtime.dirty.add(entry.target)'))
check('Client 排除行内控件用统一的 CONTROL_SEL', clientCode.includes('CONTROL_SEL'))
check('Client 的 <svg> 挂在宿主末尾（不挤占宿主第一行）', clientCode.includes('host.appendChild(svg)'))

console.log('4. 宿主真身里的锚点（本机安装版）')
const asarArg = process.argv.indexOf('--asar')
const asarPath = asarArg > -1 ? process.argv[asarArg + 1] : DEFAULT_ASAR
if (!existsSync(asarPath)) {
  notes.push('跳过：没找到 app.asar（' + asarPath + '）')
} else {
  const missing = []
  for (const anchor of ANCHORS) {
    const found = await containsBytes(asarPath, anchor)
    check('app.asar 里还有 ' + anchor, found)
    if (!found) missing.push(anchor)
  }
  if (missing.length) notes.push('宿主锚点缺失：' + missing.join(', ') + ' —— client 半会静默降级，需要重写选择器')
}

console.log('')
if (notes.length) {
  for (const note of notes) console.log('注：' + note)
}
if (failures.length) {
  console.log('\n结果：' + failures.length + ' 项失败')
  process.exitCode = 1
} else {
  console.log('结果：全部通过')
}

/** 在任意大的文件里流式找一个 ASCII 片段（跨块边界也找得到）。 */
async function containsBytes(path, needle) {
  const target = Buffer.from(needle, 'utf8')
  const overlap = target.length - 1
  const handle = await open(path, 'r')
  try {
    const chunkSize = 1 << 22
    let tail = Buffer.alloc(0)
    let position = 0
    for (;;) {
      const buffer = Buffer.alloc(chunkSize)
      const { bytesRead } = await handle.read(buffer, 0, chunkSize, position)
      if (bytesRead === 0) return false
      position += bytesRead
      const window = Buffer.concat([tail, buffer.subarray(0, bytesRead)])
      if (window.includes(target)) return true
      tail = window.subarray(Math.max(0, window.length - overlap))
    }
  } finally {
    await handle.close()
  }
}
