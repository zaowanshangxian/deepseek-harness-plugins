# 独立盲审：janitor（ROADMAP Step 3）

> 审查人：独立只读盲审（无写权限要求，未改任何源码/测试；只新增本文件）
> 时间：2026-11-09
> 审查对象：`src/janitor.js`（316 行）、`src/host.js` 的 `normalizeConfig` / `runStartupJanitor` / `runSelfCheck`、
> `tools/janitor.mjs`、`src/orb-store.js`（`orbPathFor`）、`src/recall-store.js`（`mergeSidecars`）、
> `tests/govern-check.mjs`、`tests/sandbox.mjs`；口径对照 `ROADMAP.md` §3 Step 3。
> 方法：先读口径 → 读实现 → 跑全部测试（`govern-check 85/85`、`sandbox 62/62`、`check 31/31`、`recall-check 27/27` 全绿）
> → 在 `os.tmpdir()` + `DSH_HOME` 临时目录里做 9 组针对性实验（真实 host apply 路径 + 真实 CLI）。
> **没有跑任何会写 `~/.dsh/memhub` 或 `L:\DSH\shared\memhub` 的命令**；真机侧只读了一次 sidecar 统计与 `self-check.json`。

---

## 结论

管线骨架（纯函数计划 / 只归档 sidecar / protected 判定 / 启动可重入）是对的，测试也确实跑在真实 host 路径上。
但**回滚链路有一个会静默失败的致命缺陷**（restore 会删掉自己要用的快照），
另外四处**与口径不符**（`latest` 排序、淘汰与合并同轮互不知情、去重只看前 300 字、zzerx 源的 `global` 不在 evergreen 里），
以及一处**会让上限永远触发不了**的实测事实（真机 140 条里 112 条 protected，可淘汰只有 28 条）。

真机 `self-check.json` 目前**没有 `janitor` 字段**（HANDOFF-2026-11-08 说还没重启）→ 上面这些问题**尚未在真机生效**，
但 `tools/janitor.mjs --restore` 现在就能被人工触发，P0 必须在第一次回滚之前修掉。

| 级别 | 条数 | 一句话 |
|---|---|---|
| 致命 | 1 | `restore` 会 prune 掉自己要恢复的快照 → 报告成功但什么都没恢复 |
| 严重 | 9 | latest 选错 / 淘汰与合并互相打脸 / 去重假阳性丢正文 / global 不豁免 / pinned 无落点 / 默认写入落公共区 / restore 无回滚 / 半成品快照 / `--shared` 覆盖错盘 |
| 一般 | 14 | 日志静默、aside 残留、CLI 参数与配置不同源、小数上限、性能、文档口径错 |

---

## 致命

### P0-1 `restore` 会删掉自己要恢复的快照 → 静默空恢复（报告成功，实际零改动）

- **位置**：`src/janitor.js:184-207`（关键三行：`187-191` 安全快照 → `135-154` 内的 `152 pruneSnapshots` → `195` 静默跳过）
- **为什么致命**：
  `restoreSnapshot` 先做「安全快照」`createSnapshot(..., { tag:'pre-restore', keep: SNAPSHOT_KEEP + 1 })`，
  而 `createSnapshot` 内部会 `pruneSnapshots(dataRoot, keep=4)`。快照总数达到 4 份后，prune 按
  「保留 4 份、删最旧 1 份」→ **如果被删的正好是本次要恢复的 `source`**，后面第 195 行
  `if (!fs.existsSync(from)) continue` 会把 orbs / recall / graph / 公共区全部跳过，
  函数返回 `restored: []` 且**不报错**；CLI 照样打印「已恢复快照 X：」。
  更糟的是 X 已被删掉，下一次 `--restore X` 直接抛「没有这个快照」——
  **用户以为回滚过了，实际什么都没回滚，且回滚点被自己的安全机制吃掉。**
- **实测**（临时目录，5 次 restore 同一个基线快照）：

  ```
  restore#1: restored=["orbs"]  x.md=v1
  restore#2: restored=["orbs"]  x.md=v1
  restore#3: restored=["orbs"]  x.md=v1
  restore#4: restored=[]  x.md=v-before-3      ← 报成功，实际没恢复（x.md 还是 restore 前的内容）
  restore#5 抛错: Error: 没有这个快照：20261109-083534-8o7s   ← 基线快照已被 prune 掉
  ```
- **怎么改**（三件都要）：
  1. `pruneSnapshots` 增加 `exclude`（或安全快照走 `keep: Infinity` 再单独 prune，prune 时跳过 `source`）；
  2. `187` 之后、复制之前**重新校验 `source/manifest.json` 还在**，不在就抛错；
  3. `restored.length === 0` 要当失败（抛错或至少红字警告），别打印成功；
  4. 顺手：安全快照的 `keep+1` 语义要写清楚（现在的 4 和配置的 3 不一致，用户看到的是「多出来一份 pre-restore 把老的回滚点挤掉了」）。

---

## 严重

### S-1 `--restore latest` 用 id 字典序 → 选中 `pre-restore-*`（不是最新的）

- **位置**：`src/janitor.js:172`（`sort by left.id.localeCompare(right.id)`）+ `tools/janitor.mjs:58`（`snapshots[snapshots.length - 1]`）
- **为什么**：带 tag 的 id 是 `pre-restore-<stamp>-<rand>`，字典序里 `'p'(0x70) > '2'(0x32)`，
  所以 **所有 pre-restore 快照永远排最后**，`latest` 永远先选它们；`pruneSnapshots` 同样按这个序删「最旧」，会先删真正的普通快照。
