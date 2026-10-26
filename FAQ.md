# 常见问题（FAQ）

各插件更细的排错见：花费插件 [TROUBLESHOOTING](./输入框花费金额/docs/TROUBLESHOOTING.md) ·
表情插件 [TROUBLESHOOTING](./更多表情和颜文字/docs/TROUBLESHOOTING.md)。

## 安装与生效

**Q：装完之后界面没变化。**
A：客户端 bundle 在页面加载时构建。**刷新页面（`Ctrl+R`）**；老版本 DSH 重启一次。
另外确认 profile `package.json` 的 `dsh.profile.bundles` 里有对应包名。

**Q：为什么一定要把中文目录映射成 ASCII 路径？**
A：DSH 的 `plugin_manager` 底层用 pnpm 写 profile 的 `package.json`，遇到中文路径会按 GBK 转码，
把 JSON 写成乱码（引号断裂、文件变空白），Host 启动时 `JSON.parse` 失败 → 直接打不开。
`mklink /J L:\work\plugins\xxx "中文目录"` 一行就绕开了。

**Q：装完 DSH 打不开了怎么办？**
A：双击桌面 **`DSH一键恢复.cmd`**（脚本 `L:\work\scripts\dsh-profile-recover.ps1`，`-DryRun` 可预演）：
它会备份当前文件 → 用 `package.json.bak*` 还原 → 清死链 → 校验 JSON → 启动。
装之前先备份 profile 是最省事的习惯。

**Q：改了插件代码为什么不生效？**
A：改完要重新跑 `node tools/build.mjs`（`lib/` 才是 DSH 加载的东西），然后刷新页面。
只改 `src/` 不构建 = 什么都没改。

**Q：会拖慢 DSH 吗？**
A：花费插件是 1.5s 一次的轻量 DOM 查询 + body 级 `MutationObserver`（找到卡片就早退），开销可以忽略。
表情插件客户端 bundle 较大（含 36 张贴纸 base64，几百 KB 级），首屏慢一点点，面板打开后是纯前端渲染。

## 花费金额

**Q：卡片里没有「花费金额」。**
A：先看 设置 → 输入框花费金额 → **定位状态**：

- 「未找到用量卡片」→ 当时卡片没开；开着还是一样，说明官方改版了（见插件 TROUBLESHOOTING 第 1 条）
- 「已找到…未插入花费行」→ 拿不到数字；把「复制报告」的内容发我
- 整个配置页都没有 → 插件客户端没加载（刷新页面 / 确认 bundles 清单）

**Q：金额和官方账单差几分，正常吗？**
A：正常。单轮卡片与兜底路径是按**当前时段**的峰谷价估算的；会话卡片取 `dsh-token-mb` 的记录，
它的统计窗口有延迟。**这不是账单，别拿去对账。**

**Q：两个数字（会话卡片 / 单轮卡片）为什么不一样？**
A：语义不同：会话卡片 = 这个会话从开始到现在的累计；单轮卡片 = 这一轮。后者不是「会话累计」的子集显示，
而是这一轮自己的 token × 价格。

**Q：没装 `dsh-token-mb` 能用吗？**
A：能。插件会自动退回按卡片数字估算，值前面带 `≈`。装了能拿到更准的会话记录。

## 表情插件

**Q：输入框旁没有 😊。**
A：先看 设置 → 更多表情和颜文字 → 「隐藏表情入口」是不是勾上了（这是设计里的开关，勾上后 `emoji_pack` 仍可用）。
没勾还没有 → 刷新页面；确认 bundles 清单。

**Q：模型不主动用表情。**
A：系统提示只是「建议」。想让它更常用：配置里开「优先发送常用表情」、填几条常用词、关掉不需要的分类；
想让它彻底不用：把设置里那条隐藏开关旁的允许分类全部取消（`emoji_pack` 就只会返回空）——或者直接跟它说别用。

**Q：Emoji 显示成方框。**
A：系统缺彩色 emoji 字形，装个 emoji 字体即可（Windows 自带 Segoe UI Emoji）。

**Q：贴纸能自定义吗？**
A：目前不行，36 张是内置 PNG（见 [ROADMAP](./ROADMAP.md)）。想加就改 `tools/make-stickers.py` 重新生成。

## 通用

**Q：会上传我的数据吗？**
A：不会。见 [PRIVACY.md](./PRIVACY.md)：零出站请求，错误记录只在本地且默认不上报。

**Q：支持 macOS / Linux 吗？**
A：插件本身是纯 JS，理论上跨平台；但本仓库只在 Windows + DSH 桌面版上验证过。
ASCII 路径那条坑与平台无关（pnpm 转码问题在 Windows 尤其明显）。

**Q：会上架 npm / DSH 插件市场吗？**
A：计划里（见 [ROADMAP](./ROADMAP.md)），目前请用本地文件夹安装。

**Q：能同时装两个插件吗？**
A：可以，互不依赖、互不干扰（唯一交集是都往「设置」里加一节）。
