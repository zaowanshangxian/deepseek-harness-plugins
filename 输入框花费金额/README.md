# Token 用量 + 花费金额（dsh-plugin-inline-cost）

把 DeepSeek Harness 输入框下方自带的「Token 用量」条**替换成同款**，并在点开的卡片里**多一行「花费金额」**：

```
Token 用量
本轮用量        202,453,818 tok
缓存命中        97.0%
未缓存输入      6,467,892 tok
缓存读取        195,550,208 tok
缓存写入        0 tok
输出            435,718 tok
─────────────────────────────
花费金额        ≈ ¥6.51
```

- **不新增常驻行、不重复统计**：平时还是「X tok · 缓存命中 Y%」这一条，和官方一致
- **点开才显示**：金额只在展开的卡片里，收起时不占地方
- **数据同源**：官方客户端投影 `useProjection('tokenUsage')`，不扫日志、不额外请求接口
- 悬停「花费金额」可看分项金额（缓存命中/未缓存/输出）与高峰/低谷价说明

## 计价口径

DeepSeek 官方 CNY / 百万 token 峰谷价（与 `dsh-token-mb` 同口径，2026-09-19 抓取）：

| 模型 | 缓存命中 | 未缓存输入 | 输出 |
| --- | --- | --- | --- |
| deepseek-flash / v4-flash | 0.02（低谷）/ 0.04（高峰） | 1 / 2 | 4 / 8 |
| deepseek-v4-pro | 0.15 / 0.3 | 4.5 / 9 | 13.5 / 27 |

- 高峰：北京时间 **周一至周五 9:00–12:00、14:00–18:00**，其余为低谷价
- 按**当前时段**统一估算（官方按实际调用时间分档），允许与账单有几分差异

## 安装（必须 ASCII 路径）

**不要直接用中文文件夹路径安装**（pnpm 会把 profile 的 package.json 写成 GBK 乱码，导致 DSH 打不开）。先建 junction：

```bat
mklink /J L:\work\plugins\inline-cost "L:\work\deepseek-harness-plugins\输入框花费金额"
```

再 `plugin_manager install_bundle`，target = `L:\work\plugins\inline-cost`。

## 生效方式

客户端 bundle 有缓存：**安装后需要重启一次 DSH**（或让界面重新加载客户端模块）才会替换官方用量条。Host 侧为空壳，不占用资源。

## 与官方用量的差异（取舍）

- 卡片里**没有**「提供方 / 模型」这一行（官方投影不提供该字段；官方卡片才有）
- 官方卡片原有的其它信息（如有）不在本插件范围内
- 只统计**本会话**；跨天/跨会话历史金额请用 `dsh-token-mb` 或官方 Token 面板

## 兼容性

- DeepSeek Harness `>=0.2.1-rc.2 <0.3.0`
- 扩展点：`conversation.composer.dock` 的 `usage` 格子（复用 id 即替换官方用量条）
- 注册失败只跳过自己，不影响界面；投影不可用时显示「用量 —」

## 许可

MIT