- **实测**（真 CLI）：

  ```
  $ node tools/janitor.mjs --restore latest
  已恢复快照 20261109-083752-tqn9：orbs / recall
  恢复前的状态另存为 pre-restore-20261109-083756-tusb
  $ node tools/janitor.mjs --restore latest
  已恢复快照 pre-restore-20261109-083756-tusb：…     ← 第二次 latest 变成「撤销上一次恢复」
  ```
  另一次实验里普通快照时间更新（`083552`），`latest` 仍选 `pre-restore-083548`（旧 4 秒）。
- **怎么改**：`listSnapshots` 按 `manifest.at`（ISO 时间）排序，无 manifest 的回落到 id；
  `latest` 默认**排除** `pre-restore-*`（要回滚上一次恢复时用 `--restore pre-restore-...`，CLI 提示里已经给了 id）。

### S-2 淘汰与合并在同一轮里互不知情 → 合并写进「已归档」的 keep，审计日志说谎

- **位置**：`src/janitor.js:266-280`（先淘汰）→ `281-313`（再合并）；缺一处 `plan.evict` 与 `plan.dedupe` 的交叉校验
- **为什么**：`plan.evict` 与 `plan.dedupe` 都基于**同一份淘汰前的 sidecars**。若一对重复条目的 `keep`
  也在淘汰名单里（两条都很低权重、overflow ≥ 2 时必然发生），`298-299` 会照常
  `bumpImportance(keep)` + `applyArchive(drop)`，结果是**两条都被归档**，而 `archive.jsonl` 写的是
  `{action:'merge', keep:'kb', drop:'ka'}` —— 审计记录声称 kb 被保留，实际 kb 已 archived。
- **实测**：

  ```
  plan.evict = ka(w1), kb(w1)
  plan.dedupe = kb<-ka
  evicted = [ 'ka', 'kb' ]
  merged  = [{"keep":"kb","drop":"ka","score":1,"importance":1.3}]
  sidecar ka: archived=true status=archived | sidecar kb: archived=true status=archived importance=1.3
  ```
- **后果**：`archive.jsonl` 是口径要求的「可追溯」，现在会指向一条归档条目；合并后的权重落在不可见条目上（restore 才回来）。
- **怎么改**：`planJanitor` 里先算 dedupe 的 keep 集合，再从 evict 候选里**排除被 keep 的 id**（保护一个合并保留下来的条目是合理语义）；
  或 `runJanitor` 里 `if (result.evicted.includes(pair.keep) || result.evicted.includes(pair.drop)) → skipped` 并上报。

### S-3 去重只看前 300 字 → 长条目尾部差异被判 100% 重复，drop 的正文不并入 keep

- **位置**：`src/janitor.js:53`（`textOf` = `title + content.slice(0, 300)`）+ `295-300`（合并只搬 importance）
- **为什么**：`memhub_save` 允许正文 2000 字，而相似度只比前 300 字。两条共享同一段开头、
  尾部结论不同的长记忆（很常见：同一模板模板化写的排障记录）相似度会算成 1.000 → 被合并；
  合并只搬权重（口径如此），**drop 的正文不会写进 keep**；而 `memhub_search` 过滤 `archived`（`tools-recall.js:188`）
  → 被归档那条从「可检索面」消失，只剩 `memhub_open(id)` 能读回来（得先知道 id）。
- **实测**（两条 517/516 字、前 300 字完全相同、尾部一条讲部署一条讲回滚）：

  ```
  被判重复的对: [ 'h_a/h_b 1.000' ]
  合并结果: [{"keep":"h_a","drop":"h_b","score":1,"importance":4.9}]
  存活条目正文里还有「尾部B」的内容吗: false
  ```
- **怎么改**：`textOf` 用全文（或按 2000 上限）；长度差超过阈值时不做重复判定（`Math.abs(lenA-lenB)/max > 0.3` 直接跳过）；
  合并时把 drop 的正文附在 keep 末尾（`\n\n## 合并自 <id>\n<content>`）或至少在 `archive.jsonl` 里**存 drop 的正文摘要**。

### S-4 zzerx 源的 `scope: global` 不进 evergreen → 默认源下公共区记忆会被自动淘汰

- **位置**：`src/recall-store.js:138`（`evergreen: Boolean(record.evergreen) || record.scope === 'shared'`）
- **为什么**：旧栈的「公共区」是 `scope: global`（迁移时 `classifyOrb` 明确把 `global → shared`，`orb-store.js:30`）。
  但 `buildSidecars` 只认 `'shared'` → **默认配置（`recall.source: 'zzerx'`）下，global 记忆 tier 按 kind/importance 落在 event/mid/long，evergreen=false → 可淘汰**；
  同一条记录迁移进 orb 后又变 evergreen。同一份数据，迁移前后「受不受保护」相反 —— 这是口径 #2 的直接违背。
- **实测**（`planJanitor(maxOrbs=2)`，两条 global + 一条 shared）：

  ```
  evergreen: g1:false g2:false s1:true
  淘汰: [ 'g1' ] capped= false
  ```
- **怎么改**：`record.scope === 'shared' || record.scope === 'global'`；补一条 `buildSidecars` 的用例。

### S-5 `pinned` 在 orb 上没有落点 → 「pinned 豁免」对 orb 库是死规则，迁移会静默丢 pin

- **位置**：`src/orb-store.js:60-79`（`renderOrb` 不写 pinned）、`151-169`（`loadOrbs` 不读 pinned）、`94-125`（`saveOrb` 不接收 pinned）、`182-197`（`fromZzerx` 不搬 pinned）
- **为什么**：口径 #2 把 `pinned` 列为 protected，`janitor.js:44` 也判了；但 orb 的 frontmatter 字段白名单里根本没有 `pinned`，
  `memhub_save` 也没有这个参数 → **迁移后的库不可能有 pinned 条目**，规则永远不生效；
  反过来，zzerx 里原本 `pinned: true`（→ `tierOf` 给 core）的记忆迁移进 orb 时 pin 丢了，
  下一次重建就按 importance 重新分档，**从「永久不衰减 + 受保护」变成可淘汰**。
