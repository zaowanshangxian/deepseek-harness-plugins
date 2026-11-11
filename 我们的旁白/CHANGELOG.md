# 变更记录

只记「改了什么 / 为什么」。版本号跟 `package.json`。本插件**尚未发布**（没有装进任何 profile）。

## [0.1.0] 未发布 —— 独立盲审修复（2 高 / 8 中，全部已修）

盲审抓出的 10 条问题。修完宿主半 27 项 + 客户端半 10 项自检全绿；
新加的每条回归测试都做过**反向对照**（把老写法塞回去确认测试真的会红）。

### 高

**1. `lib/client.js`：factory 里引用了自由变量 `ctx`，设置页根本注册不上**

- 现象：模块既没 `exports.apply` 也没 `exports.inject`，却直接在 `factory(require)` 体里写
  `if (!ctx …) ctx.slots.inject(…)` / `ctx.slots.register(…)`。宿主 `ClientModuleSystem` 只认
  `exports.apply(ctx)` + `exports.inject`，所以那三个 `ctx` 全是未定义的自由变量 —— 设置页与插件配置页
  都注册不上，而且错误被 `guard()` 吞成一条 `console.warn`。宿主半的 21 项测试全绿也发现不了，
  因为 `lib/client.js` 完全没被覆盖。
- 修法：整块搬进 `exports.apply = function (ctx) {…}`，并加 `exports.inject = ['slots']`。
  槽位注册抽成本地 `registerSlot(slotName, options, component)`，和仓库里其它插件同构。
- 验证：新增 `test/client.test.mjs` —— 静态断言（确实有 `exports.apply`、确实声明了 `inject`、
  源码里**所有 `ctx` 引用都落在 apply 括号内**）＋ `vm` 行为断言（喂假 ctx，确认两个槽位真的注册上了）。
  反向对照：把老写法塞回去，5 项全红。

**2. 同处：`ensureStyle` 和两次槽位注册在 factory 物化期执行，没有清理函数**

- 修法：`ensureStyle()` 改成返回刚插入的 `<style>` 节点；样式与槽位各自放进一个 `ctx.effect(...)`，
  清理函数里 `style.remove()`、逐个调用 `slots.register` 返回的注销函数。
  另加 `disposed` 标志：卸载之后才到达的 `slots.inject` 回调不再注册（否则会往已卸载的插件里塞组件）。
- 验证：`client.test.mjs` 断言样式只插 1 次、卸载后 `styles.length === 0`、注销函数被调 2 次、
  卸载后的回调不再注册；重复 `apply` 不会叠出第二个 `<style>`。

### 中

**3. `lib/client.js` GET 不检查 `response.ok`（403/500 回落成 `EMPTY` 当真实设置渲染）**

- 现象：宿主 403 的响应体是 `{ok:false,error:'forbidden'}`，没有 `config`，于是页面把默认值
  当成「服务端现在的设置」画出来，用户以为配置丢了又改一遍。
- 修法：`!response.ok` 直接抛错（文案 `读取失败：HTTP 403`），`body.config` 不是对象也抛；
  失败路径只显示一行错误，**不渲染任何设置控件**。
- 验证：`client.test.mjs`「GET 403 显示读取失败，不把默认值当成真实设置渲染」。

**4. `lib/client.js` POST 只看 `body.persisted === false`，403 被显示成「已保存」**

- 修法：先把响应折成 `{ok, status, body}`（`json()` 失败也不当成功）；`!response.ok` 或
  `body.ok === false` 一律算失败 → 文案 `保存失败：<body.error>`（读不出来就退回 `HTTP <status>`），
  **并把界面回滚**到保存前的值。另加 `saveSeqRef` 序号：数字框失焦即保存，连着改两下时
  只认最后一次的结果，避免前一次失败把后一次的值回滚掉。
- 验证：`client.test.mjs` 三条（403 显示失败并回滚 / 响应体不是 JSON 时用状态码 /
  `persisted:false` 单独一句文案）。反向对照：把老判断塞回去，3 项红。

**5. `lib/index.js` `pruneSessions` 淘汰会话时不同步删 `ledgers`**

- 现象：`sessions` 有 32 条上限、`ledgers` 没有 —— 被淘汰会话的 `{lastInjectAt, byTurn}` 永久留着，
  长时间开着 DSH 就是一条无界增长的泄漏。
