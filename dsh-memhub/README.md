# dsh-memhub

> 建 2026-11-03 ｜ 规模 M ｜ 第 1–7 期代码完成（待盲审修改 + 安装验收）

## 目标（九期）

| 期 | 模块 | 一句话 |
|---|---|---|
| 1 | 技能 | 主库 42 个 + 隔离游戏库 77 个（`L:\DSH\DeepSeek\skills-game`），描述不常驻，`skill_search` → `skill_load` 三级披露 |
| 2 | 记忆 | 只读 zzerx 库 + sidecar 分级，每轮注入 ≤280 字符；`memhub_open` 打开全文、`memhub_raw` 回读原文 |
| 3 | 治理 + 教训 | 双通道衰减/归档/恢复；教训触发式匹配；记忆→技能草案、`skill_outcome` 台账、改版提案 |
| 4 | 自我叙述 | 它自己写叙述（≤320 字/段、活跃 ≤8 段、旧段归档可回读）+ 岛屿派生视图 |
| 5 | 情感 | 参数化状态（mood/强度/亲近/软硬/表情密度）+ basis 依据 + 边界；无依据回落 neutral |
| 6 | 面板 | 设置页一节：技能启停、台账、教训、自我、情感 |
| 7 | 星图 | 派生视图：记忆按 tier 分环、实体居中，默认过滤 82% 的 auto related 边；可点选节点改 tier / 删除（归档）/ 恢复 |
| 8 | 人格 | 现有人格参数化 baseline；演化步长 ≤0.02；情感偏置 24h 衰减到零（**不改 baseline**） |
| 9 | 自研存储 + 迁移 | orb 存储（公共区 / 项目 / 自我分类）；zzerx 100 条 + fish 可一键迁移（幂等） |

## 非目标

- 不搬技能文件、不改 SKILL.md 正文（只加/去 frontmatter 一行开关）
- 不搬记忆数据、不改 zzerx 一行（扩展字段只写 `~/.dsh/memhub/`）
- 不替换 DSH 原生 `skill` 与 zzerx 的 `memory_*` 工具（增强层 + 兜底）
- 不做自动学习：晋升/改版全部生成草案，人工确认

## 验收标准

- [x] 技能自测 `node tests/check.mjs` **40/40**（hermetic fixture，含多库合并/重名/折叠描述/主库优先）
- [x] 记忆自测 `node tests/recall-check.mjs` **27/27**
- [x] 治理/教训/自我/情感/人格/星图 + janitor 自测 `node tests/govern-check.mjs` **105/105**
- [x] 体检模块自测 `node tests/health-check.mjs` **22/22**
- [x] 检索模块自测 `node tests/search-check.mjs` **10/10**（v2 真机对比见 `data/search-bench-20261110.md`）
- [x] 沙箱运行验证 `node tests/sandbox.mjs` **65/65**（22 工具 / 5 处动态注入 901–905 / 读写 owner 门 / 双源检索 / 实体边落库 / 独立星图页 / 日记 / janitor 启动自动淘汰 / 工具 schema 3352 字符）
- [ ] 盲审 REVIEW.md 问题修完（进行中）
- [ ] 装到桌面客户端后每轮注入 ≤180 tokens（待安装验收）

## 怎么跑

```bash
npm test                    # 五套全跑
node tests/check.mjs        # 技能
node tests/recall-check.mjs # 记忆
node tests/govern-check.mjs # 治理/教训/自我/情感/星图
node tests/sandbox.mjs      # 沙箱运行验证（mock 运行时，不安装）
node tests/health-check.mjs # 体检纯函数
node tests/search-check.mjs # 检索（别名/IDF/字段权重）
node tools/search-bench.mjs # 检索命中率对比（真机数据）
node tools/index.mjs        # 技能索引 + 预算
node tools/recall-index.mjs # 记忆 sidecar + 预算
```

## 安装（已装进 desktop）

