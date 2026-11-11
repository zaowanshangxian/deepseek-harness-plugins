# 降级契约（插件准入条件）

> 来源：`记忆系统-可学清单.md` 第 8 条——A 的文档第一段就声明「所有新模块都可关闭或缺省降级」。
> 我们装插件从不提前问「坏了会退化成什么」。这份是可直接粘进 `AGENTS.md` 的一页规矩，**等你点头再放进去**。

## 一、规矩（准入条件）

装任何插件前，它的 README 必须能回答这四行，缺一条不装：

1. **关掉它，系统还剩什么？** —— 说清退化成什么状态（不是「无影响」这种空话）。
2. **它写哪些文件？** —— 路径 + 是不是用户数据 + 丢了怎么恢复。
3. **它失败时是静默还是报错？** —— 静默失败必须给可观测信号（自检文件 / 日志 / 面板字段）。
4. **怎么卸干净？** —— 卸载步骤 + 残留目录 + 回滚命令。

## 二、memhub 自己怎么答（现状）

| 问题 | 答 |
|---|---|
| 关掉它剩什么 | 技能回到 harness 原生 `skill` 工具 + 完整描述预注入（每轮 +约 439 tokens）；记忆回到 zzerx 的 `memory_*`；情感/人格/星图全部消失。**不会坏，只是变回装它之前** |
| 写哪些文件 | `~/.dsh/memhub/**`（sidecar / persona / graph / INDEX / self-check）、`L:\DSH\shared\memhub/{orbs,lessons.jsonl}`、技能 frontmatter 的**一行开关**（`disable-model-invocation`，带 `.bak-toggle`）。用户数据 = orbs / lessons / persona / graph |
| 失败怎么表现 | **已知坑：静默跳过**。`@deepseek-ai/dsh-tools` 解析失败时 `import` 报错但宿主继续启动，症状只有「`self-check.json` 不生成」。**判定口令：重启后看这个文件的时间戳** |
| 怎么卸 | 删 `~/.dsh/memhub` 目录 + 从 profile 的 dependencies/bundles 移除 + 重启；技能开关用 `node tools/toggle-model-invocation.mjs --restore` |

## 三、为什么这条对 memhub 特别重要

它一次改了**五个注入位**（90000 / 901 / 902 / 903 / 904 / 905）和 **21 个工具**。任何一处坏掉，症状都是「模型行为变怪」而不是「报错」——用户根本不知道是插件干的。

所以定了两条硬规矩：

- **每个模块独立 try/catch**，单模块失败只跳过（`host.js` 已落实）
- **启动自检必须落盘**（`self-check.json`），因为这是唯一能在故障时看到的信号

## 四、检查方法

```bash
ls -la ~/.dsh/memhub/self-check.json     # 时间戳是最近一次重启 → 加载成功
cat ~/.dsh/memhub/self-check.json        # memoryErrors 应为 0
```

`self-check.json` 不存在 = 插件没加载（不是「没数据」）。
