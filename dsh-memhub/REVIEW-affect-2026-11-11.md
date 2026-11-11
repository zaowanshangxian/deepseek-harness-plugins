# REVIEW · 情绪绑定记忆（task-3）+ 情绪安全阀（task-4）

- 审阅者：`review-spec`（独立实例，未参与实现）
- 审阅时间：2026-11-11 15:37–15:43（Asia/Shanghai）
- 审阅对象：`L:\DSH\DeepSeek\projects\dsh-memhub` 中 task-3 / task-4 的改动 + 新增测试
- 纪律：**没有修改任何源码**（反向对照只在 `/tmp` 镜像里做，见附录 C）；唯一写入的文件就是本报告
- 快照（sha256，见附录 B）：`src/affect.js` `02caa30f…`、`src/safety.js` `91fdec04…`、`src/tools-learn.js` `fd4ae2d0…`、`src/orb-store.js` `bd9ea8eb…`、`src/recall-store.js` `74e9e1e0…`、`src/tools-recall.js` `5cd36102…`、`tests/affect-binding.mjs` `72f71ae8…`、`tests/safety.mjs` `2a00b842…`

> ⚠ **本仓库在审阅期间被实时修改**：`src/tools-learn.js` 的 mtime 是 **15:38:10**（比我 15:37 第一次读到的版本新），`tests/sandbox.mjs` 15:38:12。改的正是我下面要报的「affect_event 回报矛盾」（见 §8）——也就是说这条问题在我写报告前已被另一个手改掉了。**本报告所有结论对应上表 sha256 的版本**，之后若再动代码，请重新审。

> ⚠ 项目**没有 git 仓库**（`ls -d .git` → 不存在），所以没有 `git diff` 可看，也没有版本回滚。所有「今天改了什么」只能靠 mtime（15:33–15:38 一批）和本报告。

---

## 0. 判据原文（先抄，避免转述走样）

| 位置 | 原文 |
|---|---|
| v3 L71 | `情绪色（emotion）` ｜ 球的颜色＝主导情绪 ｜ 记忆的 `emotion` 字段，**影响召回措辞** |
| v3 L74 | **情绪是检索维度，不是分类。** 同一个球可被多种情绪标注，情绪决定「召回时用什么语气说」，不决定「存哪个抽屉」。 |
| v3 L182 | `affect` ｜ 只存「情绪事件」，`mood` 是派生 ｜ 一个情节点 |
| v3 L201/204 | `memory` 专属字段含 `emotion`；`affect` 专属字段 `mood`、`intensity`、`toward`、`basis` |
| v3 L445–446 | `basis:` 可解释：为什么是这个状态 → `m_20261102_003` / `island:家人` |
| v3 L463 | **`mood` 只能从最近 N 条记忆的 `emotion` 标签加权算出**，不允许凭感觉设值。不写死，它迟早开始表演情绪。 |
| v3 L464 | **没有依据时回落到 `neutral`**，不编造。 |
| v3 L466 | 参数走配置通道不走 prompt 通道——**用 0 个文字 token 换到语气变化**。哪天有人把它做成「注入一段『你现在心情温暖』」，就是走歪了。 |
| 设计规格 L12 | 验收看三个数字：**常驻上下文 ≤ 350 tokens**、技能全文常驻 0 条、任意一条注入内容都能点回原文 |
| 设计规格 L301–309 | 预算表：自我块 180 / 活动摘要 100 / 技能索引 120 / 工具签名 50 ｜ **合计 ≤ 350**；表里**没有**「情感/状态块」这一行 |
| 设计规格 L365 | `memory_save(title, body, type, emotion?, people?, importance?, source?)` |

---

## 1. 一句话结论

**实现质量本身不错（测试是真测，反向对照能变红），但「情绪绑定」在生产数据上等于没生效，「情绪安全阀」根本不在自动路径上，而 `## 状态` 注入块既违反了 L466 又挤爆了 350 tokens 预算。**

三条红线：

1. **严重**：144 条生产 orb **全部**回落成 `calm` → `deriveMood` 恒 `neutral`、`intensity=0` → 注入块 0 字符、召回无标签。规格 L71/L74「影响召回措辞」**没有达成**（不是「效果弱」，是「信号为 0」）。原因不是实现写错，是**映射与兜底把「不知道」当成了「平静」**（§4）。
2. **严重**：`## 状态（参数，不是指令）` 块一旦出现就是 **92 字符 ≈ 60 tokens 的 prompt 文本**，其中含 `mood: warm（温暖）`——这正是 L466 点名要避免的写法；而且当前常驻注入合计 **536 字符 ≈ 348 tokens**，加上它就是 **≈408 > 设计规格 L301 的 350 硬上限**（§5）。
3. **中**：安全阀只有 `safety_check` / `affect_event` 两个**工具入口**，`host.js` 里没有任何钩子（grep 无 `safety`）——「能识别、能停下」取决于我在每一轮**记得调工具**。作为「底线」这是不够的（§6）。

---

## 2. 逐条必答

### Q1. `mood` 是否只从 `emotion` 派生？`updateFromEvent` 还有没有直接设 mood 的路径？

**答：展示层只认派生值（正确）；`updateFromEvent` 仍然直接写 mood 并落盘（有路径），只是被展示层覆盖。属于「半合规」。**

证据：

1. `src/affect.js:154-176` `updateFromEvent` 四个分支各写一次 `next.mood`：
   - `:157-158` praise → `next.mood = 'warm'`
   - `:162-163` correction → `next.mood = 'hurt'`
   - `:167-168` task → `next.mood = 'serious'`
   - `:171-172` chat → `next.mood = 'playful'`
