# 设计说明：输入框花费金额

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

卡片是 React portal 渲染到 `document.body` 的；`<dl>` 的样式来自官方 CSS module，所以
**追加行不要自己写样式**，直接塞 `dt`/`dd`，列宽、颜色、右对齐全部继承。

## 3. 数据流

```
卡片打开
  ├─ findUsageDialog()            role=dialog + aria-label 命中 → dialog
  ├─ detailsList(dialog)          [data-turn-usage-details] 或首个含 dt 的 dl
  ├─ readMetrics(list)            从 dt/dd 文本抓 缓存读取/未缓存输入/缓存写入/输出
  ├─ 单轮卡片 → computeCost()      本轮数字 × 当前时段价 → 「本轮估算」
  └─ 会话卡片
       ├─ refreshSummary()        GET /token-mb/summary（30s TTL，两套 URL/结构都兼容）
       ├─ currentSessionTitle()   nav[class*=crumbs] [class*=crumbCurrent] → 当前会话标题
       └─ currentSessionFromSummary(payload, title)
             标题命中 → 该会话 cny；否则 → 最近写入的非子代理会话；都没有 → 估算
  → 写入 <dt>花费金额</dt><dd>≈ ¥x</dd> + dd.title 悬停明细
卡片关闭
  → portal 卸载，节点随之消失；下一轮 sync 发现 list 不存在 → removeRow() 兜底
```

触发时机：`apply()` 里装一个 `MutationObserver`（body，subtree）+ 一个 1.5s 的 `setInterval`，
二者都调 `sync()`；`sync()` 幂等——节点已在且 `parentNode` 正确就只更新文本。

## 4. 代码地图（`src/client.js`，单文件 ~470 行）

| 位置 | 责任 |
| --- | --- |
| `installErrorReporter()` | 本地错误记录（localStorage，最多 20 条，去重）+ `window.__dshErrorReporter` |
| `findUsageDialog()` | 唯一锚点入口；`collectAll()` 支持 shadow DOM |
| `detailsList()` | 找明细 `<dl>`；`perTurn` 由 `data-turn-usage-details` 判断 |
| `readMetrics()` / `parseUnit()` | 解析 `69,092 tok` / `1.2M tok` 这类文本（去逗号、支持 k/M/B） |
| `computeCost()` | 峰谷价（`PRICE`）估算本轮 |
| `currentSessionTitle()` | 当前会话标题（面包屑），用于匹配 token-mb 记录 |
| `currentSessionFromSummary()` | token-mb 记录选会话：标题优先，其次最近写入的非子代理 |
| `refreshSummary()` | 30s TTL、两套 URL 依次尝试、失败静默 |
| `sync()` / `removeRow()` | 注入与回收；写 `window.__inlineCostStatus` 供配置页「定位状态」读 |
| `InlineCostSettings` | 配置页组件（显示开关 / 错误上报 / 定位状态 / 报告按钮） |
| `exports.apply(ctx)` | 装 observer/timer + `ctx.slots.inject('settings.section')` 注册配置页 |

## 5. 关键决策与踩过的坑

| 决策 | 为什么 |
| --- | --- |
| 不复用官方 usage 槽位 | v0.3 曾替换 `conversation.composer.dock` 的 usage 格子 → `ui-chat` 启动失败、DSH 进安全模式、profile 被重置。**铁律**：官方槽位 id 一律不碰 |
| 按 `role` + `aria-label` 锚定，而不是按文本猜 | 早期版本用「文本里同时出现 未缓存输入/缓存读取/输出/用量」定位，真实页面里命中的是**聊天记录里的普通 span**（用户消息本身就带这些词），于是永远插不进去 |
| 追加 `dt`/`dd` 到官方 `<dl>` | 官方是 grid 两列，塞 `div` 会破坏布局；克隆行或自带样式都会和主题脱节 |
| token-mb 路由两套都试 | 社区有两个孪生包：`dsh-token-mb` → `/token-mb/summary`，`dsh-token-meter-panel` → `/token-meter-panel/summary`；返回都套一层 `{ ok, data }` |
| 会话匹配先看标题 | 只看 `lastTime` 时，多会话同时活跃会取错；标题（面包屑）是当前视图的强信号 |
| 单轮卡片只给估算 | token-mb 只有会话维度，把会话累计显示在单轮卡片里是撒谎 |

## 6. 状态位（给排错用）

```js
window.__inlineCostStatus
// { card: boolean, row: boolean, scope: 'session' | 'turn' | '', at: number }
```

配置页「定位状态」直接渲染这个对象；`card=false` 表示当时没有用量卡片打开（正常），
`card=true, row=false` 才是真出问题。

## 7. 验证方式

- 离线 harness：`.verify/harness/`（历史产物，用假 DOM 跑注入逻辑）
- 真实 GUI：`.verify/cdp/`（无头 Edge + CDP，伪造同源 cookie 打开 `127.0.0.1:51388`，点击卡片、读 DOM、截图）
- 截图产物：`.verify/screenshots/`（不入库）
- 手工回归清单：
  1. 打开会话卡片 → 有「花费金额」且右对齐
  2. 打开单轮卡片 → 有「花费金额」，悬停显示「本轮估算」
  3. 关卡片 → 行消失；再开 → 回来
  4. 关「显示花费金额」开关 → 行消失；打开 → 回来
  5. 杀掉 token-mb（或改 `SUMMARY_URLS` 为空）→ 会话卡片仍有金额（估算）+ 悬停提示「token-mb 不可用」

## 8. 改版时的自愈能力

官方改了卡片结构时，插件会**静默不显示**（不影响官方功能），排错路径：
配置页「定位状态」→ 若是 `card=false` 但卡片明明开着，说明 `aria-label` 或 `<dl>` 变了，
改 `findUsageDialog()` / `detailsList()` 两处即可，其余逻辑不用动。
