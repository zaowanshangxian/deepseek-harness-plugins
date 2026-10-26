# DeepSeek Harness 插件集

自制的 **DeepSeek Harness（DSH）** 插件集合。每个插件是一个可独立安装的文件夹，带 README、`package.json`、`cordis.patch.yml`。

> ⚠️ 安装前请先阅读 [DISCLAIMER.md](./DISCLAIMER.md)（风险告知 / 免责声明）。插件会修改 DSH profile 配置，请自行备份。

## 插件列表

| 插件 | 说明 | 版本 | 文档 |
| --- | --- | --- | --- |
| [更多表情和颜文字](./更多表情和颜文字/) | 输入框旁的 Emoji / 颜文字 / 文字表情 / 短句 / 图片贴纸面板；收藏、最近使用、一键发送；配置中心可隐藏、勾选允许分类、常用词优先；附 `emoji_pack` 工具 | 0.7.0 | [README](./更多表情和颜文字/README.md) · [智能体说明](./更多表情和颜文字/docs/AGENT.md) · [变更](./更多表情和颜文字/CHANGELOG.md) |
| [输入框花费金额](./输入框花费金额/) | 官方「Token 用量」卡片打开时追加一行「花费金额」；优先取 token-mb 官方会话记录，无则估算；含客户端调试/错误上报 | 0.8.0 | [README](./输入框花费金额/README.md) · [变更](./输入框花费金额/CHANGELOG.md) |

## 安装方式

1. **备份 profile**（安装/卸载前都建议做）：
   ```bat
   copy "%USERPROFILE%\.dsh\profiles\desktop\package.json" "%USERPROFILE%\.dsh\profiles\desktop\package.json.bak"
   copy "%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml" "%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml.bak"
   ```
2. **把中文目录映射成 ASCII 路径**（必须）：
   ```bat
   mklink /J L:\work\plugins\more-emoji "L:\work\deepseek-harness-plugins\更多表情和颜文字"
   mklink /J L:\work\plugins\inline-cost "L:\work\deepseek-harness-plugins\输入框花费金额"
   ```
3. 在 DSH 里用 `plugin_manager install_bundle`，target 指向 ASCII 路径（`L:\work\plugins\...`）。
4. **重启一次 DSH**（客户端 bundle 只在启动时加载）。
5. 安装后先校验 profile：
   ```bat
   python -c "import io,json;d=json.load(open(r'%USERPROFILE%\.dsh\profiles\desktop\package.json',encoding='utf-8'));print('OK',len(d['dsh']['profile']['bundles']))"
   ```

## 智能体（模型）怎么用

- **更多表情和颜文字**：模型有 `emoji_pack` 工具（`list` / `search` / `pick`），系统提示里带使用说明；「收藏/常用词优先」会让模型倾向选择这些内容。详见 [AGENT.md](./更多表情和颜文字/docs/AGENT.md)。
- **输入框花费金额**：纯 UI 展示，**不提供工具**；模型不需要调用，也不要向用户声称金额是官方账单（是官方会话记录或估算）。
- 两个插件都**不会自动上传**任何数据；错误上报由用户在 🐞 面板手动复制/提交。

## 错误上报与调试（在插件配置页里，可手动关闭）

- 位置：**设置 → 输入框花费金额 / 更多表情和颜文字**（也出现在插件页的配置里）
- 选项：**启用错误上报**（取消勾选即手动关闭）、最近错误列表、复制报告、去 GitHub 提 issue、清空
- 「显示花费金额」开关只控制本插件是否注入那一行；**不提供关闭任何官方组件的选项**
- 只在浏览器本地记录最近错误（最多 20 条，去重），**不会自动上传**

## 版本变更

- 根汇总：[CHANGELOG.md](./CHANGELOG.md)
- 表情插件：[更多表情和颜文字/CHANGELOG.md](./更多表情和颜文字/CHANGELOG.md)
- 花费插件：[输入框花费金额/CHANGELOG.md](./输入框花费金额/CHANGELOG.md)
- 按版本记录的问题：[ERROR-REPORTS/](./ERROR-REPORTS/)

## 代码审核

见 [CODE-REVIEW.md](./CODE-REVIEW.md)（含两个插件的问题清单、剩余风险与结论）。

## 许可

MIT（各插件文件夹内 `LICENSE`）。使用即视为已阅读并同意 [DISCLAIMER.md](./DISCLAIMER.md)。
