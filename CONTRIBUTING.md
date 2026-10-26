# 贡献指南

谢谢愿意花时间。这个仓库不大，规则也就几条，核心是：**别接管官方组件，别让插件崩掉宿主，别留下擦不掉的痕迹。**

## 三种贡献方式

### 1. 报 bug

先看 [FAQ.md](./FAQ.md) 和对应插件的 `docs/TROUBLESHOOTING.md`，再提 issue
（[模板](./.github/ISSUE_TEMPLATE/bug-report.yml)）。请带上：

- 插件名 + 版本（设置 → 对应插件 → **复制报告**，里面有版本、UA、最近错误）
- DSH 版本（`dsh --version` 或 设置 → 账号与余额 底部）
- 复现步骤 + 截图 / 控制台报错
- 是否装了 `dsh-token-mb`（花费插件相关时）

### 2. 加内容（最容易上手）

表情 / 颜文字 / 文字表情 / 短句全在一个文件里：`更多表情和颜文字/src/packs.mjs`。

```js
{
  id: 'kaomoji-new',        // 全局唯一
  kind: 'kaomoji',          // emoji | kaomoji | art | phrase
  name: '新分类名',          // 同一 kind 下唯一
  items: ['(๑•̀ㅂ•́)و✧'],
}
```

然后：

```bash
cd 更多表情和颜文字
node tools/check.mjs     # 重复 / 空项 / 坏字符
node tools/build.mjs     # 生成 lib/
```

PR 只需改动 `src/packs.mjs` + `lib/`（构建产物要一起提交）+ `CHANGELOG.md` 一行。

### 3. 改代码

改之前请读 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) 和该插件的 `docs/DESIGN.md`。

**四条硬约束**（违反会被拒）：

1. **不接管官方槽位**：不复用官方 slot id、不替换官方组件。新功能只能用新 id 注册，或纯 DOM 观察追加。
   历史事故：v0.3 用官方 usage 格子 id 替换组件 → `ui-chat` 激活失败 → DSH 进安全模式、profile 被重置。
2. **保险丝**：每个注册点独立 `try/catch`，失败只跳过自己，绝不抛到宿主。
3. **可卸载**：不写 DSH 配置文件、不改 profile；卸载后零残留（`localStorage` 允许残留，但要在
   [PRIVACY.md](./PRIVACY.md) 里写明 key）。
4. **不引入运行时依赖**：`dependencies` 保持为空（构建期的 Node 内置模块随意）。贴纸/文本一律构建期内联。

**安装路径**：本地调试必须用 ASCII junction（`mklink /J L:\work\plugins\<ascii> "<中文目录>"`），
否则 pnpm 会把 profile 的 `package.json` 写成 GBK 乱码。

## 本地流程

```bash
git clone https://github.com/zaowanshangxian/deepseek-harness-plugins.git
cd deepseek-harness-plugins

# 花费插件
cd 快速显示花费 && node tools/build.mjs && node --check lib/client.js

# 表情插件
cd ../更多表情和颜文字 && node tools/check.mjs && node tools/build.mjs && node --check lib/client.js
```

改完 `lib/` 后要重启 DSH（客户端 bundle 在 Host 启动时构建）。
验收方式见 [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)（离线 harness + 真实 GUI 的 CDP 验收）。

## 提交信息

沿用现有风格：`type(scope): 版本 —— 一句话`

```text
fix(inline-cost): 0.9.0 —— 锚定官方用量卡片 dl、修 token-mb 路由与配置页注册
docs(emoji): 0.7.2 —— 补「收藏后智能体提高使用权重」的说明
```

- `type`：`feat` / `fix` / `docs` / `refactor` / `chore`
- `scope`：`inline-cost` / `emoji` / `repo`
- 正文写清楚 **现象 → 根因 → 修法 → 怎么验证的**（这个仓库的历史里，细节比结论值钱）

## PR 检查清单

- [ ] `node tools/build.mjs` 后 `lib/` 已更新并一起提交
- [ ] `node --check lib/client.js` 通过；表情插件 `node tools/check.mjs` 通过
- [ ] 手工回归：插件能加载、原有功能没坏、卸载后界面正常
- [ ] 版本号：改行为 → 升 minor；只改文档 → 不升版本；补丁 → 升 patch（见 [docs/RELEASING.md](./docs/RELEASING.md)）
- [ ] 同步更新：插件 `CHANGELOG.md`、根 `CHANGELOG.md` 一行、相关 README/文档
- [ ] 没有提交 `.verify/`、临时截图、带个人信息（姓名/路径/会话标题/账号）的图片
- [ ] 没有新增运行时依赖，没有改 `LICENSE`

## 不要做的事

- 不要为了「更好看」去替换官方组件——这是本仓库最硬的一条红线
- 不要提交 `node_modules/`、`.verify/`、`edge-profile/`
- 不要在文档里写没有验证过的行为（尤其是「支持某版本」这类断言）
- 不要把别人的会话截图、账号信息、API key 带进仓库
