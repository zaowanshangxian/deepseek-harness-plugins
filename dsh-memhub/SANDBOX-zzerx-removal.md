# SANDBOX · 卸掉 zzerx 之后 dsh-memhub 还能不能独立跑

> 2026-11-11 · 验证手 sandbox-zzerx · 沙箱 `L:\DSH\DeepSeek\tmp\sandbox-zzerx-20261111-145132`
> 生产 profile / 生产数据**一行没改**（只读复制）。改动只在 `projects/dsh-memhub` 内。

## 0. 结论（先看这三行）

1. **删包后能跑**：`recall.source: memhub` 时，zzerx 目录整个消失，`host.js` 照常 apply、22 个工具全注册、5 处注入全在、`/api/graph` 不 500。实测记忆 **144 条 → 144 条**、注入块 **246 → 246 字符**、`memoryErrors` **0**。
2. **但有两个前提**：① 星图（82 实体 / 2013 边）**只存在 zzerx 库里**，卸载前必须跑一次迁移，否则星图静默变空；② 配置里 `recall.source` 必须显式或按新默认（已改成 `memhub`）。
3. **修了 4 处「安静地坏」**：默认源回落 zzerx、源读不出来只有数字没有日志、星图旧库消失无声、原文回读把「目录没了」说成「可能已被裁剪」。都是静默降级，不是崩溃——所以以前的验证很难发现。

## 1. 沙箱怎么复现（可复制粘贴）

```bash
# ① 建沙箱 + 只读复制两份数据（zzerx 旧库 / memhub 自有库），再把公共区 orb 也复制一份
TS=$(date +%Y%m%d-%H%M%S); SB="L:/DSH/DeepSeek/tmp/sandbox-zzerx-$TS"
mkdir -p "$SB/storages"
cp -r ~/.dsh/storages/memory "$SB/storages/memory"     # zzerx：102 记忆 / 82 实体 / 2013 边 / 29 原文
cp -r ~/.dsh/memhub          "$SB/memhub"              # sidecar 144 个 + orbs 89
cp -r /l/DSH/shared/memhub   "$SB/shared"              # 公共区 orbs 55 + lessons

# ② 用 DSH_HOME 隔离（src/const.js:9 支持），确认读的是沙箱而不是生产
DSH_HOME="$SB" node -e "import('L:/DSH/DeepSeek/projects/dsh-memhub/src/const.js').then(m=>console.log(m.DATA_ROOT))"

# ③ 演练「物理卸载」= 把目录改名（等价于插件卸掉后数据目录被删）
mv "$SB/storages/memory" "$SB/storages/memory__UNINSTALLED"

# ④ 四组对照 + 工具/星图/原文（脚本见第 1.1 节）
DSH_HOME="$SB" node "$SB/probe.mjs"
```

### 1.1 用到的两个脚本（都在沙箱里，没进仓库）

| 脚本 | 干什么 |
|---|---|
| `$SB/probe.mjs` | 四组对照：A `source=memhub`+旧库在 / B 同配置+旧库消失 / C `source=zzerx`+旧库消失 / D 不写 `recall.source`（走默认）+旧库消失。每组都跑真实 `host.js apply()`（mock ctx + 真 loader），收集 self-check、注入块、4 个记忆工具、`/api/graph`、logger warn |
| `$SB/check-graph-raw.mjs` | 星图迁移后是否还能画 82/2013；`m_<id>` 前缀能不能对上旧库 `raw_documents` |

跑真宿主不可用（没有 GUI/Electron），所有"加载"都是 `node` + `tests/loader.mjs`（把 `@deepseek-ai/dsh-tools` 重定向到 mock）——见第 6 节「没验证到的」。

## 2. 验证结果表

前置：生产 `profiles/desktop/cordis.patch.yml:561` 是 `source: memhub`，`:143-146` 是 `- id: zzerx-memory / disabled: true`（11-05 软停用）。所以下面的 A/B/D 组就是生产现状。

