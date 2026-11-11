# 设计说明：快速显示花费

面向维护者。读完应该能回答：为什么这样写、改哪里、改坏了怎么验证。

## 1. 边界

- **纯客户端插件**：Host 半侧是空壳（`lib/index.js` 只有 `name` + 空的 `apply()`），不注册工具、不注册路由。
- **零接管**：不注册官方槽位、不替换官方组件、不改 profile、不写 DSH 配置。
- 唯一副作用：往官方卡片的 `<dl>` 里追加两个节点（`<dt>` + `<dd>`），卡片关闭即随 portal 卸载。

## 2. 官方 DOM 契约（这是全部依赖）

| 用途 | 选择器 | 说明 |
| --- | --- | --- |
| 会话卡片 | `div[role="dialog"][aria-label="Token 用量"]` | 点输入框下方 `8.6M tok · 缓存命中 99%` |
| 单轮卡片 | `div[role="dialog"][aria-label="本轮用量"]` | 点消息底部 `用量 24.2M tok`；英文 `Turn usage` |
| 明细网格 | 卡片内 `[data-turn-usage-details]`（单轮）或第一个含 `dt` 的 `<dl>` | `display:grid; grid-template-columns: minmax(76px,auto) minmax(0,1fr)` |
| 行 | `<dt>` 标签 / `<dd>` 数值（`dd` 右对齐 + `tabular-nums`） | —— |
| 模型行（单轮） | 单轮卡片 `<dl>` 里 `dt` 文案为 `提供方 / 模型`（英文 `Provider / Model`），其后的 `dd` 形如 `deepseek-account/deepseek-v4-pro`，多模型用逗号连接 | 官方 `TurnUsagePanel` 源码：`t("message.turnUsage.model")` + `${route.provider}/${route.model}` |

卡片是 React portal 渲染到 `document.body` 的；`<dl>` 的样式来自官方 CSS module，所以
**追加行不要自己写样式**，直接塞 `dt`/`dd`，列宽、颜色、右对齐全部继承。

## 3. 数据流

```
卡片打开
  ├─ findUsageDialog()            role=dialog + aria-label 命中 → dialog（快路径）
  │                                没命中时：先 querySelector('[role="dialog"]') 判断页面上有没有 dialog，
  │                                没有就直接返回 —— 卡片关着时不扫全文档
  ├─ detailsList(dialog)          [data-turn-usage-details] 或首个含 dt 的 dl
  ├─ readMetrics(list)            从 dt/dd 文本抓 缓存读取/未缓存输入/缓存写入/输出
  ├─ readModel(list)              单轮卡片：读「提供方 / 模型」行的 dd（provider/model）→ priceTierOf()
  ├─ 单轮卡片 → computeCost(metric, model)  本轮数字 × 当前时段价 × 该模型档位 → 「本轮估算」
  └─ 会话卡片
       ├─ refreshSummary()        GET /token-mb/summary（30s TTL，两套 URL/结构都兼容）
       ├─ refreshBalance()        GET /token-mb/balance（60s TTL）→ 账户余额行
       ├─ currentSessionTitle()   nav[class*=crumbs] [class*=crumbCurrent] → 当前会话标题
       ├─ currentSessionFromSummary(payload, title)
       │     标题命中 → 该会话 cny；否则 → 最近写入的非子代理会话（跳过没有 cny 的记录）；
       │     都没有 → 估算；连估算也没有 → 不写行（绝不显示「≈ —」）
       └─ todayTotal(payload)
             data.days[今天]（北京时间日界）→ 当天金额，行名「今日累计」
             没有 days → 「最后写入在今天」的会话累计之和，行名「涉及会话累计」+ 悬停说明
  → 写入 <dt>花费金额</dt><dd>≈ ¥x</dd> + dd.title 悬停明细
卡片关闭
  → portal 卸载，节点随之消失；下一轮 sync 发现 list 不存在 → removeRow() 兜底
```

触发时机：`apply()` 里把运行时挂在 `ctx.effect` 上（一个 `MutationObserver` + 1.5s `setInterval` +
`pointerdown`/`click`/`keydown` 三个 capture 监听 + 60s 预热刷新定时器），卸载时全部收回；
`sync()` 幂等——节点已在且 `parentNode` 正确就只更新文本。

