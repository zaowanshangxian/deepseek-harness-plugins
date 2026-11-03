# dsh-memhub 盲审（第 1–7 期）

> 审法：只读 `src/*.js`、`lib/client.js`、`tools/*.mjs`、`tests/*.mjs`、README/EVIDENCE + 跑四套 `node tests/*.mjs`（纯读）。不读项目外设计文档，不假设作者意图。
> 复跑实测：check 19/19、recall 17/17、govern 35/35、sandbox 25/25；技能 42 个（hidden=0、desc 676 字符）/ 记忆 98 条（long 67 / event 31 / core 0）。
> 时点：README/EVIDENCE/MAP/CHANGELOG 在 2026-11-03 06:53 被重写过，本审以当前 108 行 README 为准；`src/*.js` 自 06:52 起未变，行号有效。

## 严重（会丢数据/会崩/违反硬规矩）

1. **sidecar 每次重建都会清掉召回计数与归档标记**（host.js:90；recall-store.js:82,109-116；govern.js:41-57）
   现象：host 调 `buildSidecars(entries)` 不传 usage，`recall` 永远回落 `{count:0,last:null}`；`writeSidecars` 又把整个目录覆盖。`recordRecall` / `applyArchive` 写回 sidecar 的 count/archived，在下一次 `memories` 目录 mtime 变化（zzerx 一写记忆就变）后被静默抹掉。
   依据：全局规矩「永远不许砍防数据丢失的错误处理」；govern.js:4 自称「归档可恢复」，恢复目标会被覆盖回原值。
   后果：README:11「双通道衰减/归档/恢复」和第 2 期 `recall≥3 → core` 永远不成立（实测 core=0），派生数据在无提示下丢失。
   建议：重建前用 `readSidecar(id)` 合并 `recall/archived`（或把台账单独存 `usage.json`）；补集成测试「recordRecall → 缓存重建 → 计数仍在」。
   （govern-check.mjs:36-41 只单测了 recordRecall/applyArchive，恰好绕开了这条路径。）

2. **情感注入按整块 slice 92 字符，会把边界规则切一半并改义**（affect.js:93-101，切在 100）
   实测：`renderAffectBlock` 输出正好 92 字符，结尾是「约束：正经问题不用阴阳怪气；不替哥哥做」——原文「不替哥哥做决定」被截成「不替哥哥做」（意思相反）。
   依据：affect.js:5 自己写「边界规则不可被情绪覆盖」；全局规矩「永远不许砍安全的错误处理 / 信任边界」；预算该压参数，不该切规则。
   建议：按行预算（逐行 `if (used + line.length > budget) break`），边界行优先、参数行可省；绝不对整段做 `slice`。

3. **技能 frontmatter 写回：非原子 + 单代备份 + 模型可无人确认触发**（host.js:187-205；tools-skill.js:88-120；tools/toggle-model-invocation.mjs:62-68）
   现象：`toggleSkill` 直接 `writeFileSync(entry.file)`，中途崩溃即半截文件；`.bak-toggle` 每次覆盖只留一代。`skill_register` 覆盖已有 SKILL.md 只留同名备份、重写整篇正文（tools-skill.js:105-115），与 README:19「不改 SKILL.md 正文」的非目标相抵；描述里的「必须人工确认」只是一句提示文本。`--restore` 用备份整文件覆盖当前文件，会丢掉 `--apply` 之后的用户编辑，并删掉唯一备份。
   依据：AGENTS.md 硬性约束「涉及系统改动先问再做」；README:19 自述边界。
   建议：写临时文件 + `rename`；备份带时间戳保留 N 代；`skill_register` 只允许新建或要求显式 confirm；面板 toggle 加配置默认关。

4. **owner 门只守「读」，写类工具全裸**（tooling.js:35-41；tools-recall.js:23,55）
   现象：`isOwner` 只用在 `memhub_open` / `memhub_raw`；`skill_register`、`lesson_save`、`self_note_write`、`affect_pin`、`skill_outcome` 在任何会话（群聊 / 子代理）都能写用户技能库和中枢数据。
   依据：全局规矩「信任边界的校验不可砍」；读侧做了门、写侧没做，风险方向反了。
   建议：把 `isOwner` 提到注册层统一 gate 写工具，失败文案与现有读侧一致。

## 建议（值得改）

1. **文档里的数字已经漂了（违反 文档真实性）**（README:9,107；EVIDENCE:8-10；package.json:6；locale/zh.json:4）
   README:9 写「41 个技能描述（631 字符）」、:107「41 个可见」，实测 42 个 / 676 字符 / hidden=0；EVIDENCE:8-10 的 41/631/247019 与现状 42/676/248894 不符；package.json:6 与 locale 还停在「第 1 期」。
   依据：AGENTS.md「写『X 个 / 已启用 / 全部』前先跑检查，别靠记性」。
   建议：这些数字改成跑命令得出（或干脆删数字只给命令），核对一次 `node tools/index.mjs` 再交付。

