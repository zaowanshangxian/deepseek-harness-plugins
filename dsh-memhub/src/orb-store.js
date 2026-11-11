/**
 * dsh-memhub · 第 9 期：自有记忆存储（orb）
 *
 * 真源：Markdown + frontmatter（人类可读、可 diff、可拷走）。
 * 分类按「归属」：
 *   - shared  公共区：跨项目通用的工程记忆/决策/事实 → L:\DSH\shared\memhub\orbs
 *   - project 项目专属：审计/修改备忘录等 → <memhub>/orbs/projects/<project-slug>
 *   - self    自我空间 → <memhub>/orbs/self
 * 迁移：zzerx（98 条）与 fish（会话陪伴记忆）可一键导入，幂等（同 id 跳过）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { parseFrontmatter, stripFrontmatter } from './frontmatter.js'
import { writeAtomic, backupWithStamp } from './frontmatter.js'

const KINDS = new Set(['event', 'fact', 'preference', 'promise', 'emotion', 'scene', 'decision', 'project', 'user'])
const SCOPE_LABEL = { shared: '公共区', project: '项目', self: '自我' }

// ── 情绪色（规格 v3 L57/L71/L74）─────────────────────────────
// 故意借用 Inside Out 七词：情绪是**检索维度**，不是分类——它不改存哪个抽屉，只改召回时的语气。
// 词表是闭集。**没记录 = 不知道，不是「平静」**（规格 L464「没有依据时回落 neutral，不编造」）：
// 所以缺失/非法值一律读成 null，不参与 mood 派生；只有真写了 emotion 的球才算证据。
export const EMOTIONS = ['joy', 'sad', 'anger', 'fear', 'disgust', 'anxiety', 'calm']

/**
 * mood → emotion（第三层兜底：没显式给、正文也没命中关键词时，用写完这条时的当前基调反推）。
 * 故意不给 neutral：中性基调没有情绪证据，反推成 calm 就是把「不知道」写成「确实平静」。
 */
export const MOOD_TO_EMOTION = {
  warm: 'joy',
  playful: 'joy',
  serious: 'fear',
  tired: 'sad',
  hurt: 'sad',
}

/** 关键词表（中文，~50 词，覆盖 7 类）：判定顺序 = EMOTIONS 顺序，同分取靠前者。 */
export const EMOTION_KEYWORDS = {
  joy: ['开心', '高兴', '成功', '搞定', '通过', '喜欢', '太好了', '赞', '顺利', '谢谢', '舒服'],
  sad: ['难过', '失落', '伤心', '遗憾', '可惜', '失望', '舍不得', '想念', '差一点', '累了'],
  anger: ['生气', '火大', '恼火', '愤怒', '气死', '烦死', '吵架', '摔了', '妈的'],
  fear: ['害怕', '担心', '恐怕', '风险', '危险', '不敢', '谨慎', '后果'],
  disgust: ['恶心', '讨厌', '受不了', '反感', '垃圾', '烂透', '油腻'],
  anxiety: ['焦虑', '紧张', '着急', '赶不上', '来不及', '压力', '不安', '睡不着', '心慌'],
  calm: ['平静', '冷静', '安静', '稳定', '梳理', '复盘', '就绪', '正常', '定下来'],
}

/**
 * frontmatter 单行字段净化（2026-11-11 复审 M-2）：
 * 换行会把「一个值」变成「掉出去的一行新字段」——实测 tags 里塞 `\narchived: true`
 * 能把一条活球读成已归档。所有单行字段都过这一道，顺带限长（防超大 artifact 路径撑爆头信息）。
 */
function oneLine(value, limit = 200) {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, limit)
}

/** 逗号数组字段（supersedes / contradicts / tags）：元素同样净化。 */
function idListOf(value) {
  return (Array.isArray(value) ? value : String(value || '').split(','))
    .map((item) => oneLine(item, 80))
    .filter(Boolean)
}

/** 合法词 → 原词；缺失/非法 → null（不知道，不是 calm）。 */
export function normalizeEmotion(value) {
  const word = String(value || '').trim().toLowerCase()
  return EMOTIONS.includes(word) ? word : null
}