## 4. 代码地图（`src/client.js`，单文件 ~970 行）

| 位置 | 责任 |
| --- | --- |
| `installErrorReporter()` | 本地错误记录（localStorage，最多 20 条，去重）+ `window.__dshErrorReporter` |
| `PRICE_TIERS` / `priceTierOf()` | 峰谷价目（flash / v4-pro）与模型名 → 档位；认不出返回 `null`，绝不静默按 flash 算而不说 |
| `findUsageDialog()` | 唯一锚点入口；快路径 querySelector，慢路径（shadow DOM 兜底）先过一次 dialog 存在性判断 |
| `detailsList()` | 找明细 `<dl>`；`perTurn` 由 `data-turn-usage-details` 判断 |
| `readMetrics()` / `parseUnit()` | 解析 `69,092 tok` / `1.2M tok` 这类文本（去逗号、支持 k/M/B） |
| `readModel()` | 读单轮卡片的「提供方 / 模型」行 → `{provider, model, tier, mixed, official}` |
| `computeCost(metric, model)` | 按档位 × 当前时段价估算本轮；缓存写入不计费；返回 `assumedTier` 供文案标注 |
| `currentSessionTitle()` | 当前会话标题（面包屑），用于匹配 token-mb 记录 |
| `currentSessionFromSummary()` | token-mb 记录选会话：标题优先，其次最近写入的非子代理；跳过没有 `cny` 的记录 |
| `todayTotal()` / `cstDayKey()` | 今日金额：优先 `data.days[今天]`，没有就降级成会话累计并标 `source='sessions'` |
| `refreshSummary()` | 30s TTL、两套 URL 依次尝试、失败静默 |
| `balanceOf()` / `refreshBalance()` | 账户余额：按上游源码字段取 `balance_infos[].total_balance`（优先 CNY）/ `total_costs[].amount`；`supported:false` → `{disabled:true}`（配置页要这个对象，卡片路径必须判断 `disabled`） |
| `buildTooltip()` | 悬停明细：会话记录 / 价目档 / 假设标注（按 flash 估、缓存写入不计费、非官方 provider） |
| `sync()` / `removeRow()` | 注入与回收；写 `window.__inlineCostStatus` 供配置页「定位状态」读 |
| `installRuntime()` | 预热 + 定时器 + observer + 事件监听，返回清理函数 |
| `InlineCostSettings` | 配置页组件（显示开关 / 错误上报 / 定位状态 / 报告按钮） |
| `exports.apply(ctx)` | `ctx.effect(installRuntime)` + `ctx.slots.inject('settings.section')` 注册配置页 |
| `exports.__internals` | 纯函数出口，供 `tools/regress.mjs` 单测；运行时没人读 |

## 5. 关键决策与踩过的坑

