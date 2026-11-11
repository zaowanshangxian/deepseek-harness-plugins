# RUNBOOK · 2026-11-12 卸 zzerx + 关 fish

> 目的：观察期满 7 天（11-05 → 11-12）后的收尾。**涉及系统改动，执行前要哥哥点头。**
> 原则：先备份 → 先软停（已做）→ 再卸 → 每步可回滚；任何一步异常就停。

## 0. 前置检查（现在就成立，执行当天再核一次）

```bash
cat ~/.dsh/memhub/self-check.json        # recallSource: memhub，memoryErrors: 0
cat ~/.dsh/profiles/desktop/cordis.patch.yml | grep -A2 "id: zzerx-memory"   # disabled: true 在
ls ~/.dsh/storages/memory                # 旧库还在（备份源）
```

## 1. 备份（执行当天）

```bash
# 新拍一份，不覆盖 11-05 那份
cp -r ~/.dsh/storages/memory ~/.dsh/storages/memory-backup-20261112
du -sh ~/.dsh/storages/memory-backup-20261112   # 应 ≈11 MB
```

## 1.5 迁移星图（**卸载前必须做**，2026-11-11 补）

记忆早就迁完了，但**实体/边只存在 zzerx 库里**，没有迁移就等于丢：真机这份是 82 实体 / 2013 边，卸完星图页会变空（而且 `/api/graph` 照样 200，不报错）。

```bash
node harness/tools/migrate-memory.mjs            # dry-run：看 entities / edges 条数
node harness/tools/migrate-memory.mjs --apply    # 搬记忆（幂等，已存在跳过）+ 搬星图
```

- 落的目录：`~/.dsh/memhub/graph/{entities,edges}`
- 幂等：第二次跑应显示「复制 0，跳过 2095」
- 不覆盖：本地已有同名文件就跳过，不会把新写的图冲掉

## 2. 卸载 zzerx（硬）

- 走 GUI 插件管理器卸载 `@zzerx/dsh-plugin-memory`（`dsh plugin --profile desktop` 会被拒，别试）
- 或从 `~/.dsh/profiles/desktop/package.json` 的 `dependencies` + `dsh.profile.bundles` 移除后重启

**回滚**：GUI 重装 `@zzerx/dsh-plugin-memory@0.4.3` + 恢复备份目录 + 删掉 patch 里的 `disabled: true`。

## 3. 关 fish

```bash
# 改前备份
cp ~/.dsh/fish-memory-config.json ~/.dsh/fish-memory-config.json.bak-20261112
# 把「全局开关」改成 false（JSON 里是中文键）
```

数据目录 `~/.dsh/fish-memory` **保留不动**（关掉≠删数据）。
**回滚**：改回 `true`。

## 4. 卸完验什么

| 检查 | 期望 |
|---|---|
| `self-check.json` | `recallSource: memhub`，`memoryErrors: 0`，`memories` 不降（当前 144） |
| `memhub_search("QQ 机器人")` | 仍能搜到迁移来的条目 |
| 注入块 | 仍有「## 记忆（背景…」且不含 fish 的「你记得的事」块 |
| `/memhub/api/state` | 200，技能 119 / 记忆 144 |
| `/memhub/api/graph` | 200，`entities: 82`、`edgesRaw: 2013`（**跑了 1.5 才有**；没跑 = 0，且启动日志里有一条 warn） |
| `memhub_raw` | 会答「旧库 raw_documents 目录不存在」——**这是正常的**，L0 原文随 zzerx 一起没了 |
| 日志 | 无 `zzerx`/`fish` 相关插件加载报错；无「记忆源读取有 N 个错误」 |

## 5. 不要做

- 不要删 `~/.dsh/storages/memory-backup-*`（回滚唯一依靠）
- 不要顺手清 `~/.dsh/skills`（技能库和 zzerx 无关）
- 不要动 `~/.dsh/memhub/orbs`（新真源）
- `arc_` 归档记忆不回填

## 6. 之后

- 观察 3 天：`memoryErrors` 保持 0、随机抽查 3 条 `m_` 记忆能搜到
- 体检：`node tools/health-report.mjs --dupes --write`
- 若出现「记得的东西想不起来」→ 立刻回滚第 2 步
