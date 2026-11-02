# 错误报告库 / ERROR REPORTS

这里按「插件 + 版本」记录实际遇到的问题、原因与处理，作为 Bug 数据库使用。

## 怎么上报一个错误

1. 打开插件右下角 **🐞 调试按钮** → 「复制报告」，或直接点「去 GitHub 提 issue」。
2. 也可以手动提 issue，模板：[`.github/ISSUE_TEMPLATE/bug-report.yml`](../.github/ISSUE_TEMPLATE/bug-report.yml)
3. 请附上：插件名+版本、DSH 版本、报错文字/截图、复现步骤、是否安装 token-mb、是否重启过。

## 记录约定

- 每个插件一个目录，每个版本一个文件：`ERROR-REPORTS/<插件名>/v<版本>.md`
- 每条包含：现象、复现步骤、根因、处理/修复版本、是否遗留
- 只记录**真实发生**的问题；**不要**把可重跑的验证结果写进来

## 索引

| 插件 | 版本 | 文件 |
| --- | --- | --- |
| 更多表情和颜文字 | 0.5.0 / 0.6.0 / 0.7.0 | [v0.5.0.md](./更多表情和颜文字/v0.5.0.md) · [v0.6.0.md](./更多表情和颜文字/v0.6.0.md) · [v0.7.0.md](./更多表情和颜文字/v0.7.0.md) |
| 快速显示花费 | 0.6.0 / 0.7.0 / 0.8.0 | [v0.6.0.md](./快速显示花费/v0.6.0.md) · [v0.7.0.md](./快速显示花费/v0.7.0.md) · [v0.8.0.md](./快速显示花费/v0.8.0.md) |

## 客户端本地数据位置

- 错误记录：`localStorage['dsh-errors:<包名>']`（最多 20 条）
- 错误上报开关：`localStorage['dsh-errors-off:<包名>']`
- 花费行停用：`localStorage['dsh-inline-cost:disabled']`
- 表情收藏/最近使用：`localStorage['dsh-more-emoji:favorites']`、`localStorage['dsh-more-emoji:recent']`

以上都只在本机，**不会自动上传**。
