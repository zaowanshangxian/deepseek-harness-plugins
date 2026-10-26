# 更多表情和颜文字（dsh-plugin-more-emoji）

给 DeepSeek Harness 加一个**表情面板**：输入框工具栏点 😊 就能打开，把 Emoji、颜文字、文字表情、聊天短句插到光标处，
还能发**图片贴纸**；同时提供 `emoji_pack` 工具 + 系统提示，让模型也能自然取用。

当前版本 **0.7.2** · MIT · 兼容 DSH `>=0.2.1-rc.2 <0.3.0`

**30 秒上手**：装好 → 重启 DSH → 点输入框左侧 **😊**，面板从上方弹出。
日常用法见 [docs/USAGE.md](docs/USAGE.md)。

- **44 个分类 / 911 条文本**（表情 400 · 颜文字 280 · 文字表情 81 · 短句 150）+ **36 张图片贴纸**
- 点一下插入光标处；可开「一键发送」改成点一下直接发出
- ⭐ 收藏、🕘 最近使用，跨页签共享
- 面板浮在输入框上方，不遮输入内容；主题跟随 DSH 深浅色
- 无第三方运行时依赖、无网络请求

![面板示意](docs/panel.png)

## 功能

**表情面板（给人用）**

- 5 个页签：表情 / 颜文字 / 文字表情 / 短句 / 贴纸
- 分类标题吸顶；搜索框实时过滤
- **文本类**：点条目 → 通过 composer 的官方 `inputActions`（`captureInsertion` + `insertText`）插到光标处，兼容 contenteditable 编辑器
- **图片贴纸**：点贴纸 → 把 PNG 合成 `paste` 事件交给 DSH 上传成附件，停在输入框等你发送（开「一键发送」则直接发出）
- **一键发送**：设置 → 通用 → 「更多表情和颜文字」勾选，或面板底部迷你开关；开启后点条目 = 发送
- **收藏**：鼠标悬停条目点 ☆；⭐ 页签统一查看/取消
- **最近使用**：自动记录最近 40 条，🕘 页签查看
- `Esc` / 点面板外部关闭

![图片贴纸页](docs/stickers.png)

**emoji_pack 工具（给模型用）**

模型可以主动调用它取分类目录或具体条目，把更多表情/颜文字/短句自然地写进回复。

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `kind` | `emoji` \| `kaomoji` \| `art` \| `phrase` | 大类，省略则不限 |
| `category` | string | 分类 id 或名字片段，如 `emoji-love`、`猫`、`夸夸` |
| `query` | string | 关键词过滤（匹配分类 id / 名字） |
| `count` | integer 1-40 | 期望条数，缺省 12；只选一个分类时返回该分类全部条目 |
| `random` | boolean | 是否随机取样，缺省 false |

示例：

```text
emoji_pack()                                  → 返回完整分类目录
emoji_pack({ kind: "kaomoji", category: "猫" }) → 颜文字·猫猫 全部
emoji_pack({ kind: "phrase", query: "夸" })     → 夸夸类短句
emoji_pack({ kind: "art", random: true })       → 随机一组文字表情
```

**给智能体的说明（自动注入系统提示）**

安装后 Host 半侧注册两段提示：

- 固定说明 `more-emoji-usage`（order 2950）：有这个工具、参数怎么用、一条回复 1-3 个为宜、正式内容别加、用户说别用就停
- 动态上下文 `more-emoji-settings`（order 96）：每个模型步实时读取你的配置——允许的分类、常用词、收藏（开启「收藏也参与优先」时）

完整文本与设计理由见 [docs/AGENT.md](docs/AGENT.md)。

## 配置中心（设置 → 更多表情和颜文字）

所有配置都在这一个页面里，**同一份配置同时作用于客户端面板和 `emoji_pack` 工具**（Host 与客户端共读
`%USERPROFILE%\.dsh\more-emoji\settings.json`）。