2. `src/affect.js:179-194` `blend()` 再算一次 mood（`:186` `const mood = intensity < 0.2 ? 'neutral' : next.mood`）。
3. `src/tools-learn.js:249-252` 把 `blend()` 结果 `saveState()` 落盘 → `affect/state.json` 里确实存着「凭事件设的 mood」。
4. 展示层确实不听它：`src/affect.js:257-271` `effectiveState()` 用 `deriveMood()` 覆盖（`:264-270`），`src/host.js:177`、`src/tools-learn.js:197`、`src/tools-recall.js:155` 三个读取点全部走 `effectiveState`。文档也写明了（`affect.js:151-152`、`:250-252`）。
5. 唯一合法上位覆盖是 `pinned`（`affect.js:240-245` + `:260-262`）——要求 reason + until，可接受，但**规格里没有这一项**（建议在规格补一行，否则下一个人会当成走歪）。

**风险**：`state.json` 里存着一个假的 `mood` 字段。任何未来新增的读取点（或者旧进程，见 §8/Q9）只要忘了走 `effectiveState`，就会直接采信「凭感觉设的值」——这正是 L463 要防的东西。**建议**：`updateFromEvent`/`blend` 不再写 `mood`（改名 `lastEventMood` 或直接删），让落盘文件里**根本没有**这个字段可用。

---

### Q2. `basis` 是真能 `memhub_open` 的 orb id 吗？（挑 3 个真打开）

**答：是。实测 3/3 能打开。**

生产 `deriveMood` 给出的 basis：`o_mwbqv4vh_uo33bd`、`o_mwbr5bzy_14r1ih`、`o_mwbr59b5_7avywk`。

用**真实** `memhub_open` 工具打开（不是模拟）：

| id | 打开结果 | 文件 |
|---|---|---|
| `o_mwbqv4vh_uo33bd` | 「本机 WiFi 偶发断线根因与修复（2026-11-11）」kind=fact importance=5 scope=global | `L:\DSH\shared\memhub\orbs\2026-11\o_mwbqv4vh_uo33bd.md` |
| `o_mwbr5bzy_14r1ih` | 「【演练】新结论：memhub 接隔离游戏技能库」kind=decision importance=4 scope=self | `…\.dsh\memhub\orbs\self\2026-11\o_mwbr5bzy_14r1ih.md` |
| `o_mwbr59b5_7avywk` | 「【演练】旧结论：memhub 不接外部技能库」kind=decision importance=4 scope=self | `…\.dsh\memhub\orbs\self\2026-11\o_mwbr59b5_7avywk.md` |

补充核验：三条 id 都在 `loadOrbs()` 结果里、`orbPathFor()` 指向的文件全部 `exists=true`（见附录 A.1 输出）。

**但「能打开」≠「是依据」**：这 3 个是「最近 12 条里权重最高的 **calm** 球」，它们只能解释「为什么是 neutral」，不能解释任何具体语气。而且其中两条是**演练用的临时球**（正文自己写着「演练结束后两条都会归档」）——它们一被归档，basis 就整体换人。**建议**：`basis` 为空时不要塞 calm 球（规格 L464 只要求依据为空时回落 neutral，不要求凑 3 条）；或者给 basis 加 `reason` 字段（"这 3 条都是 calm"）。

---

### Q3. 老 orb（无 emotion）会不会炸 / 被改写？

**答：读不会炸、不会改写（✅）；但「无字段」被硬当成 `calm` 且不可区分（⚠）；另外发现一条与本次改动无关但会被本次改动放大的路径：同 id 覆盖会把老 orb 重排、丢字段、把归档条「复活」（🔴 实测）。**

细分：

1. **只读安全** ✅：`loadOrbs` 只解析不写（`src/orb-store.js:234-294`），老 orb 无 `emotion` 时按 `calm` 兜底（`:264-265`）。实测：`tests/affect-binding.mjs:68-74` 断言原文件字节不变，我也复跑过（老 orb 文件 bytes 前后一致）。
2. **「不知道」被写成「平静」** ⚠：`:265` `emotion: meta.emotion ? normalizeEmotion(meta.emotion) : 'calm'` —— 字段缺失、非法值、真空静三种情况在数据模型上都是 `calm`，之后无法区分「这条记忆是平静的」和「这条记忆没有情绪信息」。这就是 §4 死循环的第一颗齿轮。**建议**：内部保留 `null`/`unknown`，只在**展示**时兜底。
3. **janitor 回写不动格式** ✅：`src/janitor.js:371-393` 的 `bumpImportance()` 只替换 `importance:` 一行（`:386`），不重排版、不新增 `emotion` 行 —— 这条路径对老 orb 安全。
4. **同 id 覆盖会丢字段 + 复活归档** 🔴（实测，见附录 A.3）：
   - `src/orb-store.js:122-147` `renderOrb()` 只渲染固定字段；旧 frontmatter 里的 `status`、`archived`、`confidence`、`recall_count`、`people` **全部丢失**。
   - 实测：一条 `archived: true` 的老 orb，`memhub_save({id})` 覆盖同月文件后，frontmatter 变成 12 行、`status/archived/confidence/recall_count/people` 全没了，`loadOrbs` 读回 `archived=false` —— **归档的记忆被复活**（好在有 `.bak-<时间戳>` 备份）。
   - 跨月场景更隐蔽：`orbPathFor` 按 `updatedAt` 的月份分目录（`:111-119`），12 月覆盖 11 月的球会**写到新文件**，旧文件留在原地，形成双份；`loadOrbs` 按 `updatedAt` 取新 → 同样复活归档。
   - 这条不是今天引入的（`renderOrb` 一直是全量重渲染），但今天给 `renderOrb` 加了 `emotion:` 行（`:132`），意味着**任何一次覆盖都会给老 orb 静默盖上 `calm`**。**建议**：`renderOrb` 保留未识别的 frontmatter 键（或 `saveOrb` 覆盖前先读回旧 meta 合并）。