| # | 验的是什么 | 结果 | 证据（命令 → 关键输出） |
|---|---|---|---|
| 1 | 真数据副本能起 host（`source=memhub`） | **PASS** | `probe.mjs` A：`{"source":"memhub","memories":144,"errors":0,"byTier":{"event":19,"mid":29,"long":56,"working":40}}`；22 工具 / 5 注入 |
| 2 | 旧库目录消失后仍能起、条数不变 | **PASS** | B：`memories 144`、`errors 0`、注入块 `246` 字符（与 A 完全一致） |
| 3 | `memhub_search` 中文 2-gram 命中迁移条目 | **PASS** | `memhub_search("QQ 机器人")` → `m_d6357e52…`（云端 QQ 机器人）/ `m_e080f8f3…`（QQ 机器人路由本地模型）/ `m_2fdc2939…`（汇报通道：QQ 官方机器人） |
| 4 | `memhub_open` / `memhub_budget` 正常 | **PASS** | `memhub_budget` → `预算：227/280 字符 ≈ 148 tokens`；`memhub_open(m_15912472…)` → `# QQ 个人号接入：WSL2 + Docker NapCat` |
| 5 | 注入预算仍 ≤ 800 tokens/轮（只算记忆块） | **PASS** | 227/280 字符 ≈ **148 tokens**（记忆块）；技能提示 48 字符 ≈ 30 tokens（常量自述）；情感/自我/人格/索引四块未单列，见第 6 节 |
| 6 | `/api/graph` 在旧库消失时不崩 | **PASS** | `{"status":200,...}`；迁移前 `entities:0`，迁移后 `entities:82, edgesRaw:2013, edgesRendered:307` |
| 7 | **星图迁移**：`migrate-memory --apply` 一起搬实体/边 | **PASS** | `星图：entities 82 / edges 2013 → 复制 2095，跳过 0`；`find memhub/graph -name '*.json' \| wc -l` = **2095** |
| 8 | 迁移幂等（记忆 + 星图） | **PASS** | 二次 `--apply`：`复制 0，跳过 2095`；`zzerx：total 102 / migrated 0 / skipped 102 / errors 0` |
| 9 | 迁移后卸载 = 与迁移前完全等价 | **PASS** | B(迁移后)：`memories 144 / 246 字符 / entities 82 / edges 2013`，与 A 逐项相同，且**没有 warn**（本地已有图就不吵） |
| 10 | 默认配置（不写 `recall.source`）不再落到 zzerx | **PASS** | D：`{"source":"memhub","memories":144}`（**改之前** D 是 `{"source":"zzerx","memories":0}`，注入块 31 字符，日志 0 条 warn） |
| 11 | 显式回滚 `source=zzerx` 而旧库不在 → 必须出声 | **PASS** | C：`memories 0` + `warn [memhub] 记忆源「zzerx」读取有 1 个错误，注入会变少：记忆库不可读：Error: ENOENT…scandir` |
| 12 | 原文回读：`m_` 前缀 id 能命中旧库裸 id | **PASS** | `check-graph-raw.mjs` → `PASS 4e43c360-… → # 原文（9eafd3dc-….json）`；旧判定 `recordIds.includes("m_<id>")` 对真机仅有的 2 条原文 = `[false,false]`，新逻辑 = `[true,true]` |
| 13 | 原文回读：旧库目录不在 → 说清原因 | **PASS** | `memhub_raw` → `原文回读不可用：旧库 raw_documents 目录不存在（…）。zzerx 卸掉后 L0 原文不再可读。`（改之前是「可能已被裁剪」） |
| 14 | `tools/migrate-memory.mjs` 在无旧库时给可读原因 | **PASS** | exit **1** + `没有可迁移的 zzerx 记忆：目录不存在（…），zzerx 卸掉后不用再迁` |
| 15 | `tools/recall-index.mjs` 不拿空源覆盖 sidecar 索引 | **PASS** | 改之前：`recall-index.jsonl` 被写成 **1 字节**；改之后：exit 1 + `源不可读，未改写 sidecar`，哨兵内容保留（`tests/zzerx-removal.mjs` 里断言） |
| 16 | `tools/health-report.mjs` 无旧库时 | **PASS** | exit **0**、`记忆总数 144`、`实体图 82 实体 / 2013 边`、无「严重」 |
| 17 | `tools/janitor.mjs` 无旧库时 | **PASS** | exit 0：`orb 总数 144 ｜ 活跃 98 ｜ 上限 300 ｜ 可淘汰 29` |
| 18 | 测试套件在「旧库已卸」下还能跑 | **PASS** | `MEMHUB_ZZERX_ROOT=<不存在的路径> node tests/sandbox.mjs` → **65/65**（改到一半时实测 64/65：`promote_to_skill` FAIL，根因是该测试把 `{sourceRoot}` 当成「用 zzerx 源」，默认源一改就读到空 orb） |
| 19 | 全套测试 | **PASS** | check 40/40、recall 30/30、govern 107/107、sandbox 65/65、health 24/24、search 10/10、**新增 zzerx-removal 24/24** |
| 20 | 生产没被碰 | **PASS** | `stat ~/.dsh/memhub/self-check.json` → `2026-11-11 14:44:23`（开工前）；`profiles/desktop` 只 `grep` 过 |