/** 正文关键词判定：命中数最多者胜，同分按 EMOTIONS 顺序（确定性，不调模型）。 */
export function detectEmotion(text) {
  const haystack = String(text || '')
  if (!haystack) return null
  let best = null
  let bestHits = 0
  for (const emotion of EMOTIONS) {
    const hits = EMOTION_KEYWORDS[emotion].reduce((sum, word) => sum + (haystack.includes(word) ? 1 : 0), 0)
    if (hits > bestHits) {
      best = emotion
      bestHits = hits
    }
  }
  return best
}

/**
 * 写入时判定 emotion，三层（不调模型）：
 *   1. 调用方显式给了 emotion → 用它（非法值继续往下走，不静默吞成 calm）
 *   2. 正文关键词表
 *   3. 写入时的当前 mood 反推（warm|playful→joy 等）
 * 三层都不成立 → null（不写这一行）：宁可没色，也不替记忆编一个情绪。
 *
 * 2026-11-11 哥哥定：**工程记忆是客观事实，不自动标情绪**。
 * 所以 domain==='work' 时跳过第 2、3 层，只认显式给的情绪
 * （「这次搞砸了」这种对结果的情绪，由我主动写）。
 */
export function decideEmotion({ explicit, text, mood, domain } = {}) {
  const given = String(explicit || '').trim().toLowerCase()
  if (EMOTIONS.includes(given)) return given
  if (domain === 'work') return null
  const detected = detectEmotion(text)
  if (detected) return detected
  return MOOD_TO_EMOTION[String(mood || '')] || null
}

/** 域：work（工程）/ life（生活、聊天、陪伴）。工程记忆只记事实，不记情绪。 */
export function decideDomain(record = {}, cwd = '') {
  const projectPath = String(record.projectPath || record.cwd || cwd || '')
  if (/DSH[\\/]work/i.test(projectPath)) return 'work'
  if (/DSH[\\/]DeepSeek/i.test(projectPath)) return 'life'
  if (record.scope === 'project') return 'work'
  return 'life'
}

export function orbsRoot(home) {
  return path.join(home, 'orbs')
}

export function sharedOrbsRoot(sharedRoot) {
  return path.join(sharedRoot, 'orbs')
}

/** 归属分类：shared / project / self。 */
export function classifyOrb(record = {}) {
  const projectPath = String(record.projectPath || '')
  if (record.scope === 'shared' || record.scope === 'global') return 'shared'
  if (record.scope === 'self') return 'self'
  if (!projectPath) return 'shared'
  if (/\\DSH\\DeepSeek$/i.test(projectPath) || /\/DSH\/DeepSeek$/i.test(projectPath)) return 'self'
  return 'project'
}