- 走 GUI 插件管理器（`dsh plugin --profile desktop` 被 Electron 独占拒绝，`bin.js:36` 硬编码）
- **必做：补宿主依赖 junction**。`@deepseek-ai/dsh-tools` 只随 `@deepseek-ai/dsh` 装在嵌套 `node_modules`，npm 公开版仅 `0.0.1-rc.1`：
  `node_modules/@deepseek-ai/dsh-tools` → 宿主实包。缺这一步 import 会报 `ERR_MODULE_NOT_FOUND` 并被**静默跳过**（`self-check.json` 不生成）
- 装完重启客户端；`~/.dsh/memhub/self-check.json` 出现即加载成功

## 配置（`cordis.patch.yml` 里 `id: memhub`）

```yaml
- id: memhub
  config:
    vault: "~/.dsh/skills"            # 技能库
    indexMode: tool                   # tool（一行提示）| inline
    allowRegister: true
    ownerOnly: false                  # true 时打开全文/原文要 ownerSessions 命中
    ownerSessions: []
    recall:
      enabled: true
      sourceRoot: "~/.dsh/storages/memory"
      budgetChars: 280                # ≈180 tokens
    learn: { enabled: true }
    self: { enabled: true }
    affect: { enabled: true }
    panel: { enabled: true }
    persona: { enabled: true }        # 人格参数注入 + 演化/偏置
    sharedRoot: "L:\DSH\shared\memhub"   # 教训 + 公共区工程记忆
    extraVaults:                        # 额外技能库（隔离、按需检索、不写回主库）
      - path: "L:\DSH\DeepSeek\skills-game"
        label: game
    janitor:                          # 治理（ROADMAP Step 3）
      enabled: true
      autoEvict: true                 # 启动时超容量就淘汰（只归档，可 restore）
      maxOrbs: 300                    # 算活跃条目；protected 不参与淘汰但占名额（真机 112/140 是 protected）
      dedupeThreshold: 0.82           # 合并只走 CLI --apply，不自动
      snapshotKeep: 3
```

## 模块

| 文件 | 职责 |
|---|---|
| `src/const.js` | 常量：vault / 数据目录 / 一行提示 / 工具名 |
| `src/indexer.js` | 技能扫描（多库合并）、frontmatter、中文 2-gram + 别名检索、索引/预算 |
| `src/recall-store.js` | 读 zzerx 记忆 + sidecar 分级 + 原文回读 |
| `src/recall-scheduler.js` | 记忆注入预算调度（纯函数，硬截断） |
| `src/govern.js` | 双通道衰减/冻结/归档/恢复 + 召回计数 |
| `src/lessons.js` | 教训存储、匹配、复发、退休/升格提案 |
| `src/promote.js` | 记忆→技能草案、技能台账、改版提案 |
| `src/selfnote.js` | 自我叙述库（上限/归档）+ 岛屿派生 |
| `src/affect.js` | 情感状态、事件存档、**mood 从记忆派生**（`deriveMood`）、pinned 一行注入 |
| `src/safety.js` | 情绪安全阀：水槽（加水/漏水/分级）+ 自伤独立 crisis + 不回显原文 |
| `src/graph.js` | 星图节点/边 + auto 边过滤 |
| `src/tooling.js` | 工具层共享件（输出信封 / owner 门） |
| `src/tools-skill.js` / `tools-recall.js` / `tools-learn.js` | 23 个工具定义 |
| `src/host.js` | 组装器：配置 → 缓存 → 注册模块 → 4 处注入 → 面板 API → 自检 |
| `lib/client.js` | 设置页面板（技能/星图/情感/自我） |
| `lib/graph-page.js` | 独立全屏星图页（`GET /memhub/graph`，零依赖自包含 HTML） |
| `CONFIG-MAP.md` | 配置地图：16 项的「文件:行 / 默认值 / 改错后果」 |
| `DEGRADE.md` | 降级契约：装插件前必须能回答的四行（待进 AGENTS.md） |
| `src/diary.js` | 日记存储（按天分页、多人共用、带署名） |
| `src/janitor.js` | 治理管线：容量上限/淘汰/去重合并/维护前快照 + restore（archived 只写 sidecar，orb 永不删） |
| `src/health.js` | 体检纯函数：库存/分层/注入成本/治理余量/问题分级 |
| `src/search.js` | 记忆检索：2-gram + 记忆域别名 + IDF + 字段权重 + 短语/实体加成（保留 v1 对照） |
| `tools/archive-to-memory.mjs` | 归档 → 记忆桥（`.dsh/archive/logs` → orb，幂等） |
| `tools/janitor.mjs` | 治理 CLI：dry-run / `--apply` / `--list` / `--restore` |
| `tools/health-report.mjs` | 体检 CLI：只读量 memhub 自己的产物（替代对旧库失明的 `memory_audit.py`） |
| `tools/search-bench.mjs` | 检索命中率对比：baseline / v1 / v2 三档，输出 Markdown |

