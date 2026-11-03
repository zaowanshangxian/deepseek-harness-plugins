# dsh-memhub 二次盲审（第 8–9 期 + 上次 4 条修复复核）

> 审法：只读 `src/*`、`lib/client.js`、`tools/*`、`tests/*`、README/EVIDENCE/GAP/ARCHITECTURE/CHANGELOG，跑四套测试 + 只读 dry-run（check / recall-check / govern-check / sandbox、`tools/index.mjs`、migrate dry-run、toggle dry-run），另用临时目录复现一条重建路径。不读项目外设计文档，不假设作者意图。
> 复跑实测：check **31/31**（README:28 写 28）、recall 17/17、govern **58/58**（README:30 写 56）、sandbox 34/34；工具 schema **2321 字符**（≤2400 ✓）；技能 42 / desc 676；zzerx 记忆 **100 条**；migrate dry-run → shared 53 / self 28 / project 19（文档写 98 / 53-27-18）。行号以 08:36 版文件为准。

## 严重（会丢数据/会崩/违反硬规矩）

1. **星图「改 tier」改完立刻被抹掉** ｜ `src/host.js:226-236,308-317` + `src/recall-store.js:130-143`
   现象：`setMemoryTier` 写 tier 后 `caches.recall.invalidate()`；下次 `createRecallCache.get()` 重建 → `buildSidecars` 按 `tierOf` 重算，`writeSidecars` 只合并 `recall/archived/status`，**不合并 tier**。临时目录实测：手改 core → 重建后回到 event。
   后果：README:15、GAP.md:18 声称的「点选改主次」静默失效，用户操作被无提示丢弃——与上次 S1「派生数据被静默抹掉」同一类。
   依据：硬规矩「防数据丢失」；`writeSidecars` 的注释只承诺保留 recall/archived（:129），把 tier 当纯派生，但面板已允许人改。
   建议：合并 `old.tier`（或加 `tierOverride`，`tierOf` 优先读它）；补集成测试「改 tier → 重建 → tier 仍在」。

2. **上次 S3 的修复漏掉风险最大的写者：批量开关脚本** ｜ `tools/toggle-model-invocation.mjs:28-38,64-66,87-88`
   现象：脚本仍自带一套 `flagPresent`/`addFlag`（不认 `TRUE`/引号，`src/frontmatter.js:39-41` 认），`--apply` 是 `copyFileSync(bak)` + 直接 `writeFileSync`（非原子、单代 `.bak-toggle`，每次覆盖）；`--restore` 拿备份盖回当前文件并删掉唯一备份，会丢 `--apply` 之后的用户编辑。
   依据：AGENTS「最小改动：改到所有调用方」「系统改动先问再做」；CHANGELOG.md:22「frontmatter 统一到 frontmatter.js」与事实不符（文档真实性）。
   建议：脚本改为 import `frontmatter.js` + `writeAtomic`/`backupWithStamp`；`--restore` 前先备份现状。实测 dry-run 会写 42 个文件，一次性脏写风险面最大。

3. **owner 门只守工具，面板 HTTP 写接口全裸** ｜ `src/host.js:300-333`、`src/tooling.js:35-41`
   现象：`isOwner` 仅在工具层调用；`/api/skill/toggle`、`/api/memory/archive`、`/api/memory/tier`、`/api/persona/evolve` 都不检查身份。`ownerOnly: true` 时，任何本机进程/子代理 POST 即可改技能开关、归档记忆、演化人格。
   依据：硬规矩「信任边界的校验不可砍」；上次 S4 只修到工具面。
   建议：四个写端点统一过 `isOwner`（或加一次性 token）；补一条「ownerOnly 下 POST 被拒」的沙箱用例。

## 建议（值得改）

1. **frontmatter 的 flag 判定仍按全文匹配** ｜ `src/frontmatter.js:39-41,44-52,55-57`
   `hasFlag`/`removeFlag` 用 `/m` 在整篇文里找，正文里以该串开头的行会被误判/被删；`addFlag` 却只看 frontmatter，三条不对称。建议先 `parseFrontmatter` 再只在头部操作。

2. **切 `recall.source=memhub` 失败时静默变空** ｜ `src/host.js:96-107`
   orbs 目录缺失或迁移未做时 `loadOrbs` 返回 `[]`，无回退、无告警（只有 self-check 日志 `memories:0`）；`sourceRoot` 对 memhub 分支无效。建议 0 条时回退 zzerx 并 warn。

3. **缓存签名一好一坏** ｜ `src/host.js:71-75,96-102`
   技能缓存每次 `get()` 都全量 `loadVault`（读 42 个文件），缓存等于没缓存；记忆 memhub 分支用 orbs **目录** mtime，改 orb 正文不失效（与上次建议 3 同类）。建议统一用各文件 mtime 签名。

4. **迁移不搬 sidecar 状态，切源会「复活」已归档记忆** ｜ `src/orb-store.js:131-146`、`tools/migrate-memory.mjs:48-50`、`src/graph.js:11,32`
   orb id 前缀 `m_`，旧 sidecar 的 recall/archived/tier 都不迁 → 切源后已归档记忆重新注入、召回计数归零、core 判定回落；且星图实体/边仍读 zzerx，切源后 `m_*` 与 zzerx id 对不上，边全被丢。建议迁移时把旧 sidecar 复制到新 id；`graph` 按 `source` 分派。

