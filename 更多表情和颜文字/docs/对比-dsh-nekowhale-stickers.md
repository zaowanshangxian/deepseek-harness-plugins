# 对比：dsh-nekowhale-stickers（大肥鱼表情包）vs 我们的「更多表情和颜文字」

分析对象：`Loping151/dsh-nekowhale-stickers` v1.1.1（Apache-2.0 + 素材 CC-BY-NC-4.0，74★，2026-10-22 建）
对照：`dsh-plugin-more-emoji` v0.7.3（我们，MIT）
日期：2026-10-28

## 一、本质区别一句话

**他们是"给模型用的表情包知识库 + 本地出图机"；我们是"给人用的表情面板 + 给模型的文本包"。**

- 他们：模型自己决定发哪张图（工具检索 + 技能约束），人只是看预览墙。
- 我们：人点面板插表情；模型只能拿到文字（emoji/颜文字/短句），发不了图。

## 二、结构对照

| 维度 | 他们 | 我们 |
|---|---|---|
| 素材 | **322 张动图** + 6 个模板，**不打包**，从 kiriyuki.com 懒加载（磁盘缓存 + ETag + content-hash 永不重取） | 911 条文本 + **36 张 PNG**，全部打包在插件里（离线可用） |
| 包体 | ~512 KB（只有元数据与代码） | 带 36 张图，体积更大 |
| 知识粒度 | **每张图一条**：name / emotion / tags / text / meme / use / dir / desc（`meta/nekowhale.json` 160 KB） | 只有**文本分类**（44 类），图没有语义 |
| 模型侧 | 4 个工具：`sticker_search`（情绪/场景打分检索）、`sticker_send`（返回 Markdown 图片行）、`meme_render`（模板出图）、`sticker_manage`（browse/allowlist/credit） | 1 个工具：`emoji_pack`（返回**文字**表情） |
| 常驻成本 | 技能描述约 **60 token**（知识按需检索） | 系统提示一段 + 工具定义，约 200–300 token |
| 人侧 | 设置页预览墙 + 白/黑名单 | 输入框 😊 面板（5 页签、搜索、收藏、最近、一键发送） |
| 出图能力 | 本地 canvas 合成：想/举牌/葱卷/上联/下联/抱，GIF 编码、文字排版、水印、违禁词 | 无（只有静态 36 张） |
| 跨平台 | MCP server + CLI，可接 QQ 等桥接（`[sticker:名字]` 协议） | 仅 DSH web |
| 依赖 | `gifenc`、`gifuct-js`、optional `@napi-rs/canvas`（native） | **0 依赖**，纯 DOM |
| 许可 | Apache-2.0 + 素材 **CC-BY-NC-4.0**（不可商用） | MIT（素材来源需自带 DISCLAIMER） |

## 三、他们的生成流程（"32 万 token"花在哪）

```
① 素材：作者 B 站「可以叫我云大人」/ kiriyuki.com，站点 manifest 提供文件清单
② 拼图审阅：tools/annotate/contact_sheet.py 把图拼成 contact sheet
③ 逐张标注：视觉模型按 tools/annotate/PROMPT.md 产出 JSONL
             （场景词、动作描述、梗出处、双人图的对象方向）
④ 合并：tools/annotate/build_meta.py 把 JSONL + manifest → meta/nekowhale.json
⑤ 校验：tools/annotate/stale.py 找过期条目；REVIEW_PROMPT.md 做二次复核
⑥ 运行时：core/kit.ts 载入 meta → core/search.ts 打分
          （权重 name 6 / tags 5 / emotion 4 / text 4 / meme 3 / use 3 / dir 2，中文 bigram 兜底）
          → sticker_send 产出 Markdown 图片行 → 客户端渲染
```

关键设计：**知识在磁盘/远端，不在上下文里**——常驻只有技能那 60 token，检索按需发生。

## 四、优缺点

### 他们
**优**
- 模型能按**情绪/场景**挑图（322 张 × 逐张语义），比"按分类选"准得多
- 上下文成本极低（60 token 常驻），因为知识检索而不是注入
- 本地模板出图 → 内容无限，还能 GIF
- 资源懒加载 + 缓存 + 离线兜底，包体小
- 可移植（MCP/CLI/QQ），有 credit 机制（不冒充作者）

**劣**
- **每次发图多 1–2 次工具调用**：长会话里比"人点面板"贵（我们面板是 0 token）
- 依赖 native canvas（可选），Windows 装不上就少一半能力
- 模板/字体/违禁词/GIF/水印，维护成本高；模板还得美术
- 素材 **NC 许可**，不能商用打包
- 依赖站点可用性（首次无网不可用）

### 我们
**优**
- 0 依赖、纯 DOM、不接管官方槽位（事故换来的铁律）
- 人用零 token；911 条文本 + 36 张贴纸离线可用
- 设置页可关、可裁剪分类，风险可控

**劣**
- 模型不能主动发图，只能给文字
- 图无语义 → 无法"按语境挑图"
- 不能生成新图，只支持 DSH web

## 五、值得学的四件事（按性价比排序）

| # | 学什么 | 成本 | 收益 |
|---|---|---|---|
| 1 | **给 36 张图补一行语义**（name/emotion/tags/desc），`emoji_pack` 加 `kind=sticker` 返回"可推荐贴纸" | 手写 36 条 ≈ 30 分钟，或本地视觉模型一次 | 模型能说"我给你贴个摸鱼"，而不是只会发颜文字 |
| 2 | **技能/提示里写死发送纪律**："一条回复最多一张、正经问题少发、不替代回答" | 0 | 防模型滥发 |
| 3 | **Pillow 本地模板渲染**（我们有 Pillow，不需要 native canvas） | 半天 | 任意文字出贴纸，能力上限打开 |
| 4 | **素材 credit**（作者/来源写进 README 与工具返回） | 10 分钟 | 尊重原作者，也避免商用纠纷 |

**不学**：MCP/CLI/QQ 桥接（超出我们定位）、GIF 编码（收益/成本比低）。

## 六、结论

我们不是"比它差"，是**定位不同**：它是"模型自主表达层"，我们是"人的输入效率层"。
两者可以共存——真要做，第一步只学"给图加语义 + 允许模型推荐贴纸"，不要一上来就做渲染器。