### 反向对照（证明修复点确实是真问题）

| 对照 | 旧行为（改之前实测） | 新行为（改之后实测） |
|---|---|---|
| `source` 默认值 | 不写配置 → `zzerx` → **0 条记忆 / 注入 31 字符 / 无 warn** | 不写配置 → `memhub` → **144 条 / 246 字符 / 无 warn** |
| 显式 `zzerx` + 旧库没了 | 0 条 + **日志里 0 条 warn**（只有 `self-check.memoryErrors=1`） | 0 条 + **1 条 warn**（点出源名 + ENOENT 原文） |
| 星图 | 不迁移直接卸 → `entities 82 → 0`、`edges 2013 → 0`、`/api/graph` 仍 200、**无任何提示** | 不迁移会 warn；迁移后 `82/2013` 原样还在 |
| `memhub_raw` | 旧库在也读不到（`m_` 前缀对不上裸 id），且文案甩锅「可能已被裁剪」 | 旧库在能读；旧库不在就明说目录不存在 |
| `recall-index` | 空源跑一次 → 索引文件被覆盖成 1 字节 | exit 1，文件不动 |

**注意（诚实）**：`source=zzerx` + 旧库不在，现在仍然是「0 条」——修复不是让它能读到，而是让它**不再安静**。这是刻意选择：显式写 `zzerx` 是回滚动作，此时应该显眼地失败，而不是偷偷换成别的源。

## 3. 问题清单

严重度：**严重** = 会丢数据或静默失效；**中** = 行为误导、需人工排障；**低** = 文案/一致性。

