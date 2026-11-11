# ROADMAP：外部记忆系统清单的吸收计划（2026-11-03）

> 来源：`L:\DSH\shared\记忆系统-可学清单.md`
> · A = `y083245/dsh-memory-brain`（31k 行 JS + Python sidecar）
> · B = `gutuxxxxl/dsh-memory-blocks`（2.9k 行 Python，零依赖）
>
> **与 GAP.md 的分工**：GAP = 最初要求 vs 现在；本文 = 外部能学的东西 → 什么时候做、做在哪、怎么验收。
> **替代/删原插件**：见 `REPLACE.md`（谁能顶、什么算通过、怎么回滚）。
> **核查记录**：第一稿由 Lead 写，**第二轮独立盲审**（fresh 上下文审查员，只读）逐条回源码核过，修正 9 处判断（见 §5），第二轮复审又改掉 4 处统计/验收错误。本文所有「现状」都带 `文件:行`。

---

## 0. 基线：先写清楚现在**不是**什么

别把这堆目录当成「已经在跑的库」：

| 事实 | 证据 |
|---|---|
| 插件**未安装** | `~/.dsh/profiles/*/cordis.patch.yml` 无 memhub；只有 `desktop-test` 一次失败安装的残留 |
| `~/.dsh/memhub/` 下只有 `recall/` | `orbs/` 目录**不存在**，0 个 orb |
| `L:\DSH\shared\memhub` **不存在** | 所以 `lessons.jsonl` 从未写过（GAP.md:16 的「教训放公共区」目前是空承诺） |
| 98 条 sidecar 全是「空跑」 | `recall.count` 全为 0、core 0 条（long 67 / event 31）、archived 11 |

**结论**：现有数据是 `recall-index.mjs` 跑出来的派生快照，不是运行中的记忆库。Step 0 装之前，任何「现状如何」的判断都要按这个口径读。

---

## 0.1 先决条件：换栈这一刀还没磨完

两个 GAP.md 没记的洞，比清单里任何一条都靠前。**不补就迁移 = 单向死路。**

| 洞 | 证据 | 不补的后果 |
|---|---|---|
| **无写入通道** | `tools-recall.js:14-111` 只注册 `memhub_open/raw/budget/archive`，全是「拿 id 打开」；`writeOrb` 的调用点只有迁移函数（`orb-store.js:159`、`:197`） | 运行期没有任何代码能新建 orb；迁移完就冻结，新记忆继续写 zzerx |
| **实体/边不落 orb** | orb 字段是白名单（`orb-store.js:54-68`、`:105-118`），无 `entities`/`links`；星图两个源都读 `zzerxRoot()`（`graph.js:11-13`、`:32-34`） | 迁移丢实体图；原生新建的 orb（id 不带 `m_`）**永远是孤岛**（`graph.js:68` 只靠剥 `m_` 前缀接旧边） |

---

## 1. 逐条对账（盲审修正版）

