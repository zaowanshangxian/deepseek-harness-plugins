# 变更记录（只追加，不改旧行）

## 2026-11-03
- 项目初始化（脚手架生成）
- 第 1 期技能模块：索引器 + 4 工具（skill_search / skill_load / skill_list / skill_register）+ 一行提示（order 90000）+ 自测
- 中文检索从子串匹配改为 2-gram + 别名表：修复「写测试 / 排障 / 做PPT / 交付前验证」查不到
- 自测 19/19；索引 41 行；未安装、未改 frontmatter（等哥哥确认）
- 沙箱验证：`tests/sandbox.mjs`（mock loader 跑真实 host.js）12/12；装到 `desktop-test` profile（非客户端）
- 技能开关：41/41 已加 `disable-model-invocation`，整库备份 `~/.dsh/skills-backup-20261103-003348`，可 `--restore`
- 第 2 期记忆模块：`src/recall-store.js`（读 zzerx + sidecar 分级）+ `src/recall-scheduler.js`（280 字符预算调度）+ 3 个工具（memhub_open / memhub_raw / memhub_budget）+ 记忆注入（order 901）+ owner 门
- `tools/recall-index.mjs`：98 条 sidecar（long 67 / event 31）可重跑生成
- 自测：记忆 17/17、沙箱 17/17（7 工具）
- 按哥哥要求恢复技能开关（hidden=0），等插件完整上线后再统一加
- 第 3–7 期：治理（govern）/教训（lessons）/晋升+台账（promote）/自我叙述（selfnote）/情感（affect）/星图（graph）
- 工具拆分：tooling + tools-skill + tools-recall + tools-learn（16 工具），host.js 改为组装器
- 面板：lib/client.js（设置页：技能/星图/情感/自我）+ host /memhub/api（state/graph/skill toggle）
- 四套测试：19/17/35/25 全过；语法 16/16
- 事故修复：desktop-test 符号链接共享 desktop node_modules，沙箱安装误伤后已 pnpm install 恢复客户端
- 盲审（REVIEW.md）4 条严重问题修复：sidecar 重建保留 recall/archived、情感块按行预算、技能写回原子+时间戳备份+覆盖确认、owner 门覆盖写工具
- 测试升级：check 改 hermetic fixture（28/28）、govern 42/42、sandbox 32/32（18 工具、schema 2321 字符）、recall 17/17
- 文档数字改为可重跑命令：技能 42 / 676 字符、记忆 98 条
- 死配置/死导出清理：indexMode/indexBudget、TOKEN_PER_CHAR、未用导入；frontmatter 统一到 frontmatter.js
- 第 8–9 期：人格模块（蓝图/步长 0.02/情感偏置 24h 衰减到零）、自有 orb 存储（公共区/项目/自我）、zzerx+fish 迁移脚本、索引 INDEX.md、注入 904/905
- 星图交互：点选节点改 tier / 删除（归档）/ 恢复；面板加「性格」页
- 教训迁公共区 `L:\DSH\shared\memhub\lessons.jsonl`；工程/公共区记忆 evergreen 不衰减
- 四套测试 28/17/56/34；迁移 dry-run 98 条（shared 53 / self 27 / project 18）