| # | 严重度 | 位置 | 现象 | 处理 |
|---|---|---|---|---|
| P1 | **严重** | `src/host.js:59`（旧） | 默认 `recall.source = 'zzerx'`。zzerx 卸掉后，任何「配置漏写 / 键名写错 / 新 profile」都会读到空库：记忆 144→0、注入块 246→31 字符（只剩标题行），**日志一句话都没有**。`CONFIG-MAP.md:17` 本来就写了这个坑 | **已修**：默认改 `memhub`，`'zzerx'` 变成显式回滚开关 |
| P2 | **严重** | `src/host.js` `runSelfCheck`（旧：只写数字） | 源读不出来只体现在 `self-check.json` 的 `memoryErrors`，宿主日志无声——「记忆全没了」在日志里查不到 | **已修**：`data.errors.length>0` → `logger.warn`，带源名 + 首条错误原文 |
| P3 | **严重（数据）** | `src/host.js:314-315`（旧）+ `src/graph.js:9-11` | `loadEntities/loadEdges` 默认吃 `zzerxRoot()`，而**实体/边从来没有迁移路径**（`migrate-memory` 只搬记忆）。卸载后 82 实体 / 2013 边静默消失，`/api/graph` 照样 200 | **已修**：① 显式传 `zzerxRoot()`，本地也没图时 warn 一次；② `tools/migrate-memory.mjs` 增 `migrateGraph()`，`--apply` 一起搬（按文件名幂等，不覆盖本地同名）；③ RUNBOOK 增「1.5 卸载前必须迁移星图」 |
| P4 | **中** | `src/recall-store.js:244`（旧 `findRawText`）、`src/tools-recall.js:72` | ① 迁移后 orb id 是 `m_<zzerx id>`，`raw_documents` 记的是裸 id → 旧 `includes` 精确比较**一条都命中不了**（用旧判定跑真机 2 条原文：`[false,false]`）；② 旧库目录不在时返回 `null`，工具文案说「只留最近一批，可能已被裁剪」——把「库没了」说成「被裁剪」 | **已修**：`wanted` 集合同时试带/不带 `m_` 前缀；目录不在返回 `{missingRoot,dir}`，工具明说「旧库 raw_documents 目录不存在」 |
| P5 | **中** | `tools/recall-index.mjs:17-19`（旧） | 源不可读时照样 `writeSidecars`，把 `recall-index.jsonl` 覆盖成 1 字节（sidecar 单文件还在，索引空） | **已修**：`entries===0 && errors>0` → 直接 exit 1，不落盘 |
| P6 | **低** | `tools/migrate-memory.mjs:28`（旧） | 「没有可迁移的 zzerx 记忆」不区分「库是空的」和「目录不存在（已卸载）」 | **已修**：分别给出原因 |
| P7 | **低** | `tests/sandbox.mjs:19,60,169`（旧） | 测试直接吃生产 zzerx 路径，且把 `{sourceRoot}` 当成「用 zzerx 源」——默认源改成 memhub 后会读到 orb（空），`promote_to_skill` 挂 | **已修**：加 `MEMHUB_ZZERX_ROOT` 覆盖 + `HAS_ZZERX` 分支（有旧库显式 `source:'zzerx'`；没有则 `source:'memhub'` 并用自写 orb 当晋升素材） |
| P8 | **中（仓库外，未改）** | `L:\DSH\work\Companion-AI-Memory-Context\scripts\memory_audit.py:30` | 夜跑任务 `DSH-MemoryAudit`（23:10）`MEM = ~/.dsh/storages/memory`。卸载后 `Path.glob` 对不存在的目录返回空 → **静默量一个空库**，报表失真但不报错 | 建议：把夜跑换成 `node tools/health-report.mjs --write --dupes`（memhub 自带、只在无旧库场景下更准）。**不在我的改动范围，未改** |
| P9 | **中（未验证，风险）** | `profiles/desktop/cordis.patch.yml:143-146` | patch 里还留着 `- id: zzerx-memory / disabled: true`。插件被卸掉后这个 override 是否会让宿主报「未知插件 id」，**我没法在无 GUI 环境验证** | 建议卸载后重启第一件事就是搜日志里的 `zzerx-memory`；有报错就删掉这 4 行（RUNBOOK 已提，但没写「未知 id」这一条） |
| P10 | 低 | `src/host.js:118`（现状） | `source=memhub` 的缓存签名只看 `DATA_ROOT/orbs` 的 mtime，公共区 orbs 变了不失效（要重启） | 记录不改（与 zzerx 无关，改它得动缓存策略） |

## 4. 改了什么（全部在 `projects/dsh-memhub` 内）

