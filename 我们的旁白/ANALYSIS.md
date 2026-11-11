# dsh-narrator 分析 + 我们的实现说明

> 分析对象：`Asza-other/dsh-narrator` v0.12.6（MIT，约 3 星）。
> 取码方式：GitHub API `contents` 返回 base64（`raw.githubusercontent.com` 在本机不稳）。
> 抓下来的文件在会话临时目录，正式引用以下面「证据」里的仓库路径 + 行号为准。
> 我们的实现只借鉴机制，不复用任何一行源码（见文末「借鉴点对照」）。

---

## 0. 一句话结论

它把「让模型自己说进度」拆成 **计时 → 记账 → 在 step 边界注入一条 user 消息**：
插话不是当场塞进去的，而是记一个 `due` 标记，等宿主跑 `agent/pre-step` 这个 waterfall 时
把消息并进本步消息批次——因为 `decision.messages` 非空，宿主那条
「`turnEnds && decision.messages.length === 0` 就 `break`」的规则判不出回合结束，任务于是继续。

---

## 1. 「沉默」怎么判定

**不是**看某个 hook 烧了多久，而是**看「距最后一次正文输出」过了多久**，用 `setTimeout` 自己计时。

挂两个宿主动作：

| 钩子 | 用途 | 证据 |
| --- | --- | --- |
| `agent/assistant-stream` | 收流帧，维护"最后一次正文输出"时刻 + 起停定时器 | `lib/index.js:1106` |
| `agent/pre-step` | 真正注入的唯一位置 | `lib/index.js:1107` |

判「有输出」的口径（这是它反复改过的地方，README 有一整张表 `README.md:170-185`）：

| 帧 | 是否重置计时 | 为什么 |
| --- | --- | --- |
| `text-delta`（非空） | 重置 | 用户真的看见了字 |
| `block-start`（`blockType: 'text'`） | 重置 | 同上 |
| `block-start`（`blockType: 'tool-call'`） | **不重置** | 调工具不是说话 |
| `tool-call-delta` | **不重置** | 密集调工具恰恰是最该提示的场景 |
| `reasoning-delta` | **不重置** | 想多久都不算开口 |
| step `start` | **同回合内沿用**，不归零 | 见下面「坑 1」 |
| step `end` | 只记时长，不清状态/定时器 | 换步之间用户同样什么都看不到 |
| `turn/end`（`session/event`） | 清零 | 新回合从用户发言重新起算 |

到点后不直接注入：`tick()` 只把 `st.due = true` 写进内存（`lib/index.js:691-783`），
再等下一个 `pre-step`。原因有两条，都写在注释里：

1. 到点那一刻模型往往卡在「assistant(tool_calls)」和「tool 结果」之间，此时往会话里塞消息会落在
   调用与结果之间，宿主直接报错（`lib/index.js:683-690`）。
2. 注入只能发生在 step 边界，而 step 边界可能很久（例如主会话在等子代理好几分钟）。

限流由三样东西管：`silentSeconds`（阈值）、`cooldownSeconds`（两次注入最小间隔）、
`maxPerTurn`（单回合上限，0 = 不限，靠冷却兜底）。注入成功后还会把
`lastVisibleAt` 推到现在——否则定时器一醒就判"仍然静默"会连发（`lib/index.js:926`）。

---

## 2. 「注入」注到哪 —— 最关键的一点

**注到 `agent/pre-step` 的 waterfall 返回值里，作为一条 `role: 'user'` 消息追加进本步的 `decision.messages`。**
不是系统提示、不是在回合中途硬插、不是改模板。

```js
async function onPreStep(payload, next) {
  const decision = await next()          // 先拿下游（含宿主自己的 runtime context）组装好的决策
  ...
  const message = createUserMessage({
    content: [{ type: 'text', text: cfg.prompt }],
    source: cfg.showInjected ? { kind: 'user' } : { kind: 'narrator', form: 'notice', summary: '…' },
  })
  return { ...decision, messages: [...decision.messages, message] }
}
```

它到底改了 DSH 的哪个环节：