- **怎么改**：`renderOrb`/`loadOrbs`/`saveOrb`/`fromZzerx` 都带上 `pinned`；`memhub_save` 参数加 `pinned`；
  或明确写进文档「pinned 只对 zzerx 源有效」，并且迁移时把 zzerx 的 pinned 转成 `importance: 5`（至少别静默降级）。

### S-6 不传 scope 的写入会落进公共区，并且双豁免（evergreen + working）→ 永不淘汰

- **位置**：`src/orb-store.js:101-106`（默认 `scope='project'`）+ `28-35`（`classifyOrb` 里 `if (!projectPath) return 'shared'`）
- **为什么**：`memhub_save` 的 `scope` 不是必填。不传 → `scope='project'`、`projectPath=''` → `classifyOrb` 返回 `shared`
  → 文件写到 **`L:\DSH\shared\memhub\orbs\<月份>\`（公共区根目录，不在任何项目 slug 下）**；
  读回时 `category: shared` → `evergreen: true`，同时 `scope: project` → `tier: working`
  → `isProtected` 两条都命中 → **既污染公共区，又永远不会被淘汰**。
- **实测**：

  ```
  默认写入路径: <tmp>\shared\orbs\2026-11\o_mw90dw33_crgqr5.md
  record.scope = project | classifyOrb = shared
  loadOrbs 读回: [{"scope":"project","category":"shared","evergreen":true}]
  sidecar tier= working evergreen= true 受保护= true
  ```
- **怎么改**：`classifyOrb` 在 `scope==='project' && !projectPath` 时**报错或按 self 处理**，不要默认进公共区；
  `memhub_save` 把 `scope` 标成必填（或显式默认 `self`）。
- **顺带口径错**：`README.md:76` 写「maxOrbs 只算活跃条目；**protected 不占名额**」——代码里
  `overflow = active.length - maxOrbs`，`active` **包含 protected**（`janitor.js:75-77`）。
  实测 `maxOrbs=2`、2 条 working 时，3 条 self 全被淘汰，protected 是结结实实占名额的。
  真机现状：140 条 sidecar、112 条 protected、**只有 28 条可淘汰** → `maxOrbs=300` 永远不会触发；
  即使调小，最多也只能压到 112（capped）。这一条要同时改文档和（或）重新决定 protected 是否占名额
  —— 顺带说明：`ROADMAP.md:102` 的原意是「含 shared/evergreen 那批，否则 53 条永远免疫」，
  和现在代码（evergreen 全豁免）方向相反，需要产品口径拍一次。

### S-7 restore 是「先搬走再拷贝」，任一步失败没有回滚，且 `orbs` 排第一

- **位置**：`src/janitor.js:193-205`（`fs.renameSync(target, aside)` → `fs.cpSync(from, target)`）、`129`（`snapshotDirs` 顺序 `orbs, recall, graph, shared-orbs`）
- **为什么**：循环里对每个组件先 `rename` 成 `*.pre-restore-*` 再拷贝。若 `orbs` 已经搬走、`recall` 的 rename 或后续 `cpSync`
  抛错（Windows 上目录被占用/杀软扫描/磁盘满都会 EBUSY/ENOSPC/EPERM），**没有任何回滚**：
  现场就是 `orbs` 目录消失、只剩 `orbs.pre-restore-*`，看起来「记忆全没了」；
  下一次再 restore 时新安全快照会把这个「orbs 不存在」的现场存成新基线，问题被固化。
- **没实测**（无法在只读审查里稳定制造 EBUSY），但代码路径明确，且 `orbs` 确实排在第一个。
- **怎么改**：先全部 `cpSync` 到 `*.restore-tmp`，全部成功后再逐个 rename 换入（两阶段提交）；
  失败时回滚 tmp 并保留 aside；或在恢复前提醒「先停宿主」。

### S-8 快照可以是「半成品」：cp 失败 → 目录在、manifest 不在，却占一份 keep 名额

- **位置**：`src/janitor.js:140-151`（先 `mkdir`、再循环 `cpSync`、**最后**才写 `manifest.json`）、`156-173`（`listSnapshots` 容忍无 manifest）
- **为什么**：`cpSync` 抛错时目录已存在但无 manifest → `listSnapshots` 显示 `at: '?'`、`copied: []`，
  `restoreSnapshot` 拒绝它（`186` 检查 manifest）→ **它既不能用，又占着 3 份的配额**，会把可用快照挤掉；
  `runJanitor` 因抛错不淘汰（这点是安全的），但用户完全看不到发生了什么（`host.js:416-419` 只是一条 warn）。
- **怎么改**：`manifest.json` 最后写没错，但要 `try { … } catch { rmSync(dir); throw }`；
  `pruneSnapshots` 只统计「有 manifest 的」；`createSnapshot` 失败要写进 `stats.janitor`。

### S-9 `--shared` 与快照时不一致 → restore 把公共区副本盖到另一个共享区

- **位置**：`src/janitor.js:147-151`（manifest 只记 `copied` 名字，不记 `dataRoot` / `sharedRoot` 路径）+ `tools/janitor.mjs:29`（`--shared` 默认 `DEFAULT_SHARED_ROOT`）
- **为什么**：快照里存了 `shared-orbs` 的副本，但**没记录它来自哪个共享区**。CLI 的 `--shared` 默认写死
  `L:\DSH\shared\memhub`，而插件配置里的 `sharedRoot` 可以被改过；用户只要 `--restore` 时 `--shared` 给错（或忘了给，而配置不是默认值），
  就会把快照里的公共区内容**覆盖到另一个共享区的 `orbs`**（`198-203` 先 rename 再 copy，目标不在快照里就整目录替换）。
  这属于「写错盘」，且没有校验、没有提示。
- **怎么改**：manifest 记 `{dataRoot, sharedRoot}`；`restoreSnapshot` 与调用方路径不一致时**拒绝**（或要求 `--force`）；
  CLI 打印「将恢复到 <路径>」并要求确认。

---

## 一般

| # | 位置 | 问题 | 建议 |
|---|---|---|---|
| G-1 | `janitor.js:198-202` | `*.pre-restore-*` 残留**永不清理**。实测两次 restore 后 `dataRoot` 有 `orbs.pre-restore-*`×2、`recall.pre-restore-*`×2，公共区同样残留；不进 `--list`、不进快照配额，只涨不消 | 恢复成功后删掉（或纳入 keep 配额、`--prune-aside`）；至少在 CLI 输出里列出来 |
| G-2 | `janitor.js:211-218` | `appendJsonLine` 用空 `catch` 吞掉所有写日志失败 → 合并做了、`archive.jsonl` 没写，**审计链断而无人知**（口径 #3 要求可追溯） | 失败写进 `result.skipped/logErrors` 并在 CLI/host 打出来 |
| G-3 | `janitor.js:283-288`、`tools/janitor.mjs:104-111` | `skipped` 只上报数量，不上报**原因**（`受保护` / `sidecar 缺失` / 连环合并 / 异常）；`dropped.has(...)` 的跳过根本不计数 | CLI `--apply` 后按原因分组打印；`result.skipped` 带上 reason 已有，只差输出 |
| G-4 | `janitor.js:235-238` | `bumpImportance` 在 orb 路径对不上时**静默返回 false**（只改了 sidecar）；下次 rebuild 用 orb 的 importance 覆盖 sidecar → 合并权重蒸发，且无任何告警 | 返回 `{ok, reason}`；失败时不要让 `merged` 计数 +1，写 `skipped` |
| G-5 | `host.js:438-441` | `stats.janitor` 只有 `evicted`/`snapshot`，没有 `capped`/`overflow`/`skipped`/`merged` → 「上限永远达不到」「有 2 条合并失败」这类事**完全不可见**（注释自己写的是「静默失败要看产物」） | 加 `{overflow, capped, evictable, skipped: n, merged: n}` |
| G-6 | `host.js:400,412-414` | capped 场景（protection 占满上限）每次启动都进 `runJanitor`，然后打 `janitor 淘汰 0 条（上限 1），快照 undefined` —— **误导性日志**（`runJanitor` 在 415 行前就早退，返回的是 `snapshot:null`） | `plan.capped` 时改打 warn：`上限 X 达不到：protected N 条不受淘汰`；`needWork===false` 时别打「淘汰 N 条」 |
| G-7 | `janitor.js:91-103` | 宿主每次启动都算 O(n²) 去重（即使 `merge:false`）。实测 `planJanitor`：140 条 91 ms / 300 条 402 ms / 600 条 1.6 s / **1200 条 6.5 s**，且是**同步阻塞启动** | `planJanitor(options.needDedupe)`，`merge:false` 时跳过；或降到「按标题/长度先分桶」 |
| G-8 | `tools/janitor.mjs:29-33` | CLI **完全不读插件配置**：`--max` 默认 300、阈值默认 0.82，而宿主用 `config.janitor.*`；CLI 的计划源固定是 orb（`35-41`），宿主默认源是 `zzerx` → **dry-run 不能预测宿主行为**；`--apply` 还会写一份 orbs-only 的 `recall-index.jsonl`（`72` + `recall-store.js:189-190`） | CLI 读 profile/插件配置作为默认值；计划源跟随 `recall.source`；输出里标明「计划基于 <源>」 |
| G-9 | `tools/janitor.mjs:72` + `host.js:117-128` | `--apply` 在**快照之前**就 `writeSidecars` 全量重写 sidecar；宿主同样先 `writeSidecars` 再 `runJanitor` → 快照不是严格「维护前」，而是「sidecar 已重写后」 | 把首次 `writeSidecars` 挪到快照之后，或快照里保留独立副本 |
| G-10 | `tools/janitor.mjs:24-27,55-67` | 参数解析把下一个 flag 当值：`node tools/janitor.mjs --restore --shared X` → 试恢复快照 `--shared` 并甩出堆栈（实测）；`--max abc` → `NaN` → 静默回落 300；CLI 没有顶层 `try/catch`，所有异常都是裸栈 | 解析器拒绝「值以 `--` 开头」；非法数字直接报错退出；`main()` 包 try/catch |
| G-11 | `janitor.js:75-83,113` | 上限非整数时算不平：`maxOrbs=2.5` → `overflow=0.5` → `slice(0,0.5)` 截成 `[]` → `evict=0` 且 `capped=true`，永远达不到上限 | `maxOrbs = Math.max(1, Math.floor(...))`；`overflow = Math.max(0, active - maxOrbs)` 取整 |
| G-12 | `janitor.js:295` + `orb-store.js:114` | 合并后 `importance` 可到 9（> `saveOrb` 的 1–5 区间），且借由 `tierOf`（`recall-store.js:76-83`）把 tier 从 event 抬到 mid/long → **顺带改了保护期、衰减与注入优先级**；下次用同 id `memhub_save` 会被夹回 5（权重静默丢） | 合并权重写独立字段（`mergedWeight`），别写回 `importance`；或文档写明这个连带效应 |
| G-13 | `orb-store.js:60-79` + `loadOrbs:151-169` | `archived` 只存在 sidecar，orb frontmatter 不写、`loadOrbs` 不读 → recall 目录被清/换 `DSH_HOME`/restore 到更早快照，**淘汰结果静默复活**（140 条里 44 条 archived 全靠 sidecar） | 属既定口径（ROADMAP 明确「只归档 sidecar」），但要在 README/HANDOFF + restore 输出里写清「archived 只在 sidecar」 |
| G-14 | `host.js:479` | 淘汰只在启动时执行；写入永不拒绝（对）→ **长会话内超限不收敛**，`maxOrbs` 实际语义是「下次启动才生效」 | 文档写明；或 `memhub_save` 后做一次轻量检查（只算计数，不合并） |

---

## 测试：哪些是假绿 / 覆盖不到

现有 85 + 62 条都通过，但没有一条能抓住上面 P0/S-1/S-2/S-3/S-4/S-5。

| 位置 | 现状 | 缺什么 |
|---|---|---|
| `govern-check.mjs:322-328` | 只做**一次** restore，断言 `restored` 含 orbs/recall、两条字段复原 | 连续 restore（P0 就藏在这里）；空 `restored` 应算失败；安全快照是否真的可用 |
| `govern-check.mjs:336-338` | 4 次 `createSnapshot(keep:3)` 断言剩 3 份 | 全是**无 tag** 的 id，碰不到 `localeCompare` 排序问题（S-1）；`pre-restore` 参与后谁被删 |
| `govern-check.mjs:330-334` | 标题「短文本不按相似度合并」，实际是 `minChars=60` 在起作用（`janitor.js:54`），阈值给的是 0.5 | 相似度判据本身没验；三条应加：`textOf` 300 字截断（S-3）、`scope:'global'` 的 evergreen（S-4）、`pinned` orb（S-5） |
| `govern-check.mjs:260-269` | 容量/protected/capped 都覆盖了 | 没有「keep 被同轮淘汰」（S-2）；没有 `maxOrbs` 非整数（G-11） |
| `govern-check.mjs:67` | 只测 `mergeSidecars` 纯函数的 archived 保留 | 没有「janitor 淘汰 → 重建 → 仍 archived」的端到端（host 路径只有 sandbox 一次） |
| `sandbox.mjs:250-260` | 断言 `memories` 不变、`evicted === janBefore - janMax`、快照/日志存在 | 没断言**淘汰的正是最低权重+最老**（实测恰好是 `sx_a/sx_b`，但测试只看 `length>=1`）；没有**二次 apply 不重复淘汰**（可重入）；没有 capped 时**不打快照**；`janSelfCheck.janitor.evicted === janBefore - janMax` 这条在 protected 占名额时会脆 |
| 全部 | 没有 CLI 的自动化用例 | `--restore latest` 的选择逻辑（S-1）、`--shared` 不匹配（S-9）、`--restore` 空参/flag 混用（G-10）、dry-run 与 apply 计划一致性（手动实测一致，但没固化） |
| `sandbox.mjs:96-99` | `memhub_save` 用例**总是显式传 `scope: 'global'`** | 不传 scope 的默认落点（S-6）没有任何断言 |

另外：`tests/sandbox.mjs:19` 读真实 `~/.dsh/storages/memory`（只读），换机器/无 zzerx 库时会静默变成空库跑过 —— 建议加一条「zzerx 库为空则 skip 或用 fixture」的分支，否则 CI 上是假绿。

---

## 查过、确认没问题的地方（省下重复审查）

1. **写入永不拒绝**：`writeOrb`（`orb-store.js:82-88`）无容量检查，任何写都会成功 → 口径 #1 前半条成立。
2. **淘汰只动 sidecar**：`runJanitor` 只调 `applyArchive`（`janitor.js:268,299`），orb 完全不碰；`sandbox:251` 也断言了「orb 数不变」。
3. **淘汰排序**：`weightOf = importance × decay`（31-35），`sort` 升序 + `updatedAt` 升序（79-82）＝「最低权重 + 最老」；实测三次重启淘汰的正是 `z_4/z_5`（权重同、最老）。
4. **protected 判定**：`archived / evergreen / pinned / core / working` 五类齐全，且 `!ACTIVE()`（`28`）额外兜住 `status==='archived'` ─ 单论「实现和 brief 一致」，这段是对的（问题在数据来源，见 S-4/S-5/S-6）。
5. **淘汰跨重启稳定 / 启动可重入**：`mergeSidecars`（`recall-store.js:166-179`）保留 `archived/recall/tierOverride`，三次 `apply` 只淘汰一次、快照不增长（实测 `重启#1 evicted:2` → `#2/#3 evicted:0`，`snapshots=1`）。
6. **快照失败不淘汰**：`createSnapshot` 抛错 → `runJanitor` 抛出 → `runStartupJanitor` 的 catch（`host.js:416-419`）包住，不会「没备份就动手」。
7. **快照覆盖范围**：`orbs / recall / graph / 公共区 orbs` 四项正确（`janitor.js:128-132`），`keep` 在正常路径（不带 tag）下生效（实测 3 份）。
8. **跨盘 rename 不是风险**：`.pre-restore-*` 与 target 同父目录（同卷），快照副本走 `cpSync`（跨卷可拷贝）——这点不用改。
9. **id 注入**：`applyArchive`/`recordRecall` 有 `SAFE_ID`（`govern.js:45-49`）拦住路径穿越；`restoreSnapshot` 的 `id` **没有**同类校验（只查 `manifest.json` 存在），属低危只读面，见 G-表外的备注。
10. **不打常驻工具**：`sandbox:261-262` 断言没有 `memhub_janitor` 工具，schema 预算没被突破（3352 ≤ 3400）。
11. **合并链**：`dropped` 集合（`janitor.js:288`）避免 A→B、B→C 连环归档；缺点只是静默跳过（G-3）。
12. **CLI dry-run 与 apply 同源**：两者都走同一个 `loadSidecars()` + `runJanitor(apply:false/true)`，实测同一条命令两次输出的 plan 完全一致；dry-run 确实不写盘（`applied:false`，无新快照）。

