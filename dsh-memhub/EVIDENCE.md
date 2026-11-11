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
| **桌面客户端已装** | `~/.dsh/profiles/desktop/package.json`：bundles 第 22 项为 `dsh-memhub`、dependencies 为 `link:L:/DSH/DeepSeek/projects/dsh-memhub`；`pnpm-lock.yaml:35-37` 有该 link 依赖 | 2026-11-04 |
| **宿主依赖解析坑（已修）** | probe 报 `memhub (dsh-memhub): failed to import: Cannot find package '@deepseek-ai/dsh-tools'`；npm 公开版只有 `0.0.1-rc.1`（宿主用 `0.2.1-rc.2`，在 `@deepseek-ai/dsh` 嵌套 node_modules 里）。给项目建 `node_modules/@deepseek-ai/dsh-tools` junction 后 `import('dsh-memhub')` → `apply,inject,name` | 2026-11-04 |
| **真机加载成功（host 身份）** | `~/.dsh/memhub/self-check.json` mtime `00:20`（desktop 重启后写，不是我 probe 的 23:49）：`skills 42 / memories 102 / memoryErrors 0 / byTier long70 event32`；`INDEX.md` 同时间重写 2725 字节 | 2026-11-04 |
| **技能零预注入生效** | 新会话 system prompt 中无 `available_skills` 列表，只有「## 能力库」一行（`HINT_TEXT` 48 字符）；`skill_search("排障 诊断 bug")` 返回 `diagnosing-bugs` 候选卡 | 2026-11-04 |
| **面板 API 真机可用** | `GET http://127.0.0.1:56894/memhub/api/state` → 200 + 42 技能 JSON；`/memhub/api/graph` → 200 + 节点；对照 `/memhub/api/nonsense` → **404**（证明是注册路由不是通配） | 2026-11-04 |
| **记忆注入预算真机数字** | `memhub_budget`：`257/280 字符 ≈167 tokens`，选中 4 条（2 long + 2 最近） | 2026-11-04 |
| **情感块注入生效** | 新会话 system prompt 出现「性格参数 warm 0.70 …」+ 三行约束；`affect_state` → `mood: neutral / 强度 0.00`（无依据回落中性） | 2026-11-04 |
| 工作记忆（working）真机生效 | `self-check.json`（11-09 13:48 重启后）：`byTier {working:40, long:53, mid:28, event:19}`；磁盘 sidecar 同数 | 2026-11-09 |
| janitor 四套测试全绿 | `node tests/check.mjs` 31/31 · `recall-check` 27/27 · `govern-check` 85/85 · `sandbox` 62/62 | 2026-11-09 |
| janitor 真机 dry-run 无动作 | `node tools/janitor.mjs` → `orb 总数 140 / 活跃 96 / 上限 300 / 可淘汰 28 / 超容量 0 / 0 重复` | 2026-11-09 |
| janitor 淘汰排序可复现 | `node tools/janitor.mjs --max 90` → 列出 6 条最低权重 mid（权重 3），按最老优先 | 2026-11-09 |
| janitor CLI apply→restore 往返 | 临时 `DSH_HOME` + `--shared`：4 条种子 → `--max 2 --apply` 淘汰 2 条（t_b、t_a）留 t_c/t_d、快照 1 份；`--restore latest` 后 `archived` 归零 | 2026-11-09 |
| janitor 启动自动治理（真机路径） | `sandbox` 用例：`apply()` 走真实 host，超上限时淘汰 2 条 + 写 `snapshots/` + `janitor-log.jsonl`，`self-check.janitor.evicted=2`；orb 数不变（只归档） | 2026-11-09 |
| janitor 盲审（独立只读） | `REVIEW-janitor.md`：1 致命 + 9 严重 + 14 一般，附可复现脚本 | 2026-11-09 |
| janitor 盲审修复后四套测试 | `check` 31/31 · `recall-check` 27/27 · `govern-check` **99/99** · `sandbox` 62/62 | 2026-11-09 |
| P0 回归：连续 5 次 restore | govern-check「连续 5 次 restore 都真的恢复」PASS（修复前第 4 次返回 `restored: []`） | 2026-11-09 |
| CLI 修复后往返 | 临时目录：`--apply` 淘汰 t_b/t_a → `--restore latest` 两次都选普通快照 → archived 归零；`--max abc` 退出码 2 | 2026-11-09 |
| 复审（第二轮） | `REVIEW-janitor.md` §复审：P0/S-1~S-9 修住（原复现脚本重放），新抓 R-1/R-3 已再修 | 2026-11-09 |
| 复审后四套测试 | 31/27/**105**/62；新增：饱和权重合并、默认 scope=self、latest 多快照取最新、R-3 先合并后淘汰 | 2026-11-09 |
| CLI 复审后冒烟 | 临时目录：`--apply` 淘汰 2 → 二次 `--apply` 淘汰 0（可重入）→ `--restore latest` 成功；`pre-restore` 只留 1 份 | 2026-11-09 |
| 体检改量 memhub | `node tools/health-report.mjs --dupes --write` → `~/.dsh/memhub/reports/health-202611100931.md`：96 活跃 / 44 归档、注入 213/280、0 可归档、0 休眠、0 重复、3 条提示 | 2026-11-10 |
| 五套测试串跑 | `npm test`：31/27/105/62/**22** 全过 | 2026-11-10 |
| 检索 v2 命中率对比 | `node tools/search-bench.mjs --write`（真机 96 活跃 × 18 查询）：baseline 2/18、v1 15/18、**v2 16/18**；MRR 0.111 / 0.883 / **0.928**；报告 `data/search-bench-20261110.md` | 2026-11-10 |
| 六套测试串跑 | `npm test`：31/27/105/62/22/10 全过 | 2026-11-10 |
| 六套测试串跑（取代+指纹+缓冲+多库） | `npm test`：**40**/30/107/65/24/10 全过 | 2026-11-11 |
| 游戏技能库隔离加载 | `node -e` 用 `loadSkillVaults` 扫 `L:\DSH\DeepSeek\skills-game`：77 条、0 error；`searchSkills('three.js 角色控制')` 命中 3 条并标 `[game]` | 2026-11-11 |
| 技能库总数未污染 | 主库仍是 `~/.dsh/skills` 的 42 个；游戏库独立目录，候选卡带 `[game]` 标签 | 2026-11-11 |
| 真机演练：supersedes + 产物指纹（2026-11-11） | 建两条演练记忆 → 新条 `supersedes: o_mwbr59b5_7avywk`：旧 sidecar `supersededBy` 正确、注入块**当场只显示新条**（旧条被排除）；`memhub_search("演练 技能库 结论")` 新条第 1、旧条第 2；`artifact.txt` 改动后体检报「外部修改 1 条」，恢复后归 0；演练结束两条均已 `archived: true`，检索不再返回，临时文件已删 | 2026-11-11 |