| 配置项 | 作用 |
| --- | --- |
| 隐藏表情入口 | 勾选后输入框旁的 😊 按钮与浮层面板都不显示；**本配置页仍可用**，随时关回来；`emoji_pack` 工具不受影响。<br>（「插件」页里的同一开关叫「隐藏客户端入口（智能体仍可用）」） |
| 优先发送常用表情 | 开启后，模型需要发表情时**优先用「常用」里的词/表情**（提高权重），系统提示里会带上这份清单 |
| 允许发送的表情分类 | 44 个分类逐个勾选；不选 = 全部允许。面板只显示允许的分类，`emoji_pack` 也只返回允许的分类 |
| 常用词 / 常用表情 | 客户端随时添加/删除（例如 `晚安喵～`、`(๑•̀ㅂ•́)و✧`、`抱抱`）；面板会多出「常用」页签，模型侧置顶 |
| 收藏也参与优先 | ⭐ 收藏会同步给 Host，`emoji_pack` 与系统提示同样按收藏加权（可关） |

- **立即生效**：Host 读到配置文件后，`emoji_pack` 输出与系统提示实时变化；客户端面板保存后即时更新
- **入口**：设置 → 更多表情和颜文字（也在「插件」页的本插件配置里）
- **存储**：`%USERPROFILE%\.dsh\more-emoji\settings.json`（按机器保存，可手动备份）
- **安全边界**：配置 API 只监听本机 DSH Web 服务；写请求做同源校验（跨域 403）、body 上限 64KB、
  `tmp` + `rename` 原子写；配置文件只留在本机

## 安装

插件通过 DSH 的 bundle 机制安装（**未上架 npm**，用本地文件夹安装）。

```bash
git clone https://github.com/zaowanshangxian/deepseek-harness-plugins.git
```