---

## 修复顺序建议

1. **P0-1（restore 的 prune + 空恢复校验）** —— 这是唯一会「让人以为回滚了」的缺陷，且现在就能被 CLI 触发。
2. **S-1（latest 排序）、S-9（`--shared` 校验）** —— 同一个回滚入口，一起改。
3. **S-2（淘汰/合并互斥）、S-3（300 字 + 正文合并）** —— 治理正确性，改完 `archive.jsonl` 才可信。
4. **S-4 / S-5 / S-6 + README:76** —— 口径问题，需要先拍一次产品口径：「evergreen 到底参不参加淘汰」「protected 占不占 maxOrbs 名额」「不传 scope 写哪儿」。
5. **S-7 / S-8** —— 恢复的两阶段提交与半成品快照清理。
6. **G-2/G-3/G-5/G-6** —— 把「静默」变成「可见」（日志、skipped、stats），这几条成本最低、收益最高。
7. **测试补齐 8 条**（P0 连续 restore、latest 排序、keep 被淘汰、300 字截断、global evergreen、pinned orb、capped 不打快照、二次 apply 可重入）。

---

## 复现脚本（可直接跑，全部在临时目录）

写到 `%TEMP%\rev-janitor.mjs`（与项目同级之外的任意位置，用绝对路径 import）即可：