- 修法：淘汰时 `ledgers.delete(victim.sessionId)`；POST 关总开关时 `ledgers.clear()` 也一起清。
- 验证：`host.test.mjs` 走 `pickEvictionVictim`（新抽出的纯函数）覆盖淘汰决策，`dropSession` 路径本来就有。

**6. `pruneSessions` 按 `lastVisibleAt` 淘汰，可能挤掉正在跑的会话**

- 现象：当主会话一直在调工具、不出正文时，它的 `lastVisibleAt` 最旧，会话数超过 32 就可能被挤掉，
  之后该会话的提醒静默停止。
- 修法：状态新增 `lastActivityAt`（**任何**帧都刷新，含工具调用、思考、step 结束），淘汰排序改用它；
  已经排期待注入（`due`）的会话优先保留，只有在全都等注入时才退一步淘汰最久没活动的那个。
  决策抽成导出的纯函数 `pickEvictionVictim(states)`，便于单测。
- 验证：`host.test.mjs` 两条。反向对照：排序换回 `lastVisibleAt`，第一条立刻红。

**7. `lib/index.js` 空批次闸门 `step <= 1` 的实际语义是「每回合第 1 步永不参与」**

- 现象：宿主 step 从 1 开始数，所以「整回合只有一步、但模型在这一步里想了很久」永远等不到提醒。
- 处理：**保留行为、补文档**。这不是漏判 —— 注入只能落在 step 边界，单步回合在那段时间里根本没有边界
  可插；把第 1 步的空批次强改成「新请求」还会撞上宿主那条准入规则。
  `README.md`「已知限制」第 6 条写明这个例外，`onPreStep` 里也留了注释，免得下一个会话当成 bug 再改一遍。
- 验证：原有 21 项测试语义不变（第 1 步仍然不注入）。

**8. `lib/index.js` 记账先于提交：被取消的那次也会吃掉冷却和配额**

- 修法：抽 `isAborted(signal)` —— 除了看 `aborted`，还调用宿主自己的 `throwIfAborted()`
  （和宿主用完 decision 之后做的是同一个判断）。注入流程固定成
  **构造消息 → 检查取消 → 才记账（due / lastVisibleAt / lastActivityAt / lastInjectAt / byTurn）**。
- 残留窗口：宿主拿到 decision 之后自己还会 `throwIfAborted()` 一次，那一下插件侧拦不住 ——
  本次只是把「我们已经知道被取消却照样记账」的窗口关掉。
- 验证：`host.test.mjs`「被取消的那一次不记账」。反向对照：把第二次检查换回 `signal?.aborted === true`，红。

**9. `lib/index.js` `writeOverride` 非原子写**

- 修法：写同目录临时文件（`<file>.<pid>.<8位随机>.tmp`）再 `rename`；失败时清掉临时文件并把错误抛给调用方
  （调用方据此回 `persisted:false`）。
- 验证：`host.test.mjs` 两条 —— 落盘内容完整可 parse、目录里不留 `.tmp`、覆盖写同样原子；
  路径不可写时抛错而不是写半截。

**10. `lib/index.js` 没有跨字段约束：`cooldownSeconds` 与 `maxPerTurn` 同为 0**

- 现象：阈值下限只有 10 秒，两个刹车同时松开就等于每个 step 边界都往会话里插一句，纯烧 token。
- 修法：`normalizeConfig` 里加约束 —— 两者同时为 0 时把 `cooldownSeconds` 抬回默认 120（`maxPerTurn: 0`
  仍然合法）；设置页在冷却那行按当前 `maxPerTurn` 显示对应提示，`README.md` 默认值表也写了。
- 验证：`host.test.mjs`「冷却与单回合上限不许同时为 0」。反向对照：去掉约束，红。

### 测试

```bash
node --check lib/index.js && node --check lib/client.js
node --test test/host.test.mjs     # 27 项（原 21 + 6）
node --test test/client.test.mjs   # 10 项（新增）
```

`test/client.test.mjs` 用 `vm` 把 `lib/client.js` 当浏览器脚本加载，喂假 `ctx` / 假 `fetch` / 极简 hooks
运行时，把「读配置 → 改设置 → 保存」整条链真跑一遍 —— 这次的高危 bug 就属于「宿主测试全绿、
客户端半零覆盖」的类型，所以专门补了这一份。

## [0.1.0] 未发布 —— 复审追加（1 中 / 3 低）