- **不改系统提示**（早期版本用 `systemPrompt.section`，v0.11.0 起明确放弃：系统提示对"回合是否结束"没有任何影响，改了也拦不住回合关闭——`test/apply.test.js:150` 有回归测试）。
- **不改用户消息、不改排队提示词**（那是 `inbox`/queued prompt 的地盘）。
- **改的是驱动器的「本步消息批次」**：`agent/pre-step` 是 waterfall，`payload` 带 `{ agent, turn, step, signal }`，`next()` 给出 `{ kind: 'enter' | 'reject', messages: [...] }`。只有 `kind === 'enter'` 才能追加；`reject` 表示宿主已决定不进这一步。
- 追加的消息带 `source.form = 'notice'`：宿主把它投影成 **context 节点**，`isVisibleChatNode` 把它从可见对话行里排除 → 不进对话流、不会成为一条假的「用户发言」，但界面上仍会多一行来源标记（本插件实测是 `narrator-lite · 要求模型中途汇报进度`），模型读得到（`lib/index.js:145-158`）。想让它整条显示成用户发言就换成 `{ kind: 'user' }`。

为什么绕这么一大圈：DSH 的 turn 循环里有条硬规则（README 直接引了原文）

```js
if (turnEnds && decision.messages.length === 0) break;
```

模型单发一条不带工具调用的纯文本，会被判成「回合完成」→ 任务当场收尾。所以"在提示词里让模型中途报个进度"
这条路在 DSH 里走不通；唯一合法的口子是让**消息批次非空**，而消息批次只能从 `pre-step` 改。

顺带一条被否决的路（`README.md:159`）：**别用 `session.append` 硬插 assistant 消息**。
除了语义错（会被同 step 的真实回复整体覆盖），还有三条暗礁：必须带 `reasoning` block、必须带 `stream: []`、
**绝不能传 `sourceEventSeqs`**（`SessionPersistence` 对 `assistant/message` 有硬校验，非 undefined 就抛）。

---

## 3. 「不打断任务」怎么保证 / 代价是什么

保证来自机制本身，不来自提示词：

1. `messages` 非空 → 宿主判不出回合结束，循环继续。
2. 注入发生在 step **边界**，不破坏 `tool_calls ↔ tool 结果` 的配对。
3. 注入用的是一条"用户中途插嘴"口吻的提示词，末尾明确要求
   「这是中途汇报，说完必须继续执行，不要结束任务」（`lib/index.js:121-131`）。
4. 不取消、不重启、不重排任务：它不碰 `agent.cancel()`（对比 `dsh-thinking-guard` 是掐断）也不碰 history。

代价与风险（作者自己在「已知限制」里认了，`功能介绍.md:118-124`）：

- **不是硬保证**：机制只保证"回合不关"，模型自己写完就停那还是会停。提示词末尾那两句就是在补这个漏。
- **上下文会变长**：每条注入都会作为 context 节点持久化进会话，长任务里注入 N 次就是 N 条。
  所以限流（冷却 + 单回合上限）+ 提示词只有一段固定文本（不塞任务内容）是必须的。
- **有重复劳动的诱惑**：模型被中途问"你在做什么"时容易重述、甚至重做。提示词里点了「不要罗列工具名」「说结论」，
  但它仍可能复述已完成的步骤——这是提示词层面的概率问题，不是机制能解决的。
- **延迟**：到点只是记账，真正注入要等下一个 step 边界；主会话在等子代理时可能等几分钟
  （它的浮窗为此分三段显示「还在等 / 正在整理汇报 / 正在汇报」）。
- **子代理默认不汇报**（`includeSubagents: false`）：子代理会话界面上看不见，注入等于白烧一次模型调用。

---

## 4. 可配置项

`lib/index.js:68-110` 的 `DEFAULTS` + 设置页可改字段 `lib/index.js:1197-1212`：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | true | 总开关（关掉后每帧直接 return，自检里计 `skipped.disabled`） |
| `silentSeconds` | 60 | 距最后一次正文输出多久算"沉默" |
| `cooldownSeconds` | 60 | 两次注入最小间隔 |
| `maxPerTurn` | 0 | 单回合注入上限，0 = 不限 |
| `overlayEnabled` | true | 是否弹左下角浮窗 |
| `overlayOpacity` / `lingerSeconds` | 1 / 90 | 浮窗透明度 / 停留时长 |
| `showInjected` | false | 把注入原文当可见 user 消息显示（排查用） |
| `includeSubagents` | false | 子代理也汇报 |
| `prompt` | 内置四点式 | 自定义注入提示词（有 4096 字符硬上限） |
| `locale` | zh | 中/英内置提示词 |

