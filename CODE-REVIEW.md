# 代码审核报告（2026-10-27）

> **范围说明**：本文件的第一、二节是 2026-10-27 对 `更多表情和颜文字 v0.6.0` / `输入框花费金额 v0.7.0` 的审核记录，
> 保留原文作为历史。当前版本为 **表情 0.7.2 / 花费 0.9.0**，最新一轮（0.9.0）的复核结论见文末第四节。

审核对象：
- `更多表情和颜文字` v0.6.0
- `输入框花费金额` v0.7.0

审核范围：Host 半侧、Client 半侧、bundle 清单、权限/接口、错误路径、发布流程。

## 一、更多表情和颜文字（dsh-plugin-more-emoji）

### 架构与数据
- Host：`src/host.mjs` 注册 `emoji_pack` 工具、系统提示段、`/more-emoji/api/settings` 路由；设置文件原子写（tmp+rename），默认值与迁移校验完整；工具输出带 `schema + render`。
- 数据：`src/packs.mjs` 单一数据源（44 分类 / 911 条文本），构建时内联进 `lib/client.js` 与 `lib/packs.mjs`；36 张 PNG 贴纸 base64 内联。
- Client：5 个扩展点（输入框按钮/面板/设置行/设置页/bundle config），全部 `try/catch` 保险丝；发送走官方 composer API（`captureInsertion`→`insertText`→`submit`），图片走合成 paste 事件。

### 已发现并修复的问题
| 问题 | 原因 | 状态 |
| --- | --- | --- |
| 工具报错 `reading 'render'` | defineTool 缺 `output.schema/render` | 已修 |
| `reading 'draftRev'` | insertText 未传 captureInsertion 的 token | 已修 |
| 18 个 Emoji 显示成方框 | 系统字体无字形 | 已修（字形审计后替换） |
| 贴纸首帧空白 | 圆角遮罩后画错层 | 已修 |
| 客户端改代码不生效 | clientModules 按包 id 缓存 rev | 已记录，需重启 |
| 中文路径安装写坏 profile | pnpm 写 package.json 时 GBK 转码 | 已记录，必须 ASCII junction |

### 剩余风险
- 图片贴纸依赖对 contenteditable 合成 paste，DSH 编辑器结构大改时可能失效（会静默失败，不崩溃）。
- 「收藏/常用词提高发送权重」是系统提示层引导，不是硬性概率；模型仍可能自行选择。
- 客户端 bundle 较大（含 36 张贴纸 base64），首屏加载略慢。

结论：**无高危问题**；建议每次发版跑离线 harness 与 `tools/check.mjs`。

## 二、输入框花费金额（dsh-plugin-inline-cost）

### 架构
- 纯 Client 插件，Host 半侧空壳；**不注册任何官方槽位、不替换官方组件**。
- 通过 `MutationObserver` 观察官方「Token 用量」卡片：打开时在卡片末尾追加一行「花费金额」，关闭时移除。
- 数据：优先 `GET /token-meter-panel/summary`（token-mb 官方会话记录，按调用峰谷/模型计价）；失败时解析卡片文字估算。
- 客户端调试/错误上报：🐞 按钮 → 面板可关闭错误上报、停用花费行、复制报告、跳转 GitHub issue。

### 已发现并修复的问题
| 版本 | 问题 | 原因 | 处理 |
| --- | --- | --- | --- |
| v0.1 | 与官方统计重复的独立行 | 设计错误 | 废弃 |
| v0.3 | 启动时 `dsh-client-ui-chat` 激活失败 → DSH 进安全模式、配置被重置 | 替换官方 `usage` 格子（复用 id） | 废弃，改用纯观察 |
| v0.4 | 卡片里不出现金额行 | 克隆行依赖官方 DOM 层级；`<script>` 文本被误判为卡片 | v0.5 改文本解析 + 排除 script、取最深 |
| v0.6 | 金额口径 | 自算估算 vs 官方记录 | 优先 token-mb 官方 cny，失败才估算 |

### 剩余风险
- 会话匹配启发式：取「最近写入的非子代理会话」，若同时开多个窗口/有子代理写入，可能取错会话（tooltip 会展示所用会话的明细，便于核对）。
- 官方卡片文案/结构大改会导致定位失败（静默不显示，不影响官方功能）。
- 依赖 token-mb 的接口 `/token-meter-panel/summary`；未安装时自动降级估算。
- 估算按当前时段统一套峰谷价，跨档会偏。

结论：**无高危问题**；核心风险已从「替换官方组件」改为「只读追加」。

## 三、发布流程检查
- 两个插件 README 均写明：ASCII 路径安装、重启生效、免责声明、错误上报方式。
- 仓库包含 `.github/ISSUE_TEMPLATE/bug-report.yml`；`ERROR-REPORTS/` 按插件+版本记录问题与变更。
- 本地验证：`tools/check.mjs`、`tools/build.mjs`、离线 harness、严格 UTF-8/JSON profile 校验。

## 四、0.9.0 复核（2026-10-27 深夜，真实 GUI 验证后）

这一轮不是纸面审核：用无头浏览器 + CDP 连上正在运行的 DSH Web，直接读真实 DOM 才发现的三个问题。

| 问题 | 现象 | 根因 | 修法 | 验证 |
| --- | --- | --- | --- | --- |
| 花费行从不出现 | 卡片打开也没有「花费金额」 | 按文本猜卡片：真实页面里「未缓存输入/缓存读取/输出/用量」同时命中的是**聊天记录里的普通 span**，`readMetrics` 全 null | 锚定 `div[role="dialog"][aria-label="Token 用量"\|"本轮用量"]`，往其 `<dl>` 追加 `dt`/`dd` | 真实页面：会话卡片 `≈ ¥0.50`、单轮卡片 `≈ ¥1.31`，截图存 `.verify/screenshots/` |
| 官方记录从未取到 | 一直走估算 | 路由写错（`/token-meter-panel/summary`，实际 `/token-mb/summary`）+ 结构少套一层（`{ok,data:{sessions}}`） | 两套 URL 依次试，兼容两种结构；会话按标题匹配 | token-mb 记录命中「重启DSH验收插件」会话（97 次调用） |
| 配置页不注册 | 设置里没有这一节 | `exports.apply` 漏写 `ctx` 参数 → 用 `ctx.slots` 抛 ReferenceError 被 catch 吞掉 | `apply(ctx)` | 配置页可见，含「定位状态」 |

**复核结论**：无新增高危；三条不变量（不接管官方槽位 / 保险丝 / 可卸载）仍成立，
新增依赖仅「官方卡片 `aria-label` + `<dl>` + `data-turn-usage-details`」，属于公开 DOM 契约。

剩余风险（更新）：

- 会话匹配仍是启发式（标题优先 → 最近写入），标题重名 + 多会话同时活跃可能取错；tooltip 可核对
- 单轮卡片按当前时段价估，跨峰谷会偏；卡片上有 `提供方 / 模型` 行但暂未用于选价目
- 官方改版（`aria-label` 或 `<dl>` 结构变）→ 静默不显示；排错入口在配置页「定位状态」
- 表情插件未改动，0.7.2 的剩余风险沿用第二节
