# 配置地图（谁在第几行、默认值、改错会怎样）

> 目的：改配置前先知道**改错了会发生什么**。行列号对应 `src/host.js` 的 `normalizeConfig`（2026-11-09 版）。
> 改哪里：**只在** `~/.dsh/profiles/desktop/cordis.patch.yml` 里加 `- id: memhub` + `config:`，别改 `node_modules` 里的副本（会被重装覆盖）。

## 一、配置项

| 配置 | 定义 | 默认 | 改错会怎样 |
|---|---|---|---|
| `vault` | `host.js:44` | `~/.dsh/skills` | 指到空目录 → 技能列表空、`skill_search` 全空、`skill_load` 报找不到。**不会报错**，只是静默为空 |
| `sharedRoot` | `host.js:45` | `L:\DSH\shared\memhub` | 换盘/换目录 → 公共区记忆与教训“看起来消失”（实际写去新位置，旧数据留在原地）；星图仍读旧 zzerx |
| `extraVaults` | `host.js:44-49` | `[]` | 额外技能库（数组：`path` + `label`）。指向不存在的目录 → 静默少一批技能（`skill_search` 搜不到）；同名技能只保留先加载的主库，另记 error |
| `allowRegister` | `host.js:53` | `true` | 设 `false` → `skill_register` 直接拒（覆盖已有技能也拒） |
| `ownerOnly` | `host.js:48` | `false` | 设 `true` 且 `ownerSessions` 为空 → **读写全拒**，面板 POST 全 403。这是最容易把自己锁死的一项 |
| `ownerSessions` | `host.js:49` | `[]` | 写错会话 id → 永久拒绝；只能改配置重启救回来 |
| `recall.enabled` | `host.js:52` | `true` | `false` → 记忆块完全不注入（技能、情感、自我照常） |
| `recall.source` | `host.js:61` | `memhub` | **默认是 `memhub`（2026-11-11 改）**：只有显式写 `'zzerx'` 才回滚旧库。旧默认 `'zzerx'` 的危险在于配置漏写/写错 = 静默读空库、注入块只剩标题。写了 `'zzerx'` 但旧库已卸 → 0 条 + 启动 warn |
| `recall.sourceRoot` | `host.js:62` | `~/.dsh/storages/memory` | 只对 `source: 'zzerx'` 生效；指错 → 记忆 0 条、`memoryErrors` 上涨，启动会 warn |
| `recall.budgetChars` | `host.js:55` | `280` | 调大 → 每轮 token 直接涨；调小 → 注入条目变少（硬截断，不会切半行） |
| `learn.enabled` | `host.js:57` | `true` | `false` → 4 个教训/晋升工具不注册 |
| `self.enabled` | `host.js:58` | `true` | `false` → `self_note_write` / `self_view` 消失，注入 903 也没有 |
| `affect.enabled` | `host.js:59` | `true` | `false` → 情感工具消失，注入 902 不再出现「性格参数」 |
| `persona.enabled` | `host.js:61` | `true` | `false` → 人格参数块（904）不注入，演化定时器也不起 |
| `persona.mode` | `host.js:63` | `auto` | 只认 `auto` / `always` / `baseline`；**写错回落 auto**（工程会话只带蓝图） |
| `persona.evolveIntervalDays` | `host.js:64` | `7` | 调小 → 演化更频繁；单次步长上限 0.02 仍然生效，不会突变 |
| `panel.enabled` | `host.js:66` | `true` | `false` → `/memhub/api` 与 `/memhub/graph` 都不注册（星图页打不开） |
| `janitor.enabled` | `host.js:69` | `true` | `false` → 启动时不做超容量淘汰（CLI 仍可手工跑）；不影响读写 |
| `janitor.autoEvict` | `host.js:70` | `true` | `false` → 只报告不自动淘汰；配合 `enabled:false` 等于完全关掉治理 |
| `janitor.maxOrbs` | `host.js:71` | `300` | 算**活跃条目**（含 protected）；protected 不参与淘汰但占名额 → 真机 112/140 是 protected，调小于 112 会直接 capped（淘汰不了、只打 warn）。调大 → 只增不减，检索变慢 |
| `janitor.dedupeThreshold` | `host.js:72` | `0.82` | 调低 → 更多“相近”被判重复（合并只走 CLI，不会自动执行）；正文 < 60 字或长度差 >30% 不参与 |
| `janitor.archiveBuffer` | `host.js:74` | `1.2` | 活跃数超过 `maxOrbs × buffer` 才归档（防每条新记忆都触发一次淘汰）；调到 1 就是「一超就动」 |
| `janitor.snapshotKeep` | `host.js:75` | `3` | 调小 → 旧快照被清，回滚点变少（每份含 orbs/recall/graph/公共区 orbs） |

## 二、数据落在哪

| 路径 | 内容 | 丢了会怎样 |
|---|---|---|
| `~/.dsh/memhub/` | sidecar（tier/decay/recall）、persona、graph、INDEX.md、self-check.json | 可重建（重扫 zzerx/orb 重算）；`persona` 与 `graph` 是用户数据，**要备份** |
| `~/.dsh/memhub/orbs/` | 自研 orb 记忆（self / projects） | 这是真源，丢了就没了 |
| `L:\DSH\shared\memhub\orbs/` | 公共区 orb（global） | 同上 |
| `L:\DSH\shared\memhub\lessons.jsonl` | 教训 | 同上 |
| `~/.dsh/storages/memory/` | zzerx 旧库（迁移前是真源；**实体/边也在这里**） | 迁移前丢了 = 全丢；卸载前必须先 `node tools/migrate-memory.mjs --apply`（记忆 + 星图一起搬） |

## 三、最容易踩的三条

1. **`recall.source` 默认已是 `memhub`**——只有显式 `'zzerx'` 才读旧库；写 `zzerx` 而旧库不在会有 warn（源读不出来但现在日志里看得见）。切完一定看 `self-check.json` 的 `recallSource`。
2. **`ownerOnly` 一开就可能把自己锁死**——HTTP 请求没有会话身份，面板写操作直接 403；工具层靠 `ownerSessions` 命中。没有可用的 session id 就别开。
3. **`vault` / `sourceRoot` 指错是静默的**——界面不报错，只表现为“技能没了/记忆空了”。改完先看 `self-check.json`。
4. **`tools/janitor.mjs` 不读插件配置**——它的 `--max` / `--threshold` 是独立默认值（300 / 0.82），且计划基于**本地 orb 库**；宿主配置改了 `janitor.maxOrbs` 或还跑着 zzerx 源时，CLI 的 dry-run 数字不代表宿主行为。
5. **合并会把 importance 抬到最高 9**（`min(9, a+b*0.3)`），而 `memhub_save` 只收 1–5；抬到 9 的条目下次手动覆盖写会被夹回 5。merge 只走 CLI `--apply`，属于人工动作。

## 四、改完怎么验

```bash
# 重启客户端后
cat ~/.dsh/memhub/self-check.json      # skills / memories / recallSource / memoryErrors
curl -s http://127.0.0.1:<端口>/memhub/api/state | head -c 200
```
