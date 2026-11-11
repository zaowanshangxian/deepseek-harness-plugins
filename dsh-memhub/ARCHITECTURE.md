# dsh-memhub · 架构与链路（第 1–9 期）

> 一个 npm 包，三个板块（技能 / 记忆 / 情感）+ 四个支撑（治理 / 教训 / 自我 / 星图）。
> 原则：**真源在外部（SKILL.md、zzerx 库），memhub 只写派生与扩展；晋升/改版全部人确认。**

## 1. 思维导图

```
dsh-memhub（一个包）
│
├─ ① 技能（第1期）
│  ├─ 资产：~/.dsh/skills/*/SKILL.md ×42（原地，唯一真源）
│  ├─ 检索：skill_search → 候选卡 ≤3（名字/触发/分组/成本）→ skill_load 全文
│  ├─ 注入：一行提示 48 字符（section order 90000，系统提示最底部）
│  └─ 治理：启停（改 frontmatter + 时间戳备份；原子写；热加载）
│
├─ ② 记忆（第2期）
│  ├─ 源：zzerx 库（只读；memories 98 条）
│  ├─ sidecar：~/.dsh/memhub/recall/<id>.json（tier/decay/recall/status）
│  ├─ 调度：280 字符硬预算（核心/长期 > 最近 3 条 > 项目命中，超了按行截断）
│  ├─ 打开：memhub_open（全文）/ memhub_raw（L0 原文）/ memhub_budget（可解释）
│  └─ 治理：双通道冻结 / 归档 / 恢复（第3期）
│
├─ ③ 情感（第5期）
│  ├─ 状态：~/.dsh/memhub/affect/state.json（mood/强度/亲近/软硬/表情密度）
│  ├─ 更新：规则层（praise/correction/task/chat）→ 衰减→同情绪取大→换情绪保留 35%
│  └─ 注入：92 字符参数块（context order 902）；无依据/低强度 → 不注入
│
├─ ④ 自我（第4期）
│  ├─ 叙述：~/.dsh/memhub/self/notes/（≤320 字/段，活跃 ≤8 段，第 9 段归档可回读）
│  └─ 岛屿：从 core/高重要度记忆按 kind 派生（可重算，不落盘）
│
├─ ⑤ 学习（第3期）
│  ├─ 教训：lessons.jsonl（trigger 必须「当 X 时」；动手前 match ≤3 条）
│  └─ 晋升：记忆 ≥3 条 → 技能草案；skill_outcome 台账 → 失败率高 → 改版提案
│
├─ ⑥ 面板（第6期）
│  ├─ 设置页一节：技能启停 / 星图 / 情感 / 自我
│  └─ Host API：/memhub/api/state · /graph · /skill/toggle
│
└─ ⑦ 星图（第7期）
   └─ 派生视图：记忆按 tier 分环 + 实体居中；默认过滤 82% 的 auto related 边
```

## 2. 链路

### 2.1 启动链路

```
DSH 挂载 bundle → cordis.patch.yml（insert id: memhub）
  → apply(ctx, config)
    → normalizeConfig（vault / recall / owner / learn / self / affect / panel）
    → 建缓存：技能索引（vault mtime）、记忆（zzerx 目录 mtime）
    → registerSkillTools / registerRecallTools / registerLearnTools（21 工具）
    → registerPrompt（5 处注入：90000 技能 / 901 记忆 / 902 情感 / 903 自我）
    → registerPanelApi（/memhub/api）
    → runSelfCheck（写 ~/.dsh/memhub/self-check.json，只日志）
```

### 2.2 每轮注入链路（不进前缀缓存破坏）

```
每轮组装系统提示：
  section 90000  技能提示（48 字符，静态）
  context 901    记忆块（读 zzerx+sidecar → 预算调度 → ≤280 字符）
  context 902    情感块（读 state → 混合 → ≤92 字符；无依据返回空）
  context 903    自我摘要（最新叙述标题 + 段数 → ≤60 字符）
  context 904    人格参数（baseline + 情感偏置 → ≤120 字符）
  context 905    索引一行（指向 ~/.dsh/memhub/INDEX.md）
合计 ≈660 字符 ≈430 tokens（含人格/索引行）
```

### 2.3 工具调用链路（例：排障）

```
模型：skill_search("排障")
  → queryTokens（中文 2-gram + 18 条别名）→ 命中 diagnosing-bugs
模型：skill_load("diagnosing-bugs") → 读 SKILL.md → 返回正文
执行 → skill_outcome("diagnosing-bugs", success)
  → 台账 skill-ledger.jsonl 追加 → 成功率更新
失败 → lesson_save("当…时", wrong, right) → 下次动手前 lesson_match 命中
```

### 2.4 记忆写入链路

```
模型：memory_save（zzerx，≤320 字）→ zzerx 写 memories/<id>.json
  → memhub 下次读缓存时 mtime 变化 → buildSidecars（tier/decay）
  → 写 ~/.dsh/memhub/recall/<id>.json + recall-index.jsonl
  → 注入时按预算挑选；memhub_open 打开时 recordRecall 累加（双通道数据）
```

