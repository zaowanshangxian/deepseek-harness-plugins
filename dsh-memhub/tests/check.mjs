/**
 * 第 1 期自测（hermetic：fixture 技能库，不依赖真实用户数据）。
 * node tests/check.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadVault, loadSkillVaults, searchSkills, formatCards, formatList, budgetReport, toIndexLines, parseFrontmatter, skillCategory } from '../src/indexer.js'
import { hasFlag, addFlag, removeFlag } from '../src/frontmatter.js'
import { HINT_TEXT } from '../src/const.js'

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

const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'memhub-vault-'))
function writeSkill(dir, frontmatter, body = '# body\n') {
  fs.mkdirSync(path.join(vault, dir), { recursive: true })
  fs.writeFileSync(path.join(vault, dir, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}`, 'utf8')
}

writeSkill('tdd', 'name: tdd\ndescription: "测试先行：红-绿-重构"')
writeSkill('diagnosing-bugs', 'name: diagnosing-bugs\ndescription: 难 bug / 性能回归的诊断循环')
writeSkill('ppt-design-skill', 'name: ppt-design-skill\ndescription: 做/改 PPT 的完整设计与验收流程')
writeSkill('verification-before-completion', 'name: verification-before-completion\ndescription: 声称完成前必须先跑验证并贴输出')
writeSkill('hidden-skill', 'name: hidden-skill\ndescription: 带开关的技能\ndisable-model-invocation: TRUE')
writeSkill('crlf-skill', 'name: crlf-skill\r\ndescription: CRLF 行尾的技能')

const index = loadVault(vault)
ok(index.errors.length === 0, `fixture 技能库无解析错误（errors=${index.errors.length}）`)
ok(index.entries.length === 6, `条目数 6（实际 ${index.entries.length}）`)
ok(index.entries.every((entry) => entry.name && entry.description), '每条都有 name + description')
ok(index.signature > 0, '索引带内容签名（缓存失效用）')

ok(searchSkills(index.entries, 'tdd').some((entry) => entry.name === 'tdd'), '检索「tdd」命中')
ok(searchSkills(index.entries, '写测试').some((entry) => entry.name === 'tdd'), '「写测试」命中 tdd')
ok(searchSkills(index.entries, '排障').some((entry) => entry.name === 'diagnosing-bugs'), '「排障」命中 diagnosing-bugs')
ok(searchSkills(index.entries, '做PPT').some((entry) => entry.name === 'ppt-design-skill'), '「做PPT」命中 ppt-design-skill')
ok(
  searchSkills(index.entries, '交付前验证').some((entry) => entry.name === 'verification-before-completion'),
  '「交付前验证」命中 verification-before-completion',
)
ok(searchSkills(index.entries, '完全不存在zzz').length === 0, '查不到时返回空')
ok(searchSkills(index.entries, '').length === 3, '空查询返回默认 3 条')

const cards = formatCards(searchSkills(index.entries, 'tdd'))
ok(cards.includes('tdd') && !cards.includes('# body'), '候选卡只给卡片，不含全文')
ok(cards.length < 600, `候选卡 ≤600 字符（实际 ${cards.length}）`)
ok(formatList(index.entries).includes('分组'), '分组列表可生成')

const report = budgetReport(index.entries)
ok(report.descChars <= 800, `描述总字符 ≤800（实际 ${report.descChars}）`)
ok(HINT_TEXT.length <= 60, `常驻提示 ≤60 字符（实际 ${HINT_TEXT.length}）`)
ok(!index.entries.some((entry) => HINT_TEXT.includes(entry.name)), '常驻提示不含任何技能名')

const lines = toIndexLines(index.entries).trim().split('\n')
ok(lines.length === index.entries.length, '索引行数 == 条目数')
ok(
  lines.every((line) => {
    try {
      JSON.parse(line)
      return true
    } catch {
      return false
    }
  }),
  '索引行全部合法 JSON',
)

// frontmatter 边界（盲审建议10：引号 / CRLF / 缺 frontmatter / 大写 TRUE）
ok(parseFrontmatter('# 没有 frontmatter').ok === false, '无 frontmatter → ok=false')
ok(parseFrontmatter('---\nname: x\ndescription: "带引号"\n---\n正文').meta.description === '带引号', '引号 description 解析')
ok(parseFrontmatter('---\r\nname: x\r\n---\r\nbody').ok === true, 'CRLF frontmatter 解析')
ok(hasFlag('---\nname: x\ndisable-model-invocation: TRUE\n---\n'), '大写 TRUE 也识别为已开关')
ok(hasFlag('---\nname: x\ndisable-model-invocation: "true"\n---\n'), '带引号 true 也识别')
ok(addFlag('---\nname: x\n---\nbody') !== null, '可加开关')
ok(addFlag('# 无 frontmatter') === null, '无 frontmatter 拒绝加开关（不静默改文件）')
const toggled = addFlag('---\nname: x\n---\nbody')
ok(hasFlag(toggled), 'addFlag 后 hasFlag 为 true')
ok(!hasFlag(removeFlag(toggled)), 'addFlag → removeFlag 往返')

ok(skillCategory({ name: 'tdd' }) === '流程规范', 'tdd 归入「流程规范」')
ok(skillCategory({ name: 'research' }) === '文档内容', 'research 归入「文档内容」')
ok(skillCategory({ name: 'unknown-skill' }) === '其他', '未知技能归入「其他」')


// ── 多技能库（游戏库隔离）+ YAML 折叠描述 ─────────────────────────────
const vaultGame = fs.mkdtempSync(path.join(os.tmpdir(), 'memhub-vault-game-'))
fs.mkdirSync(path.join(vaultGame, 'threejs-scene-setup'), { recursive: true })
fs.writeFileSync(
  path.join(vaultGame, 'threejs-scene-setup', 'SKILL.md'),
  '---\nname: threejs-scene-setup\ndescription: >\n  Stand up a three.js scene:\n  import maps, renderer, camera.\n---\n# body\n',
  'utf8',
)
const multi = loadSkillVaults([
  { path: vault, label: 'core' },
  { path: vaultGame, label: 'game' },
])
ok(multi.entries.length === loadVault(vault).entries.length + 1, '多技能库合并后条目数 = core + game')
ok(multi.entries.every((entry) => entry.vault === 'core' || entry.vault === 'game'), '每条技能带库标签')
const gameEntry = multi.entries.find((entry) => entry.name === 'threejs-scene-setup')
ok(gameEntry?.vault === 'game', '游戏技能标为 game')
ok(gameEntry?.description.startsWith('Stand up a three.js scene'), '折叠 description（>）能解析成一行')
ok(searchSkills(multi.entries, 'three.js 场景', { limit: 3 }).some((entry) => entry.vault === 'game'), '游戏库可被检索到')
ok(formatCards([gameEntry], '').includes('[game]'), '候选卡标出 [game] 库')

// 重名：core 优先，另记一条 error
fs.mkdirSync(path.join(vaultGame, 'tdd'), { recursive: true })
fs.writeFileSync(path.join(vaultGame, 'tdd', 'SKILL.md'), '---\nname: tdd\ndescription: game tdd\n---\n# body\n', 'utf8')
const dup = loadSkillVaults([{ path: vault, label: 'core' }, { path: vaultGame, label: 'game' }])
ok(dup.entries.filter((entry) => entry.name === 'tdd').length === 1, '重名只保留一个（core 优先）')
ok(dup.errors.some((error) => String(error.error).includes('重名')), '重名记 error 不静默')

// 非主库轻微降权：同分时主库优先
fs.mkdirSync(path.join(vault, 'scene-helper'), { recursive: true })
fs.writeFileSync(
  path.join(vault, 'scene-helper', 'SKILL.md'),
  '---\nname: scene-helper\ndescription: scene helper 工作辅助\n---\n# body\n',
  'utf8',
)
fs.mkdirSync(path.join(vaultGame, 'scene-game'), { recursive: true })
fs.writeFileSync(
  path.join(vaultGame, 'scene-game', 'SKILL.md'),
  '---\nname: scene-game\ndescription: scene helper 游戏\n---\n# body\n',
  'utf8',
)
const tie = loadSkillVaults([{ path: vault, label: 'core' }, { path: vaultGame, label: 'game' }])
const tieHits = searchSkills(tie.entries, 'scene helper', { limit: 2 })
ok(tieHits[0]?.vault === 'core', `同分时主库优先（实际 ${tieHits[0]?.name}）`)

fs.rmSync(vault, { recursive: true, force: true })
console.log(`\n技能模块自测：${total - failures.length}/${total} 通过`)
if (failures.length > 0) {
  console.log(`失败项：${failures.join(' ｜ ')}`)
  process.exit(1)
}