| 决策 | 为什么 |
| --- | --- |
| 不复用官方 usage 槽位 | v0.3 曾替换 `conversation.composer.dock` 的 usage 格子 → `ui-chat` 启动失败、DSH 进安全模式、profile 被重置。**铁律**：官方槽位 id 一律不碰 |
| 按 `role` + `aria-label` 锚定，而不是按文本猜 | 早期版本用「文本里同时出现 未缓存输入/缓存读取/输出/用量」定位，真实页面里命中的是**聊天记录里的普通 span**（用户消息本身就带这些词），于是永远插不进去 |
| 追加 `dt`/`dd` 到官方 `<dl>` | 官方是 grid 两列，塞 `div` 会破坏布局；克隆行或自带样式都会和主题脱节 |
| token-mb 路由两套都试 | 社区有两个孪生包：`dsh-token-mb` → `/token-mb/summary`，`dsh-token-meter-panel` → `/token-meter-panel/summary`；返回都套一层 `{ ok, data }` |
| 会话匹配先看标题 | 只看 `lastTime` 时，多会话同时活跃会取错；标题（面包屑）是当前视图的强信号 |
| 余额只读上游聚合接口，不自己算 | 余额要密钥、要官方接口，只有 token-mb 宿主侧能做；它的 `/balance` 是公开文档化的只读路由（MIT），字段按源码取 |
| 单轮卡片只给估算 | token-mb 只有会话维度，把会话累计显示在单轮卡片里是撒谎 |
| 「今日累计」只认分天聚合 | `data.sessions[*].cny` 是**会话累计**，拿它按 `lastTime` 筛日期会把前几天的花费算进今天（0.9.5 的错）。token-mb ≥0.6 的 `data.days` 才是当天口径 |
| 拿不到分天数据就改文案，不改数字 | 「涉及会话累计」+ 悬停说明，比「一个看着精确的错数字」诚实 |
| 缓存写入不计费 | 官方价目表没有这一档，token-mb 的 `costOf()` 也只算 hit/miss/out；按未缓存输入价收会虚高 |
| 认不出模型仍出数但标注 | 完全不出数会让「没装 token-mb 的单轮卡片」变成空白；标注「按 flash 价估算」把不确定性交回用户 |
| `package.json` 的 `dsh.client.inject` 与代码里的 `exports.inject` **不是一回事** | 前者是客户端模块 id（哪些 client 包要先加载），后者是 cordis 服务名（这里要 `slots`）。兄弟插件 `dsh-plugin-save-token` 同样是 manifest `[]` + 代码 `['slots','locale']`，不要「对齐」 |

## 6. 状态位（给排错用）

```js
window.__inlineCostStatus
// { card: boolean, row: boolean, scope: 'session' | 'turn' | '', at: number, balance: boolean }
```

配置页「定位状态」直接渲染这个对象；`card=false` 表示当时没有用量卡片打开（正常），
`card=true, row=false` 才是真出问题。`balance` 为 `false` 既可能是「没取到」也可能是「上游关了
showBalance」，配置页下面那行会区分。

## 7. 验证方式

- 离线：`node tools/smoke.mjs`（主链路）+ `node tools/regress.mjs`（口径/定价/余额/性能/生命周期），
  两者共用 `tools/harness.mjs`（假 DOM + 可控时钟 + 定时器/监听计数）
- 复现验证：`INLINE_COST_CLIENT=<旧文件> node tools/regress.mjs`，旧代码应报出一排 FAILED
- 真实 GUI：`.verify/cdp/`（无头 Edge + CDP，伪造同源 cookie，点击卡片、读 DOM、截图）
- 截图产物：`.verify/screenshots/`（不入库）
- 手工回归清单：
  1. 打开会话卡片 → 有「花费金额」且右对齐
  2. 打开单轮卡片 → 有「花费金额」，悬停显示「本轮估算」+ 用的哪一档价目
  3. 关卡片 → 行消失；再开 → 回来
  4. 关「显示花费金额」开关 → 行消失；打开 → 回来
  5. 杀掉 token-mb（或改 `SUMMARY_URLS` 为空）→ 会话卡片仍有金额（估算）+ 悬停提示「token-mb 不可用」
  6. 在 token-mb 里关掉 showBalance → 两张卡片都**没有**「账户余额」行；配置页提示「已关闭」
  7. 老版本 token-mb（summary 没有 `days`）→ 第二行写「涉及会话累计」，悬停说明它不是当天花费

## 8. 改版时的自愈能力

官方改了卡片结构时，插件会**静默不显示**（不影响官方功能），排错路径：
配置页「定位状态」→ 若是 `card=false` 但卡片明明开着，说明 `aria-label` 或 `<dl>` 变了，
改 `findUsageDialog()` / `detailsList()` 两处即可，其余逻辑不用动。

**已知限制**

- 慢路径（shadow DOM 兜底）现在只在「页面上确实存在 `role="dialog"` 元素」时触发（省掉卡片关着时的
  全文档遍历）；官方卡片是 `createPortal(document.body)`，本来就不在 shadow DOM 里。
- 即使从 shadow DOM 里扫到卡片并插入行，后续更新/回收走 `document.getElementById`（穿不透 shadowRoot），
  所以那种情况只能「插进去一次」。同样理由：官方卡片不在 shadow DOM 里，不为此加复杂度。