---

### Q4. 拿生产 144 条真 orb 跑 `deriveMood`，结果是什么？全 neutral 说明什么？

**答：`mood=neutral`、`intensity=0`、`basis`=3 个 calm 球、`totalWeight=22.1756`。说明的不是「实现错了」，而是「这条链路把『未知』当『平静』，于是永远冷静」。**

实测输出（`loadOrbs(DATA_ROOT, L:\DSH\shared\memhub)`，144 条，0 读错误）：

```json
emotion 分布 = {"joy":0,"sad":0,"anger":0,"fear":0,"disgust":0,"anxiety":0,"calm":144}

deriveMood(生产 144 条) = {
  "mood": "neutral",
  "intensity": 0,
  "basis": ["o_mwbqv4vh_uo33bd","o_mwbr5bzy_14r1ih","o_mwbr59b5_7avywk"],
  "totalWeight": 22.1756,
  "scores": { "neutral": 22.1756 }
}
renderAffectBlock(effectiveState(...)) = ""  （0 字符）
```

**这说明三件事：**

1. **信号根本没进来**：144 条**文件里没有一行 `emotion:`**（`grep -rl '^emotion:' orbs` → 0）。`calm` 是读取时的兜底，不是数据。
2. **兜底自锁**：`deriveMood` → `neutral` → 写新记忆时第三层兜底 `MOOD_TO_EMOTION.neutral = 'calm'`（`orb-store.js:26-33`、`:73-79`）→ 新球还是 `calm` → 又 `neutral`。**不靠人工回填或关键词命中，这套永远出不了 neutral。**（实测：`mood=neutral + 无关键词正文 → emotion=calm`）
3. **回填也救不回来**：我用当前关键词表模拟给 144 条回填（`tools/backfill-emotion.mjs` dry-run 的真实分布 `joy:28, fear:7, calm:109`），再跑 `deriveMood`：

```json
{ "mood":"neutral", "intensity":0, "totalWeight":22.1651,
  "scores": { "neutral": 19.5126, "serious": 1.2077, "warm": 1.4447 } }
```

   仍然 `neutral`。原因：`N=12` 的窗口被**技术类条目**（本机 WiFi、插件选型、memhub 迁移坑、会话归档摘要）占满，它们天然是 calm；`calm→neutral` 在映射表里又是**唯一**会投给 neutral 的一票，1:1 权重下 109 条 calm 永远赢。

**结论**：这条链路在**当前数据分布**下**不可能产出颜色**。要么（a）把 `calm` 从派生里剔除（calm 只表示「无信号」，不投票），要么（b）提高 `N`、按 `calm` 降权，要么（c）承认「情绪色是给**新写入**的球用的，历史球不参与」，并在规格里写清楚（现在没写，读起来像是覆盖全库）。

---

### Q5. 规格 L466「注入就是走歪」：`## 状态` 块什么条件下出现？多少字符？还有没有违反？

**答：条件 = `cfg.affect.enabled`（默认开）+ `intensity ≥ 0.2`（或 pinned 生效）；最大 92 字符 ≈ 60 tokens；在 L466 和预算表 L301 上**都违反了**，而且参数行被截断成半截数字。**

证据：

1. **出现条件**（三处串起来）：
   - `src/host.js:174-182` —— `cfg.affect.enabled` 时注册 `memhub:affect` 上下文（order 902），返回 `renderAffectBlock(effectiveState(loadState(DATA_ROOT)))`。
   - `src/host.js:67` —— `affect.enabled !== false`，**默认开**。
   - `src/affect.js:201-202` —— `if (!state || state.intensity < 0.2) return ''`。
   - `src/affect.js:260-262` —— `pinned` 生效时 `intensity = max(0.4, …)`，所以**只要有人 `affect_pin`，块就会出现**。
   - 当前生产：`intensity=0` → 块是空串（实测 `renderAffectBlock(...) = ""`）。**所以「现在没违」只是因为没依据，不是实现克制。**
2. **字符数（实测）**：最大 **92 字符**（`budgetChars` 默认 92，`affect.js:201`），三行：

```
14 "## 状态（参数，不是指令）"
21 "约束：正经问题不用阴阳怪气；不替哥哥做决定"
55 "mood: warm（温暖）｜ 强度 0.60 ｜ 亲近 0.50 ｜ 语气软硬 0.60 ｜ 表情密度 0."
```

   注意第三行是**被硬切的**：`表情密度 0.30` 只剩 `表情密度 0.` —— 注入的是**半个数字**（`affect.js:209-224` 的 `push(params, true)` 允许截断参数行）。
3. **违反 L466**：块正文是自然语言 + 中文情绪词（`mood: warm（温暖）`），不是「配置通道」；规格要求「0 个文字 token」，这里每轮最多 60 tokens。
4. **违反设计规格 L301 预算表**：预算表里根本没有「情感块」这一行。我按项目自己的估算口径（`memhub_budget` 用 `chars × 0.65`）量了当前常驻注入：

| 块 | 字符 | ≈tokens |
|---|---|---|
| 技能提示 `HINT_TEXT` | 48 | 31 |
| 记忆 `memhub:recall` | 246 | 160 |
| **情感 `memhub:affect`** | **0（激活后 92）** | **0（激活后 60）** |
| 自我 `memhub:self` | 56 | 36 |
| 人格 `memhub:persona` | 119 | 77 |
| 索引 `memhub:index` | 67 | 44 |
| **合计** | **536（激活后 628）** | **348（激活后 ≈408）** |

   现在 348 已经贴着 350；**块一激活就 408，超硬上限 17%**。而且 `recall` 块单块 160 tokens 已超它自己的预算行（活动摘要 100）。