```js
// 1) P0：restore 会 prune 掉自己要恢复的快照
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { createSnapshot, listSnapshots, restoreSnapshot } from 'file:///L:/DSH/DeepSeek/projects/dsh-memhub/src/janitor.js'
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-b4-')); const d = path.join(tmp, 'd')
fs.mkdirSync(path.join(d, 'orbs'), { recursive: true }); fs.writeFileSync(path.join(d, 'orbs', 'x.md'), 'v1')
const s = createSnapshot(d, null, { now: Date.now() })
for (let i = 0; i < 5; i += 1) {
  fs.writeFileSync(path.join(d, 'orbs', 'x.md'), `v-before-${i}`)
  try { const r = restoreSnapshot(d, null, s.id, { now: Date.now() + i * 1000 })
        console.log(`#${i+1}`, JSON.stringify(r.restored), fs.readFileSync(path.join(d, 'orbs','x.md'),'utf8')) }
  catch (e) { console.log(`#${i+1} 抛错`, String(e)); break }
}
```

```js
// 2) S-2：keep 被同轮淘汰
import { saveOrb, loadOrbs, orbPathFor } from '…/src/orb-store.js'
import { buildSidecars, writeSidecars, readSidecarMap } from '…/src/recall-store.js'
import { planJanitor, runJanitor } from '…/src/janitor.js'
const body = '同一件事的完整正文，用来测重复度；这段故意写长一点，超过六十个字符…'.repeat(2)
saveOrb({ id:'ka', title:'同一件事', content: body, scope:'self', kind:'event', importance:1, updatedAt: Date.now()-5000 }, home, shared)
saveOrb({ id:'kb', title:'同一件事', content: body, scope:'self', kind:'event', importance:1, updatedAt: Date.now() }, home, shared)
saveOrb({ id:'kc', title:'别的', content:'完全不同的一条内容，占住上限。', scope:'self', kind:'event', importance:9, updatedAt: Date.now() }, home, shared)
const sc = buildSidecars(loadOrbs(home, shared).entries, {}, Date.now()); writeSidecars(sidecarDir, sc)
console.log(planJanitor(sc, { maxOrbs: 1 }).evict.map(e => e.id))   // ['ka','kb']
runJanitor({ dataRoot: home, sharedRoot: shared, sidecarDir, sidecars: sc, options:{maxOrbs:1}, apply:true, merge:true, orbPathFor: r => orbPathFor(r, home, shared) })
console.log([...readSidecarMap(sidecarDir).values()].map(s => `${s.id}:${s.archived}`))  // ka:true kb:true（archive.jsonl 却说 keep=kb）
```

3) S-3（300 字截断）、S-6（默认落公共区）、S-4（global 不豁免）见正文「实测」段，都是十行内可复现的纯函数调用。

---

## 备注（未实测，供判断）

- **restore 时宿主正在运行**：CLI 无法让宿主失效缓存。`source: 'memhub'` 靠 `orbs` 目录 mtime 触发重建（`host.js:107-113`），restore 后能自愈；
  `source: 'zzerx'` 的签名是 zzerx memories 的 mtime，**restore 不会改变它** → 该会话注入仍是旧的 sidecar，直到 zzerx 有变动或重启。`applyArchive` 用非原子 `writeFileSync`（`govern.js:54`），并发下丢标志的风险仍在（不是本轮引入）。
- 真机侧只读事实：`~/.dsh/memhub/recall` 140 个 sidecar（archived 44、protected 112、可淘汰 28，byTier `event 19 / mid 28 / long 53 / working 40`），`self-check.json` **无 `janitor` 字段**、`snapshots/` 不存在 → janitor 尚未在真机跑过，P0 也还没有回滚点被吃掉。
## 复审（第二轮）

> 复审人：同一盲审员（仍只读；源码/测试未改）。方法：重跑四套测试（31/27/**99**/**62** 全绿）+
> 用**第一轮的原复现脚本**逐条重放（P0 6 次 restore、S-1 混合 tag、S-2、S-3、S-4、S-6、S-9、两阶段 restore 的
> 失败注入：`fs.renameSync`/`fs.cpSync` 打桩模拟 EBUSY/ENOSPC）+ 走真实 host `apply()` 与真实 CLI（临时 `DSH_HOME`）。
> 全程临时目录，未碰 `~/.dsh/memhub`、`L:\DSH\shared\memhub`。

### 一、修住了（实测通过）

| 项 | 证据 |
|---|---|
| **P0** | 6 次 restore 同一基线：`#1..#6` 全部 `restored=["orbs"]` 且内容 `v1`；基线快照存活、`snapshots=5` 稳定、`*.pre-restore-*` 只留 1 份、无 `restore-tmp` 残留（`janitor.js:227-236` protect + `274-281` 二次校验 + `293` 空恢复抛错） |
| **S-1** | 我自造「普通1 → pre-restore → 普通2（更新）」：列表按 `at` 升序 `08:46:51 < 08:46:52 < 08:46:53`，`latestSnapshot` 命中普通2 ✓（`205-219` 按 at 排序、`221-225` 过滤 pre-restore） |
| **S-3** | 原 517/516 字、前 300 字相同的对：**0 对**；全文相似度 0.582，旧口径 1.000（`41` TEXT_OF 全文、`81-82` 长度差 ≤30%） |
| **S-4** | `scope:'global'` → `evergreen=true`、`isProtected=true`（`recall-store.js:138`） |
| **S-5** | `pinned:true` 写入 → `loadOrbs` 读回 true → `tierOf` 给 core → 受保护（`orb-store.js:72/165/120/196`） |
| **S-6** | 不传 scope → `scope=project 需要 projectPath…`（`orb-store.js:112`），不再落公共区 |
| **S-8** | 注入「安全快照 cp 失败」→ 干净抛出、无半成品目录、orbs 完好、快照数不变（`196-200` + `216`） |
| **S-9** | 公共区不一致 → 拒绝并给出两条路径；`--force` 后 `restored=["shared-orbs"]` 覆盖成功（`264-273`） |
| G-2/3/4/5/6/7/11 | `logErrors`/`skipped` 带原因 + CLI 分组（`tools/janitor.mjs:140-147`）；`stats.janitor` 8 个字段齐全（`host.js:443-455`）；capped warn（`399-402`）；启动去重关闭后启动耗时 **29 ms → 6 ms**；`maxOrbs 2.5 → maxOrbs 2 / overflow 整数`；`--max abc` **exit 2** 且提示清楚 |