| # | 清单要求 | 真实现状（带证据） | 判定 |
|---|---|---|---|
| ① | 自动去重（0.82 / 权重合并 / 归档可追溯） | 只有按 **id** 去重（`orb-store.js:119-120`），无相似度；`lesson_save` 的 trigger 去重是教训不是记忆 | **完全没有** |
| ② | 写满不拒绝、淘汰最低权重最老、`protected` 豁免 | `writeOrb` 无条数检查（`orb-store.js:73-79`）+ 缓存重建对每条重写 sidecar（`host.js:111-117`），O(n) 只增不减 | **完全没有**；但 `selfnote.js:52-75` 有现成范式可搬 |
| ③ | 冻结但可查 / 查到即解冻 / 冷却期 | **语义相反**：memhub 的「冻结」= 近期高频召回就**免疫衰减**（`govern.js:4-5`、`:17-22`）；注入只过滤 `archived`（`recall-scheduler.js:40`），**没有「冻结不注入」**；全项目无解冻实现；`recordRecall` 让 count+1 → 第 2 次起**更容易冻结**（`govern.js:56-63`） | **部分，且方向反了 → 要新建** |
| ④ | 超长直接报错、不静默截断 | 记忆 orb **零长度校验**（`orb-store.js:52-70`）；硬拒只在 selfnote（`selfnote.js:56-57`，文案已写「拆成两段或压缩」）和 lessons trigger（`lessons.js:13`） | **部分（记忆层没有）** |
| ⑤ | 维护前自动快照留 3 份、可 restore | 覆盖写前已有 `backupWithStamp(file, 3)`（`orb-store.js:76` → `frontmatter.js:68-85`）；缺「维护前」触发、缺快照目录/uuid、无 `restore()`；新建文件不备份（`frontmatter.js:69`） | **半条** |
| ⑥ | 语义检索（向量 + 关键词 RRF） | **比清单描述的更弱**：memhub 连关键词检索都没有，4 个工具全靠 id；子串匹配是 zzerx 的（外部插件）；注入靠 tier/最近/项目命中，不是检索（`recall-scheduler.js:42-49`）；indexer 的 2-gram 只服务技能 | **完全没有** |
| ⑦ | 配置地图（谁在第几行、改错会怎样） | 配置项+默认值已有（`README.md:51-71`）、真源边界表已有（`ARCHITECTURE.md:135-141`）；缺 `文件:行` 与「改错后果」 | **部分** |
| ⑧ | 降级契约 | 代码级降级齐（`host.js:118-119`、`:350-352`、`:384-394`）+ §3 失败行为列（`ARCHITECTURE.md:110-121`）；没写成准入契约 | **半条** |
| ⑨ | 3D 星图 | 只有 2D 环形 SVG（`client.js:95-125`）；点选→改 tier/删除/恢复**确实有**（`client.js:167`、`:176-217`） | 2D 已有，3D 不做 |
| ⑩ | 拖拽超 6px 不算点选 | **已查**：只有 `onClick`（`client.js:167`），全文件无 mousedown/move | 无拖拽，不做 |
| ⑪ | 可独立 `serve` | 有脱离宿主可跑的 CLI（`tools/*.mjs`），插件本体强依赖 `ctx.inject`（`host.js:397-409`），无 HTTP serve | 不做 |
| ⑫ | 一键起停 + systemd | `scripts/` 空；Windows 无常驻服务对应物 | 不做 |
| ⑬ | 每日报表（只统计、不调模型） | 有一次性统计（`self-check.json`，`host.js:386-390`）+ `tools/recall-index.mjs`；缺定时 | **部分，且成本极低 → 提前做** |
| — | 别学歪：实体图 / 双作用域 / 预检 / 上限的理由 | 前两条在**旧栈**成立；**迁移会压扁作用域**（见 §2-2），预检脚本不在 memhub 写入路径上（见 §2-6） | ⚠️ 不能直接说「守住」 |

**总账**：要新建 5 条（①②③⑥⑬——③ 是「语义相反，得重做成清单要的那个意思」）、部分 4 条（④⑤⑦⑧）、明确不做 4 条（⑨ 的 3D / ⑩ / ⑪ / ⑫），合计 13。

---

## 2. 盲审抓到、第一稿漏掉的 8 条

1. **刷计数能升 core，且无冷却**：`importance>=5 && count>=3 → core`（`recall-store.js:67`），而 `memhub_open` 每次都 +1（`tools-recall.js:27`）。**打开同一条 3 次 = 永久不衰减**。清单 #3 的 `reviewCooldownMs` 正是防这个。
2. **迁移会压扁双作用域**：`classifyOrb` 把 `global` 归成 `shared`（`orb-store.js:30`），`renderOrb` 写回的是分类结果（`:58`）。**原始 global/project 语义在 orb 里存不下来**——「守住双作用域」这句对迁移后的库不成立。
3. **迁移幂等判据是「文件存在」不是「id 存在」**：orb 路径带月份（`orb-store.js:43-48`），同一 id 若 `updatedAt` 跨月会写出第二份，旧月份没人清 → ② 的隐藏堆积源。
4. **冻结没有运行时消费者**：`planStatus` 只被 `host.js:242` 拿去面板显示计数；`applyArchive` 只有工具/面板手工调（`tools-recall.js:100`、`host.js:313`）。**「衰减 <0.2 → 归档」从来不会自己执行** → Step 3 不是「加三件套」，是**先建一条之前不存在的管线**。
5. **星图的跨 id 约定没写下来**：靠 `aliasOf` 剥 `m_`（`graph.js:68`）。Step 1 做实体落库时必须保留这个映射，否则迁移后星图断成两半。
6. **预检不在 memhub 路径上**：`memory-precheck.py` 是 `L:\DSH\DeepSeek\tools` 的外部脚本，orb 写入没有钩子 → 迁移后预检落空。
7. **`autoFiltered` 多报**：`graph.js:108` 用 `edges.length - links.length`，把「端点不在节点集被丢」也算成 auto 过滤，面板数字虚高。
8. **迁进 shared 的那批天生免疫淘汰**：`scope: global → shared`（`orb-store.js:30`）→ `evergreen: true`（`:117`）→ `planStatus` 第二顺位（archived 之后）放行永不衰减（`govern.js:26-29`）。**GAP 说 53 条**进了这个区（那是 zzerx 100 条那次 dry-run 的统计，现 102 条，只当量级看），以后加淘汰策略它们也不参与。