> ⚠️ 中文目录必须先映射成 ASCII 路径，否则 pnpm 会把 profile 的 `package.json` 写成 GBK 乱码，DSH 可能打不开。
> 安装前先备份 profile，详见仓库根 [README](../README.md#安装)。

```bat
mklink /J L:\work\plugins\more-emoji "L:\work\deepseek-harness-plugins\更多表情和颜文字"
```

在 DSH 里让 Agent 执行：

```text
plugin_manager install_bundle
target = L:\work\plugins\more-emoji
```

装完**重启一次 DSH**（客户端 bundle 在 Host 启动时构建），输入框工具栏左侧会出现 😊。

## 卸载

```text
plugin_manager remove_bundle  dsh-plugin-more-emoji
```

或手动：从 profile `package.json` 的 `dsh.profile.bundles` 删掉 `"dsh-plugin-more-emoji"` →
`dsh plugin --profile desktop remove dsh-plugin-more-emoji` → `rmdir L:\work\plugins\more-emoji`。

想彻底清干净（可选）：

- 删配置文件 `%USERPROFILE%\.dsh\more-emoji\settings.json`（不删也不影响，重装会沿用）
- 浏览器 DevTools 里删 `dsh-more-emoji:favorites` / `dsh-more-emoji:recent` / `dsh-more-emoji:directSend`

## 使用

1. 点输入框左侧的 😊 打开面板；
2. 切页签 / 搜索，点条目即插入（或按设置直接发送）；
3. 悬停条目点 ☆ 收藏；⭐ / 🕘 查看收藏与最近；
4. 贴纸页点图片 → 作为图片附件贴到输入框，回车发送；
5. `Esc` 或点外部收起。

## 内容库

| 大类 | 分类数 | 条数 | 例子 |
| --- | --- | --- | --- |
| 表情 emoji | 16 | 400 | 常用笑脸、可爱卖萌、爱心、美食、动物、手势、天气自然、困倦睡觉… |
| 颜文字 kaomoji | 14 | 280 | 开心、可爱、撒娇卖萌、汗与无语、生气炸毛、猫猫、害羞、长条颜文字… |
| 文字表情 art | 4 | 81 | 组合表情、框框字（`╭━━━╮` 好耶 `╰━━━╯`）、分割装饰、符号表情 |
| 短句 phrase | 10 | 150 | 夸夸、撒娇、日常回复、早晚安、摸鱼吐槽、鼓励、节庆祝福、网络梗… |
| 图片贴纸 sticker | 2 组 | 36 | 颜文字贴纸 18 张 + 文字贴纸 18 张（128×128 PNG，内联在客户端 bundle） |

改文本：编辑 `src/packs.mjs`；改贴纸：编辑 `tools/make-stickers.py` 后重新生成。两者都是**单一数据源**，再跑构建。

## 目录结构

```text
更多表情和颜文字/
├── package.json            # bundle 声明（dsh.bundle.patch / dsh.client）
├── cordis.patch.yml        # 插入一行 more-emoji
├── icon.svg                # 插件图标
├── locale/{zh,en}.json     # 插件页标题与描述
├── assets/stickers/        # 36 张 PNG + manifest.json（由脚本生成）
├── lib/                    # 构建产物（Host 工具/提示 + Client 面板 + 内联数据）
├── src/
│   ├── packs.mjs           # ★ 文本内容库单一数据源
│   ├── host.mjs            # Host：emoji_pack 工具 + 系统提示 + 配置 API
│   └── client.template.js  # Client：面板/贴纸/收藏/最近/设置页
├── tools/
│   ├── build.mjs           # 生成 lib/（内联文本 + base64 贴纸）
│   ├── check.mjs           # 校验文本库（重复/空项/坏字符）
│   └── make-stickers.py    # 生成贴纸 PNG + manifest
└── docs/
    ├── panel.png / stickers.png  # 面板截图
    ├── AGENT.md            # 给智能体看的说明（同时注入系统提示）
    ├── DESIGN.md           # 架构 / 数据流 / 代码地图
    └── TROUBLESHOOTING.md  # 排错
```

## 开发

```bash
python tools/make-stickers.py   # 重新生成贴纸（需要 Pillow）
node tools/build.mjs            # 生成 lib/
node tools/check.mjs            # 校验文本内容库
```

改完 `lib/` 后要**重启一次 DSH**（客户端 bundle 在 Host 启动时构建；只刷新页面不一定拿得到）。
架构与代码地图见 [docs/DESIGN.md](docs/DESIGN.md)，验证方式见仓库 [docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md)。

## 兼容性

- DSH `>=0.2.1-rc.2 <0.3.0`，Node >= 20
- 用到的扩展点：`conversation.input.left`（按钮）、`conversation.input.overlay`（面板）、
  `settings.general.item`（通用设置里的勾选项）、`settings.section`（配置页）、`plugins.bundle.config`；
  Host 侧 `tools` / `systemPrompt` / `webServer`
- 输入与发送走 composer 注入的官方 `inputActions`（`captureInsertion` / `insertText` / `submit`），
  DOM 模拟只作兜底；贴纸走合成 `paste` 事件
- 不改内核、不写 profile 配置文件

## 排错

见 [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)：😊 不出现、点了没反应、贴纸发不出去、
模型不用表情、Emoji 显示成方框、配置不生效、DSH 打不开。

## 隐私

- 插件**不发任何网络请求**（配置 API 只在你本机的 DSH Web 服务上）
- 收藏 / 最近使用 / 一键发送开关存在浏览器 `localStorage`；配置存在 `~/.dsh/more-emoji/settings.json`
- 错误记录只在浏览器本地（最多 20 条），手动复制或提 issue 才会离开本机
- 详见仓库根 [PRIVACY.md](../PRIVACY.md)

## 已知边界

- 贴纸是 36 张内置 PNG；暂不支持导入自定义图片
- 「一键发送」依赖 DSH 的 `submit()`；宿主没有该 API 时退回「插入 + 提示按回车」
- 收藏/最近/开关存浏览器 `localStorage`（按机器保存，不跨设备同步）
- 「收藏 / 常用词优先」是系统提示层的引导，不是硬性概率

## ⭐ 收藏与智能体权重

- 面板里点 ☆ 收藏后：「收藏」页签会出现该条目，并**同步给 Host**
- Host 把它写进系统提示：这些是用户收藏的表情，需要发表情时**优先使用、权重更高**
- 配置页「收藏也参与优先」开关可关闭这个加权（默认开启）
- 收藏只影响选择倾向，不强制、不保证一定发送

## 风险与免责（必读）

- 按「现状」提供，不保证无缺陷；安装/卸载会修改 DSH profile 配置，**请先备份 profile**
- 安装路径必须 ASCII junction（中文路径会写坏 profile）
- 贴纸依赖合成 paste，DSH 编辑器大改时可能静默失效（不崩溃）
- 客户端 bundle 较大（含 36 张贴纸 base64），首屏略慢
- 详细条款见 [DISCLAIMER.md](../DISCLAIMER.md)；使用即视为同意

## 许可

MIT