启动可重入仍成立：三次 `apply()` 只在第一次淘汰 4 条，之后 `overflow=0`，`snapshots=1`。

### 二、部分修住（有残留，建议再补一刀）

**R-1（严重残留）S-7 的回滚在「同一组件第二个 rename 失败」时仍会丢该组件**
`src/janitor.js:299-303`：`rename(target→aside)` 成功后，`rename(tmp→target)` 若抛错，该 item **还没进 `done`**，
回滚循环（`308-315`）只处理 `done` 里的，于是这个组件既不在原位、也没回滚。
实测（打桩 `renameSync` 让 recall 换入时 EBUSY）：

```
[S-7] orbs/x.md = V2（orbs 回滚成功 ✓） ｜ recall 目录在? false
[S-7] 顶层 = ["orbs","recall.pre-restore-20261109-084657-nccx","snapshots"]
```

叠加 G-13（archived 只在 sidecar）：宿主下次重建会 `mkdir` 空 `recall`（`recall-store.js:183-188`）并按新集合写 sidecar →
**真机 44 条归档会全部复活**（它们只靠 sidecar 记住）。修法很小：把 item 先 `done.push({...item, aside})` 再换入 tmp，
回滚时就能把它换回来。

**R-2（一般）phase A（拷 tmp）失败残留 `*.restore-tmp-*`**
`janitor.js:286-292` 在 try 之外。实测注入 ENOSPC 后顶层留下 `orbs.restore-tmp-20261109-084719-aimn`，数据完好但目录永久残留
（`loadOrbs`/`createSnapshot` 都不会读它，纯占盘）。用 `try { …拷… } catch { plan.forEach(rm tmp); throw }` 收掉。