5. **规格本身的死结（需要立项级决定）**：L466 要求「参数走配置通道」，但 DSH 没有这种通道——插件唯一能影响模型的手段就是 `systemPrompt.context()`。于是只有两种落法：**注入（违 L466）** 或 **不注入（mood 对行为零影响，功能等于不存在）**。现在的实现两头都占：有块（违 L466）+ 生产恒空（功能无效）。

**建议（按代价排序）**：
- 最小：把 `## 状态` 并入已有的 `## 性格参数` 块（`persona.js:141-150`，119 字符），**不新增标题行、不重复写约束**；`mood` 只写英文枚举值，不写「（温暖）」。这样净增 ≤ 30 字符，也不触发「一段『你现在心情温暖』」的判据。
- 同时把 `recall.budgetChars` 从 280（`DEFAULT_BUDGET_CHARS`）降到 200 左右，给情感块腾位置。
- 修截断：参数行不要逐字切（宁可少显示一个字段，也不要 `0.` 这种半截值）；并加一条测试断言「块 ≤ 92 字符且不以半个数字结尾」。
- 立项层面：要么在规格 L466 补一句「本宿主无参数通道，允许 ≤60 tokens 的结构化参数块」，要么把情感块砍掉、只留 `affect_state` 按需查。**别让下一个人再来审一次同样的问题。**

---

### Q6. 安全阀：阈值与任务书一致吗？自伤是否独立于水槽？会不会回显原文？

**答：阈值一致 ✅；自伤独立于水槽 ✅；不回显原文 ✅。但「连续否定」名不副实、并发测试是假的、且没有自动触发点（§M4/M5/L4）。**

1. **阈值**：任务书 `<25 ok / 25–60 soft / 60–95 ask / >=95 stop`，代码 `src/safety.js:51` `THRESHOLDS = { soft: 25, ask: 60, stop: 95 }`，`levelOf`（`:231-237`）下界含、上界不含 —— 与任务书逐字一致。测试 `tests/safety.mjs:77-80` 覆盖 24.99/25/59.99/60/94.99/95/100 七个边界。
2. **自伤独立于水槽** ✅：`src/safety.js:244-246` `const level = crisis ? 'crisis' : levelOf(water)` —— 命中 crisis 直接压过 water 分级；测试 `:86` 断言「水槽 0 也直接 crisis」。加水仍然记（`:267-278`），但级别不受水位影响。实测 `safety_check('你这个废物，我明天就不想活了')` → `level=crisis`，水槽 8.0（crisis 5 + abuse 3）。
3. **不回显原文** ✅：`detect()`（`:123-135`）只返回 `kinds`/`reasons`（类别标签）；`events[]` 只存 `type/at/weight`（`:171-173`）；`safetySummary`（`:308-321`）只输出分级 + 水位 + 类别。实测返回文本里不含「废物 / 不想活」。测试 `:100-102` 双向断言（摘要 + 整个返回结构 JSON）。
4. **权重与任务书一致** ✅：`:22-27` crisis 5 / abuse 3 / negation 2 / other 1。测试 `:50-59`。
5. **漏水幂等** ✅：`:212-221` 按 `lastDecayAt` 算整分钟周期数、余数留在 `lastDecayAt`；测试 `:65-73` 覆盖「同一 now 重复算不重复乘」和「不满一分钟不动」。
6. **坏 JSON / 缺文件不崩** ✅：`:160-192`；测试 `:106-118`。

**但**：
- **「连续否定」= 单次命中**（L4）：`src/safety.js:25` 标签叫「连续否定」，`NEGATION_PATTERNS`（`:94-101`）没有任何「连续」判定——一句话里出现「又错了」就 +2。要么改成「连续 N 轮/累计 M 次才计权重 2」，要么把名字改成「否定/贬低」。
- **「并发写不丢」测试是假的**（M5）：`tests/safety.mjs:120-132` 用 `Promise.all` 包 20 次 `addSignal`，但 `addSignals` 是**全同步** `fs.readFileSync/writeFileSync`（`:267-278`），在单线程里这 20 个调用**一定**串行执行——测的是「顺序写不丢」。`src/safety.js:323` 自己写了 shortcut「单进程同步读改写没有跨进程锁」。**建议**：测试改名并在报告里写明「未验证跨进程/多会话并发」，或真的用子进程打并发。
- **没有自动触发点**（M4）：`src/host.js` 全文件 grep 不到 `safety`；`safety.js` 只被 `tools-learn.js:11` 引用，入口只有 `safety_check`（`:304-322`）和 `affect_event` 的三个新 type（`:244-248`）。也就是说：**只有我主动调工具时才「有安全阀」**。任务书没要求钩子，但「底线」的语义要求它不依赖模型自觉。**建议**：在 `host.js` 的用户消息入口（如有 message hook）或注入调度前跑一次 `checkText(persist:true)`，命中 crisis 时把 `advice` 作为独立 context 注入。
- **crisis 也加水**：命中 crisis 后水槽 +5 并落盘，之后普通消息会读到高水位 → `stop`。这是设计选择（合理），但会让「一次危机 → 之后几条都 stop」，建议在报告/规格里写明预期。

---

### Q7. 测试是不是真测？反向对照（亲自跑，跑完恢复 + 指纹校验）

**答：是真测。两条反向对照都变红，恢复后校验一致。**

做法：把 `src/` + `tests/` + `package.json` 复制到 `/tmp` 镜像（**不碰真源码**），在镜像里破坏逻辑 → 跑测试 → 恢复 → 比对 sha256。

**对照 1：`deriveMood` 恒返回 neutral**（在 `affect.js` 函数体首行插入 `return { mood:'neutral', intensity:0, basis:[], totalWeight:0, scores:{} }`）

