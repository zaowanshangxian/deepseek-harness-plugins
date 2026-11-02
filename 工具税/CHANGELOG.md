# 变更记录 · 工具税

## 0.5.0

**去掉打开延迟（工具账单秒出）**

- 会话扫描改成**按文件缓存**：路径 + mtime + size 命中就跳过解析，结果落盘到 `<DSH_HOME>/tool-tax/cache.json`。
- Host 启动时**预热**一次，第一次打开 Token 页就已经有缓存。
- 客户端把上次结果存 `localStorage`，**先进页面先渲染上次的数，再异步刷新**——感知上等于零延迟。
- 实测（本机 53 个会话）：首次 2237ms → 第二次 **27ms**（全部命中缓存，结果一致）。

## 0.4.2

**判定改成结构锚点（不靠文本）**

- 旧逻辑：页面文本里有「今日消费 / 账户余额」就认为在 Token 页——别处出现同样四个字就会误插。
- 新逻辑：先看**侧栏 NAV 里哪个按钮是高亮（`panelActive`）且文字为「Token」**，再要求页面里有「Token 用量」或「今日消费」，最后排除带输入框占位符的会话页。三条同时满足才插。
- 文本不再是判据，只是第二道校验；侧栏不在 Token 时，哪怕页面上出现「账户余额」也不插（有测试锁住）。

## 0.4.1

**修复：卡片误插到会话页输入框下面**

- 0.4.0 用「缓存命中」当 Token 页判据，会话页底部的用量条也有这个词 → 卡片被插进会话输入框下方。
- 现在只认「今日消费 / 账户余额」，并排除含「发送消息 / 描述你想要构建的内容」的会话页。
- 真机验证（Windows / DSH 0.2.1-rc.5）：会话页干净；Token 页底部卡片正常，52 会话 · 10926 次调用 · ¥118.51 · 工具税 ≈ 7048 tokens/轮。

## 0.4.0

**嵌进 Token 页底部（不再单开侧栏）**

- 侧栏不再新增「工具」入口；改为在官方 Token 面板的滚动区末尾追加一张卡片「工具账单（近 14 天）」，
  和 token-mb 的「今日消费 / 近 7 天 / 余额」卡片排在一起。
- 判定：中栏可滚动容器且含「今日消费 / 账户余额 / 缓存命中」→ 认为是 Token 页 → 注入；切走自动移除，零残留。
- 纯 DOM 注入，不接管、不替换官方组件；数据仍来自 Host 半的 `/api/tool-tax/report` 与 `/tools`。

**验证**

- `node tools/smoke.mjs`：36 项（新增 Token 页识别、金额/token 格式）。
- 沙箱验收（独立 DSH_HOME）：点侧栏「Token」→ 滚到底 → 区块出现，15 行表格，
  副标题「会话 4 个 · 调用 452 次 · 合计 1.08 亿 tokens / ¥3.53（工具税 ≈ 2420 tokens/轮）」。
- 截图：`L:\DSH\work\logs	ool-tax-token-bottom.png`

## 0.3.0

**改成独立面板（不再挤在用量卡片里）**

- 侧栏新增「工具」入口（与 Token 并排），中栏独立面板：上半「工具税」、下半「工具账单」。
- 移除 v0.2 往官方「Token 用量」卡片 `<dl>` 里追加 `<dt>/<dd>` 的做法——那张卡片本来就挤。
- 面板用 React 组件渲染，样式跟随官方；不接管、不替换官方槽位，只注册自己的 `sidebar.panellist` + `main`。

**验证**

- `node tools/smoke.mjs`：36 项（新增会话扫描平摊、峰谷判断、侧栏/主面板注册、图标渲染）。
- 沙箱验收（独立 DSH_HOME）：点侧栏「工具」→ 面板渲染「工具税（每轮固定注入）」「工具账单（近 14 天）」，33 工具 / 3524 tokens/轮 / 4 会话 452 次调用。
- 截图：`L:\DSH\work\logs	ool-tax-sidebar.png`

## 0.2.0

**新增「工具账单」**

- 用量卡片第二行「工具账单 · 点击查看」→ 面板表格：每个工具近 14 天的 调用次数 / 分摊 tokens / 分摊金额 / 占比。
- 数据源：`<DSH_HOME>/sessions/**/session*.jsonl.zstd`，逐帧解压；`tool/call` 按 (turn,step) 平摊该轮 `assistant/message.data.usage`。
- 金额：DeepSeek 峰谷价（与 `dsh-token-mb` 同表），非官方 provider 只记 token 不猜钱。
- 只读字段白名单：`type / data.name / data.turn,step / data.usage`，不碰对话内容。
- 性能：200 文件上限、单文件 64 MB 上限、5 分钟缓存；本机 51 会话实测 1.5 秒。

**验证**

- `node tools/smoke.mjs`：25 项（新增「插入两行」「第二行是工具账单」）。
- 沙箱验收（独立 DSH_HOME，不给真实客户端添任何东西）：
  - API：`sessions 4 · calls 452 · ¥3.53`；Top：ops_bash 329 次 ¥2.48（72%）、write 35 次 ¥0.475（9%）、pwsh 16 次 ¥0.139（5%）。
  - UI：无头 Edge 点开卡片 → 点「点击查看」→ 面板 17 行正常渲染。
  - 对账：`dsh-token-mb` 同一批会话 ¥3.6418（LLM 调用 423 次），本插件 ¥3.53（工具调用 452 次），差约 3%，已在 README 写明原因。
  - 截图：`L:\DSH\work\logs\tool-tax-panel.png`

## 0.1.0

首个版本。

**功能**

- 官方「Token 用量」卡片末尾追加一行「工具税 ≈ N tokens/轮」，悬停看按插件 Top 5，点击复制摘要。
- Host 半读 `ctx.tools.schemas()`，序列化每条 schema 数长度；按插件归属（源码字面量唯一命中）+ 未归属兜底。
- `POST /api/tool-tax/report`：只读报告，60 秒缓存，`{force:true}` 强制刷新。

**验证**

- `node tools/smoke.mjs`：24 项（Host 纯函数 / 归属夹具 / 路由 405·400·200 / 客户端迷你 DOM 插入·去重·卸载零残留）。
- 沙箱验收（独立 `DSH_HOME=L:\DSH\work\.dsh-sandbox`，profile=sandbox，不碰真实客户端）：
  - API：`tools 33 · 3524 tokens/轮`，归属 `dsh-qq-onebot 18/2107`、`dsh-bili-scroll 13/1103`、`dsh-plugin-more-emoji 1/202`，未归属 `working_directory`。
  - UI：无头 Edge 打开 6 天前的历史会话 → 点用量卡片 → 出现「工具税 / ≈ 3524 tokens/轮」，与「花费金额 / 账户余额」并存不冲突。截图 `L:\DSH\work\logs\tool-tax-card.png`。

**已知限制**（详细见 README 第四节）

- 只量工具 schema，不含系统提示词/人格/记忆注入。
- token 为估算（字符 ÷ 3.5，区间 ÷4…÷3）。
- 归属是推断；工具名由变量拼出的、或两个包同名时记「未归属」。
