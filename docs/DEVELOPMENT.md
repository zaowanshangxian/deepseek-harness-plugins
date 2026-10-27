# 开发与验证

## 环境

- Node **>= 20**（只用内置模块；构建、校验脚本不需要 `npm install`）
- Python 3 + Pillow（仅当你要重新生成贴纸：`more-emoji/tools/make-stickers.py`）
- DSH 桌面版或 `dsh web`（手动验收）
- 可选：`dsh-token-mb`（花费插件想拿到「官方记录」而不是估算时要装）

## 仓库结构

```text
deepseek-harness-plugins/
├── 快速显示花费/          # 纯 Client 插件
│   ├── src/client.js        # 源码（单文件）
│   ├── lib/client.js        # 构建产物 = 源码拷贝
│   ├── tools/build.mjs
│   ├── docs/{DESIGN,TROUBLESHOOTING}.md + screenshots/
│   └── .verify/             # 本地验收产物（gitignored）
├── 更多表情和颜文字/        # Host + Client
│   ├── src/{packs.mjs,host.mjs,client.template.js}
│   ├── assets/stickers/     # 36 张 PNG + manifest.json
│   ├── lib/{index.js,client.js,packs.mjs}
│   ├── tools/{build.mjs,check.mjs,make-stickers.py}
│   └── docs/{AGENT,DESIGN,TROUBLESHOOTING}.md + 截图
├── docs/                    # 本文件、架构、发布
└── .github/                 # issue/PR 模板、CI
```

## 常用命令

```bash
# 花费插件
cd 快速显示花费
node tools/build.mjs            # src/client.js → lib/client.js
node --check lib/client.js      # 语法检查

# 表情插件
cd 更多表情和颜文字
node tools/check.mjs            # 内容库校验：重复 id/name、空项、坏字符
node tools/build.mjs            # src/* + assets → lib/*
node --check lib/client.js && node --check lib/index.js
python tools/make-stickers.py   # 需要时重新生成贴纸（Pillow）
```

构建产物一致性（CI 也跑这个）：

```bash
cd 快速显示花费 && node tools/build.mjs && git diff --exit-code lib/
cd ../更多表情和颜文字 && node tools/build.mjs && node tools/check.mjs && git diff --exit-code lib/
```

`git diff --exit-code` 非零 = 忘了提交 `lib/`，或 `src/` 与产物不同步。

## 在本机安装/更新调试

```bat
:: 首次：中文目录 → ASCII junction
mklink /J L:\work\plugins\more-emoji  "L:\work\deepseek-harness-plugins\更多表情和颜文字"
mklink /J L:\work\plugins\inline-cost "L:\work\deepseek-harness-plugins\快速显示花费"

:: 装（在 DSH 里让 Agent 执行）
:: plugin_manager install_bundle  target = L:\work\plugins\inline-cost
```

- 因为是 `link:` 安装，**不用重装**；但改完 `lib/` 要**重启 DSH**（客户端 bundle 在启动时构建）
- 装/卸之前备份 profile（见根 [README](../README.md#安装)）

## 两种安装模式（和对应的更新动作）

| 模式 | profile 里的依赖长什么样 | 更新怎么做 |
| --- | --- | --- |
| **link（开发用）** | `link:L:/work/plugins/inline-cost`（junction → 仓库目录） | 改代码 → `node tools/build.mjs` → **重启 DSH** |
| **tarball（使用用）** | `https://github.com/.../releases/download/<tag>/<file>.tgz` | `dsh plugin --profile desktop add <新 tag 的 URL>` → 重启 DSH |

- 切模式：直接 `dsh plugin add <新的 spec>`，pnpm 会替换依赖项；`dsh.profile.bundles` 会自动保持
- 本机一键更新脚本：`L:\work\scripts\dsh-plugins-update.ps1`（查最新 release → 装 → 重启；`-CheckOnly` 只检查）
- 发版：`L:\work\scriptselease-plugin.ps1 -Plugin cost|emoji`（构建 → 冒烟 → 打包 → 提交/推送 → 建 release）

## 验证分三层

### 第 1 层：静态

```bash
node --check lib/client.js         # 语法
node tools/check.mjs               # 内容库
git diff --exit-code lib/          # 产物一致
```

### 第 2 层：离线 harness（不碰真实 DSH）

花费插件历史版本用 `.verify/harness/` 里的假 DOM 跑注入逻辑（`dump-*.html` 是不同版本的模拟卡片）。
做法：把 `lib/client.js` 塞进一个 `window.__ModuleLoader__` 桩、喂一个假卡片、断言 `#inline-cost-dd` 的文本。

优点：秒级、可回归；缺点：**假 DOM 会和真实页面脱节**——0.8.x 的 bug 就是这么漏掉的（假 DOM 里卡片能命中，
真实页面里命中的是聊天记录里的普通元素）。所以第 3 层必须有。

### 第 3 层：真实 GUI（关键）

思路：用无头浏览器连上**正在跑的** DSH Web（默认 `http://127.0.0.1:51388`），像用户一样点开卡片/面板，
读 DOM、截图。要点：

1. DSH Web 需要同源登录 cookie。桌面版的 cookie 由一次性的启动 token 换取，脚本没法直接拿；
   调试时可以从 `~/.dsh/.credentials.yaml` 里的 `client-connection/browser-session.payload.secret`
   自行签一个（cookie 名与签名算法见 DSH 源码 `client-connection` 部分）。
   **这个 cookie 等价于本机登录态：只在本机调试用，绝不外发、绝不写进仓库。**
2. 用 CDP 驱动：启动 Edge/Chrome `--headless=new --remote-debugging-port=9333`，
   `Network.setCookie` 写入 cookie → `Page.navigate` → `Runtime.evaluate` 读 DOM → `Page.captureScreenshot` 截图。
3. 具体的 `launch-edge.ps1` / `setup.mjs` / `act.mjs` 在 `快速显示花费/.verify/cdp/`（gitignored，随本机保留）。

手工回归清单（每次改动至少跑一遍）：

| 插件 | 检查 |
| --- | --- |
| 花费 | 打开会话卡片有「花费金额」→ 打开单轮卡片有「本轮估算」→ 关卡片后行消失 → 关开关后行消失 → 杀掉 token-mb 仍有估算 |
| 表情 | 😊 出现/面板打开/插入文本/贴纸粘贴/收藏/最近/配置页保存/隐藏入口勾选后 😊 消失但 `emoji_pack` 仍可用 |
| 通用 | 卸载后官方 UI 正常、无残留 DOM（`#inline-cost-*` 不存在） |

截图存档建议放 `.verify/screenshots/`，**发布用的图**放各插件 `docs/screenshots/` 且要先裁掉会话标题等私人信息。

## 提交前

- 跑完上面三层里适用的检查
- 更新两份 CHANGELOG（插件 + 根）与相关 README/文档
- 版本号规则见 [RELEASING](./RELEASING.md)
- 不要提交 `.verify/`、`edge-profile/`、临时 dump