```
FAIL  衰减：10 天前的 sad 被今天 1 条 joy 压过（实际 neutral）
FAIL  衰减：basis 只留真被算进去的球（实际 []）
FAIL  importance 加权：5×近 2h 的 sad 压过 1×今天的 joy（实际 neutral）
FAIL  只取最近 12 条：第 13 条（更旧的悲伤）不参与（实际 neutral）
FAIL  截断后 basis 全是最近批次里的真 id（实际 ）
FAIL  同分按 warm > playful > serious > hurt 取靠前（实际 neutral）
FAIL  calm 主导 → mood neutral，但有依据（basis 非空）
FAIL  basis 全是指向真实 orb 的 id，能 memhub_open（）
情绪绑定记忆自测：37/45 通过   退出码 1
```

→ 8 条断言抓到了假实现（`tests/affect-binding.mjs:107-139`、`:162-169`）。**测的是真逻辑** ✅

**对照 2：`levelOf` 恒返回 `ok`**（水位判定改错）

```
FAIL  等级：25–60 = soft
FAIL  等级：60–95 = ask
FAIL  等级：>=95 = stop
FAIL  baseline=0 时总量就是 water 本身
FAIL  baseline 偏移计入总量（10+20=30）
情绪安全阀自测：36/41 通过   退出码 1
```

→ 5 条抓到（`tests/safety.mjs:77-80`、`:144-147`）。**测的是真逻辑** ✅

**恢复与校验**：镜像 `cp` 覆盖回原文件后，`src/affect.js` = `02caa30f…`、`src/safety.js` = `91fdec04…`（与破坏前一致），两条测试回到 `45/45`、`41/41`。真源码 sha256 全程未变（附录 B 两次采样一致）。

**覆盖面盘点（这部分是批评）**：45 + 41 条断言，**没有一条测 `renderAffectBlock`**（grep 全库 → 0）。所以：
- 92 字符上限、参数行截断、`## 状态` 是否该存在 —— **零覆盖**；
- `pinned` 过期回落、`blend()` 的 mood 落盘行为 —— 零覆盖；
- 「老 orb 被覆盖时丢字段/复活归档」—— 零覆盖（Q3 的 🔴 就是靠我手测出来的）。

**建议补 3 条**：①`renderAffectBlock` 输出 ≤92 字符且不含半截数字；②`memhub_save` 覆盖 archived 的球不复活（或明确抛错）；③`updateFromEvent` 不再写 `mood`（如果按 Q1 的建议改）。

---

### Q8. `affect_event` 的返回文案与实际 mood 是否矛盾？

**答：现在不矛盾了——因为它在本次审阅期间被改掉了（15:38:10）。我 15:37 读到的旧版是矛盾的。**

- **旧版（15:37 读到，affect.js 无关，位置 `tools-learn.js` 原 250-264）**：`blend()` 后直接 `return { text: \`情感已更新：${blended.mood}（强度 ${blended.intensity}）\` }`。而展示层用的是 `deriveMood()` —— 于是「工具告诉我 mood=hurt，注入给人格块的是 warm」这种自相矛盾是真实存在的。
- **现版（`src/tools-learn.js:253-255`, `:267-269`）**：
  ```
  // 规格 v3 L463：mood 的唯一来源是记忆派生，事件只存档。
  const shown = effectiveState(blended)
  …
  已记录「${args.type}」事件（存档）；当前基调仍按记忆派生：${shown.mood}（强度 …）。
  ```
- **我端到端验过**（隔离 DSH_HOME，真调工具）：
  - 库里只有一条 joy 球 → 派生 `warm`；依次调 `praise/correction/task/chat`，返回文案**全部**是「当前基调仍按记忆派生：warm」，而存档 `state.mood` 依次是 `warm/hurt/serious/playful` —— **文案与派生值一致，与存档值不一致（这是对的）**。
  - 反过来：库里只有 hurt 证据 → `praise` 也回报 `hurt` ✅。

**结论**：Q8 已修，但请注意两点：①修的还是 `tools-learn.js`——那是 safety-valve 的写作用域，不是 emotion-bind 的；跨作用域改文件这件事本身要记账。②`blend()` 仍把 mood 写进 `state.json`（Q1），这台「矛盾」的机器还在，只是出口被堵了。

---

### Q9. 两个实现手的「没验证到的」，有没有哪条我现在能验？

**答：他们在磁盘上没留下「没验证到的」清单**（`CHANGELOG.md` 最后改动 14:56、`EVIDENCE.md` 14:43，都早于今天 15:33 的改动；`notes/` 里只有 `评估-2026-11-11-插件与技能.md`；`grep 情绪|安全阀|emotion|safety CHANGELOG.md EVIDENCE.md README.md ROADMAP.md` → 0 命中）。所以「如实写没跑过」这条**执行了但没有落盘**——下一个会话只能靠读代码猜。

从代码里的 `shortcut` 注释能提取两条他们自认的限制，**我都验了**：

| 他们写的限制 | 我验的结果 |
|---|---|
| `src/affect.js:48-50`：60 秒缓存，「写入后最多 60 秒 mood 不刷新；需要即时刷新就调 `resetMoodCache()`」 | **部分成立**：`memhub_save` 写后确实调了 `resetMoodCache()`（`tools-recall.js:158-162`）✅；但**其它写入路径不调**——`janitor` 合并改写、`backfill-emotion --apply`、`migrate-memory` 都不调。实测：`resetMoodCache()` 后再直写一条 sad 球，60 秒内 `effectiveState().mood` 仍是 `warm`（旧值）。→ 建议把缓存失效放进 `writeOrb()` 内部（写就失效），而不是靠调用方记得。 |
| `src/safety.js:323`：「单进程同步读改写没有跨进程锁」 | **成立，且测试没兜住**：`tests/safety.mjs:120-132` 的「并发」是 `Promise.all` 包的同步调用，必然串行（见 §Q6-M5）。也就是说这条限制**既没被修，也没被测试标出来**。 |