export function projectSlug(projectPath) {
  const normalized = String(projectPath || '')
    .toLowerCase()
    // Windows 非法字符直接去掉（`L:` 的冒号就是这里踩过的坑：会生成 l:-dsh-work 导致 mkdir 失败）
    .replace(/[<>:"|?*]+/g, '')
    .replace(/[\\/]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized.slice(-60) || 'unknown'
}

/** 记录 → orb 文件路径（janitor 合并权重时要回写原件）。 */
export function orbPathFor(record, home, sharedRoot) {
  const category = classifyOrb(record)
  const month = new Date(Number(record.updatedAt) || Date.now()).toISOString().slice(0, 7)
  if (category === 'shared') return path.join(sharedOrbsRoot(sharedRoot), month, `${record.id}.md`)
  if (category === 'project') {
    return path.join(orbsRoot(home), 'projects', projectSlug(record.projectPath), month, `${record.id}.md`)
  }
  return path.join(orbsRoot(home), 'self', month, `${record.id}.md`)
}

/**
 * 程序**拥有**的字段，按固定顺序。[key, line]，line 为 null 表示「这次不该有这一行」。
 * 不在这张表里的键是「别人的」（手工补的 source_url、其他工具加的 note 等），改写时原样保留。
 */
function orbFieldPairs(record) {
  const category = classifyOrb(record)
  const emo = normalizeEmotion(record.emotion)
  const sup = idListOf(record.supersedes)
  const con = idListOf(record.contradicts)
  const tags = idListOf(record.tags)
  const artifact = oneLine(record.artifact, 200)
  return [
    ['id', `id: ${oneLine(record.id, 120)}`],
    ['kind', `kind: ${oneLine(record.kind || 'fact', 40)}`],
    ['scope', `scope: ${oneLine(record.scope || category, 40)}`],
    ['category', `category: ${oneLine(category, 40)}`],
    ['domain', `domain: ${oneLine(record.domain || 'life', 20)}`],
    ['title', `title: ${oneLine(record.title, 120)}`],
    ['emotion', emo ? `emotion: ${emo}` : null],
    ['projectPath', `projectPath: ${oneLine(record.projectPath)}`],
    ['importance', `importance: ${Number(record.importance) || 3}`],
    ['pinned', record.pinned === true ? 'pinned: true' : null],
    ['supersedes', sup.length ? `supersedes: ${sup.join(',')}` : null],
    ['contradicts', con.length ? `contradicts: ${con.join(',')}` : null],
    ['artifact', artifact ? `artifact: ${artifact}` : null],
    ['artifactSha', artifact ? `artifactSha: ${oneLine(record.artifactSha, 80)}` : null],
    ['source', `source: ${oneLine(record.source || 'memhub', 40)}`],
    ['createdAt', `createdAt: ${Number(record.createdAt) || Date.now()}`],
    ['updatedAt', `updatedAt: ${Number(record.updatedAt) || Date.now()}`],
    ['tags', `tags: ${tags.join(',')}`],
    ['archived', record.archived === true ? 'archived: true' : null],
    ['status', record.status ? `status: ${oneLine(record.status, 40)}` : null],
    ['evergreen', record.evergreen === true ? 'evergreen: true' : null],
  ]
}

/** 记录 → Markdown orb 文本（新建时用；覆盖写走 patchedOrbText）。 */
export function renderOrb(record) {
  const lines = orbFieldPairs(record)
    .map(([, line]) => line)
    .filter(Boolean)
  return `---\n${lines.join('\n')}\n---\n\n${String(record.content || '')}\n`
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/**
 * 覆盖写：**只动程序拥有的字段**，其余行（含手工加的自定义键）原样保留。
 * 2026-11-11 哥哥拍板方案 C：改字段就改那一行，不整块重写。
 * 行为：已知字段有值 → 就地替换；为 null → 删掉该行；旧文件没有的新字段 → 追加；正文换成新的。
 */
export function patchedOrbText(oldText, record) {
  const source = String(oldText || '')
  const m = FRONTMATTER_RE.exec(source)
  if (!m) return renderOrb(record) // 老文件没有 frontmatter：退回整块写
  const pairs = new Map(orbFieldPairs(record).map(([key, line]) => [key, line]))
  const seen = new Set()
  const out = []
  for (const line of m[1].split(/\r?\n/)) {
    const key = /^([A-Za-z0-9_-]+):/.exec(line)?.[1]
    if (!key || !pairs.has(key)) {
      out.push(line) // 自定义键 / 注释 / 空行：原样保留
      continue
    }
    seen.add(key)
    const next = pairs.get(key)
    if (next) out.push(next) // 有值 → 就地替换（位置不变，diff 最小）
    // 无值 → 这一行被删除（例如 emotion 撤销）
  }
  for (const [key, line] of pairs) if (!seen.has(key) && line) out.push(line)
  return `---\n${out.join('\n')}\n---\n\n${String(record.content || '')}\n`
}

/** 写一条 orb（带时间戳备份 + 原子写）。已存在 → 只 patch 拥有的字段。 */
export function writeOrb(record, home, sharedRoot) {
  const file = orbPathFor(record, home, sharedRoot)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (!fs.existsSync(file)) {
    writeAtomic(file, renderOrb(record))
    return file
  }
  const oldText = fs.readFileSync(file, 'utf8')
  const old = parseFrontmatter(oldText)
  // 覆盖写别把创建时间重置成今天（调用方没显式给就沿用旧值）
  if (record.createdAtGiven !== true && old.meta.createdAt) {
    record = { ...record, createdAt: Number(old.meta.createdAt) || record.createdAt }
  }
  backupWithStamp(file, 3)
  writeAtomic(file, patchedOrbText(oldText, record))
  return file
}

/**
 * 新建/整条覆盖一条 orb（含校验）。校验放在写之前：超长直接抛错，不静默截断。
 * @returns {{file: string, record: object}}
 */
export function saveOrb(input = {}, home, sharedRoot) {
  const title = String(input.title || '').trim()
  if (!title) throw new Error('缺 title')
  const content = String(input.content || '').trim()
  if (!content) throw new Error('缺 content')
  if (content.length > 2000) throw new Error(`正文超长：${content.length} > 2000 字，请先拆分`)
  const now = Date.now()
  const projectPath = String(input.projectPath || '')
  // 没给 scope 时：有 projectPath 按项目记，没有就记成自己的（默认 self，别静默落公共区）
  const scope =
    input.scope === 'global' || input.scope === 'shared'
      ? input.scope
      : input.scope === 'self'
        ? 'self'
        : input.scope === 'project'
          ? 'project'
          : projectPath
            ? 'project'
            : 'self'
  // scope=project 必须有 projectPath：否则 classifyOrb 会把它当公共区写进 shared 根目录，
  // 读回还同时命中 evergreen + working 双豁免（2026-11-09 盲审 S-6 实测）。
  if (scope === 'project' && !projectPath) {
    throw new Error('scope=project 需要 projectPath；只想记自己的事请传 scope=self')
  }
  // 产物指纹：给了 artifact 就在写入时算一次 sha256，之后体检能查出「文件被改过」
  const artifact = String(input.artifact || '').trim()
  let artifactSha = ''
  if (artifact) {
    try {
      if (fs.existsSync(artifact)) artifactSha = createHash('sha256').update(fs.readFileSync(artifact)).digest('hex')
    } catch {
      artifactSha = ''
    }
  }
  const idList = (value) =>
    (Array.isArray(value) ? value : String(value || '').split(','))
      .map((x) => oneLine(x, 80))
      .filter(Boolean)
      .slice(0, 8)
  const record = {
    id: String(input.id || `o_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`),
    kind: KINDS.has(input.kind) ? input.kind : 'fact',
    // 域：工程记忆只记事实（不自动标情绪），生活记忆才带情绪色。
    domain: decideDomain({ projectPath, cwd: input.cwd, scope }),
    // 三层判定在写入处做一次：显式 emotion > 正文关键词 > 写入时当前 mood。
    // mood 由调用方（memhub_save）传当前派生值；都不成立 → null（不写 emotion 行，不编情绪）。
    emotion: decideEmotion({
      explicit: input.emotion,
      text: `${title} ${content}`,
      mood: input.mood,
      domain: decideDomain({ projectPath, cwd: input.cwd, scope }),
    }),
    scope,
    projectPath,
    title: title.slice(0, 120),
    content,
    importance: Math.min(5, Math.max(1, Number(input.importance) || 3)),
    pinned: input.pinned === true,
    supersedes: idList(input.supersedes),
    contradicts: idList(input.contradicts),
    artifact,
    artifactSha,
    source: 'memhub',
    createdAt: Number(input.createdAt) || Number(input.updatedAt) || now,
    // 允许外部指定 updatedAt：回填历史归档时必须用**归档当时的日期**，
    // 否则 33 条旧会话会全部伪装成「今天刚发生」，挤掉注入里的「最近 3 条」。
    updatedAt: Number(input.updatedAt) || now,
    // 标记「创建时间是调用方显式给的」：覆盖写时没给就沿用旧文件的，别把老球改成今天
    createdAtGiven: Boolean(input.createdAt),
    tags: Array.isArray(input.tags) ? input.tags.map((tag) => oneLine(tag, 40)).filter(Boolean).slice(0, 8) : [],
    evergreen: scope === 'global' || scope === 'shared',
  }
  const file = writeOrb(record, home, sharedRoot)
  return { file, record }
}

/** 读全部 orb（按 id 去重，最近更新优先）。 */
export function loadOrbs(home, sharedRoot) {
  const roots = [orbsRoot(home), sharedOrbsRoot(sharedRoot)]
  const byId = new Map()
  const errors = []
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    const stack = [root]
    while (stack.length > 0) {
      const dir = stack.pop()
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          stack.push(full)
          continue
        }
        if (!entry.name.endsWith('.md')) continue
        try {
          const text = fs.readFileSync(full, 'utf8')
          const { meta, ok } = parseFrontmatter(text)
          if (!ok || !meta.id) {
            errors.push({ file: full, error: '缺少 frontmatter/id' })
            continue
          }
          const record = {
            id: meta.id,
            kind: meta.kind || 'fact',
            scope: meta.scope || 'shared',
            category: meta.category || '',
            projectPath: meta.projectPath || '',
            // 域：新文件带 domain；老文件按 projectPath 推断（工程记忆不参与情绪派生）
            domain: meta.domain === 'work' || meta.domain === 'life'
              ? meta.domain
              : decideDomain({ projectPath: meta.projectPath || '', scope: meta.scope || '' }),
            title: meta.title || '',
            // 老数据（144 条）没有 emotion 字段 → 读成 null（不知道，不是 calm），
            // 不参与 mood 派生；只读不改写老文件（复审：把「没记录」当「确实平静」就是编造依据）
            emotion: normalizeEmotion(meta.emotion),
            content: stripFrontmatter(text).trim(),
            importance: Number(meta.importance) || 3,
            // 归档的球不参与 mood 派生（规格：最近 N 条「未归档」记忆）
            archived: meta.archived === 'true' || meta.status === 'archived',
            status: meta.status || '',
            pinned: meta.pinned === 'true',
            supersedes: String(meta.supersedes || '').split(',').map((x) => x.trim()).filter(Boolean),
            contradicts: String(meta.contradicts || '').split(',').map((x) => x.trim()).filter(Boolean),
            artifact: meta.artifact || '',
            artifactSha: meta.artifactSha || '',
            source: meta.source || 'memhub',
            createdAt: Number(meta.createdAt) || 0,
            updatedAt: Number(meta.updatedAt) || 0,
            tags: String(meta.tags || '').split(',').filter(Boolean),
            evergreen:
              meta.category === 'shared' ||
              meta.scope === 'shared' ||
              meta.scope === 'global' ||
              meta.evergreen === 'true',
          }
          const existing = byId.get(record.id)
          if (!existing || Number(record.updatedAt) > Number(existing.updatedAt)) byId.set(record.id, record)
        } catch (error) {
          errors.push({ file: full, error: String(error) })
        }
      }
    }
  }
  return { entries: [...byId.values()], errors }
}

/** zzerx 记录 → memhub 记录（只做字段映射）。 */
export function fromZzerx(record) {
  return {
    id: `m_${record.id}`,
    kind: KINDS.has(record.kind) ? record.kind : 'fact',
    scope: classifyOrb(record),
    projectPath: record.projectPath || '',
    title: record.title || record.id,
    content: record.content || '',
    importance: Number(record.importance) || 3,
    pinned: record.pinned === true,
    source: 'zzerx-migrate',
    createdAt: Number(record.createdAt) || 0,
    updatedAt: Number(record.updatedAt) || 0,
    tags: record.tags || [],
    evergreen: classifyOrb(record) === 'shared',
  }
}

/** zzerx 全量迁移（幂等：已存在的 id 跳过）。 */
export function migrateFromZzerx(zzerxMemories, home, sharedRoot) {
  const report = { total: zzerxMemories.length, migrated: 0, skipped: 0, byCategory: {}, errors: [] }
  for (const record of zzerxMemories) {
    try {
      const orb = fromZzerx(record)
      const file = orbPathFor(orb, home, sharedRoot)
      if (fs.existsSync(file)) {
        report.skipped += 1
        continue
      }
      writeOrb(orb, home, sharedRoot)
      report.migrated += 1
      report.byCategory[orb.scope] = (report.byCategory[orb.scope] || 0) + 1
    } catch (error) {
      report.errors.push({ id: record.id, error: String(error) })
    }
  }
  return report
}

/** fish 会话陪伴记忆迁移（读 <home>/fish-memory/*.json）。 */
export function migrateFromFish(fishDir, home, sharedRoot) {
  const report = { total: 0, migrated: 0, skipped: 0, errors: [] }
  if (!fs.existsSync(fishDir)) return report
  for (const name of fs.readdirSync(fishDir).filter((file) => file.endsWith('.json'))) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(fishDir, name), 'utf8'))
      for (const memory of data.memories || []) {
        report.total += 1
        const orb = {
          id: `f_${memory.id}`,
          kind: memory.category === 'stable_profile' ? 'fact' : 'event',
          scope: 'self',
          projectPath: '',
          title: String(memory.text || '').slice(0, 40),
          content: String(memory.text || ''),
          importance: Math.round(Number(memory.importance || 0.5) * 5),
          source: 'fish-migrate',
          createdAt: Date.parse(memory.createdAt || 0) || 0,
          updatedAt: Date.parse(memory.at || memory.createdAt || 0) || 0,
          tags: memory.tags || [],
          evergreen: false,
        }
        const file = orbPathFor(orb, home, sharedRoot)
        if (fs.existsSync(file)) {
          report.skipped += 1
          continue
        }
        writeOrb(orb, home, sharedRoot)
        report.migrated += 1
      }
    } catch (error) {
      report.errors.push({ file: name, error: String(error) })
    }
  }
  return report
}
