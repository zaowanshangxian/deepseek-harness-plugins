# 差距报告：最初要求 vs 现在（2026-11-03）

> 对照「最初的要求与设想」，逐条标注：**做到 / 部分做 / 没做（原因）**。
> 测试口径：`check 31/31` · `recall 17/17` · `govern 59/59` · `sandbox 36/36`（全部为 mock/纯逻辑，真机未验证）。

## 一、做到了

| # | 要求 | 现在 | 证据 |
|---|---|---|---|
| 1 | 大型插件，三板块（技能/记忆/情感） | 一个包 `dsh-memhub`，第 1–9 期代码完成 | `src/*`、`README` |
| 2 | 技能随用随取、不预注入、专门管理 | 描述不常驻；`skill_search → skill_load` 三级披露；面板启停；开关脚本 dry-run | `tests/check.mjs`、`tools/toggle-model-invocation.mjs` |
| 3 | 记忆分级、遗忘时间不同 | core/long/event 半衰期；双通道冻结；归档可恢复 | `src/govern.js`、`govern-check` |
| 4 | 情感影响不同、分层影响不同 | 情感→性格偏置按记忆 tier 加权（core 1 / long 0.6 / event 0.3） | `src/persona.js`、`govern-check` |
| 5 | 限时情感：影响随时间衰减到零 | 偏置 24h 半衰期衰减，<0.01 归零；**不改 baseline** | `govern-check`「偏置最终衰减到零」 |
| 6 | 性格以现有人格为蓝图、变形参数调小 | baseline 用复合人格；演化步长上限 0.02 | `persona.js`、`govern-check` |
| 7 | 教训放公共区 | `L:\DSH\shared\memhub\lessons.jsonl` | `tools-learn`、sandbox |
| 8 | 工程记忆不衰减 | `evergreen`（公共区/工程）永不归档 | `govern.js`、`govern-check` |
| 9 | 记忆星图分类排主次 + 可交互 | 节点点选 → 改 tier / 删除（归档）/ 恢复；后端 API 齐 | `lib/client.js`、`host.js` |
| 10 | 索引分类，后续对话能读到 | 生成 `~/.dsh/memhub/INDEX.md`，每轮注入一行指向它 | `src/index-doc.js`、sandbox「索引注入块」 |
| 11 | 五层记忆链 L0–L4 | L0 原文回读、L2 权重、L3 owner 门、L4 selfNote 都在 | 第 2–5 期代码 |
| 12 | 记忆自研 + 迁移两个插件 | 自有 orb 存储 + 迁移脚本（zzerx 100 条 dry-run：shared 53 / self 28 / project 19；fish 2 条代码就绪） | `tools/migrate-memory.mjs` dry-run 输出 |
| 13 | 替换前排测试、可回滚 | 四道门槛 + 回滚预案写进 PLAN §13；本次不执行替换 | `REVIEW.md` + 本文件 |

## 二、部分做到（差在哪）

| # | 要求 | 差在哪 | 怎么办 |
|---|---|---|---|
| 1 | 情感「养成」更像人 | 参数与混合公式有；**自动判定从对话里识别 praise/correction 没接线**（现在靠 `affect_event` 工具/面板触发） | 接 `agent/turn-stopping` 规则层（0 模型调用），或先手动 |
| 2 | 人格替换（接替 preset persona） | 模块已能生成/注入/演化；**还没替换 preset**（改系统提示要停机+备份，之前踩过崩） | 按「并行注入 → 观察 → 替换」两步走，等你点头 |
| 3 | 记忆迁移「直接搬过来」 | 迁移脚本已就绪、dry-run 通过；**没有 --apply**（等你看分类） | 你确认后 `node tools/migrate-memory.mjs --apply`，再切 `recall.source: memhub` |
| 4 | 归档流水线替换 | 未动 `archive-summarize.py` 与两个计划任务 | 放最后一步，等记忆模块真机稳定 |
| 5 | 星图可交互 | 代码与 API 有了；**没在浏览器里真点过**（沙箱是 mock） | 装机后页面验收 |
| 6 | L1 会话摘要 | 按 PLAN 交给 DSH 原生（不重复造） | 保持 |
| 7 | 每次会话读指定文件 | 现有 AGENTS 开机顺序已满足；索引是可选增强（已做） | 保持 |

## 三、没做（明确原因）

| # | 没做什么 | 原因 |
|---|---|---|
| 1 | 装到桌面客户端 | 你要求先沙箱验证；且 `desktop-test` 的 node_modules 是 desktop 的符号链接，不能当隔离沙箱 |
| 2 | 真机验证（工具 schema / webServer / slots / 面板渲染） | 需要安装 + 重启 DSH；沙箱只覆盖 mock |
| 3 | 替换 preset 人格 | 系统提示改动，必须停机 + 备份 + 你确认 |
| 4 | 执行记忆迁移 | 等你看完 dry-run 分类 |
| 5 | 卸载 zzerx / fish | 迁移验证 + 观察期后才停用 |

## 四、一句话

**能写的都写了，能测的都测了；剩下的差距全部是「真机动作」——装机、迁移、换人格，这三件都要你点头、且都有回滚路。**