配置分两层：`cordis.patch.yml` 的 `config:`（部署者）+ 设置页覆盖层
`~/.dsh/narrator/config.json`（用户），覆盖层只在用户显式保存过的字段上生效
（`lib/config-store.js:1-20`）。设置页读写走自己注册的 loopback HTTP 路由
（`/api/narrator/config` 等），不依赖宿主对第三方插件开放的 settings 命名空间。

---

## 5. 踩过的坑（都能在他们的注释/测试里找到证据）

1. **跨步清零 → 永不触发**：一开始每个 step `start` 都把计时归零，而实测单步只有 5~7 秒（最长 17.5 秒），
   阈值 60 秒时永远到不了。修法：同回合内沿用 `lastVisibleAt`（`lib/index.js:1001-1007`, `README.md:170-185`）。
2. **tool-call 重置计时 → 长任务永不触发**：密集调工具的长任务正是最需要提示的场景（`lib/index.js:1082-1090`）。
3. **`due` 竞态 → 自问自答**：到点置了 `due`，模型随后在同一 step 内自己说了正文。若 `text-delta` 不把 `due` 清掉，
   下一个 `pre-step` 还会再注入一次「请汇报」，界面上出现一段自问自答。修法：任何正文帧都 `st.due = false`（`lib/index.js:1050-1063`）。
4. **判"子代理"用错了字段**：`parentSession` 存在也可能是**分支会话**（用户看得见的主会话），
   于是 `includeSubagents:false` 把主窗口的播报全拦掉了，自检里 `skipped.subagent` 涨到 27 万。
   唯一可靠判据是 `session.header.origin === 'subagent'`（`lib/index.js:327-366`, `README.md:160`）。
5. **`includeSubagents` 用 `!== false` 判 → 没配置等于打开**：`undefined !== false` 为真，与 DEFAULTS 相反。
   修法：布尔默认值一律 `=== true`（`lib/index.js:313-316`）。
6. **配置归一化的"假数字"**：`Number(null) === 0`、`Number('') === 0`、`Number(false) === 0` 都是有限值，
   直接夹紧会把"没配过"变成"想调到最透明/最短"。修法：先排掉 null/''/boolean 再 `Number()`（`lib/index.js:216-229`）。
7. **截断劈开代理对**：`slice(0, 4096)` 若切在 emoji 的高/低代理之间，写进会话变成 U+FFFD。
   修法：末位是高代理就退一格（`lib/index.js:245-251`）。
8. **版本号写死**：`/status` 报的版本与磁盘上的代码不一致时，"功能没生效"会被误判成"跑的是旧代码"。
   修法：运行时读自身 `package.json`，读不到就 `'unknown'`（`lib/index.js:49-59`）。
9. **测试污染真实配置**：没在 import 插件前隔离 `DSH_NARRATOR_CONFIG`，测试写到用户配置上，12 项假失败（`README.md:300`）。
10. **loopback ≠ 安全**：任意网页都能 fetch 到 `127.0.0.1`。要同时校验 Host 白名单（防 DNS rebinding）
    和 Origin/同源，写路由再加 `Sec-Fetch-Site` 与 `Content-Type: application/json`（`lib/index.js:1219-1303`）。
11. **浮窗的自我撤销逻辑**：模型汇报那段正文本身也是 `text-delta`，若拿它推进"最后一次正文"，
    浮窗会在模型正写总结时把自己撤掉。修法：注入后开一个"截取窗口"，窗口内的正文不进 `lastTextAt`（`lib/index.js:1064-1079`）。

---

## 6. 我们做的话：留什么、砍什么

### 必须保留（机制性，砍了就不工作）

| 保留 | 理由 |
| --- | --- |
| `agent/assistant-stream` 计时，只认正文 | 这是"沉默"唯一的正确定义；用工具的密度不能代替用户可见进展 |
| 到点只记 `due`，注入留到 `agent/pre-step` | 中途插话会撞 `tool_calls ↔ tool` 配对，宿主直接报错 |
| `await next()` 后追加 `decision.messages` | waterfall 契约；`kind !== 'enter'` 时不能塞 |
| `source.form = 'notice'` | 不往对话流里塞一条假的"用户发言"，但模型必须读得到 |
| 提示词里写死「说完继续，不要结束任务」 | 机制只保证回合不关，停不停还是模型说了算 |
| 注入后把计时推到 now + 冷却 | 否则立刻二次触发，变成刷屏 |
| `session.header.origin === 'subagent'` 判据 | 否则内置字段全失效，或在分支会话里静音 |
| `turn/end` 与 `agent/disposed` 清状态、`ctx.effect` 清定时器 | 定时器不 unref / 不清理，进程退不掉，状态泄漏 |
| `silentSeconds` 的下限（不能设 1 秒） | 1 秒阈值等于每步注入，纯烧 token |