---

## 3. 步骤

### Step 0 · 装机冒烟（已排队，不跳）

- 路径已确认：`dsh plugin --profile desktop` **被 Electron 独占**（`managed exclusively by the Electron application`），只能 GUI 装或手动装配
- 手动装配三件套：`node_modules` 下 link → `dependencies` 登记 `link:` → `dsh.profile.bundles` 加 `dsh-memhub`
- 依赖不是问题：`@deepseek-ai/dsh-tools` 由宿主提供（同 profile 三个 `link:` 插件都没有 `node_modules`）
- **不过就卸**：卸载插件 + `node tools/toggle-model-invocation.mjs --restore`

### Step 1 · 补两个洞（✅ 2026-11-05 完成：写入通道 / scope 原语义 / 实体边落库 / 休眠语义）

- `memory_*` 等价写入面（save / search / list / update）挂到 orb
- 实体与边落 orb，**保留 `m_` 别名映射**（§2-5）
- 顺带：新 orb 要能写 `global`/`project` 原语义——**必须新增字段**（现在 `scope` 存的就是分类结果，只加校验 round-trip 还是会丢，§2-2）
- **验收**：`/memhub/api/graph` 返回的 edges 里含新 orb 的边（或直接读 orb frontmatter 有实体/边字段）；`memory_save` 写进 orb 不写 zzerx；新 orb 在星图里不成孤岛。
  ⚠️ 不能用 `memory_link action=list` 验——那是 plugin-memory 的工具、查它自己的库，迁移前后都返回同样结果，等于没验。

### Step 2 · 迁移，但带上去重报告

- `migrate-memory.mjs` dry-run 增加「疑似重复组」一节（0.82，**只报不改**）
- 修幂等判据：先按 id 查，再按路径（§2-3）
- **验收**：条数对得上、无重复 id、重复组报告落 `EVIDENCE.md`

### Step 3 · 治理管线 + janitor 三件套（✅ 2026-11-09 完成）

- **管线已建**：`src/janitor.js`（纯函数 `planJanitor` / `planDedupe` + IO 的 `runJanitor` / `createSnapshot` / `restoreSnapshot`）；宿主启动时 `runStartupJanitor` 只在**超上限**时动盘，且**只淘汰、不合并**
- 容量：`janitor.maxOrbs` 默认 **300**，只统计活跃条目（archived 不占名额）；`protected` 不参与：archived / evergreen（公共区）/ pinned / core / **working**（11-08 新增的按需层，清掉等于悄悄丢项目记忆）
- 淘汰：按 `importance × decay` 升序、同权重取最老；**只把 sidecar 标 `archived`，orb 原件不删不搬**（设计口径里的「永不 unlink」）
- 去重：bigram Jaccard ≥ 0.82 **且正文 ≥ 60 字**（短文本相似度虚高，实测「甲 body / 乙 body」能到 0.84）；保留权重高者、权重 `min(9, a + b*0.3)`、另一条归档，写 `archive.jsonl`
- 快照：动盘前拷 `orbs / recall / graph / 公共区 orbs` 到 `~/.dsh/memhub/snapshots/<时间>-<随机>`，保留 3 份；`restore` 前再快照一次（`pre-restore-*`），恢复时旧目录原地改名留档
- 冷却 / 超长 / 休眠：已在 Step 1 与 11-04~11-05 落地（`reviewCooldownMs`、`orb-store.js:98`、`isDormant`）
- CLI：`tools/janitor.mjs`（默认 dry-run；`--apply` 先快照再动盘；`--list` / `--restore latest`）
- **验收**：`govern-check` **105/105**（janitor 38 条：容量/排序/protected/capped/去重阈值/短文本/合并权重/归档/日志/dry-run/restore 往返/快照修剪 + 两轮盲审回归：连续 restore、latest、先合并后淘汰、饱和权重、默认 scope、公共区不一致）、`sandbox` 62/62（含启动自动淘汰真机路径）；真机 dry-run 140 条 / 0 溢出 / 0 重复；CLI 在临时目录跑通 apply → restore → 二次 apply（可重入）
- **盲审**：独立只读审查两轮（`REVIEW-janitor.md`），1 致命 + 9 严重 + R-1/R-3 全部修完；剩余 G 系按「文档写明」处理（CLI 不读插件配置、合并抬权重到 9 会连带改 tier、archived 只在 sidecar、淘汰只在启动时跑）
- **没做**：去重合并**没有**自动化（`--apply` 人工确认）；`memhub_janitor` 工具没加（省 schema 预算，CLI 够用）