## 2026-11-04
- **装进桌面客户端**：`~/.dsh/profiles/desktop` 的 `dsh.profile.bundles` 第 22 项、`dependencies` 为 `link:L:/DSH/DeepSeek/projects/dsh-memhub`、`pnpm-lock.yaml:35-37` 有该 link 依赖
- **真机加载成功**：`~/.dsh/memhub/self-check.json`（desktop 重启后写）skills 42 / memories 102 / errors 0 / long70 event32；`INDEX.md` 2725 字节
- **冒烟三条全过**：技能零预注入（新会话无 available_skills，只有「## 能力库」）、面板 API（`state` 200 / `graph` 200 / 未注册路由 404）、工具可调（skill_search / skill_load / memhub_budget / affect_state / self_view）
- **坑（已修）**：`@deepseek-ai/dsh-tools` 只随 `@deepseek-ai/dsh` 装在嵌套 node_modules，npm 公开版仅 `0.0.1-rc.1`；link 插件 import 报 `ERR_MODULE_NOT_FOUND` 后被静默跳过。修法：项目内建 `node_modules/@deepseek-ai/dsh-tools` junction 指向宿主实包
- **Step 1 写入通道**：新增 `memhub_save`（写 orb、超长硬拒、带 id 覆盖）与 `memhub_search`（2-gram + 标题加权 3 倍）；`memhub_open`/`memhub_search` 改为双源（当前源 + 本地 orb），迁移前也能读写自己的库
- orb frontmatter 加 `category`，`scope` 改存原语义（global/project/self 不再被分类结果覆盖）；`evergreen` 按 category/global 判定
- 工具 schema 2321 → 2808 字符（≈1509 → 1825 tokens），上限 2400 → 3000
- 四套测试 31/17/59/**43**（sandbox 新增 7 条：写入成功/返回 id/scope 原语义/category/双源检索/双源打开/超长拒绝）
- **实体/边落库**：新增 `src/graph-store.js`（与 zzerx 同格式，`<memhub>/graph/{entities,edges}`）+ `memhub_graph` 工具（op=entity/link）；`/api/graph` 改双源合并，同 id 本地优先。sandbox 48/48
- 工具 schema 2808 → 3172 字符，上限 3000 → 3400
- **独立星图页**：`GET /memhub/graph` 返回零依赖自包含 HTML（`lib/graph-page.js`）；**打开才拉一次数据，不轮询不常驻**；实体中心环 + tier 三层环；点节点看详情。sandbox 53/53
- 修 bug：`classifyOrb` 的「无 projectPath 归 shared」把 `scope=self` 吞了 → 加 self 短路判断（真机验证时发现）
- **休眠语义（Step 1 收尾）**：`isDormant`（decay < 0.3 且 3 天没想起 → 不自动注入）+ `recall-scheduler` 过滤 + `recordRecall` 1 小时冷却（防「连开 3 次升 core」）。注意和现有「冻结（高频→免衰减）」是两个相反概念，注释里写清了
- `tools/link-host-deps.mjs`：自动找宿主并补 `@deepseek-ai/dsh-tools` junction（幂等 + `--dry-run` + import 自检）
- `CONFIG-MAP.md`：16 项配置的「文件:行 / 默认值 / 改错后果」
- `DEGRADE.md`：插件准入的降级契约（待哥哥点头再进 AGENTS.md）
- 迁移 dry-run 加「疑似重复组」报告：bigram Jaccard（阈值按实测标定为 0.6，不是照抄 difflib 的 0.82）+ 完整分类清单落 `data/migrate-dryrun-<日期>.md`；本轮实测 102 条 / 0 错误 / 0 重复组 / 最高相似度 0.46

## 2026-11-05 · 迁移执行
- **迁移落地**：zzerx 102 条 + fish 3 条 → orb **105 条，0 错误**；分盘 shared 53 / self 31 / project 21
- 踩坑修复：`projectSlug('L:\DSH\work')` 生成 `l:-dsh-work`，**冒号在 Windows 非法** → 21 条 project 首轮全挂；改为过滤 `<>:"|?*` 后补迁成功
- 切源：profile patch 追加 `recall.source: memhub`
- zzerx 软停用：`- id: zzerx-memory` 加 `disabled: true`（回滚＝删这行）
- 原库备份：`~/.dsh/storages/memory-backup-20261105-074120`（11 MB）
- 不归并：dry-run 里最像的 5 对（最高 0.46）经确认属于「相关」不是「重复」，不合并
- **日记**（`src/diary.js` + `memhub_diary` 工具）：按天分页、多人共用一本、每段带时间署名；落 `L:\DSH\shared\memhub\diary\YYYY-MM-DD.md`。分工：日记=当天发生什么（靠翻），记忆=以后还该记住什么（靠检索/衰减）
- **归档 → 记忆桥**（`tools/archive-to-memory.mjs`）：把 `.dsh/archive/logs` 的会话总结同步成 orb（id=`arc_<文件名>`，幂等）；统一出口只有 memhub 一处。支持 `--dry-run` / `--date` / `--all`
- 工具数 22，schema 3352 字符（仍 ≤3400）；sandbox 56/56
- **历史归档回填**：34 个归档 → 写入 33 条（去重 1 条），orb 总数 105 → 139；幂等复跑「写入 0 / 跳过 33」
- 去重口径踩坑：比较**必须用正文**（去 frontmatter）。同一对 misc 文件，全文相似 0.617、正文 0.535——frontmatter 里 same session/cwd/created 字段会把不同文件算成重复。归档类阈值取 0.5（同源概率高于记忆库的 0.6）
- `src/similarity.js` 抽出共用：`migrate-memory.mjs` 与 `archive-to-memory.mjs` 不再各写一份

## 2026-11-05 · 四级分层
- 记忆分层从三级改**四级**：`core`（永久）/ `long`（**180 天**保护）/ `mid`（**90 天**保护）/ `event`（**30 天**保护）；保护期内 `decay` 恒为 1，过了才按半衰期掉
- `tierOf`：pinned 或（importance 5 且召回 ≥3）→ core；长期类 kind 且 importance ≥4 → long；长期类 kind 或 importance ≥4 → mid；其余 event
- 注入：notable 纳入 mid（core/long/mid 取 2 条），标签改 `[核心]/[长期]/[中期]/[近期]`
- 面板与独立星图：加 mid 环（青色）与四级图例；面板改 tier 的接口放行 mid
- 现有 139 条重新分级：long 71 / mid 30 / event 38 / core 0；**全部仍在保护期内（decay = 1）**
- 测试 recall **23/23**（新增 6 条保护期边界：29/30 天、89/180 天、179/360 天）

## 2026-11-05 · 整理
- 全库 139 条两两比较（9591 对）：相似度 ≥0.4 **仅 1 对**（0.476，主题相关非重复）→ **无可合并对象**
- 修 bug：归档回填统一用「回填时刻」当 `updatedAt`，33 条旧会话伪装成「今天」，挤占注入的「最近 3 条」。`saveOrb` 支持外部 `updatedAt`；回填脚本改用归档日期；`tools/fix-arc-dates.mjs` 修历史 31 条
- **归档 33 条 `arc_*`**（过程记录，不是结论）：`tools/archive-backfill.mjs`，只改 sidecar 标记，orb 文件不动；`--restore` 可全恢复
- **清理孤儿 sidecar 102 个**（迁移前按旧 zzerx id 存的）：`tools/prune-sidecars.mjs`，**移到** `recall-orphans-<时间戳>/` 不删除
- `applyArchive` / `recordRecall` 的 id 校验放宽到允许中文（原会把 `arc_SPEC-2026-11-01-盲测` 拒掉），仍禁 `..` 与路径分隔符
- 整理后：orb 139 / sidecar 139（44 归档）/ 注入 266 字符 6 条，**无「会话归档」混入**

## 2026-11-08 · 工作记忆
- 新增 `working` 层级：**项目记忆不注入、不衰减**，干活时按需读（`memhub_search` / `memhub_open`）
- 判定：`record.working === true || record.scope === 'project'`；`core` 规则（pinned / importance 5 且召回 ≥3）优先于它
- 注入侧过滤 `item.tier !== 'working'`；`decayScore('working')` 恒为 1（GRACE / HALF_LIFE 都是 Infinity）
- 现有 139 条重新分级：**working 40** / long 53 / mid 28 / event 19；注入选中里 0 条 working
- 星图与面板加 working 环（灰）+ 图例；面板可手动把条目设为 working
- `TIER_AFFECT_WEIGHT` 补 working 0.5（原会 fallback 到 0.3）
- recall **27/27**（新增 4 条：项目→working、显式标记、core 优先、400 天不衰减）

## 2026-11-09 · janitor（ROADMAP Step 3）
- **治理管线落地**：`src/janitor.js`（`planJanitor`/`planDedupe` 纯函数 + `runJanitor`/`createSnapshot`/`restoreSnapshot`）；宿主启动 `runStartupJanitor` 只在超容量时淘汰，**只淘汰不合并**
- 容量上限 `janitor.maxOrbs=300`（只算活跃条目）；protected 豁免：archived / evergreen / pinned / core / working（working=项目按需层，11-08 新增）
- 淘汰 = sidecar `archived=true`，orb 永不 unlink；排序 `importance×decay` 升序、同权重取最老
- 去重合并：Jaccard ≥ 0.82 且正文 ≥ 60 字（短文本相似度虚高实测 0.84，加最小长度门槛）；保留高权重、`min(9, a+b*0.3)`、写 `archive.jsonl`；合并只走 CLI `--apply`
- 维护前快照：`~/.dsh/memhub/snapshots/<时间>-<随机>/`（orbs/recall/graph/公共区 orbs），留 3 份；restore 前再快照（`pre-restore-*`），旧目录原地改名留档
- CLI `tools/janitor.mjs`：默认 dry-run、`--apply`、`--list`、`--restore latest`、`--shared`（测试用）
- `src/orb-store.js`：导出 `orbPathFor`（合并权重时回写原件）；`src/recall-store.js`：抽出纯函数 `mergeSidecars`
- 自检加 `janitor: {evicted, snapshot}`（静默失败看产物）
- 测试：govern **85/85**（+19）、sandbox **62/62**（+6，含启动自动淘汰）；四套 31/27/85/62
- 真机 dry-run：140 条 / 活跃 96 / 可淘汰 28 / 0 溢出 / 0 重复；CLI 在临时目录 apply→restore 往返通过

## 2026-11-09 · janitor 盲审修复（REVIEW-janitor.md）
- **P0**：`restoreSnapshot` 的安全快照会 prune 掉自己要恢复的那份 → prune 支持 `protect`、恢复前二次校验、`restored` 为空直接报错
- **S-1**：快照按 `manifest.at` 排序；`latest` 只认普通快照（`pre-restore-*` 需显式 id）
- **S-2**：同轮去重保下来的条目不进淘汰候选；`runJanitor` 再兜一层「keep/drop 已被淘汰 → skipped」
- **S-3**：去重改用**全文** bigram（原来只比前 300 字）+ 长度差 ≤30% 门限；`similarity.js` 导出 `bigrams`/`jaccard`
- **S-4**：`scope: global` 也算 evergreen（迁移前默认 zzerx 源下不再可淘汰）
- **S-5**：orb 支持 `pinned` 字段（render/load/save/迁移四处），迁移不再静默丢 pin
- **S-6**：`scope=project` 无 `projectPath` 直接报错（原来会静默写进公共区根目录并双豁免）；README 的「protected 不占名额」更正
- **S-7**：restore 改两阶段提交（先全部拷到 tmp，再换入，失败回滚）
- **S-8**：快照拷失败清掉半成品目录；`listSnapshots` 只认有 manifest 的
- **S-9**：manifest 记 `dataRoot/sharedRoot`，路径不一致拒绝恢复（`--force` 才盖）
- **G 系**：`.pre-restore-*` 只留最新一份；日志写失败进 `logErrors`；`skipped` 带原因并在 CLI 分组打印；`bumpImportance` 失败算 skipped；`stats.janitor` 加 overflow/capped/evictable/merged/skipped/logErrors；启动去重关闭（O(n²) 不同步阻塞）；CLI 参数校验（`--max abc` 退出 2、`--restore --shared` 不再把 flag 当 id）
- 测试：govern **99/99**（+13 条盲审回归：连续 restore、latest、keep 被淘汰、300 字截断、global evergreen、pinned、默认落点、公共区不一致、capped 不动盘、小数上限）；四套 31/27/99/62

## 2026-11-09 · janitor 复审修复（REVIEW-janitor.md 第二轮）
- **R-1**：restore 的 `done` 记账挪到「rename 换入」之前 → 换入失败时回滚能找到当前项（原来该组件会消失）
- **R-2**：restore 第一阶段的 `cpSync` 包进 try，失败清 tmp
- **R-3**：先合并、再按合并后的活跃数算 overflow；淘汰候选排除将被合并归档的 drop → 不再把名额压力转嫁给高权重条目（`kc` 权重 5 不会被淘汰）
- **R-4**：restore 的安全快照沿用配置的 `snapshotKeep`
- **R-6**：`logErrors` 去重
- **R-7**：prune 清掉无 manifest 的硬崩残留目录
- **G-12**：importance 已到 9 时合并不再误报「字段缺失」并 skip
- **S-6 调整**：不传 `scope` 默认 `self`（有 `projectPath` 才按项目记）；只有显式 `scope=project` 缺 `projectPath` 才报错（原实现会让 `memhub_save {title, content}` 失败）
- 测试：govern **105/105**（+6）；README 口径同步

## 2026-11-10 · 体检改量 memhub（AUDIT-2026-11-06 的 P0）
- **新增 `src/health.js`**（纯函数）：库存 / 分层 / 归属 / protected·可淘汰 / 休眠 / 可归档 / 注入成本 / 容量余量 / 问题分级（严重·警告·提示）/ Markdown 渲染
- **新增 `tools/health-report.mjs`**：只读 memhub 产物；`--dupes` 算重复对、`--write` 落 `~/.dsh/memhub/reports/health-<时间>.md`、`--json`、`--max/--budget` 覆盖；有「严重」退出码 2（计划任务可报警）
- 为什么：旧 `memory_audit.py` 读 `~/.dsh/storages/memory`（zzerx 旧库），迁移后每天还在量停用的库，对 memhub 完全失明
- 修两个自测抓到的坑：报表时间用本地时间（ISO 切片会差 8 小时）；INDEX.md 与 self-check 同一次自检先后写，差几毫秒不算「索引没生成」（容差 5 分钟）
- 测试：新增 `tests/health-check.mjs` **22/22**；`npm test` 串起五套（31/27/105/62/22）
- 真机首份报表：140 条 / 96 活跃 / 注入 213/280 字符 / 上限余量 204 / 0 可归档 / 0 休眠 / 无重复（未算）；**唯一警告**是 self_note 空 + 还没快照（都是事实）

## 2026-11-10 · 检索升级（ROADMAP Step 4）
- **新增 `src/search.js`**：`v2` 打分 = 2-gram token × IDF × 字段权重（标题 3 / 摘要 2 / 正文 1）+ 整句短语加成 + 可选实体加成；`v1` 老公式保留对照；记忆域别名（接入/恢复/配置/体检/归档/注入/模型/汇报/分盘/沙箱/迁移/人格/检索）
- `memhub_search` 改走 `searchMemories(..., mode:'v2')`，双源（当前源 + 本地 orb）不变；空查询仍是最近 5 条
- **新增 `tools/search-bench.mjs`**：真机 96 条活跃记忆 × 18 条「换个说法」查询，对比 baseline（整句子串）/ v1 / v2
- 实测：baseline hit@1 2/18（MRR 0.111）→ v1 15/18（0.883）→ **v2 16/18（0.928）**，hit@3 17/18；报告 `data/search-bench-20261110.md`
- 测试：新增 `tests/search-check.mjs` **10/10**；六套 31/27/105/62/22/10

## 2026-11-11 · 记忆取代语义 + 产物指纹 + 容量缓冲 + 隔离游戏技能库
- **取代语义**：orb 支持 `supersedes` / `contradicts`；sidecar 生成 `supersededBy`（最新者胜）；`memhub_search` 对被取代条目降权到 35%（仍可追溯），注入直接排除；`memhub_save` 新增三个参数（`supersedes` / `contradicts` / `artifact`），schema 3553/3600
- **产物指纹**：`memhub_save` 给 `artifact` 时算 sha256 存 orb；体检 CLI 重算并报「外部修改 / 文件缺失」
- **容量缓冲**：`janitor.archiveBuffer` 默认 1.2——活跃数超过 `maxOrbs × 1.2` 才归档，归档到 `maxOrbs`，避免「每条新记忆都触发一次淘汰」
- **隔离游戏技能库**：`extraVaults` 多库合并（core 优先、重名记 error）；游戏库在 `L:\DSH\DeepSeek\skills-game`（77 个 SKILL.md，来自 awesome-gamedev-agent-skills），零预注入、按需 `skill_search`/`skill_load`，候选卡标 `[game]`
- `frontmatter` 解析支持 YAML 块标量（`description: >` / `|`）——外部技能库普遍用折叠描述
- 测试：check **40/40**（多库/重名/折叠/主库优先）、recall **30/30**（取代）、govern **107/107**（缓冲）、health **24/24**（指纹/取代）、search **10/10**（降权）、sandbox **65/65**（走真实 host 路径）

## 2026-11-11 · 小修（演练后）
- 体检的产物指纹**跳过归档条目**：演练记忆归档后引用的临时文件已删，原来会误报「文件缺失 1 条」


## 2026-11-11 · 沙箱验证「无 zzerx」（卸包前）——默认源翻转 + 三处静默降级修掉
- **默认 `recall.source` 从 `zzerx` 改为 `memhub`**（`src/host.js:61`）：旧默认下配置漏写/写错 = 读到空库、注入块只剩标题，日志一句话都没有（沙箱实测：144 条 → 0 条、注入 246 → 31 字符）。回滚旧库现在要显式写 `'zzerx'`
- **源读不出来要出声**（`src/host.js:463`）：`self-check` 里记了 `memoryErrors` 但日志无声；现在启动直接 warn，带源名和首条错误原文
- **星图旧库目录不在**（`src/host.js:300-330`）：`loadEntities/loadEdges` 原来吃默认 `zzerxRoot()`；卸载后 82 实体 / 2013 边**静默消失**（`/api/graph` 仍 200）。现在显式传入 + 本地也没图时 warn 一次；本地有图（迁移过）就不再吵
- **星图迁移**（`tools/migrate-memory.mjs:32-64`）：原来只搬记忆，实体/边没有迁移路径。`--apply` 现在一起搬（按文件名幂等，不覆盖本地同名）；真机副本实测 82 实体 + 2013 边 = 复制 2095、二次跑复制 0/跳过 2095
- **原文回读**（`src/recall-store.js:222-268`、`src/tools-recall.js:74`）：`findRawText` 现在兼容 `m_<zzerx id>` 前缀（迁移后 id 全带前缀，原来一条都命中不了）；旧库 `raw_documents` 目录不在时返回 `missingRoot`，文案从「可能已被裁剪」改成「旧库目录不存在」
- **`tools/recall-index.mjs`**：源不可读时不再把 `recall-index.jsonl` 覆盖成空文件（原来写 1 字节再退出 1）
- **`tools/migrate-memory.mjs`**：「没有可迁移的记忆」现在区分「库是空的」和「目录不存在（已卸载）」
- 测试：新增 `tests/zzerx-removal.mjs` **24/24**（hermetic：fixture 旧库 + 三种源配置 + 迁移幂等 + CLI 退出码）；`tests/sandbox.mjs` 加 `MEMHUB_ZZERX_ROOT` 开关，旧库不在也能 65/65；check 40 / recall 30 / govern 107 / health 24 / search 10 全绿
- 报告：`SANDBOX-zzerx-removal.md`（复现步骤 + 结果表 + 问题清单 + 没验证到的）

## 2026-11-11（续）情绪绑定记忆 + 情绪安全阀

> 起因：哥哥指出「立项就是以《头脑特工队》为基础，本来就应该有记忆绑定情绪」。核对 `notes/2026-11-02-记忆框架-完整规格-v3.md` L71/L74/L463/L466 —— **是原设计，实现时漏了**。这轮按规格补回来，并按规格 L466 把注入层收回到 0 token。

- **记忆带情绪色（规格 L71/L74）**：orb frontmatter 新增 `emotion:`（Inside Out 七词：joy/sad/anger/fear/disgust/anxiety/calm）；写入三层判定（显式 > 正文关键词 > 当前 mood），**判不出就不写**（`null`），不编造。`renderOrb` 单行字段统一 `oneLine()` 净化（换行→空格+限长），堵住「`tags:[\"
archived: true\"]` 把球写归档」的注入面。
- **mood 派生（规格 L463）**：新增 `deriveMood(entries, now)` —— 最近 12 条**有情绪标签**的未归档球，权重 `importance(1–5) × 0.5^(h/72)`，七词→六 mood 映射，`basis` = 顶起获胜 mood 的球里权重前 3 的**真 orb id**，总权重 <0.5 → `neutral` + 空 basis。`effectiveState()` 用派生值覆盖存档 mood（`pinned` 仍是唯一上位覆盖，必须给原因+期限）。
- **「不知道」≠「平静」**（盲审 S1）：缺失 emotion 读成 `null` 而不是 `calm`；`deriveMood` 跳过无标签球。**生产 144 条旧球 → neutral + 空 basis（诚实），新写的球立刻有颜色。**
- **召回带色（规格 L74）**：`memhub_search` 每条带 `[joy]` 标签；`memhub_open` 显示情绪；sidecar 透传 `emotion`，重建不丢。
- **注入收回 0 token（规格 L466）**：删掉 `## 状态（参数…）` 块（原 92 字符/≈60 tokens，正是 L466 点名的写法）；派生 mood **并进 `## 性格参数` 当一行参数**（`基调 warm 1.00`，非 neutral 才出现，≤22 字符）；`renderAffectBlock` 只保留 `pinned` 一行（≤40 字符）。常驻注入从 536 字符回落到 ≈460 字符。
- **情绪安全阀（新增，规格里没有）**：`src/safety.js` —— 水槽（crisis 5 / abuse 3 / negation 2 / other 1，每分钟漏 0.8，幂等衰减）+ 分级（<25 ok / 25–60 soft / 60–95 ask / ≥95 stop）+ **自伤表述独立于水槽直接 crisis**。`safety_check` 工具 + `affect_event` 新增 negative/insult/crisis 三个值。**自动触发点**：`agent/pre-step` 钩子（去重），不靠模型记得调。
  - **crisis 改为句级判定 + 三道闸**（盲审 S-1：原词表在真实库 100
## 2026-11-11（工程/生活分离）

> 哥哥定：**工程记忆是客观事实，不标情绪**；工程会话不花生活侧 token；情绪只跟生活、聊天、以后的 QQ 个人号走。

- orb 新增 `domain: work | life`：`projectPath` 命中 `DSH\work` 或 `scope=project` → work，其余 → life
- `decideEmotion` 加域闸：`domain=work` 时**跳过关键词与 mood 兜底**，只认调用方显式给的情绪（「这轮搞砸了」这种对结果的情绪由我主动写）
- `deriveMood` 只让 life 的球投票：工程会话里即使显式带了情绪也不影响 mood
- 工程会话（cwd 在 `L:\DSH\work`）不注入「## 自我」（自我叙述是生活/陪伴层），需要时用 `self_view`
- 老数据：无 domain 字段的按 projectPath 推断；无 projectPath 的判 life（且它们本来也没有 emotion，不参与派生）
- 测试：`tests/affect-binding.mjs` 73 → **85**，新增 12 条（域判定 / 工程不落 emotion 行 / 显式情绪仍保留 / 工程球不参与派生）
