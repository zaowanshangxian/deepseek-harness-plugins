# Changelog

## 0.1.2 — 修复审抓出的两条（可见性闸门 + bash 状态），顺带三条小问题

复审员按宿主真源码 + 真浏览器复核 0.1.1：三条致命问题确认成立，另抓到两条新的。都在这一版修掉，
并各留了反向对照（`bash test/negative-control.sh` 现在 13 例，其中 11 例有断言会红）。

### 必修（high）

- **可见性闸门永久吃掉脏标记**：`flush()` 里 `if (!isVisible(host)) continue` 把该 host 直接丢掉，
  而 `runtime.dirty` 在那之前已被整体清空；`onViewport` 只 `schedule(null)`，从不把重新可见的 host
  排回脏集。复审实测：滚出视口 >600px → 改 `data-state=error`（跳过绘制，属设计）→ 滚回原位圆点
  仍是 done，只有再触发一次 window resize 才变。**已经结束的过程组不会再产生 mutation**，所以不会自愈。
  **修法**：`onViewport` 里 `isIntersecting` 时 `runtime.dirty.add(entry.target)`——重新可见即重新排队。
  真正没变的组仍会被签名闸门挡在 DOM 之外，不会变成"每次滚动都重画"。
  回归断言（真 IntersectionObserver，靠 4000px 内边距把过程组推出视口）：滚出期间变更**暂时不画**（设计如此）
  → 滚回后**补画成新状态**。注回旧写法时这条直接红（`failed`）。

### 应修（medium）

- **bash / shell 行的状态永远是 idle**：宿主真身的 bash 卡片是"外层 `.card`（无 state）> 内层
  `.root[data-sample=bash][data-state][role="button"]`"。`ownCard()` 返回外层 `.card`（无 state），
  退化循环找到的唯一 `data-state` 元素又被我们自己那条 `closest('button,[role="button"],…')`
  规则跳过 → 一律 idle。**shell 调用跑完从蓝直接掉成灰，三态这个主打功能等于丢了**。
  **修法**：把"控件排除"提到常量 `CONTROL_SEL`，并在 `readState()` 里加一条**卡片直接子级**路径：
  卡片子级上的状态优先认（先认非控件的，全是控件时才认那个控件——它就是这个卡片的根节点）；
  真正的行内小按钮（在 `.tool-actions` 这类更深的一层里）仍走兜底循环被排除。
  回归断言：`row > .card > .root[data-state="ok"][role=button]` 必须读成 `done`（注回旧写法读成 `idle`）；
  另一条断言保证"操作区里的按钮状态"仍不污染（回归 10 的 fixture 也改成了带 `.tool-actions` 的真实形状）。

### 可选（low）—— 做了两条，一条没做

- **不写宿主 layout**：`ensureLayer()` 从 `insertBefore(svg, host.firstChild)` 改成 `appendChild(svg)`
  ——插在最前面会让宿主第一行不再命中 `:first-child`，凭空多出 6px 上边距。挂在末尾的代价是
  它会命中宿主的 `~` 兄弟规则，而绝对定位元素带 `margin` 会整体位移（坐标全错），所以补了一条
  `[data-ptree-host]>[data-ptree]{margin:0}`（特异性高于宿主）。**这条不是空话**：反向对照里去掉它，
  实测 SVG 顶边 14 vs 宿主 8 —— 真的被推偏了 6px。
  回归断言：SVG 是宿主末尾子节点、顶边与宿主对齐、`margin-top` 为 0（fixture 里也模拟了宿主的
  `[data-chat-flow-kind] ~ *{margin-top:6px}`）。
- **干线画斜线**：`plan()` 原来把"第一个顶层 → 最后一个顶层"连成一条线，父节点被折叠过滤掉时
  孤儿会留在更深的 x 上，于是画出一条没有含义的斜线。改成**按 x 分组**，返回 `trunks` 数组，
  每组一条竖直线；同 x 的照旧连成一条，不同 x 的各画各的（宁可断成孤点也不画斜线）。
  单测：同 x → 1 条、跨 x 孤儿 → 0 条、两组不同 x → 2 条且每条都竖直。
- **和宿主自带 `subCalls` 竖线并排像双线**：**没做**。要动的是"我们这条线该不该退让/换个偏移量"，
  属于视觉决策，而且得先看到宿主那条线是怎么画的（伪元素？border？我们无从判断），
  在没看过真宿主样式的前提下改偏移只会把两套线都弄歪。留给你定：要么用 CSS 把宿主那条线压掉，
  要么把我们的道床宽度调开。需要真宿主 CSS 才能动手。

