# 发布流程

## 版本号

语义化版本，两个插件**独立编号**：

| 改动 | 升 | 例子 |
| --- | --- | --- |
| 行为变化 / 新功能 / 修 bug | minor | 0.8.2 → 0.9.0 |
| 仅文档、注释、构建产物刷新 | patch 或不动 | —— |
| 破坏性变更（官方契约改动、需要新 DSH 版本） | major（到 1.0.0 前用 minor + 醒目说明） | —— |

一次发版要同步改这些地方（漏一个就会在文档里留下不一致）：

1. `<插件>/package.json` → `version`
2. `<插件>/src/client.js`（表情插件是 `src/client.template.js`）里 `installErrorReporter({ version: '…' })` 的字符串
3. `<插件>/CHANGELOG.md` → 新增一节（`## x.y.z` + 现象/根因/修法/验证）
4. 根 `CHANGELOG.md` → 表格加一行（日期 / 插件 / 版本 / 主要变化）
5. README 里出现的版本号（根 README 的插件表、插件 README 第一段）
6. `docs/` 里引用的行为描述（改了实现就必须改设计文档）

## 发版步骤

```bash
# 1. 从干净状态开始
git status                     # 应当干净

# 2. 构建 + 校验（见 docs/DEVELOPMENT.md）
cd 输入框花费金额 && node tools/build.mjs && node --check lib/client.js
cd ../更多表情和颜文字 && node tools/check.mjs && node tools/build.mjs && node --check lib/client.js && node --check lib/index.js
cd ..

# 3. 提交
git add -A
git commit -m "fix(inline-cost): 0.9.0 —— 锚定官方用量卡片 dl、修 token-mb 路由与配置页注册"

# 4. 打 tag（名字规则见下）+ 推送
git tag inline-cost-v0.9.0
git push origin main --tags
```

**Tag 命名**：`inline-cost-v<版本>` / `more-emoji-v<版本>`（小写、连字符）。
仓库早期用的是不带前缀的 `v0.4.1` / `v0.5.0` / `v0.6.0`，属于历史遗留，**不要删也不要复用**；
新 tag 一律带插件前缀，避免两个插件版本号撞车。

**GitHub Release**：标题用 `输入框花费金额 v0.9.0`，正文直接取该插件的 CHANGELOG 小节；有 `.tgz` 就挂上去。
两个插件同一天发版时各发一个 release，不要合并。

## 网络不通时

`git push` 可能被 reset（本机网络对 GitHub 不稳定时常见）。本地辅助脚本（**不在仓库内**）：
`L:\work\scripts\api-push.py` —— 用 GitHub Git Data API 直接提交 blob/tree/commit 并更新 ref。

用之前注意：

- 脚本里的 `TAGS` 列表要改成**这次要发的 tag**（它不会自动读 `git tag`）
- API 推的 commit sha 与本地不同（元数据归一化），内容一致；网络恢复后本地
  `git fetch origin && git reset --hard origin/main` 对齐即可
- 推完去 GitHub 确认：文件内容、tag、release 三样都在

## 发布后自检（3 分钟）

1. 网页上打开 README：截图能显示、表格没错行、链接不 404
2. 按 README「安装」在干净环境装一遍（至少换个 profile 或临时机器）
3. 装完打开用量卡片 / 表情面板各点一次（对应插件）
4. 卸载一遍，确认官方 UI 正常、无残留
5. `git tag` 与 Release 页面一致

## 回滚

- 装坏了：profile 备份（`package.json.bak*`、`cordis.patch.yml.bak-*`）覆盖回去 → 校验 JSON → 重启；
  或双击 `DSH一键恢复.cmd`
- 版本有问题：`git revert` 对应 commit → 升 patch 版本发一次；**不要**直接改已发布的 tag