| 文件 | 改动 | 行数 |
|---|---|---|
| `src/host.js` | ① 默认源 `memhub`，`'zzerx'` 仅显式回滚；② 源读不出来 → `logger.warn`；③ `/api/graph` 显式传旧库根 + 「本地也没图」时 warn 一次 | ~30 行（含注释） |
| `src/recall-store.js` | `rawDocumentsDir()` 抽出；`findRawText` 支持 `m_` 前缀 + 返回 `{missingRoot}` | ~20 行 |
| `src/tools-recall.js` | `memhub_raw` 区分「旧库目录不在」与「这条没原文」 | 4 行 |
| `tools/migrate-memory.mjs` | `migrateGraph()`：`--apply` 把 entities/edges 搬进 `~/.dsh/memhub/graph`（幂等、不覆盖）；空库原因分两类 | ~35 行 |
| `tools/recall-index.mjs` | 源不可读不落盘 | 6 行 |
| `tests/zzerx-removal.mjs` | **新增** 24 条断言：默认源、warn、星图迁移幂等、原文前缀、CLI 退出码、索引不被覆盖 | 新文件 |
| `tests/sandbox.mjs` | `MEMHUB_ZZERX_ROOT` 覆盖 + 有/无旧库两个分支 | ~10 行 |
| `tests/recall-check.mjs` | 原文断言接受 `missingRoot` | 2 行 |
| `CONFIG-MAP.md` / `CHANGELOG.md` / `RUNBOOK-2026-11-12-卸zzerx.md` | 同步事实（默认源、星图迁移步骤、卸完该看到什么） | 文档 |

没碰：`package.json`（所以 `npm test` 里没有新测试，单独跑 `node tests/zzerx-removal.mjs`）、任何 profile、生产 `~/.dsh/memhub`、生产 `~/.dsh/storages/memory`。

## 5. 一条命令验完

```bash
cd L:/DSH/DeepSeek/projects/dsh-memhub
for t in check recall-check govern-check sandbox health-check search-check zzerx-removal; do node tests/$t.mjs | tail -1; done
# 期望：40/40 30/30 107/107 65/65 24/24 10/10 24/24
MEMHUB_ZZERX_ROOT="L:/nonexistent/storages/memory" node tests/sandbox.mjs | tail -1   # 期望 65/65
```

## 6. 没验证到的（明确写出来）

1. **真实宿主加载**：没有 GUI/Electron，全部用 `node` + `tests/loader.mjs`（`@deepseek-ai/dsh-tools` → mock）。真实工具注册校验、`ctx.inject` 时序、插件卸载流程、设置页渲染**都没跑过**。
2. **`dsh plugin uninstall` 的真实行为**：包删除后 `node_modules` 残留、`bundle` 列表、`cordis.patch.yml` 里 `- id: zzerx-memory`（P9）会不会报「未知插件 id」——只读了 patch，没卸过包。
3. **`memory_*` 工具消失后的模型行为**：memhub 当年把工具前缀改成 `skill_*` 是为了避开 zzerx 的 `memory_*` 互斥锁；锁没了以后是否会触发重复注册、模型会不会改叫 `memhub_*`，需要真实会话才能看。
4. **夜跑 `memory_audit.py`**（P8）：只读代码判断（`Path.glob` 对缺失目录返回空），**没实跑**——它要读会话日志，且不在我的改动范围。
5. **整轮注入 tokens**：只量了记忆块（148 tokens）与工具 schema（3553 字符 ≈ 2309 tokens，属既有基线）；技能提示/情感/自我/人格/索引五块加起来的真实每轮成本没端到端测，「≤800 tokens/轮」这条只对记忆块成立。
6. **前端面板**：`lib/client.js` 在 `/api/graph` 从 82 实体变空时的渲染、报错提示，没在浏览器里看过。
7. **反向对照不是 git revert**：仓库还没有 commit，旧行为证据来自改动**之前**跑的同一套探针（输出已贴在第 2 节），不是新旧两棵代码树并行跑。
8. **`snapshot`/`janitor --apply` 在迁移后的图上**：只跑了 dry-run，没在真数据副本上执行归档/去重（会动 orb 文件，超出"最小修复"的范围）。

## 7. 给 Lead 的下一步

卸载前在真机跑一次 `node tools/migrate-memory.mjs --apply`（已在副本验过：82 实体 + 2013 边 = 2095 个文件、二次幂等），然后按 `RUNBOOK-2026-11-12-卸zzerx.md` 执行；卸完第一件事是搜日志里的 `zzerx-memory`（P9）并把夜跑 `DSH-MemoryAudit` 换成 `node tools/health-report.mjs --write --dupes`（P8）。
