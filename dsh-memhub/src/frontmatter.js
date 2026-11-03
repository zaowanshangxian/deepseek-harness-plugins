/**
 * dsh-memhub · frontmatter 统一实现（技能开关/正文剥离的唯一入口）
 *
 * 修盲审 S3/建议9：indexer / host.toggleSkill / skill_register / toggle 脚本
 * 之前各写一套正则，大小写与引号行为不一致。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 解析头部 frontmatter（只取扁平 key: value）。 */
export function parseFrontmatter(text) {
  const source = String(text || '')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source)
  if (!match) return { meta: {}, body: source, ok: false }
  const meta = {}
  for (const line of match[1].split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!m) continue
    let value = m[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    meta[m[1]] = value
  }
  return { meta, body: source.slice(match[0].length), ok: true }
}

/** 去掉 frontmatter，返回正文。 */
export function stripFrontmatter(text) {
  const source = String(text || '')
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(source)
  return match ? source.slice(match[0].length) : source
}

/** 是否已带开关（大小写/引号容错；只看 frontmatter，正文里同名字串不算）。 */
export function hasFlag(text) {
  const { meta } = parseFrontmatter(text)
  return String(meta['disable-model-invocation'] || '').toLowerCase() === 'true'
}

/** 加开关；无 frontmatter 返回 null（调用方明确拒绝）。 */
export function addFlag(text) {
  const source = String(text || '')
  if (hasFlag(source)) return source
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source)
  if (!match) return null
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const frontmatter = match[1].replace(/\r?\n?$/, '') + eol + 'disable-model-invocation: true'
  return `---${eol}${frontmatter}${eol}---${eol}${source.slice(match[0].length)}`
}

/** 去开关；没有则原样返回。 */
export function removeFlag(text) {
  return String(text || '').replace(/^disable-model-invocation:\s*['"]?true['"]?\s*\r?\n/im, '')
}

/** 原子写：先写临时文件再 rename，避免半截文件。 */
export function writeAtomic(file, content) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, content, 'utf8')
  fs.renameSync(tmp, file)
}

/** 带时间戳备份：保留 N 代（默认 5），超代清理最旧。 */
export function backupWithStamp(file, keep = 5) {
  if (!fs.existsSync(file)) return null
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = `${file}.bak-${stamp}`
  fs.copyFileSync(file, backup)
  try {
    const dir = path.dirname(file)
    const base = path.basename(file)
    const old = fs
      .readdirSync(dir)
      .filter((name) => name.startsWith(`${base}.bak-`) && !name.endsWith('.bak-toggle'))
      .sort()
    while (old.length > keep) fs.rmSync(path.join(dir, old.shift()), { force: true })
  } catch {
    /* 清理失败不影响备份 */
  }
  return backup
}
