#!/usr/bin/env node
/**
 * 给本插件补宿主依赖的解析路径：`node_modules/@deepseek-ai/dsh-tools`。
 *
 * 为什么需要：
 *   `@deepseek-ai/dsh-tools` 只随 `@deepseek-ai/dsh` 发布（npm 公开版停在 `0.0.1-rc.1`，
 *   和宿主的 `0.2.1-rc.2` 不兼容）。`link:` 安装时 Node 从本项目目录往上找，找不到宿主那份，
 *   import 直接 `ERR_MODULE_NOT_FOUND`，插件被**静默跳过**（症状：`self-check.json` 不生成）。
 *
 * 用法：
 *   node tools/link-host-deps.mjs              # 自动找宿主
 *   node tools/link-host-deps.mjs --host <目录> # 指定 @deepseek-ai/dsh 目录
 *   node tools/link-host-deps.mjs --dry-run    # 只看会做什么
 *
 * 幂等：已存在的链接跳过；失败退出码 1。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEPS = ['dsh-tools']
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const hostIndex = args.indexOf('--host')
const hostArg = hostIndex >= 0 ? args[hostIndex + 1] : ''

function candidates() {
  const list = []
  if (hostArg) list.push(hostArg)
  if (process.env.APPDATA) list.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh'))
  list.push(path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@deepseek-ai', 'dsh'))
  list.push(path.join(os.homedir(), '.dsh', 'runtimes', 'npm', 'node_modules', '@deepseek-ai', 'dsh'))
  return [...new Set(list.filter(Boolean))]
}

let hostDir = ''
let depsDir = ''
for (const candidate of candidates()) {
  const nested = path.join(candidate, 'node_modules', '@deepseek-ai')
  if (!fs.existsSync(candidate)) continue
  if (fs.existsSync(path.join(nested, 'dsh-tools', 'package.json'))) {
    hostDir = candidate
    depsDir = nested
    break
  }
}

if (!hostDir) {
  console.error('找不到宿主里的 @deepseek-ai/dsh-tools。试过：')
  for (const candidate of candidates()) console.error(`  - ${candidate}`)
  console.error('请用 --host <你的 @deepseek-ai/dsh 目录> 指定（里面应有 node_modules/@deepseek-ai/dsh-tools）。')
  process.exit(1)
}

console.log(`宿主：${hostDir}`)
const targetDir = path.join(ROOT, 'node_modules', '@deepseek-ai')
fs.mkdirSync(targetDir, { recursive: true })

let made = 0
for (const name of DEPS) {
  const linkPath = path.join(targetDir, name)
  const target = path.join(depsDir, name)
  if (fs.existsSync(linkPath)) {
    console.log(`跳过 ${name}：已存在`)
    continue
  }
  if (dryRun) {
    console.log(`[dry-run] 会建 junction：${linkPath} → ${target}`)
    made += 1
    continue
  }
  fs.symlinkSync(target, linkPath, 'junction')
  console.log(`已建 junction：${linkPath} → ${target}`)
  made += 1
}

if (dryRun) {
  console.log(`[dry-run] 共 ${made} 项待建；去掉 --dry-run 执行`)
  process.exit(0)
}

try {
  const probe = await import(pathToFileURL(path.join(ROOT, 'index.js')).href)
  console.log(`验证通过：import('dsh-memhub') → ${Object.keys(probe).join(',')}`)
} catch (error) {
  console.error(`验证失败：${String(error.message || error).split('\n')[0]}`)
  process.exit(1)
}