### 测试

- `test/browser-smoke.mjs` 36 → 44 项；`test/plan.test.mjs` 8 → 9 项。
- `test/negative-control.sh` 8 → 13 例：新增可见性、bash 状态、SVG 插位、`margin:0`、干线分组五例，
  全部确认会红（前两例按设计应绿）。

## 0.1.1 — 修独立盲审抓出的三条致命问题（+ 六条中等）

盲审用真 headless Edge + 合成宿主 DOM 实测出的问题，逐条修完并留了回归断言。
每条都做过**反向对照**（把 bug 注回去，确认断言真的会 FAIL）：`bash test/negative-control.sh`。

### 致命（high）

- **自触发重绘死循环**：原来 `paint()` 每帧 `layer.replaceChildren(...)`，而
  `MutationObserver` 监听 `document.body` 的 `childList+subtree`，对"任何落在 `[data-step-process-content]` 里
  的变更"都标脏 → 又画一帧 → 又产生变更……盲审实测空闲 1 秒 = 240 条 childList + 60 帧，永久 60fps。
  **修法是三道独立的防线**（任意一道都足以断环，实测见反向对照）：
  1. 观察回调第一行 `if (insideLayer(record.target)) continue` —— 自己画的东西永远不算变更；
  2. `paint()` 先算**签名**（节点 id / 父子 / 状态 / 圆整过的坐标 + 容器尺寸），和上次一样、且我们那层
     还完好（`layerIntact`）就直接 return，一个字节都不写；额外好处：宿主重渲染把我们插进去的 `<svg>`
     丢掉时，闸门不会把"重建"也一起挡住；
  3. 绘制改成**按 id 复用节点**（写入幂等），重复绘制不会产生 mutation。
  回归断言：静置 1 秒 paint 次数不涨、collect 次数不涨、过程组里 0 条 mutation 记录。
  注回原写法（整块重建 + 无签名 + 无过滤）时实测 `13 → 73` 次 paint、60 条记录，断言全部报警。

- **父调用圆点 y 坐标量错**：`row.getBoundingClientRect()` 量的是 `[data-chat-call-id]` 整行，而宿主把
  `[data-subcalls]`（整棵子树）也放在同一行内部 → 行高 = 卡片 + 全部子调用，`y` 落到整块中心
  （盲审实测父圆点 cy=24，卡片中心是 12，所有有子调用的父节点都错位）。
  **修法**：新增 `cardOf(row)`：叶子行（没有 `[data-subcalls]`）量整行（最准，连 padding 一起算）；
  有子调用的行量行内第一张"自己的卡片"（跳过子调用容器与自有权重层）。`collect()` 用它的 rect。
  回归断言：父圆点 cy ≈ 卡片中线，且整行中心明显更低（证明两者确实不是一个数）。

- **运行时圆点的呼吸动画不生效**：每帧 `makeDot` 新建 `<circle>` 再整块替换，节点身份每帧都变，
  CSS `@keyframes` 每帧从 0 开始（实测 `currentTime` 恒为 0、`opacity` 恒为 1）。
  **修法**：`<svg>` 里固定两个 `<g>`（线 / 圆点），用 `WeakMap` 缓存 `key → Element`，按 key 复用节点，
  只在该变时改属性（`setAttr` 值相同就不写）；新增元素只追加在末尾，已有节点永不移动（移动也会重启动画）。
  回归断言：静置 1 秒后运行中圆点还是同一个节点、`currentTime` 在涨；强制一次重画后仍是同一个节点、
  同一个 `Animation` 对象。

### 中等（medium）

- **每帧全量量测**：`collect()` 的全量 `querySelectorAll` + 逐行 `getBoundingClientRect()` + `scrollHeight/clientWidth`
  仍然存在，但只在**签名变了**的时候跑；没变时 `paint()` 一行 DOM 都不碰（见上面第 2 道防线）。
  回归断言：静置 1 秒 `collect` 次数不增长。
- **状态读取被行内控件污染**：原退化路径"行内第一个带 `data-state` 的元素即胜出"，会把按钮的 busy/idle、
  复制按钮的 copied 当成调用状态。现在收紧为：优先认卡片根节点；退化路径额外要求"不在 `[data-subcalls]` 里、
  不是 `button/[role=button]/input/select/textarea`"。
  回归断言：新增一行，卡片外包一层、里面放 `data-state="running"` 的按钮 → 圆点必须是 `idle`。
