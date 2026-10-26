# 更多表情和颜文字（dsh-plugin-more-emoji）

给 DeepSeek Harness 加一个**表情面板**：输入框工具栏点 😊 就能打开，把 Emoji、颜文字、文字表情、聊天短句一键盘插到光标处；同时提供一个 `emoji_pack` 工具，让模型也能随时取更多表情和文字。

- **44 个分类 / 911 条内容**（表情 400 · 颜文字 280 · 文字表情 81 · 短句 150）
- 点一下插入光标位置，不打断正在打的字；支持搜索、随机一发
- 面板浮在输入框上方，不遮住输入内容
- 零第三方运行时依赖、无网络请求

![面板示意](docs/panel.png)

## 功能

**表情面板（给人用）**

- 4 个页签：表情 / 颜文字 / 文字表情 / 短句
- 分类标题随滚动吸顶；每个页签内按分类分组
- 搜索框实时过滤（匹配条目文本或分类名）
- 点条目 → 插入到输入框光标处；连续点可连插
- 「随机一发」：随机抽一条插入
- `Esc` 或点面板外部关闭；主题跟随 DSH 深浅色变量

**emoji_pack 工具（给模型用）**

模型可以主动调用它取分类目录或具体条目，把更多表情/颜文字/短句自然地写进回复。

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `kind` | `emoji` \| `kaomoji` \| `art` \| `phrase` | 大类 |
| `category` | string | 分类 id 或名字片段，如 `emoji-heart`、`猫`、`夸夸` |
| `query` | string | 关键词过滤（匹配分类 id / 名字） |
| `count` | integer 1-40 | 期望条数，缺省 12；只选一个分类时返回该分类全部条目 |
| `random` | boolean | 是否随机取样，缺省 false |

示例：

```text
emoji_pack()                                  → 返回完整分类目录
emoji_pack({ kind: "kaomoji", category: "猫" }) → 颜文字·猫猫 20 条
emoji_pack({ kind: "phrase", query: "夸" })     → 夸夸类短句
emoji_pack({ kind: "art", random: true })       → 随机一组文字表情
```

## 安装

插件通过 DSH 的 bundle 机制安装（当前未上架 npm，用本地文件夹安装）。

**1. 拿到本文件夹**

```bash
git clone https://github.com/zaowanshangxian/deepseek-harness-plugins.git
cd deepseek-harness-plugins
```

**2. 装进 profile**

在 DeepSeek Harness 里让 Agent 执行：

```text
plugin_manager install_bundle，
target = <仓库路径>/更多表情和颜文字（Windows 例如 L:\work\deepseek-harness-plugins\更多表情和颜文字）
```

也可以用 DSH 的「插件」页安装本地包，指向同一个文件夹。

**3. 生效**

刷新 Web 页面（或重启 DSH），输入框工具栏左侧出现 😊。

## 使用

1. 点输入框左侧的 😊 打开面板；
2. 切页签 / 搜索，点任意条目即插入光标处；
3. 需要灵感就点「随机一发」；
4. `Esc` 或点外部收起。

> 找不到输入框时（例如焦点在别处且没有可识别输入控件），会退回「复制到剪贴板」并提示。

## 内容库

| 大类 | 分类数 | 条数 | 例子 |
| --- | --- | --- | --- |
| 表情 emoji | 16 | 400 | 常用笑脸、可爱卖萌、爱心、美食、动物、手势、天气自然、困倦睡觉… |
| 颜文字 kaomoji | 14 | 280 | 开心、可爱、撒娇卖萌、汗与无语、生气炸毛、猫猫、害羞、长条颜文字… |
| 文字表情 art | 4 | 81 | 组合表情、框框字（`╭━━━╮` 好耶 `╰━━━╯`）、分割装饰、符号表情 |
| 短句 phrase | 10 | 150 | 夸夸、撒娇、日常回复、早晚安、摸鱼吐槽、鼓励、节庆祝福、网络梗… |

改动内容只需编辑 `src/packs.mjs`（单一数据源），再跑构建。

## 目录结构

```text
更多表情和颜文字/
├── package.json          # bundle 声明（dsh.bundle.patch / dsh.client）
├── cordis.patch.yml      # 插入一行 more-emoji
├── icon.svg              # 插件图标
├── locale/{zh,en}.json   # 插件页标题与描述
├── lib/                  # 构建产物（Host 工具 + Client 面板 + 数据）
├── src/
│   ├── packs.mjs         # ★ 内容库单一数据源
│   ├── host.mjs          # Host 半侧：emoji_pack 工具
│   └── client.template.js# Client 半侧：面板（数据由构建内联）
├── tools/
│   ├── build.mjs         # 生成 lib/
│   └── check.mjs         # 校验重复 / 空项 / 坏字符
└── docs/panel.png        # 面板截图
```

## 开发

```bash
node tools/build.mjs   # 生成 lib/packs.mjs、lib/index.js、lib/client.js
node tools/check.mjs   # 校验内容库（分类 id、重复、坏字符）
```

构建后若已安装且是本地 link，重新 `remove_bundle` + `install_bundle` 即可加载新代码。

## 兼容性

- DeepSeek Harness `>=0.2.1-rc.2 <0.3.0`（Node >= 20）
- 只用两个稳定扩展点：`conversation.input.left`（按钮）、`conversation.input.overlay`（面板），以及 Host 的 `tools` 服务
- 不改内核、不写 profile 配置文件

## 已知边界

- 是**文本类**表情/颜文字，不包含图片贴纸
- 插入依赖 composer 的 `textarea` 或 `contenteditable`；极端布局下可能退回剪贴板
- 面板宽度 240–420px，按视口自适应；超窄窗口会靠左收缩

## 许可

MIT