### 2.5 治理链路

```
planStatus（冻结：最近 30 天召回≥2 次；归档：衰减 <0.2；core 不衰减）
  → applyArchive（只改 sidecar.archived，可恢复，不动 zzerx）
```

### 2.6 晋升链（人确认才落盘）

```
同类记忆 ≥3 条 → promote_to_skill → 技能草案文本（不写库）
人工确认 → skill_register → 写 SKILL.md（旧文件 .bak-toggle）
技能失败率 ≥50% 且 ≥10 次 → revisionProposal → 改版提案
```

## 3. 各模块作用与工作模式

| 模块 | 输入 | 输出 | 触发方式 | 失败行为 |
|---|---|---|---|---|
| indexer | 技能目录 | 条目/索引/预算 | 工具调用、启动自检 | 返回空列表 + 错误文本 |
| recall-store | zzerx 文件 | sidecar | 记忆工具、注入 | 坏文件跳过，errors 上报 |
| recall-scheduler | sidecar | 注入块 | 每轮 context | 超预算按行截断 |
| govern | sidecar | 状态计划/归档 | CLI/面板 | 归档可恢复，永不删 |
| lessons | 教训文件 | 匹配/提案 | 工具 | 坏行跳过 |
| promote | 记忆/台账 | 草案/提案 | 工具 | 不足 3 条给错误 |
| selfnote | 自我目录 | 叙述/摘要/岛屿 | 工具/注入 | 超长拒绝，旧段归档 |
| affect | 事件/状态 | 参数块 | 工具/注入 | 无依据回落 neutral |
| graph | zzerx 实体/边 | 节点/边 | 面板 API | 空图不崩 |
| host | 配置 | 全部注册 | 启动 | 单模块失败只跳过 |

## 4. 注入预算

| 注入 | 上限 | 位置 | 是否动态 |
|---|---|---|---|
| 技能提示 | 48 字符（≈30 tokens） | section 90000 | 否（静态） |
| 记忆块 | 280 字符（≈180 tokens） | context 901 | 是 |
| 情感块 | 92 字符（≈60 tokens） | context 902 | 是 |
| 自我摘要 | 60 字符（≈40 tokens） | context 903 | 是 |
| **合计** | **≈480 字符 ≈310 tokens** | 硬顶 400 | — |

## 5. 真源与边界

| 数据 | 真源 | memhub 写什么 | 丢了怎么办 |
|---|---|---|---|
| 技能 | `~/.dsh/skills/*/SKILL.md` | 只加/去一行 frontmatter + .bak-toggle | 重扫即可 |
| 记忆正文 | zzerx `storages/memory` | 只读 | 重扫即可 |
| tier/decay | 派生（可重算） | `~/.dsh/memhub/recall/` | 删了重算 |
| 教训/台账/自我/情感 | **用户数据** | `~/.dsh/memhub/` | 需备份（README 注明） |
| 星图 | 派生（zzerx 实体/边） | 不落盘 | 随时重算 |

## 6. 未验证项（诚实）

- 真实 profile 的 boot 挂载未验证（沙箱用 mock 运行时验证了 apply 与工具逻辑）。
- owner 门在拿不到会话身份时保守拒绝（各 DSH 版本字段不同，需实机确认）。
- 面板 UI 未在浏览器实际渲染验证（只保证注册代码与 API 契约）。
- 技能开关热加载已验证（41→10），但「加开关后模型自动调用频率下降多少」未实测。

## 7. 与归档总结的分工（不冲突）

| 东西 | 写什么 | 写到哪 | 谁触发 |
|---|---|---|---|
| 归档总结 | 会话级总结 + HANDOFF | `.dsh/archive/` | 哥哥手动归档后脚本 |
| selfNote | **我自己的变化**（不是会话总结） | `~/.dsh/memhub/self/` | 空闲/每周 |
| 记忆 | 事实/决策/承诺 | orbs / sidecar | 对话写入 |

三条线互不导入：归档流水线保持原样，memhub 只加索引不改写它；selfNote 只写「我变了什么」，不重复会话总结。

## 8. 技能按用途分组（技能 = 流程规范）

| 分组 | 代表技能 | 作用 |
|---|---|---|
| 流程规范 | tdd / implement / to-spec / to-tickets / code-review / diagnosing-bugs / verification-before-completion / handoff | 写代码、交付、复盘的**工作流程** |
| 规划思考 | align-requirements / grilling / wayfinder / to-questionnaire / domain-modeling | 想清楚再动手 |
| 文档内容 | officecli / ppt-design-skill / archify / research / note-format / vox-director | 产出物 |
| 记忆自我 | enhancement / memory-cloud-review / i-have-adhd / archive-summarize | 记忆与自我管理 |

面板技能库按这四组展示；DSH 原生插件栏只列插件、不列技能，两处不重复。