**R-3（严重·新引入）S-2 的 keepIds 把「最低权重+最老」这条口径打破了**
`src/janitor.js:120-121`：keep 被排除出淘汰候选，但 `overflow` 仍按**含 keep 的 active 数**算（`122`）→ 名额压力转嫁给**权重更高**的条目。
实测（ka=kb 重复 w1、kc 独有 w5、maxOrbs=1）：

```
evict = ka(w1), kc(w5)   ← kc 权重最高却被淘汰
merged = 0 | skipped = [{"id":"ka","reason":"同轮被淘汰"}]
最终 archived: ka:true kb:false kc:true ｜ kb 的 importance = 1（权重没转移）
```

即：低权重 keep 占住最后一格，权重 5 的独有条目被归档，而「合并」因为 drop 先被淘汰而没执行。
新测试 `govern-check.mjs:390-391` 恰好把这个结果当正确固化了（只断言 ka 归档、kb 未归档、merged=0），没有断言 kc 的去留。
建议：**先合并、再算淘汰**（对合并后的集合算 overflow），或把 keepIds 保护限定为「keep 权重 ≥ 被判淘汰的最高权重」。

**R-4（一般）restore 的 keep 忽略配置**：`janitor.js:277` 固定 `SNAPSHOT_KEEP + 2`，`janitor.snapshotKeep` 不生效 →
恢复后快照数最多 5 份（实测 5），下次普通快照按配置回到 3，CLI 刚打印的 `pre-restore-xxx`（"不满意再 --restore"）可能已被清掉。
建议：`keep: Math.max(Number(options.snapshotKeep) || SNAPSHOT_KEEP, 2) + 1`，或把 CLI 提示里的 id 也 protect。

**R-5（一般）`--restore` 后面跟别的 flag 会静默变成 `latest`**：`tools/janitor.mjs:79`（现在至少不会把 flag 当 id，但
`--restore --force` 会「force + latest」直接盖公共区）。建议显式给 `--restore` 时必须写 `latest` 或 id。

