# dsh-memhub

> 建 2026-11-03 ｜ 规模 M ｜ 第 1–7 期代码完成（待盲审修改 + 安装验收）

## 目标（九期）

| 期 | 模块 | 一句话 |
|---|---|---|
| 1 | 技能 | 42 个技能描述（676 字符 ≈439 tokens）不常驻，`skill_search` → `skill_load` 三级披露 |
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

- [x] 技能自测 `node tests/check.mjs` **31/31**（hermetic fixture）
- [x] 记忆自测 `node tests/recall-check.mjs` **17/17**
- [x] 治理/教训/自我/情感/人格/星图自测 `node tests/govern-check.mjs` **59/59**
- [x] 沙箱运行验证 `node tests/sandbox.mjs` **36/36**（18 工具 / 5 处动态注入 901–905 / 读写 owner 门 / 工具 schema 2321 字符）
- [ ] 盲审 REVIEW.md 问题修完（进行中）
- [ ] 装到桌面客户端后每轮注入 ≤180 tokens（待安装验收）

## 怎么跑

```bash
node tests/check.mjs        # 技能
node tests/recall-check.mjs # 记忆
node tests/govern-check.mjs # 治理/教训/自我/情感/星图
node tests/sandbox.mjs      # 沙箱运行验证（mock 运行时，不安装）
node tools/index.mjs        # 技能索引 + 预算
node tools/recall-index.mjs # 记忆 sidecar + 预算
```

## 安装（待命）

- `plugin_manager` `install_bundle`，target 为本目录；Host 半侧生效需重启 DSH。
- **桌面客户端当前未装**（避免沙箱误伤：`desktop-test` 的 node_modules 是 desktop 的符号链接，不能当隔离沙箱用）。

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
```

## 模块

| 文件 | 职责 |
|---|---|
| `src/const.js` | 常量：vault / 数据目录 / 一行提示 / 工具名 |
| `src/indexer.js` | 技能扫描、frontmatter、中文 2-gram + 别名检索、索引/预算 |
| `src/recall-store.js` | 读 zzerx 记忆 + sidecar 分级 + 原文回读 |
| `src/recall-scheduler.js` | 记忆注入预算调度（纯函数，硬截断） |
| `src/govern.js` | 双通道衰减/冻结/归档/恢复 + 召回计数 |
| `src/lessons.js` | 教训存储、匹配、复发、退休/升格提案 |
| `src/promote.js` | 记忆→技能草案、技能台账、改版提案 |
| `src/selfnote.js` | 自我叙述库（上限/归档）+ 岛屿派生 |
| `src/affect.js` | 情感状态、规则层更新、混合、注入块、pin |
| `src/graph.js` | 星图节点/边 + auto 边过滤 |
| `src/tooling.js` | 工具层共享件（输出信封 / owner 门） |
| `src/tools-skill.js` / `tools-recall.js` / `tools-learn.js` | 16 个工具定义 |
| `src/host.js` | 组装器：配置 → 缓存 → 注册模块 → 4 处注入 → 面板 API → 自检 |
| `lib/client.js` | 设置页面板（技能/星图/情感/自我） |

## 工具面（18）

- 技能：`skill_search` `skill_load` `skill_list` `skill_register`
- 记忆：`memhub_open` `memhub_raw` `memhub_budget` `memhub_archive`
- 学习/自我/情感：`lesson_save` `lesson_match` `lesson_graduate` `promote_to_skill` `skill_outcome` `self_note_write` `self_view` `affect_state` `affect_pin` `affect_event`

## 注入预算

| 注入 | 上限 | 位置 |
|---|---|---|
| 技能提示 | 48 字符（≈30 tokens） | section order 90000（最底部） |
| 记忆块 | 280 字符（≈180 tokens） | context order 901 |
| 情感块 | 92 字符（≈60 tokens） | context order 902 |
| 自我摘要 | 60 字符（≈40 tokens） | context order 903 |
| 18 个工具 schema | 2321 字符（≈1509 tokens） | 工具注册（mock 实测；目标 ≤2400） |
| **合计（提示注入）** | **≈480 字符 ≈310 tokens** | 硬顶 400 内（动态 content 不破坏前缀缓存） |

## 现状

- 九期代码完成；盲审 4 条严重问题已修；四套测试 31/17/59/36 全过；迁移脚本 dry-run 通过（zzerx 100 条：shared 53 / self 28 / project 19）。
- 技能开关已恢复原状（41 个可见）；等插件完整上线再统一加。
- desktop 客户端未装（且沙箱误伤已修复：`desktop-test` 符号链接共享 desktop 的 node_modules）。