2. **16 个工具常驻 schema 比省下的技能描述还大，注入账没算这笔**（README:94-102）
   实测（mock 注册后统计）：16 工具「名 + 描述 + 参数」合计 **2762 字符 ≈1.8k tokens**；省掉的技能描述按 README 口径 631 字符 ≈410 tokens。README 的「合计 ≈480 字符 ≈310 tokens」只算 systemPrompt 的四处注入，没算工具定义。
   建议：验收口径改成「常驻 = 提示 + 工具 schema」一起量；合并/精简低频工具（lesson_graduate、memhub_budget、skill_outcome）或把描述压成一句。

3. **缓存键太粗：改文件不会失效**（host.js:58-76,84）
   技能索引只看 `vault` 目录 mtime、记忆只看 `memories` 目录 mtime。实测 Windows 上修改 `SKILL.md` 内容不会改目录 mtime → 描述 / hidden / cost 陈旧（`skill_load` 正文是现读的，所以只有候选卡与面板错）。
   建议：用各文件 `max(mtimeMs)` 做键，或缓存里存签名。

4. **情感规则层从未接线（为以后造的功能）**（affect.js:50-90；tools-learn.js:7）
   `updateFromEvent` / `blend` 无任何调用方，也没有事件入口工具；默认 intensity=0，`renderAffectBlock` 一直返回 `''`。第 5 期实际只有 `affect_pin` 手动改。
   建议：要么接一个事件写入点并加测试，要么删掉 `blend` 与 `updateFromEvent`，真做时再加。

5. **配置项与实现不一致 / 死配置**（README:55,63-66；host.js:39-40,51-54；const.js:35）
   `indexMode` / `indexBudget` 归一化后从未使用，README:55 却当可用配置；README:63-66 写 `learn/self/affect/panel` 四个开关，实际 `learn` 一个开关就决定 9 个学习/自我/情感工具的注册（tools-learn.js:10-11），`self`/`affect` 只影响注入、不影响各自工具，`panel` 才真能关 API。另有 `TOKEN_PER_CHAR` 无人引用、0.65 在 indexer.js:221 与 tools-recall.js:79 各写一次；tools-learn.js:4 导入 `graduationProposals` 未用；`applyArchive` / `listNotes` / `readSidecar` / `staleLessons` / `fail` 无调用方。
   建议：删配置项与死导出；`indexMode: inline` 要做就实现，不做就从 README 删；三个开关分别 gate 各自工具。

6. **「归档/恢复」「归档可回读」名不副实**（README:11,12；govern.js:41；selfnote.js:44-48；tools-learn.js:161-181）
   `applyArchive` 只有测试在调，没有工具或 API——治理只出计划不落地；`self_note_write` 描述说「旧段归档可回读」，但没有任何工具/面板能读 `self/archive`。
   建议：补 `memhub_archive` / 自我归档查看，或改文案。

7. **教训「命中即复发」**（tools-learn.js:47-62，bump 在 52）
   每次 `lesson_match` 命中就 `bumpRecurrence`，查 3 次即满足升格门槛（≥3），「复发」被查询次数污染。
   建议：复发只由真实复发事件写；或把 matched 次数与 recurrence 分成两个字段。

8. **教训校验形同虚设**（lessons.js:14-17）
   只查 `/当|时/`，实测「总是失败的时候」可通过，与文件头铁律「必须是『当 X 时』且可判真假」不符（「以后要小心」被拒只是碰巧不含「时」）。
   建议：`/^当.*时/` + 长度上限；补「只含时 / 只含当」两个用例（现在只测了「不要偷懒」）。

9. **技能开关两套实现且语义漂移**（host.js:191 vs indexer.js:75；tools/toggle-model-invocation.mjs:28-38）
   indexer 小写化后判 hidden，host 正则大小写敏感；`disable-model-invocation: TRUE` 或带引号时索引认为隐藏、toggle 认为没隐藏 → 可能加重复键或点了没反应。frontmatter 解析/去头逻辑共 4 处（indexer.js:11-28、tools-skill.js:54、host.js:198、toggle 工具）。
   建议：抽一个 `frontmatter.js`（读/加/去/去头）全库复用，配 TRUE / 引号 / CRLF / 无 frontmatter 用例。

