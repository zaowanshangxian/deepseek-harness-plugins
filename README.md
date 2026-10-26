# DeepSeek Harness 插件集

自制的 **DeepSeek Harness**（DSH）插件集合。每个插件是一个可以独立安装的文件夹，各自带 README、`package.json` 与 `cordis.patch.yml`。

## 插件列表

| 插件 | 说明 | 版本 |
| --- | --- | --- |
| [更多表情和颜文字](./更多表情和颜文字/) | 输入框旁的 Emoji / 颜文字 / 文字表情 / 短句 / 图片贴纸面板，支持收藏、最近使用、一键发送；附模型可调 `emoji_pack` 工具与系统提示说明 | 0.3.0 |

## 安装方式

每个插件文件夹就是一个 DSH bundle。安装时把**该文件夹的绝对路径**交给 DSH 的插件管理器：

```text
plugin_manager install_bundle，target = <本仓库路径>/<插件文件夹>
```

安装后刷新 Web 页面（或重启 DSH）即可。具体步骤与卸载方法见各插件自己的 README。

## 约定

- 只依赖 DSH 自带能力（Cordis 扩展点、Host 服务），不引入第三方运行时依赖
- 不改内核、不手写 profile 配置；安装/卸载都走 `plugin_manager`
- 每个插件一个文件夹，互不干扰，可单独安装

## 许可

MIT（见 [LICENSE](./LICENSE)）
