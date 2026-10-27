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
- 发版：`L:\work\scripts
elease-plugin.ps1 -Plugin cost|emoji`（构建 → 冒烟 → 打包 → 提交/推送 → 建 release）

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

### 第 3 层：沙箱验收（发布版 tarball，不碰本地客户端）

**规矩：不在哥哥日常用的客户端/profile 上做验证。** 每个版本都从 GitHub Release 装到一个独立 DSH_HOME 里跑，
用无头浏览器点开真卡片/真面板，断言 + 截图，跑完销毁。

```powershell
# 全流程：装最新 release → 起沙箱 host（随机端口）→ 无头 Edge → 验收 → 出报告 → 关闭
powershell -NoProfile -ExecutionPolicy Bypass -File L:\work\scripts\sandbox-test.ps1

# 常用参数
#   -Refresh        重新按 GitHub 最新 release 装（默认已装且版本够就不动）
#   -KeepRunning    测完不关，方便自己点开看
#   -Session <标题>  指定要打开哪个会话（默认「重启DSH验收插件」）
#   -Shot <路径>     截图位置
```

结构：

```
L:\work\.dsh-sandbox\            # 独立 DSH_HOME（不是你的 ~/.dsh）
├── profiles/sandbox/            # 只有 base + web-app + 两个插件（从 release .tgz 装）+ dsh-token-mb
├── sessions/--L-work--/         # 只复制一份会话，用来构造「有用量」的验收场景
├── storages/                    # 工作区索引（让会话能显示出来）
├── .credentials.yaml            # 复制一份（读账号余额用）
└── edge-profile/                # 无头浏览器专用 profile（不会动你平时的浏览器）
```

验收脚本 `L:\work\scripts\sandbox-verify.mjs` 断言：

1. 两个插件的客户端都加载（`__inlineCostInstalled`、`__dshErrorReporter[...]`）
2. 能打开会话、点开用量卡片
3. 卡片里出现「花费金额」与「账户余额」两行（并读悬停提示）
4. 截图 + 输出 JSON；报告写到 `L:\work\logs\sandbox-test-<时间>.md`

**这是发布后的最后一道门**：`release-plugin.ps1` 发完版本 → 跑一次 `sandbox-test.ps1 -Refresh`，
通过才算这版可用。任何只在本地 link 模式下验过的改动，都不算验过。

### 第 3 层补充：本地 link 模式（只给开发时快速迭代）

link 模式（`junction` + `plugin_manager install_bundle`）只适合改代码时肉眼快看，
**不作为验收依据**：它跑的是仓库工作区，而不是发布出去的 tarball。

## 提交前

- 跑完上面三层里适用的检查
- 更新两份 CHANGELOG（插件 + 根）与相关 README/文档
- 版本号规则见 [RELEASING](./RELEASING.md)
- 不要提交 `.verify/`、`edge-profile/`、临时 dump