**R-6（一般）`logErrors` 重复计数**：`janitor.js:410-412/458-460` 每条失败都 push 一次 → 4 条淘汰写日志失败会得到
`["janitor-log.jsonl"×4]`，CLI 打印 `a / a / a / a`。去重一下即可。

**R-7（一般）坏快照目录仍然不可见、不可清**：`listSnapshots` 过滤掉无 manifest 的目录（`216`），硬崩溃（断电）留下的
半目录既不进 `--list`、也不被 `pruneSnapshots` 看见（S-8 的 catch 只覆盖可捕获异常）。建议 prune 时顺带 `rmSync` 无 manifest 目录。

### 三、新引入 / 未修的连带问题

1. **（一般·可用性）`saveOrb` 未给 scope 时直接抛错**：`orb-store.js:101-112` 仍把默认值设为 `project`，然后再校验 → `memhub_save {title, content}` 与**覆盖已有 self orb（只给 id）**都变成失败：

   ```
   [memhub_save] 只给 title+content（最常见） → 写入失败：scope=project 需要 projectPath…
   [memhub_save] 覆盖已有 self orb（不带 scope） → 写入失败：scope=project 需要 projectPath…
   ```

   工具没炸（`tools-recall.js:157-166` 的 try/catch 兜住了，错误文案也可操作），但「最常见的写法」从「能写（写错区）」变成「写不进去」。
   建议：**未给 scope 时默认 `self`**，只在显式 `scope:'project'` 且无 `projectPath` 时抛错；schema 里把默认值写出来。
   `tools/archive-to-memory.mjs` 的 project root 带 `projectPath`，不受影响（已核）。

2. **（一般）G-12 未修，且现在多了个可见后果**：合并仍把 `min(9, …)` 写回 `importance:`（`438`），tier 会被连带抬高
   （实测 `importance 3 → event`，`4.9 → mid`）。当 keep 的 importance 已是 9 时，`next === text` → 返回
   **「orb 里没有 importance 字段」**（`359`，文案误报）并 `skipped` → `merged=0`，重复对永远清不掉。实测：

   ```
   [importance=9] merged = 0 | skipped = [{"id":"d9","reason":"权重写回失败：orb 里没有 importance 字段"}]
   ```

   建议：权重写独立字段（或在 9 饱和时仍然归档 drop，只是不 bump），并把 reason 改成「权重未变化」。

3. **（一般）`similarity.bestMatch` 仍是旧的「前 300 字」默认**（`similarity.js:41`），只是当前无调用方 → 要么删，要么与 `planDedupe` 对齐（避免以后被人用回旧坑）。

### 四、13 条新测试有没有假绿

- **「连续 5 次 restore」（`govern-check.mjs:349-362`）不是假绿**：老代码在第 4 次会 `restored=[]`，这条断言 `restored > 0 && text === 'v1'` 会挂。✓
- **「latest」（`:363`）是弱覆盖**：此时库里只剩 1 份普通快照 + N 份 pre-restore，只能证明「过滤掉了 pre-restore」，**证明不了「多个普通快照时取最新」**。我自造的「普通1 → pre-restore → 普通2」场景 PASS，建议把这条补进测试。
- **「修剪按时间留最新三份」（`:340-344`）不是回归测试**：用的是无 tag 的 id，id 字典序 == 时间序，**老代码同样通过**；真正要锁的是「tag 混入 + 创建时间乱序」。
- **「S-2 keep 不会被连带归档」（`:390-391`）在方向上是对的**（老代码会挂），但**固化了 R-3 的倒挂结果**：没断言 `kc`（最高权重）不该被淘汰，也没断言「权重转移发生了」。
- 其余 9 条（S-3/S-4/S-5/S-6/S-9/capped×2/G-11/`plan.evict` 不含 kb）我逐条核过，都不是假绿，且断言点与修复点对得上。
- 未覆盖仍是：两阶段 restore 的失败注入（R-1/R-2）、`--restore latest` 的 CLI 层、`memhub_save` 不传 scope 的工具层、`importance` 饱和后的二次合并（二-2）。

### 五、G 系「文档写明即可」的确认

| 项 | 结论 |
|---|---|
| G-8 CLI 不读配置 | **只写了一半**：`tools/janitor.mjs:18` 已写「计划基于本地 orb 库；宿主跑旧源时 CLI 数字不代表宿主行为」；但**没写「`--max`/`--threshold` 的默认值不读 `config.janitor.*`」**——建议在 CLI 头注释或 CONFIG-MAP 补一句 |
| G-12 importance 可到 9 | **没写**，而且见三-2（饱和后误报 + 清不掉重复对）；要么修，要么在 README/CONFIG-MAP 写清「合并抬权重会改 tier、上限 9」 |
| G-13 archived 只在 sidecar | **已写够**：`README.md:103`「archived 只写 sidecar，orb 永不删」+ CLI restore 后有提醒（`tools/janitor.mjs:91`） |
| G-14 只启动时治理 | **已写够**：`README.md:75`「启动时超容量就淘汰」+ `CONFIG-MAP.md:26` |

### 六、复审结论

- **P0 / S-1 / S-3 / S-4 / S-5 / S-6 / S-8 / S-9 与 G-2/3/4/5/6/7/11：修住了**（有实测）。
- **S-7 还剩一个失败窗口**（R-1，严重但窄）；**S-2 的原症状修住了、但引入了 R-3 的淘汰优先级倒挂**（严重，且被测试固化）。
- **新引入两条要处理**：未给 scope 的写入变成拒绝（R 三-1）、importance 饱和后的「静默 skip + 误报原因」（三-2）。
- 建议下一轮只做四件事：R-1（回滚补当前 item）、R-3（先合并再淘汰）、三-1（默认 scope=self）、R-4+R-6+R-7（小清理），并补 3 条测试（多普通快照取最新、失败注入回滚、`memhub_save` 不传 scope）。
