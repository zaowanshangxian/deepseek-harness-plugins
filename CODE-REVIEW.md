# 代码审核报告（2026-10-27）

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