### 可以简化（我们做了）

| 砍掉 | 为什么 |
| --- | --- |
| 左下角浮窗（DV 测 DOM、截取模型原话、三阶段状态机、反向撤销） | 那是"展示"层，跟"别让用户以为卡死"这个核心目标可以解耦；也是 client.js 88KB 的主要来源 |
| 设置页的滑杆/测试模式/透明度和停留时长 | MVP 只要「开关 + 阈值 + 冷却」，用数字输入就够 |
| 自检 `/status` 路由 + 十几个 `skipped.*` 计数 | 排查价值高，但不是 MVP 必需；先用日志 + 一个纯函数化决策路径代替 |
| 中英双语提示词、`locale` 字段 | 本机只有一个语言场景 |
| 截取模型汇报原文 | 没有浮窗就不需要 |
| `includeSubagents` 开关 | 固定不汇报子代理（省一次调用），留成常量比留成选项更不容易配错 |
| 独立 `config-store.js`（145 行） | 层数保留（yml + 覆盖层），实现压到 20 行读写 + 打补丁合并 |

### 我们的实现（本目录）

```
我们的旁白/
  package.json         插件清单（dsh.bundle.patch + dsh.client.platform=web）
  cordis.patch.yml     只 insert 自己这一行
  lib/index.js         宿主半：计时 + pre-step 注入 + 开关 + 配置路由
  lib/client.js        浏览器半：设置页（开关 / 阈值 / 冷却），走宿主路由
  test/host.test.mjs   可重跑自检（纯函数 + 假 ctx 跑完整链路）
  README.md            装法、默认值、已知限制
```

与参考实现的差异（机制同、代码不同）：

- 决策抽成**纯函数** `evaluateSilence({ state, ledger, config, now })` → `{ action: 'wait'|'due'|'cooldown'|'cap' }`，
  定时器只负责按返回的 `delayMs` 重新排期，所有时间判断都能脱离宿主单测。
- 没有浮窗通道，宿主半不注册任何"展示"路由，只留一条给设置页读写配置的 loopback 路由。
- 状态用 `Map<sessionId, state>` + `Map<sessionId, ledger>`，超过 32 个会话按最旧淘汰（参考实现靠 `turn/end` 清，
  我们额外加了兜底）。
- 我们自己写的每一条注释都对应到具体行为，不抄它的注释原文。

### 借鉴点对照（诚实清单）

| 借鉴来的思路 | 来源 | 我们改成了什么 |
| --- | --- | --- |
| 用 `agent/pre-step` waterfall 追加消息绕开 turn 结束规则 | 参考 README + `lib/index.js:866-973`；它自己也说触发机制参考了 `dsh-step-pause` | 同样挂 `agent/pre-step`，但注入代码重写，消息对象自己造 |
| 静默计时的口径（正文重置、工具不重置、跨步不清零） | 参考 README 的表 | 同样的口径，但由 `evaluateSilence` 纯函数承载 |
| `source.form='notice'` 隐藏注入原文 | `lib/index.js:145-158` | 同样用 notice，`summary` 文案自己写 |
| 子代理判据 `origin === 'subagent'` | `lib/index.js:327-366` | 保留判据，硬编码不汇报 |
| 冷却 / 单回合上限 / 注入后推计时 | `lib/index.js:691-783` | 保留语义，阈值默认值改成本机更合适的 90/120/4 |

**没有复制代码**：没有 `createUserMessage` 的候选路径探测、没有 `config-store.js` 的双层合并实现、
没有浮窗/截取/自检计数的任何函数或注释。行文与结构按本仓库已有插件（`人格与口癖`、`工具税`）的约定重写。

### 从变体里补到的两条（已进我们的代码）

`S-AN-Shu/dsh-progress-narrator` 是独立实现、更贴近新宿主 API，它的 `agent/pre-step` 处理比主参考更严：