5. **id 直接拼路径（穿越面）** ｜ `src/govern.js:45`、`src/host.js:228`、`src/tools-recall.js:99`
   `args.id` / body.id 未校验就 `path.join(dir, id+'.json')`；`"../../x"` 可读写 sidecar 目录外的同名 JSON（需目标已存在）。建议 `/^[A-Za-z0-9_-]+$/` + 必须在当前 sidecar 列表里。

6. **sidecar 写仍非原子、无备份，计数还会陈旧** ｜ `src/recall-store.js:144-148`、`src/govern.js:49,59`
   半写文件会被 `readSidecarMap` 跳过 → recall/archived 丢；`recordRecall` 之后不失效缓存，`memhub_open` 打开后的计数在预算/星图里仍是旧值。建议 `writeAtomic` + 打开后 invalidate。

7. **工作区判断用 `process.cwd()`** ｜ `src/host.js:147,180`（含 `recall-scheduler` 的 workspace 入参）
   Host 是单进程，cwd 不是会话工作区（GUI 下更可能是 profile 目录）；`/DSH[\\/]work/i` 还会误中 `DSH\work-old`。建议从会话上下文取 workspace；拿不到就别把它当工作区。

8. **自我叙述文件名的字典序会排错** ｜ `src/selfnote.js:61`
   `getTime()%86400000` 未补零到固定宽度：同一天 `28800000`（8:00）排到 `3600000`（1:00）前面 → 「最新/最旧」和归档对象都错；同毫秒两次写同名直接覆盖且无备份。建议固定 8 位 `HHMMSSmmm`。

9. **902 参数行被切在半路** ｜ `src/affect.js:113-117`、`src/persona.js:141-149`
   实测 92 字符块结尾是「表情密度 0.」——边界行已保住（S2 修对），但参数行建议按 `key=value` 整段丢弃；904 实测 119/120，加一个字符的边界就整行丢掉，边界规则（不替哥哥做决定）会消失。

10. **文档数字和归属普遍漂（违反文档真实性）** ｜ README:28,30,100-112；EVIDENCE.md:30,33；GAP.md:4,21,22；ARCHITECTURE.md 标题,:55,:77,:104；cordis.patch.yml:3
    check 28→31、govern 56→58、「41 个可见」→42、迁移 98/53-27-18→100/53-28-19；README 的「合计 480 字符 ≈310 tokens」没算 904（119）+905（实际两行≈90）；ARCHITECTURE 仍写「第 1–7 期 / 4 处注入 / 25 条别名（实 18）/ .bak-toggle」；GAP.md:22 指向不存在的 `PLAN.md`。建议数字一律改成命令或删快照。

11. **测试盲区** ｜ `tests/sandbox.mjs:36-43`
    面板 API 零测试（mockCtx 没有 `webServer`，`registerPanelApi` 被 catch 静默跳过）；host 工程模式判断、迁移失败路径、`--restore` 无测试；sidecar 集成测试只覆盖 recall/archived，没覆盖 tier——正好漏掉严重 1。

## 可选（可以不改）

1. 死代码/未接线：`listNotes`（selfnote.js:40）、`staleLessons`/`graduationProposals`（只测试调，没接面板）、`readSidecar`（只测试）；`CATEGORY_BY_NAME` 42 条硬编码（indexer.js:101-114）含不存在的 `browser-skill`，新技能直接掉回 group。
2. INDEX.md 只在启动时生成（host.js:369-376），会话内不重算也没有重建入口，905 每轮指向可能过期的文件。
3. `package.json:32-34` 的 `client.inject: []` 与 `lib/client.js:330` 的 `exports.inject=['slots']` 仍两处不一致；scripts 仍缺 recall/govern/sandbox。
4. `writeSidecars`/`recall-index.mjs` 每次全量重写 100 个 sidecar，面板刷新就碰盘；可按 mtime 跳过未变条目。

## 整体判断：需修改后交付

- 上次 4 条复核：**S1 部分修对**——recall/archived 合并了（host.js:108-117、recall-store.js:129-150），但没合并 tier，反而让「改主次」永远不生效；**S2 修对**（逐行预算，实测边界整行保留）；**S3 只修了工具与面板 toggle**，批量脚本仍是老路；**S4 只修了工具面**，HTTP 面仍裸。
- 注入预算承诺基本守住：90000 48 / 901 249≤280 / 902 92 / 903 ≤60 / 904 119≤120 / tool schema 2321≤2400；但 README 的「合计 480」漏了 904+905。
- 数据安全方向对（迁移跳过已存在文件不覆盖、persona 写前备份、tier 端点备份+原子写），但用户改过的状态（tier、切源后的 archived/recall）仍会被重算路径抹掉。
- 建议顺序：先修严重 1–3 + 文档数字，再按 GAP 走安装与真机冒烟；`--apply` 迁移在严重 4 修好前别做。本次没检查：真实 DSH 运行时契约（context 接不接受函数、webServer/slots 形状）、浏览器实渲染、Windows 上 `renameSync` 覆盖的实际行为。