复审确认上一条高危已修好（模块契约与宿主源码逐项对上）。这一轮修掉剩下的 1 条中危，
顺手把 3 条 low 里成立的两条做掉、第三条改成实话。

### 中

**11. 覆盖层读失败被当成「没有配置」，且永不重试（会把用户设置整份抹掉）**

- 现象链：`readOverride` 只容忍 `ENOENT`，JSON 损坏或瞬时读失败（Windows 上 `EBUSY`/`EPERM` 常见）
  直接抛 → `ensureOverride` 把**任何**错误都吞成 `override = {}` 并置 `overrideLoaded = true`（此后本进程不再重读）
  → 设置页把默认值当真实设置画出来 → 用户点保存 → 把 patch 合并进这个空对象后**整份覆盖写盘**
  → 用户之前存过的 `enabled / silentSeconds / cooldownSeconds` 永久消失，日志里只留一条 warn。
- 修法：把「读一次」拆成三态，`overrideLoaded` 换成 `overrideStatus`（`pending` / `ok` / `unreadable`）+ `overrideNote`：

  - **文件损坏**（`SyntaxError`）→ 先 `backupBrokenOverride()` 挪成 `config.json.broken-<YYYYMMDD-HHMMSS>`，
    成功才按「没有配置」继续；备份失败就降级成 `unreadable`（备份都没成，绝不能再往下写）。
  - **读失败** → 标 `unreadable` 但**不置终态**（`loading` 在 `finally` 里清掉），下一次请求自动重试；
    期间 `POST` 直接回 `409 config-unreadable`，一个字节都不写用户配置。
  - `publicConfig()` 多带 `configWritable` / `configNote`；设置页据此显示提示条、锁住所有控件、
    给一个「重新读取」按钮；保存失败时优先显示宿主给的 `message`（就是那句人话）。
- 验证：`host.test.mjs` 两条 —— (a) 用「同名目录」造 `EISDIR`：GET 标 not-writable、POST 回 409 且文件仍是目录、
  修好文件后下一次 GET 自动重读并回 `silentSeconds: 55`、随后 POST 正常落盘；(b) 写坏 JSON：备份文件
  内容原样保留、GET 带提示、POST 照常能存且提示在写成功后消失。
  `client.test.mjs` 两条 —— 提示条 + 控件 disabled + 「重新读取」能恢复；409 的 `message` 原样显示。
  反向对照：把写入闸门去掉 / 把备份调用去掉，对应测试立刻红。

### 低

**12. `markVisible` 清掉 `due` 却不重排定时器**

- 现象：`due === true` 意味着此刻没有定时器；模型随后说了一句正文把它清掉后，本步余下的静默再也算不到
  （单步长执行的回合会整段漏掉提醒）。
- 修法：`markVisible` 发现「刚清掉一个 `due` 且没有定时器」时 `arm()` 一次；顺带更新 `lastActivityAt`。
- 验证：`host.test.mjs`「到点排期之后又冒出正文」。反向对照：去掉这一行，红。

**13. 会话淘汰只靠 assistant-stream 帧判活，长工具执行期间没有帧**

- 修法：`agent/pre-step` 与 `session:event` 也刷新 `lastActivityAt`（都只是「这个会话还活着」的信号，
  不参与静默计时）。残余风险写进 README「已知限制」第 7 条：要撞上得同时有 32 个以上活跃会话
  且其中一个卡在几分钟以上的工具里，为此不再加机制。

**14. README 说注入消息「界面隐藏」，实际会显示一行来源标记**

- 修法：改成实话 —— 不进对话流、不是一条假的「用户发言」，但界面上能看到
  `narrator-lite · 要求模型中途汇报进度` 这一行；`ANALYSIS.md` 里同一处断言也一并改准。

### 测试

```bash
node --check lib/index.js && node --check lib/client.js
node --test test/host.test.mjs     # 30 项（上一轮 27 + 这条 1 + 覆盖层 2）
node --test test/client.test.mjs   # 12 项（上一轮 10 + 配置不可信 2）
npm test                           # 42 项全绿
```

> 夹具的坑记一笔：`callRoute` 一开始用 200 轮 `setImmediate` 等响应，POST 要真落盘（临时文件 + rename）
> 偶尔超过这个预算就假红；改成真实定时器最多等 2 秒。另外假请求的 body 必须等路由挂上 `end` 监听之后
> 再喂（路由会先 `await` 读配置），否则 POST 永远等不到 `end`。