10. **JSONL 台账/教训是读-改-写，无锁无原子，坏行静默删**（lessons.js:38-58；promote.js:11-31）
    加载时 JSON.parse 失败的行被 `filter` 掉，下次 save 整文件重写 → 坏行永久消失；并发两次工具调用丢一次；无备份。
    建议：改用 `appendFileSync`；坏行原样留存；save 前 `copyFileSync` 一代备份。

11. **测试盲区（非平凡逻辑没测）**
    面板 API 完全没测：sandbox 的 mockCtx 没有 `webServer`（tests/sandbox.mjs:37-44），`registerPanelApi` 被 catch 静默跳过；`readBody` / toggle 端点 / 64KB 限制无测试。`toggleSkill` / `skill_register` 这两个写用户文件的函数无测试。`parseFrontmatter` 边界（引号、缺 name/description、CRLF、BOM、`description: >` 折叠）无测试。`isOwner` 只有拒绝一例（sandbox:120），白名单命中与 `sessionIdOf` 四种字段兜底无测试。
    另外 sandbox 用 mock 替换了 `defineTool`（tests/mock-dsh-tools.mjs:1-4）和 systemPrompt/webServer/slots，四套全绿只证明自有逻辑，**真实 tool schema / systemPrompt / webServer.register / slots.register 契约未验证**。
    建议：写盘函数改成传目录的纯函数再测；面板 handler 抽成 `handle(url, method, body)`；真机前先用一个只读工具在真实 Harness 里冒烟。

12. **测试依赖真实用户数据，不 hermetic**（check.mjs:23-31,60-68；recall-check.mjs:31-33）
    「描述总字符 ≤800」「候选卡 ≤600」「errors=0」把当前 41/42 条数据写成了验收线；换机或加一个长描述技能就 FAIL。
    建议：用 fixture vault（几条构造技能）测逻辑，真实库只留一条 smoke。

13. **promote 草案默认名是空串**（promote.js:71-73,88-96）
    `options.name || '草案技能'` 再 `replace(/[^a-z0-9-]+/g,'-')` → 实测 `draft.name === ""`，后续 `skill_register` 会以名字非法拒绝。
    建议：默认名用 `draft-skill` 或基于 id 的短名。

14. **project 命中用路径精确字符串比较**（recall-scheduler.js:36）
    `item.projectPath === workspace`（`process.cwd()`）：大小写、尾斜杠、在子目录（如 `projects/dsh-memhub`）里跑都会漏命中。
    建议：`path.resolve` + Windows 小写比较，或允许前缀匹配。

15. **DEFAULT_VAULT 不认 DSH_HOME**（const.js:9 vs recall-store.js:20-27）
    `dshHome()` 认 `DSH_HOME`，技能库默认却固定 `os.homedir()/.dsh/skills`；自定义 DSH_HOME 时数据目录搬家、技能库没搬（sandbox 测试里就是这个状态）。
    建议：`DEFAULT_VAULT` 也用 `dshHome()`。

## 可选（可以不改）

1. 记忆块空时仍注入标题行；`- 工作区：<cwd>` 每轮固定占约 17% 预算（recall-scheduler.js:50-58）——cwd 模型大多已知，可只在有项目命中时给。
2. 空查询 / 纯停用词查询返回任意前 3 条（indexer.js:143），可改成「请给关键词」。
3. 面板 POST 无鉴权 / CSRF token（host.js:256-260）：JSON content-type 的预检挡得住跨站，本机够用；若 `webServer` 绑非回环再补。
4. package.json:34 `client.inject: []` 与 lib/client.js:214 `exports.inject = ['slots']` 两处声明不一致，真机以哪份为准未验证，建议只留一处。
5. 自检只落数字不落错因（host.js:279-301）：`memoryErrors` 只有计数，排障还得再跑脚本；建议把前 3 条错误写进 self-check.json。
6. 客户端技能启停无确认、失败静默（client.js:57-59）：写操作前建议加一步确认。
7. HINT_TEXT 注释写「≤60 汉字」，实际 48 字符（const.js:19-24），量纲注释可顺手改；package.json:37-41 scripts 缺 recall/govern/sandbox（README 已列命令，补脚本更省事）。

## 整体判断：需修改后交付

三处注入预算确实守住了（技能提示 48 / 记忆 235≤280 / 情感 ≤92），但 S1 会让治理与分级静默失效且覆盖已写数据，S3/S4 触及写用户文件的信任边界，面板与真机契约尚未验证（README:30-31 两项未勾）。先修 S1–S4、文档数字改成可重跑命令，再走安装与真机冒烟。
本次没检查：真实 DSH 运行时契约（defineTool/systemPrompt/webServer/slots）与桌面客户端加载——沙箱只覆盖 mock。
