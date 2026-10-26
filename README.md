# DeepSeek Harness 插件集

自制的 **DeepSeek Harness**（DSH）插件集合。每个插件是一个可以独立安装的文件夹，各自带 README、`package.json` 与 `cordis.patch.yml`。

## 插件列表

| 插件 | 说明 | 版本 |
| --- | --- | --- |
| [更多表情和颜文字](./更多表情和颜文字/) | 输入框旁的 Emoji / 颜文字 / 文字表情 / 短句 / 图片贴纸面板，支持收藏、最近使用、一键发送；配置中心可隐藏面板、勾选允许分类、添加常用词并让模型优先发送；附 `emoji_pack` 工具与系统提示 | 0.5.0 |
| [输入框花费金额](./输入框花费金额/) | 只给官方「Token 用量」卡片加一行：点开自带用量条时，卡片末尾出现「花费金额」；优先取 token-mb 官方会话记录（最准），无则退回估算；关闭自动移除 | 0.6.0 |

## 安装方式

每个插件文件夹就是一个 DSH bundle。安装时把**该文件夹的绝对路径**交给 DSH 的插件管理器：

```text
plugin_manager install_bundle，target = <本仓库路径>/<插件文件夹>
```

安装后刷新 Web 页面（或重启 DSH）即可。具体步骤与卸载方法见各插件自己的 README。

## ⚠️ 安装路径必须用 ASCII（重要）

**不要把中文目录名作为 `install_bundle` 的 target**：插件管理器底层 pnpm 在写 profile 的 `package.json` 时会把中文路径转成 GBK 乱码，导致清单损坏、DSH 打不开（2026-10-26 实测事故）。

Windows 上用目录联接（junction）把中文文件夹映射成 ASCII 路径再安装：

```bat
mklink /J L:\work\plugins\inline-cost "L:\work\deepseek-harness-plugins\输入框花费金额"
```

然后 `install_bundle` 指向 `L:\work\plugins\inline-cost`。本仓库的文件夹名保持中文（可读性），安装时走 ASCII 映射即可。

万一已经装坏：双击桌面的 `DSH一键恢复.cmd`（见 `L:\work\scripts\dsh-profile-recover.ps1`）。

## 约定

- 只依赖 DSH 自带能力（Cordis 扩展点、Host 服务），不引入第三方运行时依赖
- 不改内核、不手写 profile 配置；安装/卸载都走 `plugin_manager`
- 每个插件一个文件夹，互不干扰，可单独安装

## 许可

MIT（见 [LICENSE](./LICENSE)）
