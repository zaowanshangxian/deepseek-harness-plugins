# 设计说明：更多表情和颜文字

面向维护者。读完应该能回答：数据从哪来、改哪里、为什么这么拆。

## 1. 两半结构

```
Host（Node，src/host.mjs → lib/index.js）
├─ emoji_pack 工具          tools 服务，defineTool（input schema + output schema/render）
├─ 系统提示
│   ├─ more-emoji-usage     order 2950，固定说明（工具怎么用、1-3 个、边界）
│   └─ more-emoji-settings  order 96，每步实时读配置 → 允许分类 / 常用词 / 收藏加权
└─ 配置 API                 webServer prefix /more-emoji，GET/POST /more-emoji/api/settings
                            ↕ 读写 $DSH_HOME/more-emoji/settings.json（tmp + rename 原子写）

Client（浏览器，src/client.template.js → lib/client.js）
├─ conversation.input.left      😊 按钮（Launcher）
├─ conversation.input.overlay   面板（5 个页签 + 搜索 + 收藏/最近）
├─ settings.general.item        设置→通用 里的「点一下直接发送」
├─ settings.section             设置→更多表情和颜文字（完整配置页）
└─ plugins.bundle.config        插件页里的配置入口（同一组件）
```

**为什么这么拆**：面板必须能读写配置（隐藏、允许分类、常用词），而 `emoji_pack` 工具也在 Host 侧要用同一份配置
——所以配置唯一落盘在 Host 侧的文件里，客户端通过同源 API 读写，不用各自存一份再同步。

## 2. 数据流

```
src/packs.mjs（唯一数据源：44 分类 / 911 条）
        │  tools/build.mjs
        ├─→ lib/packs.mjs         （Host 侧 import）
        └─→ lib/client.js         （内联成 __PACKS_JSON__，含 36 张贴纸 base64）

用户点条目
  ├─ 文本：composer inputActions: captureInsertion() → insertText(token) → （可选）submit()
  └─ 贴纸：PNG → File → 合成 paste（ClipboardEvent/DataTransfer）→ 官方上传附件 → 停在输入框

模型调用 emoji_pack(args)
  → normalizeArgs → selectPacks（按 kind/category/query + 用户允许分类过滤）
  → pickItems（count / random）→ 输出 schema + render 文本
```

## 3. 存储与契约

| 存什么 | 位置 | 谁写 |
| --- | --- | --- |
| 允许分类 / 常用词 / 隐藏入口 / 收藏加权 / 收藏列表 | `%USERPROFILE%\.dsh\more-emoji\settings.json` | 客户端 → POST `/more-emoji/api/settings` → Host 原子写 |
| 收藏（本地镜像） | `localStorage['dsh-more-emoji:favorites']` | 客户端 |
| 最近使用（最多 40） | `localStorage['dsh-more-emoji:recent']` | 客户端 |
| 一键发送 | `localStorage['dsh-more-emoji:directSend']` | 客户端 + 设置行 |
| 错误记录（最多 20，去重） | `localStorage['dsh-errors:dsh-plugin-more-emoji']` | 客户端 |
| 错误上报总开关 | `localStorage['dsh-errors-off:dsh-plugin-more-emoji']` | 配置页 |

配置 API 的防护（`registerSettingsApi`）：

- 只处理 `/more-emoji` 前缀；`GET` 读、`POST` 写，其它方法 405
- 有 `Origin` 头时校验 `origin.host === req.headers.host`，跨域直接 **403**
- 请求体上限 **64KB**（`MAX_BODY`）
- 写入前 `sanitizeSettings()`（字段白名单/类型/枚举校验 + 老版本字段迁移），再 `tmp` + `rename` 原子落盘

## 4. 代码地图

`src/host.mjs`

| 函数 | 责任 |
| --- | --- |
| `DEFAULT_SETTINGS` / `sanitizeSettings` | 默认值 + 校验/迁移 |
| `readSettings` / `writeSettings` / `ensureSettingsFile` | 读、原子写、首次创建 |
| `allowedPackIds` / `priorityItems` / `customBlock` | 配置 → 过滤集合 / 置顶条目 / 提示片段 |
| `catalogText` / `matchesQuery` / `pickItems` | 目录文本、关键词匹配、取样 |
| `normalizeArgs` / `selectPacks` / `renderSelection` / `execute` | 工具主流程 |
| `registerTools` / `registerPrompt` | 工具与两段提示的注册 |
| `registerSettingsApi` / `readBody` / `sendJson` | 配置 API |

`src/client.template.js`

| 区块 | 责任 |
| --- | --- |
| `installErrorReporter` | 本地错误记录 + `window.__dshErrorReporter` |
| `DATA / KINDS / PACKS / STICKERS` | 构建时内联的内容库 |
| `readJson` / `writeJson` / `loadFavorites` / `pushRecent` | localStorage 持久化（失败降级为内存） |
| 模块级 store + `useStore` | 三个扩展点共享 UI 状态 |
| `loadSettings` / `normalizeSettings` | 与 Host 共用配置（GET API） |
| Launcher / Panel / SettingsRow / SettingsPage | 五个注册点的组件 |
| `registerSlot()` + `guard()` | 统一的注册保险丝 |

## 5. 关键决策

| 决策 | 为什么 |
| --- | --- |
| 内容库单一数据源 + 构建期内联 | 浏览器端拿不到包内文件；内联后零请求。代价是 bundle 大（贴纸 base64） |
| 配置落盘在 Host | 工具和面板要同一份真相；也方便用户备份/手改 |
| 每个扩展点独立 `try/catch` 保险丝 | 任何一个注册点失败都不能拖垮整个 Web UI（有过官方 `ui-chat` 激活失败的教训） |
| 发送走官方 `inputActions` | 直接操作 contenteditable 的 DOM 在不同版本会碎；官方 API 有 `captureInsertion` 令牌校验 |
| 贴纸走合成 `paste` | DSH 没有公开的「贴图」API；paste 是编辑器认的输入通道，官方上传逻辑会接管 |
| 收藏/常用词用「提示层加权」而不是硬过滤 | 不剥夺模型判断；用户也能通过配置关掉加权 |

## 6. 加一个分类 / 一条内容

1. 编辑 `src/packs.mjs`：往 `PACKS` 加 `{ id, kind, name, items: [...] }`（同 kind 下 `name` 唯一，`id` 全局唯一）
2. `node tools/check.mjs`（重复/空项/坏字符）
3. `node tools/build.mjs`
4. 刷新页面；面板新页签自动出现，`emoji_pack` 的目录也随之更新

## 7. 已知边界

- 贴纸是内置 PNG（36 张），不支持用户导入
- 「一键发送」依赖 `submit()`，没有就退回插入
- 配置接口只对本机 Web 服务开放；远程访问 DSH 时以 Host 的鉴权为准
- 系统提示注入会占少量 token（两段加起来约 1KB 级），介意可在 `src/host.mjs` 里删 `registerPrompt(ctx)` 调用