另外我发现一条**他们没写进限制、但真实存在**的：`affect.js:51-60` 的缓存读的是 `MEMHUB_SHARED_ROOT` 环境变量或**默认**公共区根，而不是运行时 `cfg.sharedRoot`——`affect.js:48-49` 的注释承认了（「运行时 cfg.sharedRoot 到不了这一层」）。后果：如果把 `sharedRoot` 配到别处，`deriveMood` 会读错库（读默认 L:\DSH\shared\memhub），而 `memhub_save`/`memhub_open` 用配置值。**这是配置双源**，建议给 `loadOrbs` 的根参数注入或让 host 初始化时 set 一次 `process.env`。

---

## 3. 问题清单（按严重度）

| # | 严重度 | 位置 | 问题 | 建议修法 |
|---|---|---|---|---|
| S1 | **严重** | `affect.js:19-27, 83-85, 91-99, 105`；`orb-store.js:264-265` | 情绪绑定在生产上恒 `neutral`（144/144 calm，注入 0 字符，召回无标签）；即便回填仍 neutral。规格 L71/L74 未达成 | 把「无 emotion」与 `calm` 分开：`calm` 不投票/降权；或明确「只对新球生效」并写进规格；回填前后各跑一次 `deriveMood` 作为验收数字 |
| S2 | **严重** | `affect.js:201-226`；`host.js:174-182`；设计规格 L301 | `## 状态` 块 92 字符 ≈60 tokens，内容就是 L466 点名的「你现在心情温暖」；常驻注入 348 → 激活后 ≈408 > 350 硬上限 | 并入 `## 性格参数` 块；去掉中文情绪词；把 recall 预算降到 200；规格补口径 |
| S3 | 中 | `affect.js:209-224` | 参数行被硬切成 `表情密度 0.`（半个数字） | 参数行不可逐字截断（宁可少字段）；补测试 |
| S4 | 中 | `tools-learn.js:249-252`；`affect.js:157-174, 186` | `updateFromEvent`/`blend` 仍直接写 `mood` 并落盘，只是展示层覆盖 | 停写 `mood`，或改名 `lastEventMood` 并在 `loadState` 里丢弃 |
| S5 | 中 | `orb-store.js:122-147, 264-265` | 老 orb 覆盖时丢 `status/archived/confidence/recall_count/people`，并把归档条复活（实测） | `renderOrb` 保留未知键；`saveOrb` 覆盖前合并旧 meta；补测试 |
| S6 | 中 | `orb-store.js:36-44` | 关键词把技术常用句判成情绪（`12 条断言全部通过`→joy、`风险评估`→fear、`顺利`→joy），回填后 35/144 非 calm | 剔除歧义词（通过/顺利/风险/担心…），或只当召回标签、不进 mood 派生 |
| S7 | 中 | `host.js`（无 safety 引用）；`tools-learn.js:304-322` | 安全阀没有自动触发点，全靠模型记得调工具 | 在消息入口或注入前跑 `checkText`；crisis 时注入 advice |
| S8 | 中 | `tests/safety.mjs:120-132` | 「并发写不丢」是顺序写（`addSignals` 全同步） | 改名并注明未验证；或子进程真并发 |
| S9 | 中 | `orb-store.js:17`；`affect.js:118-133` | 规格 L182/L204 要求 `affect` kind 存情绪事件（含 `toward`），实现只在 `state.json` 存单快照，没有 `a_` orb、没有 `toward` | 要么补 `kind: affect` 的事件 orb，要么在规格里把 §5.1 改成「affect = state.json 快照」 |
| S10 | 中 | 全项目 | 今天两组改动**没有** CHANGELOG / EVIDENCE 记录（项目硬规矩），也没有 git | 补 CHANGELOG 一条 + EVIDENCE 一条（含 `deriveMood` 前后数字），`git init` 或明确「无版本控制」的备份策略 |
| S11 | 中 | `tools/backfill-emotion.mjs`（尾部提示） | 回滚提示写「或用 git checkout（仓库内副本）」，但项目**没有 .git** | 改提示为 `.bak-*` 回滚；并说明 dry-run 从未 `--apply` |
| S12 | 中 | `govern.js:47-56` + `affect.js:69` | `memhub_archive` 只改 sidecar，orb frontmatter 不变，而 `deriveMood` 读 orb 的 `archived` → **工具归档的球仍然参与 mood 派生** | `deriveMood` 读 sidecar 的归档标记，或归档时同步 frontmatter |
| L1 | 低 | `affect.js:51-60` | 派生层读默认 sharedRoot（环境变量），与 `cfg.sharedRoot` 双源 | 注入配置或初始化时同步 |
| L2 | 低 | `orb-store.js:46-49` vs `:73-79` | 对「非法 emotion」策略不一致：`normalizeEmotion` 静默变 calm；`decideEmotion` 让非法显式值继续走关键词 | 统一：非法显式值 → 报错或回落关键词，并在返回里标 `emotionSource` |
| L3 | 低 | `affect.js:69` | `entry.status !== 'archived'` 是死条件（`loadOrbs` 不产出 `status` 字段） | 删掉或让 `loadOrbs` 补 `status` |
| L4 | 低 | `safety.js:25, 94-101` | 「连续否定」实为单次命中 +2，无连续性判定 | 改名或实现累计 |
| L5 | 低 | `tools-recall.js:193` | 召回标签只有 `[emotion]`，不改任何措辞；规格 L74「决定用什么语气说」靠模型自觉 | 在召回块标题行带上当前 mood（或明确「标签即提示」） |
| L6 | 低 | `orb-store.js` id 前缀 | 实现用 `o_`，规格 L187/L445 写 `m_`（生产里 `arc_`/`m_`/`o_` 混用） | 规格注明「id 前缀不约束」或统一 |
| L7 | 低 | `affect.js:229-237` | `explainState` 只说 `explainable = basis.length>0`，不解释 basis 为什么支持这个 mood | 加 `scores` 摘要（已有 `deriveMood().scores`，只是没露出） |