| 变体里的做法 | 我们采纳成什么 |
| --- | --- |
| 准入闸：`if (!decision.messages.length && (step === 1 \|\| incoming.length > 0)) return decision`（空的首批消息不能被插件变成一次新请求） | `lib/index.js` 的 `onPreStep` 里同款判断（空批次 + 第 1 步 / 有待处理输入 → 放它自己去发请求） |
| `signal.aborted` 检查，且注入后把「预留」记在账上、abort 时释放 | 注入前后各查一次 `payload.signal?.aborted`（构造消息是异步的，回来时这一步可能已被取消） |

它还有两处我们**没**跟：`ctx.settings` + `ctx.connection.fetch`（带签名的认证路由）是本机这一版 DSH
不一定提供的服务，我们沿用本仓库已装插件在用的 `ctx.inject(['webServer'])` + loopback/同源守卫；
它的「规则消息要去重、按 `ruleKey` 判重」也超出了 MVP 范围（我们只发固定文案）。

---

## 7. 验证做了什么、没做什么

| 项 | 结果 |
| --- | --- |
| `node --test test/host.test.mjs` | **21 项全过**（计时语义 / 注入位置与消息形状 / 开关 / 冷却 / 单回合上限 / 子代理 / 换步不清零 / 新回合归零 / 卸载清理） |
| `node --check lib/index.js`、`lib/client.js` | 语法通过 |
| 真机安装 | **没做**（任务要求只交源码、不装、不改 `cordis.patch.yml`） |
| 客户端设置页渲染 | **没做**（需要真宿主里的 `__ModuleLoader__` + `ctx.slots`，本机无法离线跑） |
| `decision` 结构体的宿主源码实证 | **没做到**：`app.asar` 是压缩包，只能确认 `agent/pre-step`、`agent/assistant-stream`、`createUserMessage` 三个符号存在，读不到 `{ kind, messages }` 的定义。形状来自三份独立实现 + 测试桩 |

测试期间真发现并修掉了一个自己的 bug：`ledger.lastInjectAt = 0` 被当成「纪元时刻刚注入过」，
在 mock timers（时钟从 0 起）下会让首次提醒被冷却挡掉。真实时钟是 epoch，永远看不出来——
这正是"纯函数 + 假时钟"值得写的原因。


---

## 8. 证据与限制

- 参考源码逐行核对处：`lib/index.js:7-29`（设计说明）、`:868-973`（注入）、`:976-1104`（计时）、`:1106-1186`（注册与清理）、
  `README.md:153-185`（四条工程约束 + 计时语义表）、`README.md:298-304`（测试铁律）、`功能介绍.md:118-124`（已知限制）。
- 宿主侧交叉验证：本机 `app.asar` 内可 grep 到 `agent/pre-step`、`agent/assistant-stream`、`createUserMessage` 三个符号，
  宿主文档段（同 asar）也写着「驱动器组装提示词与工具，并运行 `agent/pre-step`」。
  但 asar 是压缩包，无法读到 `decision` 结构体的完整定义——**`{ kind, messages }` 的形状来自三份独立实现**
  （主参考的测试桩 `test/apply.test.js:80-90`、`dsh-progress-narrator` 的 `lib/index.js:69-99`、
  `dsh-narrator(Chasterccj)` 的 `lib/index.js:111-115`），**不是我们从宿主源码里读出来的**。这条要在真机上装一次才能彻底钉死。
- 三个同名变体（GitHub API 限流后改用 `git clone --depth 1` 全部拉下来了，已逐个看过）：
  - `Chasterccj/dsh-narrator` v0.1.0 —— 名字撞了但不是同一件事：它是「不确定度闸门 + 中断策略 + 命令」，
    用 `tools/pre-execute` / `tools/post-execute` 拦不可逆操作，`systemPrompt.context` 写策略，`agent/pre-step` 只做记账。
  - `S-AN-Shu/dsh-progress-narrator` v0.4.3 —— 与主参考同题、独立实现、更贴新宿主（`ctx.settings` + `ctx.connection.fetch`）。
    我们的两条硬化（准入闸、abort 检查）来自它。
  - `yinque91/dsh-live-narrator` —— 语音解说（`client.js` + `locale/`），不走 pre-step 注入；任务里说明不做这档。
