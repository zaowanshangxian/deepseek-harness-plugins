# 人格与口癖 · dsh-plugin-persona-voice

> 给 DeepSeek Harness 的「表达层」：一套可切换的人格档（12 个预设）+ 口癖（说话习惯）+ 表情/口癖频率，写进系统提示。
> 纯本地、零依赖、不接管任何官方槽位；和「更多表情和颜文字」解耦，各管一段。

- 版本：0.1.0 · MIT · 兼容 DSH `>=0.2.1-rc.2`
- 只做三件事：**人格选择、口癖、频率**。表情素材/面板在另一个插件里。

## 为什么单独一个插件

| 插件 | 管什么 | 不做什么 |
|---|---|---|
| `dsh-plugin-more-emoji`（更多表情和颜文字） | 表情面板、911 条文本、36 张贴纸、`emoji_pack` 工具 | 不管人格、不管口癖 |
| **本插件 `persona-voice`** | 人格档、口癖、表情/口癖频率（写进系统提示） | 不提供任何表情素材 |

拆开的理由：① 有人只要口癖不要面板；② 口癖提示影响每条回复，坏了只关它；③ 表情包 6MB+、更新慢，口癖插件 <100KB、改得勤。

## 人格预设（12 个）

| id | 名称 | 可用大类 | 每条上限 | 默认口癖 |
|---|---|---|---:|---|
| daughter | 活泼女儿 | emoji/kaomoji/phrase | 3 | 哥哥、呀 |
| sweet | 乖巧甜 | emoji/kaomoji/phrase | 3 | 哥哥、嘛～ |
| tsundere | 傲娇 | emoji/kaomoji/phrase | 2 | 哼、才不是呢 |
| sassy | 毒舌 | emoji/kaomoji/phrase | 2 | 就这？、行了 |
| kuudere | 冷淡三无 | emoji | 1 | 嗯。 |
| colleague | 专业同事 | emoji | 1 | —（不设） |
| cat | 猫系 | kaomoji/phrase/emoji | 4 | 喵～、喵？ |
| oneesan | 温柔姐姐 | emoji/kaomoji/phrase | 3 | 乖、慢慢来 |
| cool | 高冷御姐 | emoji | 1 | 嗯。 |
| chuuni | 中二 | emoji/kaomoji/art/phrase | 3 | 哼，凡人、封印解除 |
| lazy | 慵懒 | emoji/kaomoji/phrase | 2 | 唔…、随缘吧 |
| genki | 元气 | emoji/kaomoji/phrase | 4 | 好耶、冲！ |

每个档 = 5 个风格参数（可爱/正式/毒舌/亲密/密度）+ 可用大类 + 频率上限 + 禁用分类 + 一句 guide + 默认口癖。
**加人格不改代码**：settings 的 `customPersonas` 填参数即可（同 id 覆盖预设）。

## 频率

- 表情频率：`auto`（跟随人格）/ `off` / `low`(1) / `normal`(3) / `high`(6)；正经问题一律压到 1 个。
- 口癖频率：`0`（跟随人格）/ `2` / `3` / `5` / `8` 条一次。

## 口癖（catchphrase）

```json
"catchphrases": [
  { "text": "哥哥", "mode": "prefix", "every": 2 },
  { "text": "喵～", "mode": "suffix", "every": 3 }
]
```
- 用户设置后**完全覆盖**人格默认；留空则用当前人格默认。
- 注入规则：自然使用、每条最多一个、工作/数据类可不用、不替代内容。

## 安装

```powershell
dsh plugin --profile desktop add https://github.com/zaowanshangxian/deepseek-harness-plugins/releases/download/persona-voice-v0.1.0/dsh-plugin-persona-voice-0.1.0.tgz
```

或本地开发：

```powershell
cd L:\work\deepseek-harness-plugins\人格与口癖
node tools/build.mjs
dsh plugin --profile desktop add (Resolve-Path .).Path
```

> 安装路径**必须是 ASCII**（中文目录会让 pnpm 写坏 profile），先做 junction 再装。

## 设置

设置 → **人格与口癖**（也出现在插件配置页）：
- 人格选择（12 个按钮）+ 关闭人格
- 表情频率 / 口癖频率
- 口癖列表（添加/删除）
- **实时预览**：当前注入到系统提示的文本

Host API：
- `GET /persona-voice/api/settings` → `{ settings, presets }`
- `POST /persona-voice/api/settings` → 局部合并保存
- `GET /persona-voice/api/preview` → 当前提示文本（不改任何状态）

设置文件：`$DSH_HOME/persona-voice/settings.json`（原子写，写失败会回报 `persisted: false`）。

## 与其他插件的关系

- **软依赖**：与 `dsh-plugin-more-emoji` 完全解耦；本插件不读它的配置，它也不读本插件的（人格档各自维护一套会不一致——所以约定：**人格只在 voice 里配**，表情插件保持纯素材）。
- 不接管任何官方槽位：只用 `settings.section` 与 `plugins.bundle.config` 两个设置页入口。

## 测试

```powershell
node tools/build.mjs
node tools/check.mjs
node --test test/persona.test.mjs
```

7 项单测：预设完整性、人格解析（manual/off/未知回退）、自定义档合并与参数收敛、频率生效、cap=0 禁用、口癖优先级与 every 覆盖、提示组装。

## 已知限制

- `personaSource: preset`（按会话 preset 自动切档）尚未接入——需要会话上下文，留到 0.2。
- 尚未支持导入 SillyTavern 角色卡（`personality` → guide、`mes_example` → 口癖候选），路线见 `docs/`。
