# 安全策略

## 支持的版本

只对**最新 minor** 修安全问题：

| 插件 | 支持 |
| --- | --- |
| `dsh-plugin-inline-cost` | 0.9.x |
| `dsh-plugin-more-emoji` | 0.7.x |

## 攻击面（我们怎么想的）

| 位置 | 能做什么 | 现有防护 |
| --- | --- | --- |
| Host：`emoji_pack` 工具 | 读取内存里的内容库 + 配置文件，返回文本 | 无文件系统写、无网络；参数做类型/范围校验（`count` 夹在 1-40） |
| Host：`/more-emoji/api/settings` | 读写 `~/.dsh/more-emoji/settings.json` | 只挂在本机 DSH Web 服务上；有 `Origin` 时做同源校验（跨域 **403**）；body 上限 **64KB**；写入前字段白名单校验；`tmp` + `rename` 原子写 |
| Client：DOM 观察与追加（花费插件） | 读取官方卡片上已显示的数字，插入两个节点 | 不注册官方槽位、不替换组件、不改官方节点属性；找不到卡片就静默不做事 |
| Client：composer 插入与发送 | 往输入框插文本 / 合成 paste 贴图 | 只用官方 `inputActions`（`captureInsertion` → `insertText` → `submit`）；不做任意 DOM 模拟；失败静默 |
| 错误记录 | 存最近 20 条错误（消息、堆栈、UA、时间）在 `localStorage` | **不自动上传**；仅用户在配置页点「复制报告 / 提 issue」时才离开本机 |
| 配置 API 的凭据 | 无独立凭据，依赖 DSH Web 自身的登录 cookie | 不扩展权限；远程访问 DSH 时沿用 Host 的鉴权 |

**明确不做**：不读会话内容、不读文件系统（除自己的配置文件）、不发网络请求、不装后台服务、不 hook 全局函数。

## 报告漏洞

- 优先用 GitHub 的 **Private vulnerability reporting / Security advisory**（仓库 Security 页面）
- 或开 issue 但**不要写利用细节**，只写「影响范围 + 触发条件」，我们可以转到私密渠道
- 请附：插件与版本、DSH 版本、复现步骤、影响判断（读到什么 / 改到什么 / 是否会外发）

我们会尽力在数天内回复，并在修复后于 `CHANGELOG.md` 记录（必要时发布 advisory）。

## 不在范围内

- **DSH 本体的漏洞** → 报给 DeepSeek Harness 上游
- **`dsh-token-mb` 的问题** → 报给该插件作者（本仓库只读它的 `/token-mb/summary`）
- 需要「本机已被攻破 / 已拿到用户登录态 / 已能改用户文件」的攻击前提
- 插件按文档工作但用户不满意（例如金额是估算值）——那是产品预期，不是安全漏洞

## 供应链

- 两个插件**零运行时依赖**（`dependencies` 为空），不引入第三方 npm 包
- `peerDependencies` 只声明可选的 `@deepseek-ai/dsh-tools`（表情插件的工具定义）
- 构建脚本只用 Node 内置模块；贴纸生成脚本需要 Pillow（仅开发者用）
- 仓库内不包含二进制可执行文件
