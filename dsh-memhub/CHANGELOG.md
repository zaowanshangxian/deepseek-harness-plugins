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
