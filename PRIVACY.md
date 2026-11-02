# 隐私说明

一句话：**本仓库的插件都不联网、不上传；你在界面上看到的数字和文字，就是它们能看到的全部。**

## 数据清单

| 数据 | 谁用 | 存在哪 | 会离开本机吗 |
| --- | --- | --- | --- |
| 官方用量卡片上已显示的 token 数字 | 花费插件 | 内存（30s 缓存） | 不会 |
| `dsh-token-mb` 的会话汇总（`/token-mb/summary`） | 花费插件 | 内存（30s 缓存） | 不会（同源请求，本机 Host） |
| 会话日志里的 `tool/call`（工具名）与 `assistant/message.usage`（token 数） | 工具税 | 只读，解析后聚合到内存；缓存落 `~/.dsh/tool-tax/cache.json` | 不会 |
| `ctx.tools.schemas()`（工具名/描述/参数 schema） | 工具税 | 只读，内存 | 不会 |
| 工具账单上次渲染的数据（工具名、次数、token、金额） | 工具税 | `localStorage['tool-tax:last']` | 不会 |
| 「显示花费金额」开关 | 花费插件 | `localStorage['dsh-inline-cost:disabled']` | 不会 |
| 最近 20 条错误（消息/堆栈/UA/时间） | 两个插件 | `localStorage['dsh-errors:<插件 id>']` | **默认不会**，除非你在配置页点「复制报告」或「去 GitHub 提 issue」 |
| 错误上报总开关 | 两个插件 | `localStorage['dsh-errors-off:<插件 id>']` | 不会 |
| 收藏的表情 | 表情插件 | `localStorage['dsh-more-emoji:favorites']` + 同步到 Host 的配置文件 | 不会 |
| 最近使用（最多 40 条） | 表情插件 | `localStorage['dsh-more-emoji:recent']` | 不会 |
| 「一键发送」开关 | 表情插件 | `localStorage['dsh-more-emoji:directSend']` | 不会 |
| 插件配置（隐藏入口/允许分类/常用词/收藏加权） | 表情插件 | `~/.dsh/more-emoji/settings.json` | 不会 |

## 它们**不**读什么

- 不读会话内容、不读对话历史文件、不读输入框里你打的字（花费插件只读官方卡片上已经渲染出来的数字）
- 工具税会读会话日志文件，但**只取 `type`、工具名、`turn/step`、`usage` 四个字段**，不读、不存、不上传任何消息正文
- 不读剪贴板、不读账号凭据、不读 `~/.dsh/.credentials.yaml`
- 不装后台进程/计划任务、不 hook 全局函数、不改 DSH 配置文件

## 网络

- **没有任何出站请求**。唯一的外部 HTTP 交互是花费插件向**本机** DSH Host 请求 `/token-mb/summary`
  （由 `dsh-token-mb` 提供的只读路由），以及表情插件向**本机**的 `/more-emoji/api/settings` 读写自己的配置。
- 没有遥测、没有统计、没有崩溃自动上报。错误记录只落在你自己的浏览器里。
- 工具税**没有任何出站请求**：只请求本机 DSH Host 的 `/api/tool-tax/report` 与 `/api/tool-tax/tools`。
- 表情插件的贴纸：点一下是把 PNG 合成 `paste` 事件交给 DSH 的**官方附件上传**，走你平时的上传通道（是否联网由 DSH 决定）。

## 第三方

- 花费插件会读 `dsh-token-mb` 的接口。那个插件自己会扫描 `~/.dsh/sessions` 下的会话日志来统计 token
  —— **那是它的行为，不是本仓库的**，它的隐私边界请看它自己的 README。
- 没装 `dsh-token-mb` 时，花费插件只用卡片上显示的数字估算，不读任何文件。
- 工具税**不依赖** token-mb 的数据，但卡片显示在 token-mb 的 Token 页里；没装时只是没有落点、卡片不出现，不会报错。

## 卸载后留下什么

删掉插件后，下列数据**不会自动消失**（按机器保存，重装会沿用）：

| 位置 | 内容 | 想清掉 |
| --- | --- | --- |
| `localStorage['dsh-inline-cost:disabled']` | 花费行开关 | DevTools → Application → Local Storage 删除 |
| `localStorage['dsh-errors:*']` / `dsh-errors-off:*` | 错误记录与开关 | 同上 |
| `localStorage['dsh-more-emoji:favorites' / ':recent' / ':directSend']` | 收藏 / 最近 / 一键发送 | 同上 |
| `~/.dsh/more-emoji/settings.json` | 表情插件配置 | 直接删文件 |
| `~/.dsh/tool-tax/cache.json` | 工具税会话聚合缓存（工具名+数字，无正文） | 直接删文件，下次自动重建 |
| `localStorage['tool-tax:last']` | 工具税上次渲染数据 | 同上 |

## 变更

隐私相关的行为变化（新增存储、新增请求）必须同步改这份文件，并在 `PROJECT.md` 的「五、版本时间线」里写明。
