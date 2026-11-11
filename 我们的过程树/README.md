# 我们的过程树（dsh-plugin-process-tree）

把 DSH 界面里平铺的工具调用按**嵌套关系**画成树形连接线：父调用在左、子调用逐层右移一条肘形分叉，
**运行 / 完成 / 失败**三态用颜色区分，深色与浅色各一套配色。

> 这是"看着别人的插件自己重写一版"的 MVP。参考了 [dsh-process-tree](https://github.com/Bosaiting/dsh-process-tree)（MIT）的**思路**，代码是另写的；
> 详细对照见 [ANALYSIS.md](ANALYSIS.md)。三种树形风格、IDE 配色方案、代码视图这些**没有做**。

## 它做什么 / 不做什么

| 做 | 不做 |
| --- | --- |
| 在宿主的过程组内容盒 `[data-step-process-content]` 里追加一张自己的 `<svg>` | 不接管、不替换任何 React 节点 |
| 用 DOM 包含关系判定父子（子调用被包在父级的 `[data-subcalls]` 里） | 不读 session、不订阅事件、不发网络请求 |
| 读宿主写在工具行上的 `data-state` 判三态 | 不改宿主折叠状态、不改 aria |
| 深浅色各一套配色（CSS 变量，跟随 `[data-ds-dark-theme]`） | 不做历史加载、迷你地图、失败列表 |
| 设置页一个开关（`localStorage`，键 `ptree.enabled.v1`） | 不做多风格 / 多配色方案 |

## 结构

```
lib/index.js      Host 半：只挂一个只读探针 GET /process-tree/health（ctx.effect 注册 + 注销）
lib/client.js     Client 半：DOM 装饰层（window.__ModuleLoader__.load 格式，无构建步骤）
cordis.patch.yml  bundle patch：只 insert 自己一行（row id: process-tree）
test/plan.test.mjs     纯函数单测：状态词表 + 肘形几何 + 树的 plan()
test/host-contract.mjs 契约自检：包清单 / patch / 两个半侧出口 / 本机 app.asar 里锚点还在不在
test/browser-smoke.mjs 真 headless Edge 冒烟：量测 → 画线 → 反应 → 清理（含自触发循环 / 动画 / 清理回归）
test/negative-control.sh 可选：把已修的 bug 逐个注回去，确认冒烟断言不是空的
```

## 安装（本次交付没有安装）

```sh
dsh plugin --profile desktop add <本目录或打包后的 tgz>
# 装完必须重启 DSH：clientModules 按包 id 缓存，改代码不重启不生效
```

宿主侧自检：

```sh
curl http://127.0.0.1:55920/process-tree/health     # 只读；不占宿主的 /api 命名空间
```

## 已知边界

- 依赖宿主私有 DOM 契约：`[data-step-process-content]`、`[data-chat-call-id]`、`[data-subcalls]`、`[data-state]`。
  宿主改版后这些锚点可能消失，插件会**安静地不画**（只 `console.warn` 一次）。
  `node test/host-contract.mjs` 会直接去本机 app.asar 里核这四个锚点还在不在。
- 状态词表按当前宿主实现归一（`ok / error / running / preparing / stopped`）。
  `stopped`、`interrupted` 和没见过的值都归"中性灰"——不确定就不染色，不猜成功。
- 与其它"缩进 / 连接线"插件同区域改样式会互相覆盖，**不要和 dsh-process-tree / dsh-tool-indent 同时开**。
- 只在视口 ±600px 内的组上绘制；折叠的组整块跳过（行高度为 0）。滚出视口期间的变更不画，
  **重新进入视口时补画**。
- 只改左侧 14px 道床的 padding，不动行内其它样式；自有 `<svg>` 挂在过程组末尾、`margin` 压成 0，
  不挤占宿主第一行。
- 未处理：宿主自己也可能给 `[data-subcalls]` 画一条竖线，两条并排会看着像双线。
  要改得先看真宿主的样式（伪元素还是 border），再决定压掉哪条 / 道床错开多少。

## 验证

```sh
node --check lib/index.js && node --check lib/client.js
node --test test/plan.test.mjs test/host.test.mjs   # 纯函数 + 宿主半边（4+9 项）
node test/host-contract.mjs                          # 包清单 / patch / 两个半侧出口 / 本机 app.asar 锚点
node test/browser-smoke.mjs                          # 真浏览器（Edge/Chrome headless）跑完整生命周期
bash test/negative-control.sh                        # 可选：反向对照，确认上面那些回归断言不是空的
```

`browser-smoke.mjs` 用合成宿主 DOM 验 44 项：挂载 → 画线 → 坐标（道床 x / 卡片中线 y）→ 三态配色 →
深色切换（body 与 :root 两种挂法）→ `data-state` 变化跟不跟 → 隐藏行跳不跳 →
**静置 1 秒不重画、运行中圆点节点身份不变、呼吸动画在推进** → 行内控件状态不污染 →
bash 卡片（state 挂内层根节点）状态读得对 → **滚出视口再滚回来会补画** → 不挤占宿主第一行 →
过程组离场后松手 → 清理后有没有残留。找不到浏览器会自动 SKIP。

## 已知的简化

- 只有工具调用行有圆点；思考 / 说明这类过程行只让出道床让树干通过，不上点。
- 只有一种树形（肘形 + 直线干线），没有曲线 / 植物 / 代码块风格，也没有配色方案选择。
- 不做视口外的历史绘制（只画视口 ±600px 的组）。