- **观察面过宽**：`document.body` + `subtree` + `characterData` + `attributes` 等于全应用每个流式 token 都进回调。
  现在拆成两个 observer：
  `scan` 只观察 `document.body` 的 `childList`（只用来"发现新的过程组"），
  `mutations` 逐个观察已注册 host 的子树（`childList` + `attributes`，属性白名单），不挂 `characterData`。
- **只 observe 不 unobserve**：`registerHosts()` 原来只 observe，`runtime.visible` 也不清理 → 长会话内存只涨不降。
  现在 track 一个 `runtime.hosts` 集合，`pruneHosts()` 把离开文档的 host 从 Resize/Intersection/Mutation
  三个 observer、可见集、脏集、签名缓存里一起摘掉（`flush()` 和 `onScan()` 都会触发）。
  回归断言：第二个过程组加入 → 注册数 2；从 DOM 移除 → 注册数回到 1。
- **`:has()` 深色选择器**：`:root:has(body[data-ds-dark-theme])` 会让 `:root` 变成 has-root，
  页面任何 DOM 变更都触发样式重算。宿主实际把属性挂在 `<body>` 上，改成
  `body[data-ds-dark-theme] [data-ptree],:root[data-ds-dark-theme] [data-ptree]`（后者只是兼容老挂法）。
  回归断言：标记挂 `body` 与挂 `:root` 都要换同一套配色。
- **探针抢跑宿主鉴权**：`/api/process-tree/health` 挂在宿主的 `/api` 前缀下，exact 路由先于 prefix 匹配，
  会抢在宿主自己的 `/api` 中间件之前命中。挪到 `/process-tree/health`（不占宿主命名空间；
  探针只有插件名/版本/锚点，不含会话数据）。契约测试相应改为反向断言"不落在 `/api/` 下"。

### 测试

- `test/host-contract.mjs` 加了 6 条形状级静态守卫（不挂 `characterData`、不用 `:has()`、不整块
  `replaceChildren`、观察回调必须有权威重层闸门、必须存在签名闸门、圆点必须量卡片），核对前先剥注释。
- `test/browser-smoke.mjs` 从 18 项扩到 36 项，新增的全是上面这些 bug 的回归断言。
- 新增 `test/negative-control.sh`（不进 `npm test`）：把每个 bug 逐个注回临时副本，确认对应断言真的 FAIL
  （每例都校验"补丁真的改了文件"，避免静默无效的补丁把对照变成幻觉）。
- 顺手补的两处稳健性（签名闸门带来的连带问题，盲审没提，但会咬人）：宿主重渲染把我们插进去的
  `<svg>` 或已画好的节点摘掉时，闸门不能把"重建 / 挂回"也挡在外面 —— `layerIntact()` 检查层是否完好，
  `syncPool()` 发现节点不在组里就原样挂回去（身份不变，动画不重启）。两条都有断言。

### 已知残留（有意没做）

- 流式文本只追加/修改文本节点时**不进回调**（`characterData` 被有意关掉）：这类增长靠 host 尺寸变化触发
  `ResizeObserver` 重画。若将来出现"host 高度被固定 + 行内文本继续长"的版式，会漏一次重画 ——
  那时候再加"低频安全网重查"，而不是把 `characterData` 挂回去（那等于每个 token 一次布局读）。
- 圆点/线条的 DOM 顺序会随增删漂移（新增的追加在末尾）。线和点分在两个 `<g>` 里，互不覆盖，视觉无影响。

## 0.1.0 — MVP

- 首次实现：把过程组里的工具调用按嵌套关系画成树（干线 + 肘形分叉 + 圆点）。
- 三态配色：运行中（蓝，带呼吸动画，尊重 `prefers-reduced-motion`）、完成（绿）、失败（红）；不确定的状态（`stopped` / 未知值）用中性灰。
- 深浅色两套配色，走 CSS 变量并跟随宿主 `[data-ds-dark-theme]`。
- Host 半：只读探针 `GET /api/process-tree/health`，用 `ctx.effect` 注册并注销。
- Client 半：纯 DOM 装饰，`ctx.effect` 挂载 + 清理（observer / rAF / `<style>` / 自有节点 / 自有属性）。
- 设置页一个开关（`localStorage` 键 `ptree.enabled.v1`），走官方 `settings.section` 槽位。
- 验证：纯函数单测（状态词表 / 几何 / plan）+ 契约自检（包清单 / patch / 两个半侧出口 / 本机 app.asar 锚点）。
