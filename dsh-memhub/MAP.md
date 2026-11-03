# 模块树（分形：每层一句话说清职责）

- **dsh-memhub**：DSH 的记忆/技能/情感中枢（第 1–7 期）
  - `src/` 纯逻辑 + 组装
    - `indexer.js`：技能库扫描/检索
    - `recall-store.js`：读 zzerx 记忆 + sidecar 分级 + 原文回读
    - `recall-scheduler.js`：记忆注入预算调度
    - `govern.js`：双通道衰减/归档/恢复
    - `lessons.js`：教训
    - `promote.js`：晋升 + 技能台账
    - `selfnote.js`：自我叙述 + 岛屿
    - `affect.js`：情感状态
    - `graph.js`：星图数据
    - `tooling.js`：工具层共享件
    - `tools-skill.js` / `tools-recall.js` / `tools-learn.js`：工具定义
    - `host.js`：组装器（配置/缓存/注册/注入/API/自检）
  - `lib/client.js`：设置页面板
  - `tools/` 可重跑脚本：技能索引、记忆 sidecar、技能开关
  - `tests/` 四套零依赖自测 + 沙箱
  - `data/` 派生索引预览（可重扫）

## 边界（不做什么）

- 不搬技能文件、不改 SKILL.md 正文（只加/去 frontmatter 一行开关，带备份）
- 不搬记忆数据、不改 zzerx 文件（扩展字段只写 `~/.dsh/memhub/`）
- 不替换 DSH 原生 `skill` / zzerx `memory_*`（增强层 + 兜底）
- 不做自动学习：晋升/改版只出草案，人工确认

## 模块之间的依赖

```
host.js（组装） → tools-skill / tools-recall / tools-learn
tools-*        → indexer / recall-* / govern / lessons / promote / selfnote / affect / graph
纯逻辑模块      → 只依赖 node:fs / node:path（零第三方依赖）
tests/*        → 纯逻辑模块（sandbox 额外经 loader.mjs mock dsh-tools）
lib/client.js  → 浏览器 fetch → /memhub/api/*（host 提供）
```
