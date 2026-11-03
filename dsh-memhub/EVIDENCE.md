# 证据账本

> 规矩：每条结论都要能点回原文。**只有结论没有证据的条目，等于没写。**

| 结论 | 证据（路径 / 命令 / 会话 id） | 日期 |
| --- | --- | --- |
| 自测 19/19 通过 | `node tests/check.mjs` 输出 `19/19 通过`（2026-11-03 本机） | 2026-11-03 |
| 技能库 41 个全部可解析、0 错误 | `node tools/index.mjs --out data/skills.jsonl` 输出 `skills: 41` / `errors: 0` | 2026-11-03 |
| 描述合计 631 字符 ≈410 tokens | 同上：`desc: 631 chars ≈ 410 tokens` | 2026-11-03 |
| 全文合计 247,019 字符 ≈160k tokens（全文绝不能常驻） | 同上：`body: 247019 chars ≈ 160562 tokens` | 2026-11-03 |
| 中文任务词可检索 | 同 `tests/check.mjs` 的 4 条 PASS：写测试→tdd、排障→diagnosing-bugs、做PPT→ppt-design-skill、交付前验证→verification-before-completion | 2026-11-03 |
| 常驻提示 48 字符、不含任何技能名 | `tests/check.mjs` 两条 PASS（≤60 字符 / 不含技能名） | 2026-11-03 |
| 41 个技能待加 `disable-model-invocation` | `node tools/toggle-model-invocation.mjs` 输出 `本次将加开关 41 个；已有开关 0 个` | 2026-11-03 |
| 未安装、未改 frontmatter | 本会话 approval 关闭，`plugin_manager` 与 `--apply` 均未执行；README「现状」记录 | 2026-11-03 |
| 技能开关 41/41 已加 | `node tools/toggle-model-invocation.mjs --apply` 输出「已加开关 41 个」；`node tools/index.mjs` 后 hidden=41；`.bak-toggle` 41 个 | 2026-11-03 |
| 技能开关热加载生效 | 本会话 `available_skills` 从 41 个变为 10 个（只剩 DSH 内置技能）；源码 `~/.dsh/skills/*/SKILL.md` 的 frontmatter | 2026-11-03 |
| 沙箱运行验证 12/12 | `node tests/sandbox.mjs`：mock loader 跑真实 `src/host.js`，4 工具注册 + 提示 order 90000 + 检索/加载/列表/错误/写入全部通过 | 2026-11-03 |
| 沙箱安装（desktop-test） | `desktop-test/package.json` dependencies + bundles 含 `dsh-memhub`；`dsh --profile desktop-test --dump-config` 输出 `- id: memhub / name: dsh-memhub` | 2026-11-03 |
| 桌面客户端未装 | desktop profile 的 `package.json` 未改动（无 dsh-memhub 行） | 2026-11-03 |
| 记忆模块自测 17/17 | `node tests/recall-check.mjs` 输出 `记忆模块自测：17/17 通过` | 2026-11-03 |
| 100 条记忆 sidecar 生成 | `node tools/recall-index.mjs` 输出 `memories: 98` / `byTier: {"long":67,"event":31}` / `errors: 0` / `written: 98` | 2026-11-03 |
| 记忆注入块 ≤280 字符 | 沙箱 PASS「记忆注入块 ≤280 字符（实际 235）」 | 2026-11-03 |
| 沙箱 17/17（7 工具 + 双注入 + owner 门） | `node tests/sandbox.mjs` 输出 `沙箱验证：17/17 通过` | 2026-11-03 |
| 技能开关已恢复（hidden=0） | `node tools/toggle-model-invocation.mjs --restore` 输出恢复 41 个；`node tools/index.mjs` 后 hidden=0 | 2026-11-03 |
| 第 3–7 期自测 35/35 | `node tests/govern-check.mjs` 输出 `第 3–7 期自测：35/35 通过` | 2026-11-03 |
| 沙箱 25/25（16 工具 / 4 注入） | `node tests/sandbox.mjs` 输出 `沙箱验证：25/25 通过` | 2026-11-03 |
| 全部源文件语法通过 | `node --check src/*.js lib/client.js` 16/16 OK | 2026-11-03 |
| **客户端事故与修复** | 沙箱安装误伤：`desktop-test/node_modules` 是指向 `desktop/node_modules` 的符号链接，`pnpm add` 删掉了 desktop 顶层链接；已用 `pnpm install` 恢复 18 个依赖（更多表情/persona/fish/qqbot/bili/inline-cost/tool-tax 全在），`dsh-memhub` 已移出客户端；desktop-test 残留清理 | 2026-11-03 |
| **盲审 4 条严重问题已修** | ①sidecar 重建合并 recall/archived（govern-check「重建后召回计数保留」PASS）；②情感块按行预算、边界行不切半（govern-check「不替哥哥做决定」PASS）；③技能写回改时间戳备份+原子写、覆盖需 confirm（tools-skill.js）；④owner 门覆盖写工具（sandbox「ownerOnly 下写被拒」PASS） | 2026-11-03 |
| 修复后四套测试 28/17/42/32 | `node tests/check.mjs` 28/28 · `recall-check` 17/17 · `govern-check` 42/42 · `sandbox` 32/32 | 2026-11-03 |
| 18 工具 schema 2321 字符 ≈1509 tokens | `node tests/sandbox.mjs` 输出 `18 个工具 schema 合计 2321 字符 ≈1509 tokens`（盲审建议2 已压到 ≤2400） | 2026-11-03 |
| 真实库数字（文档用） | `node tools/index.mjs`：skills 42 / desc 676 chars ≈439 tokens / body 248894；`node tools/recall-index.mjs`：memories 98 / long 67 / event 31 | 2026-11-03 |
| 第 8–9 期测试 | `govern-check` 56/56（含人格步长/偏置衰减归零/索引分类/orb 幂等迁移/evergreen 不衰减）；`sandbox` 34/34（5 处注入 901–905） | 2026-11-03 |
| 迁移 dry-run 分类 | `node tools/migrate-memory.mjs`：zzerx 100 条 → shared 53 / self 28 / project 19，0 解析错误 | 2026-11-03 |
| 星图交互 API | `host.js` 的 `/api/memory/archive`、`/api/memory/tier`、`/api/persona/evolve` 已注册；client `GraphView` 点选节点后出现 tier/删除/恢复按钮 | 2026-11-03 |