### Step 4 · 检索升级（✅ 2026-11-10 完成）

- 复用了 `indexer.queryTokens` 的 2-gram + 别名，再补记忆域别名（接入/恢复/配置/体检/归档/注入/模型/汇报/分盘/沙箱/迁移/人格/检索…）
- 新打分（`src/search.js`，`v2`，已接进 `memhub_search`）：
  - **IDF**：`log(1 + N/(1+df))`，压掉「的/是/记忆」这类到处都有的词
  - **字段权重**：标题 3 / 摘要 2 / 正文 1（摘要以前完全没参与）
  - **整句短语加成**：整句出现在标题 +6 / 摘要 +3 / 正文 +2
  - **实体加成**（可选 `entityIndex`）：星图有实体时给关联记忆加权（真机实体图还是 0，先把接口留好）
  - `v1` 老公式保留在同一个模块里，方便对照，不删
- **验收**：`tools/search-bench.mjs` 在真机 96 条活跃记忆上跑 18 条「换个说法」查询（每条指定期望 id）：
  | 方法 | hit@1 | hit@3 | MRR |
  |---|---|---|---|
  | baseline（zzerx 整句子串） | 2/18 | 2/18 | 0.111 |
  | v1（迁移期打分） | 15/18 | 16/18 | 0.883 |
  | **v2（新）** | **16/18** | **17/18** | **0.928** |
  报告落 `data/search-bench-20261110.md`；`tests/search-check.mjs` 10/10
- **不做**：向量检索、Python sidecar（ROADMAP 原口径）

### Step 5 · 治理文档件（我顺手写，成本最低）

- 配置地图：`文件:行` + 改错后果 + 默认值（README 已有配置项，只补两列）
- 降级契约：提成 AGENTS.md 插件准入条件
- 每日报表：`self-check.json` 已在算，加个定时打印（清单里最省的一条）

---

## 4. 执行方式与边界

- **不派团队做实现**：Step 0–4 强串行；**但盲审必须派**（这轮它抓出 9 处，复审又补 4 处）
- **不动**：归档流水线、preset 人格、zzerx 原文
- **每步**：可重跑脚本 + 改动前备份 + 回滚路写清楚
- **风险**：`desktop-test` 不能当沙箱（node_modules 是 desktop 符号链接）

---

## 5. 修正记录（第一稿 → 盲审后）

| 第一稿 | 修正后 | 原因 |
|---|---|---|
| ③「已有，只差验解冻」 | **部分，语义相反 → 要新建** | memhub 冻结 = 免疫衰减；注入不过滤 frozen；无解冻 |
| ④「存储层已硬拒」 | **记忆层零校验** | `renderOrb` 无长度检查 |
| ⑤「记忆库无快照」 | **半条**（backupWithStamp 3 代） | `orb-store.js:76` |
| ⑥「memory_search 是子串」 | **memhub 根本没有 search** | 会让人误以为有个能用的检索 |
| ⑦「无」 | **部分** | README 已有配置默认值 |
| ⑩「未查」 | **已查，无拖拽** | `client.js:167` |
| ⑬「无」 | **部分，且该提前做** | 统计脚本已有 |
| 「13 条里 3 条已有/只差文案」 | **只有 1 条算已有**（⑨ 的 2D 点选） | ③④⑤ 都不是「已有」 |
| 「双作用域守住」 | **迁移后会被压扁** | `classifyOrb` global→shared |

**教训**：一份「对账」如果没被第二双眼睛回源码核过，错的正好是最关键的那几条（③ 的语义、④ 的校验、⑤ 的快照）。