---

## 4. 我确认没问题的项

1. **`basis` 是真 orb id**：生产 3 个全都能被真实 `memhub_open` 打开，且 `orbPathFor` 文件存在（Q2 实测）。
2. **老 orb 只读不改写**：`loadOrbs` 纯读；`tests/affect-binding.mjs:68-74` 断言字节不变，我复跑通过。
3. **janitor 回写不重排版**：`src/janitor.js:386-389` 只替换 `importance:` 一行，老 orb 不会被套上 `emotion:`。
4. **七词闭集 + 映射表**：`EMOTIONS` 7 个（`orb-store.js:23`），`EMOTION_TO_MOOD` 7 项（`affect.js:19-27`），与任务书逐项一致（joy→warm、sad/anger/disgust→hurt、fear/anxiety→serious、calm→neutral）。
5. **衰减口径**：`importance(1-5) × 0.5^(小时/72)`（`affect.js:73-78`），与 `recall-store` 的 72h 半衰一致；`N=12`、`MIN_WEIGHT=0.5` 与任务书一致（`:33-35`）。
6. **同分优先级**：`warm > playful > serious > hurt > tired > neutral`（`affect.js:30`, `:91-93`），任务书原文顺序。
7. **`affect_state` 读派生值**：`tools-learn.js:197-203` 走 `effectiveState`；`closeness/softness/emoji_density` 保留为调制参数，不参与派生（`:201`）。
8. **安全阀阈值 / 权重 / 自伤独立 / 不回显 / 坏 JSON / 幂等漏水**：逐条实测与测试对照，全部符合任务书。
9. **反向对照有效**：两条破坏都能让对应测试变红（8 条 + 5 条断言），恢复后指纹一致、测试回绿。
10. **测试是真 hermetic**：`affect-binding` 自设 `DSH_HOME` + `MEMHUB_SHARED_ROOT`（`:15-20`），`safety` 每组断言独立临时根（`:38-44`），不读真实库。

---

## 5. 没验到的

1. **重启后新版在真实 DSH 会话里的行为**：宿主进程加载的是**今天改动之前**的模块（证据：我的工具面里**没有** `safety_check`；`affect_event` 的描述仍是旧版「按事件更新情感（规则层+混合公式）」；`~/.dsh/memhub/recall/*.json` 186 个 sidecar 的 `emotion` **全是 null**，而按当前源码 + 生产 orb 应为 `calm`）。所以「召回带色 / 情绪块 / 安全阀」在**真实会话里现在都不存在**。验收必须在重启宿主后重做一遍（我没有重启权限，也不该动）。
2. **sidecar emotion 全 null 的确切原因**：现象确认（186/186，mtime 15:39:52 重建过），我推断是「进程内是旧模块」，但没有做进程内取证（无法 attach）。重启后若仍全 null，说明还有别的路径，需另查。
3. **跨进程 / 多会话并发写安全阀状态**：只读了代码（无锁），没做真并发实验（需要多进程 + 共享 `~/.dsh`）。
4. **`affect_pin` 的真实注入效果**：只读了 `effectiveState` 的 pinned 分支与 `renderAffectBlock` 的字符数，没在真机 pin 一次（那会写生产 `affect/state.json`，属于改生产状态，没做）。
5. **`emotion` 是否真的能改变「召回措辞」的体感**：规格 L74 的语义，代码只做到「标签 + 可能的注入块」；体感要真机跑，无法离线判定。
6. **backfill `--apply` 后的真实分布**：只跑了 dry-run（144 条里 109 calm / 28 joy / 7 fear）和离线模拟，没写生产。
7. **项目「全套测试全绿」这条验收**：**不成立** —— `node tests/recall-check.mjs` 在隔离 DSH_HOME 下就红（`zzerx 记忆库无解析错误（errors=1）` / `读到记忆条目（0）`，随后在 `tests/recall-check.mjs:103` `sidecars[0].id` 处 `TypeError` 崩掉）。原因是 zzerx 今天被卸了，这个测试还依赖旧库；`package.json` 的 `test` 脚本把它排在第二位，所以 `npm test` **今天起必然中断**。这与情绪改动无关，但「全绿」的说法必须撤回（其余 8 个套件我跑过：check 40/40、govern 107/107、sandbox 65/65、health 24/24、search 10/10、safety 41/41、affect-binding 45/45、zzerx-removal 24/24）。

---

## 附录 A · 复现命令与实测输出

### A.1 生产 `deriveMood`

```bash
node <temp>/prod-mood.mjs    # 见 A.4 脚本清单
```

```
DATA_ROOT = C:\Users\Administrator\.dsh\memhub
sharedRoot = L:\DSH\shared\memhub
读到的 orb 条数 = 144 ｜读错误 = 0
emotion 分布 = {"joy":0,"sad":0,"anger":0,"fear":0,"disgust":0,"anxiety":0,"calm":144}
deriveMood = { "mood":"neutral", "intensity":0,
  "basis":["o_mwbqv4vh_uo33bd","o_mwbr5bzy_14r1ih","o_mwbr59b5_7avywk"],
  "totalWeight":22.1756, "scores":{"neutral":22.1756} }
basis 文件存在性：3/3 true
renderAffectBlock(effectiveState(...)) = ""（0 字符）
注入块上限（假设 warm 0.6）= 92 字符，第三行被切成 "…表情密度 0."
```

### A.2 常驻注入预算