## 星图页（独立页面）

浏览器打开 `http://127.0.0.1:<DSH web 端口>/memhub/graph`（端口随重启变，见运行时 GUI URL）。

- **按需渲染**：打开页面才 `fetch('/memhub/api/graph')` 拉一次；不轮询、不 SSE、不常驻，关掉就停
- 想更新点「刷新」，不自动拉
- 布局：实体中心环，core / long / event 按 tier 分三层；点节点看详情

## 工具面（23）

- 技能：`skill_search` `skill_load` `skill_list` `skill_register`
- 记忆：`memhub_open` `memhub_raw` `memhub_budget` `memhub_archive` `memhub_save` `memhub_search` `memhub_graph`
- 日记：`memhub_diary`（按天分页，共用一本，落 `L:\DSH\shared\memhub\diary`）
- 学习/自我/情感：`lesson_save` `lesson_match` `lesson_graduate` `promote_to_skill` `skill_outcome` `self_note_write` `self_view` `affect_state` `affect_pin` `affect_event`
- 安全阀：`safety_check`（不回显原文；非 owner 只判断不落盘）

## 情绪与域（2026-11-11）

**工程记忆是客观事实，不标情绪**；生活、聊天、以后的 QQ 个人号才带情绪色。

| 项 | 规则 |
|---|---|
| `domain` | `projectPath` 命中 `DSH\work` 或 `scope=project` → `work`；其余 → `life` |
| 写入判色 | `domain=work` 时跳过「关键词」和「mood 兜底」，只认调用方**显式**给的情绪 |
| `deriveMood` | 只统计 `life` 且**有 emotion 标签**的未归档球，权重 `importance × 0.5^(h/72)`，`basis` 是真 orb id |
| 注入 | 派生 mood 不单独开块（规格 L466），并进「## 性格参数」当一行参数；只有 `pinned` 单独一行 |
| 工程会话 | 不注入「## 自我」；回收生活侧 token |
| 覆盖写 | 只动程序拥有的字段，自定义键原样保留；不重置 `createdAt` |

## 注入预算

| 注入 | 上限 | 位置 |
|---|---|---|
| 技能提示 | 48 字符（≈30 tokens） | section order 90000（最底部） |
| 记忆块 | 280 字符（≈180 tokens） | context order 901 |
| 情感 | 0 字符（派生 mood 并进性格参数；只有 pinned 一行 ≤40） | context order 902 |
| 自我摘要 | 60 字符（≈40 tokens，**工程会话不注入**） | context order 903 |
| 性格参数 | 120 字符（≈80 tokens，含 mood 一行） | context order 904 |
| 安全阀 | 0 字符（水位 <25 时不出现，否则一行 ≤60） | context order 906 |
| 23 个工具 schema | 3862 字符（≈2510 tokens） | 工具注册（目标 ≤3900） |

## 现状

- 九期代码 + 五级分层（含 working）+ ROADMAP Step 1–4 完成；九套测试 **40/30/108/66/24/10/68/90/24** 全过
- **已装进 desktop 并真机加载成功**：self-check 42 技能 / 144 条记忆；技能零预注入生效；面板 API `/memhub/api/state` 200
- 迁移已执行（139 条，后接归档回填到 144）；zzerx 已于 2026-11-11 卸载（星图 2095 文件已迁）
- 技能开关已恢复原状（42 个可见）；沙箱误伤已修复（`desktop-test` 符号链接共享 desktop 的 node_modules）
