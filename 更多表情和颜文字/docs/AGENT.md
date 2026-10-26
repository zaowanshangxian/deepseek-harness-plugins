# 更多表情和颜文字 — 给智能体看的说明

插件安装后，Host 半侧会通过 `systemPrompt.section`（name `more-emoji-usage`，order 2950）把下面这段注入系统提示。这里保留全文，便于人类审阅与修改。

## 注入文本

```text
[更多表情和颜文字] 本机装了 DSH 插件「更多表情和颜文字」。你可以调用 emoji_pack 工具获取表情/颜文字/文字表情/短句，再自然地点缀到回复里。
- emoji_pack({}) 返回分类目录（44 个分类 / 911 条）；传 kind（emoji / kaomoji / art / phrase）、category（分类 id 或名字片段，如 emoji-love、猫、夸夸）、query、count、random 取具体条目。
- 用法建议：按用户语气和场景少量使用，一条回复 1-3 个为宜，不要堆砌；正式/严肃内容、代码解释里不要加。用户明确说别用表情时不要用。
- 用户界面上还有图片贴纸面板（输入框左侧 😊 按钮），那是给用户发送用的；你不需要也不应该声称自己发了图片。
```

## 为什么这样写

- **只讲事实**：工具名、参数、数据规模——模型据此决定是否调用，不靠猜。
- **给边界**：1-3 个/条、正式内容不加、用户拒绝就停。避免"每条回复都堆表情"的滥用。
- **划清能力**：图片贴纸是用户侧 UI 行为，模型没有发送图片的工具；写清楚可以防止模型误称"我发了个贴纸"。

## 工具参数速查

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `kind` | `emoji` \| `kaomoji` \| `art` \| `phrase` | 大类 |
| `category` | string | 分类 id 或名字片段（`emoji-love`、`猫`、`夸夸`） |
| `query` | string | 关键词过滤 |
| `count` | integer 1-40 | 条数，缺省 12；单分类时返回全部 |
| `random` | boolean | 随机取样 |

## 修改方式

- 文案：`src/host.mjs` 里的 `AGENT_GUIDE` 常量
- 位置：同文件 `registerPrompt()` 里的 `order`（2950 靠近其他插件提示区，避免抢主提示）
- 关闭注入：删掉 `registerPrompt(ctx)` 调用即可（工具本身不受影响）

## 动态用户配置（v0.4.0 起）

除固定说明外，Host 还会注册一个动态 prompt context（`more-emoji-settings`，order 96），每个模型步实时读取用户配置并输出：

- 用户只允许的分类（`allowedPacks`）→ 模型只能从这些分类选；
- 用户设置的常用词/常用表情（`customWords`）+ 「权重更高、优先使用」的要求（`preferCustom` 开启时）。

因此修改配置后无需重启：`emoji_pack` 的输出和系统提示都会立刻变化。
