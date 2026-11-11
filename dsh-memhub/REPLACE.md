# 替代清单：memhub 顶掉原插件（2026-11-05）

> 用途：**记事本 + 验收单**。每一条都必须能回答「凭什么说它能替代」「什么条件算通过」「删了怎么回滚」。
> 状态：**当前一条都不能删**，因为迁移还没做（见 §3）。

---

## 1. 先分清「能替代」和「不能替代」

| 原插件 | 提供什么 | memhub 能替代吗 | 结论 |
|---|---|---|---|
| `@zzerx/dsh-plugin-memory` 0.4.3 | `memory_*` 工具面、跨会话记忆库（全局/项目双作用域）、自动注入、设置面板「记忆」分区 | **能**（工具面 + 注入 + 面板都有对应物） | 可替代，但要先迁移数据 |
| `dsh-fish-memory` 1.4.6 | 「会淡忘」的陪伴记忆，每条带时间，按会话开关 | **部分**（衰减机制能覆盖，陪伴语义不能） | 看哥哥要不要保留陪伴功能 |
| `dsh-engineering-skills` 0.1.2 | **技能内容本体**（tdd / code-review / grill 等） | **不能** | **不要删**（删了技能就没了） |

> `dsh-engineering-skills` 的 patch 自己写着：`skill` 工具行、`/` 技能菜单、目录都由 harness 内置（`@deepseek-ai/dsh-tool-skill`）提供，它只提供内容。memhub 改的是「怎么被发现和加载」，**不提供技能内容**。

---

## 2. 逐项覆盖矩阵

### 2.1 工具面

| zzerx 工具 | memhub 对应 | 差距 |
|---|---|---|
| `memory_save` | `memhub_save` | ✅ 有；超长硬拒（≤2000 字），带 id 覆盖 |
| `memory_search` | `memhub_search` | ✅ 有；2-gram + 标题权重，双源（当前源 + 本地 orb） |
| `memory_list` | 无（`memhub_search` 空查询=最近 5 条） | ⚠️ 没有分页/全量列表 |
| `memory_update` | `memhub_save` 带 `id` | ⚠️ 是整条覆盖，不是字段级更新 |
| `memory_entity` | `memhub_graph` op=entity | ✅ 有 |
| `memory_link` | `memhub_graph` op=link | ✅ 有 |
| `memory_archive` | `memhub_archive` | ✅ 有（只改 sidecar，可恢复） |
| — | `memhub_open` / `memhub_raw` / `memhub_budget` | ➕ memhub 独有（全文 / L0 原文 / 预算可解释） |

### 2.2 注入面

| 能力 | zzerx | memhub | 判定 |
|---|---|---|---|
| 每轮自动注入记忆 | ✅ | ✅ 280 字符硬预算（实测 257 字符 ≈167 tokens） | ✅ 可替代 |
| 按 tier 分级 | 部分 | ✅ **四级**：core 永久 / long 180 天 / mid 90 天 / event 30 天（保护期内不衰减） | ✅ 更强 |
| 归档可恢复 | ✅ | ✅ sidecar.archived，永不 unlink | ✅ 对等 |
| 冻结（淡了不自动注入） | 有 | ✅ `isDormant`：decay<0.3 且 3 天没想起 → 不注入；查到即醒；1h 冷却 | ✅ 已对齐（原语义相反，已重做） |

### 2.3 fish 的专属能力

| 能力 | memhub | 判定 |
|---|---|---|
| 半衰期淡忘 | ✅ tier 衰减（算子不同：fish 30 天半衰期，memhub 按 tier） | 大致对等 |
| 每条带时间 | ✅ `updatedAt` / `createdAt` | 对等 |
| **按会话开关**（`fish-memory-config.json` 的 sessions） | ❌ 无 | 缺口，且是产品体验 |
| **陪伴语气**（聊天时的「会想起来的记忆」） | ❌ 无（memhub 存事实/决策/教训） | **语义不同，不替代** |
| 设置面板入口 | ✅ memhub 面板 | 对等 |

**结论**：fish 只能替代「衰减 + 存储」，替代不了「陪伴感」。建议保留 fish，或明确放弃陪伴功能后再删。

---

## 3. 删除的前置条件（缺一不可）

按顺序，**不许跳**：

1. ~~**Step 1 收尾**~~：✅ 已完成（实体/边落 orb + 休眠语义）
2. **Step 2 迁移**：`node tools/migrate-memory.mjs`（dry-run 看去重报告）→ 确认 → `--apply`
3. **切源**：profile patch 里 `recall.source: memhub`，重启
4. **观察期**：至少 **7 天**，每天检查
   - `memhub_budget` 正常（≤280 字符）
   - `memhub_search` 能搜到迁移来的条目
   - `self-check.json` 的 `memoryErrors` 保持 0
   - 没有「记得的东西突然想不起来」
5. **停用而不卸载**（先软后硬）：
   - zzerx：profile patch 里给它 `disabled: true`，观察 3 天
   - fish：`fish-memory-config.json` 的 `全局开关: false`
6. **最后才卸载**，且保留备份

---

## 4. 删除步骤（每条都可回滚）

### 4.1 停用 zzerx（软）

```yaml
# ~/.dsh/profiles/desktop/cordis.patch.yml 追加
- id: zzerx-memory
  disabled: true
```

回滚：删掉这两行，重启。

### 4.2 卸载 zzerx（硬）

- GUI 插件管理器卸载，或从 `package.json` 的 `dependencies` + `dsh.profile.bundles` 移除
- **卸载前必须**：`~/.dsh/storages/memory` 整目录备份一份到 `~/.dsh/storages/memory-backup-<日期>`

回滚：GUI 重装 `@zzerx/dsh-plugin-memory@0.4.3` + 恢复备份目录。

### 4.3 关 fish

- 改 `~/.dsh/fish-memory-config.json` 的 `全局开关: false`（改前备份）
- 数据 `~/.dsh/fish-memory` 保留不动

回滚：改回 `true`。

---

## 5. 什么情况下**不要**删

- 迁移后 `memoryErrors > 0` → 先修，别删
- 观察期出现「搜不到以前记得的东西」→ 回滚切源，别删
- 哥哥还想要陪伴记忆 → fish 保留
- 想用 `memory_entity` / `memory_link` 做实体图 → 等 Step 1 补完，别急着删 zzerx

---

## 6. 当前状态（2026-11-05）

| 项 | 状态 |
|---|---|
| memhub 已装 + 真机加载 | ✅ |
| 技能零预注入 | ✅ 已生效 |
| 记忆写入通道 | ✅ `memhub_save` / `memhub_search`（待重启注册） |
| 实体/边落 orb | ✅ `memhub_graph` 写 `~/.dsh/memhub/graph/`，星图双源合并 |
| 冻结语义 | ✅ `isDormant`（淡了不注入 / 查到即醒 / 1h 冷却） |
| 记忆迁移 | ✅ 已执行（105 条 / 0 错误） |
| zzerx 软停用 | ✅ `disabled: true`（观察期，回滚＝删这行） |
| **能删任何一个插件吗** | **还不能**——zzerx 已停用但观察期未满（建议 30 天）；卸载要等观察通过 |