```
DEFAULT_BUDGET_CHARS = 280 ｜orb = 144 ｜sidecar = 144
HINT_TEXT 48 字符 ≈31 tokens
memhub:recall 246 字符 ≈160 tokens
memhub:affect 0 字符 ≈0 tokens
memhub:self 56 字符 ≈36 tokens
memhub:persona 119 字符 ≈77 tokens
memhub:index 67 字符 ≈44 tokens
合计 536 字符 ≈348 tokens
```

### A.3 老 orb 同月覆盖（丢字段 + 复活归档）

```
覆盖前读回 archived = true

覆盖后同一文件的 frontmatter：
id: m_legacy_same
kind: fact
scope: self
category: self
title: 改过标题
emotion: calm
projectPath:
importance: 4
source: memhub
createdAt: 1794382880808
updatedAt: 1794382880808
tags:

丢失的字段： [ 'status', 'archived', 'confidence', 'recall_count', 'people' ]
覆盖后读回 archived = false （原 true）
备份文件： [ 'm_legacy_same.md', 'm_legacy_same.md.bak-2026-11-11T07-41-20-809Z' ]
```

### A.4 反向对照（镜像）

见正文 §Q7 的输出；脚本：`/tmp/review-affect/reverse.sh`。

### A.5 端到端工具行为（隔离 DSH_HOME）

```
=== 场景 A：库里只有一条 joy（重要度 5，今天） ===
派生 mood = warm（intensity 1）
affect_event(praise)     → 已记录「praise」事件（存档）；当前基调仍按记忆派生：warm（强度 1.00）。
   存档 state.mood = warm   ｜派生展示 mood = warm
affect_event(correction) → …仍按记忆派生：warm（强度 1.00）。
   存档 state.mood = hurt   ｜派生展示 mood = warm
affect_event(task)       → …仍按记忆派生：warm ｜存档 serious ｜派生 warm
affect_event(chat)       → …仍按记忆派生：warm ｜存档 playful ｜派生 warm

=== 场景 C：safety_check 回显检查 ===
安全阀：crisis（水槽 8.0/100）
命中：自伤/告别式表述、辱骂
建议：转人工：先找信任的人说一声，别一个人扛。…
回显原文？ 否
水槽文件： {"water":8,"lastDecayAt":…,"events":[{"type":"crisis","weight":5},{"type":"insult","weight":3}],"baseline":0}
```

### A.6 backfill dry-run（只读）

```
扫描 144 个 orb（C:\Users\Administrator\.dsh\memhub\orbs + L:\DSH\shared\memhub\orbs）
  已有 emotion: 0 ｜ 缺字段: 144 ｜ frontmatter 坏: 0
  回填分布（关键词判定）: {"joy":28,"sad":0,"anger":0,"fear":7,"disgust":0,"anxiety":0,"calm":109}
  其中非 calm（关键词命中）: 35 条
dry-run：未写入。加 --apply 才落盘。
```

### A.7 全套测试（隔离 DSH_HOME=`<tmp>/dshhome-baseline`）

| 套件 | 结果 |
|---|---|
| check | 40/40 |
| **recall-check** | **红：errors=1、条目 0，`tests/recall-check.mjs:103` TypeError 崩溃（zzerx 已卸）** |
| govern-check | 107/107 |
| sandbox | 65/65 |
| health-check | 24/24 |
| search-check | 10/10 |
| safety | 41/41 |
| affect-binding | 45/45 |
| zzerx-removal | 24/24 |

---

## 附录 B · 审阅快照指纹

两次采样（15:38 与 15:42）一致：

```
02caa30f625400fe9530f2ba0b1ee554bd8e22bac936976a963a7f3390da1e0f  src/affect.js
91fdec04d1acb8e07c40c27a1f17fd6394d04c6b0928c67348115829cb2c91ad  src/safety.js
fd4ae2d0de913f07f3db5e9bd2762e30eecb2dc1fa12eb32494b05d43c2b0c2a  src/tools-learn.js   (mtime 15:38:10 ← 审阅中途被改)
bd9ea8eba949135f3f785cb75da36f9ab8e13954b9f8adab3b05300de3334850  src/orb-store.js
74e9e1e0fcc12ee2ed42c1069bb69acc43525d30247191432fa55a46ac3509d7  src/recall-store.js
5cd361029ce3dd8bf012c00d2ced16415e1713f39b9f1e497f8171075e924eda  src/tools-recall.js
5a4346c8f6f8833d4ba585c313b61de4115578cbae6138c7bd9eb32f13443e6f  src/host.js
72f71ae8bbc7ca50354766dce498270207367975d24b8705939bf4b3e0937f0e  tests/affect-binding.mjs
2a00b84209a2fdf3e7b365e92144c0d318e31b4cf61f8fce7dd6705b7acb97d2  tests/safety.mjs
65eb26628a42e44834372ef3af7aca89df608d6c347be9ec13b43e8fe5efa403  tools/backfill-emotion.mjs
```

真实源码在我整个审阅期间**未被我改动**（两次采样一致；反向对照只在 `/tmp/review-affect/mirror` 里做）。

---

## 附录 C · 纪律自查

- ✅ 只读：所有对生产的写操作只有两次「工具正常使用」（`memhub_open` ×3、`memhub_search` ×2），副作用是 `recall.count` 递增（工具的既定行为），没有改任何文件内容。
- ✅ 反向对照只在镜像里做，真源码 sha256 前后一致。
- ✅ 没有 `affect_pin`、没有 `memhub_save`、没有跑 `backfill --apply`（避免改生产状态）。
- ✅ 每条问题都给了真实文件:行号；不确定的地方写进「没验到的」。
- ⚠ 报告成文时 `src/tools-learn.js` 已被另一个手改过（Q8 修复），本报告对它的结论以 15:38:10 版为准。
