# 变更记录 · 工具税

## 0.1.0

首个版本。

**功能**

- 官方「Token 用量」卡片末尾追加一行「工具税 ≈ N tokens/轮」，悬停看按插件 Top 5，点击复制摘要。
- Host 半读 `ctx.tools.schemas()`，序列化每条 schema 数长度；按插件归属（源码字面量唯一命中）+ 未归属兜底。
- `POST /api/tool-tax/report`：只读报告，60 秒缓存，`{force:true}` 强制刷新。

**验证**

- `node tools/smoke.mjs`：24 项（Host 纯函数 / 归属夹具 / 路由 405·400·200 / 客户端迷你 DOM 插入·去重·卸载零残留）。
- 沙箱验收（独立 `DSH_HOME=L:\work\.dsh-sandbox`，profile=sandbox，不碰真实客户端）：
  - API：`tools 33 · 3524 tokens/轮`，归属 `dsh-qq-onebot 18/2107`、`dsh-bili-scroll 13/1103`、`dsh-plugin-more-emoji 1/202`，未归属 `working_directory`。
  - UI：无头 Edge 打开 6 天前的历史会话 → 点用量卡片 → 出现「工具税 / ≈ 3524 tokens/轮」，与「花费金额 / 账户余额」并存不冲突。截图 `L:\work\logs\tool-tax-card.png`。

**已知限制**（详细见 README 第四节）

- 只量工具 schema，不含系统提示词/人格/记忆注入。
- token 为估算（字符 ÷ 3.5，区间 ÷4…÷3）。
- 归属是推断；工具名由变量拼出的、或两个包同名时记「未归属」。
