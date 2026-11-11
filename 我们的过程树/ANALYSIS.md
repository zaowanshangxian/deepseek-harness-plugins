# 我们的过程树 · 参考项目分析（dsh-process-tree v0.11.1）

> 分析对象：https://github.com/Bosaiting/dsh-process-tree （MIT，约 11 星，版本 0.11.1）
> 分析方式：只读。`README.md` / `CHANGELOG.md` / `docs/COMPATIBILITY.md` / `docs/DISCOVER.md` / `cordis.patch.yml` / `package.json` / `index.js` 走 GitHub API 取；`client.js`（1,016,110 字节）走 jsDelivr 取（API 限流后换的通道）。
> **另一份证据来自本机**：当前安装的 DSH 桌面版 `resources/app.asar` 里解出 `@deepseek-ai/dsh-client-ui-chat/lib/client.js` 与 `@deepseek-ai/dsh-client-ui-tool/lib/client.js`，用它们核对"它依赖的 DOM 锚点今天是否还在"。下文标 `host:` 的行号都指这两份解包文件。
> 本文只写结论与证据；**没有把它的源码贴进来**，我们的实现是另写的（见 `lib/`）。

---

## 0. 三句话结论

1. **它不接管 React，只在宿主已渲染的 DOM 上"长草"**：每个过程组的内容容器 `[data-step-process-content]` 里追加一张自己的 `<svg>`，用 `data-*` 锚点量尺寸画线；`ctx.slots` 只用来注册一个设置页，视觉部分完全走 DOM 装饰。
2. **树的唯一数据源是已渲染的 DOM**：不读 session、不订阅事件、不联网；父子关系 = DOM 包含关系（`[data-chat-call-id]` 套在父级的 `[data-subcalls]` 里），状态读宿主写在工具行上的 `data-state`（词表 `ok / error / running / preparing / stopped`）。
3. **它踩的坑几乎全在"宿主私有契约"上**：`data-*` 会变、状态词表会加、流式行会先空后补内容、200 条调用时自己的 SVG 变更会触发宿主 `:has()` 选择器重算。对策是"不设版本门槛 + 大量真宿主回归"，而不是"赌它不变"。

---

## 1. 它挂在 DSH 的哪个位置

### 1.1 包与两个半侧

| 项 | 内容 |
| --- | --- |
| 包名 / 入口 | `dsh-process-tree`，`package.json` 的 `main = ./index.js`，`exports["./client"] = ./client.js` |
| 宿主半侧 | `index.js` **全文 3 行**：`export const name`、`export function apply() {}` —— 空壳，纯注册用 |
| 客户端半侧 | `client.js`，用 `window.__ModuleLoader__.load({ id: 'dsh-process-tree', factory(require) {...} })` 注册，导出 `{ name, inject: ['slots'], apply(ctx) }` |
| bundle 补丁 | `cordis.patch.yml` 只干一件事：`- insert: [{ id: dsh-process-tree, name: dsh-process-tree }]` |
| `dsh.client` | `{ platform: 'web', immediately: true, inject: ['@deepseek-ai/dsh-client-ui-chat', '@deepseek-ai/dsh-client-ui-tool'] }` |

结论：**视觉插件可以没有宿主逻辑**。宿主半侧存在的意义只是让 Loader 有一个可插入的行；真正的 UI 全在浏览器侧。

### 1.2 视觉注入点（关键）

它不是"往 slot 里塞组件"，而是：

1. 找到每个过程组的内容盒子 `[data-step-process-content]`（宿主的组结构：`[data-chat-group-key][data-step-process]` → 头部 → 滚动体 `[data-step-process-body]` → **内容盒 `[data-step-process-content]`**，见 `host:ui-chat 4211-4240`）；
2. 在这个盒子里插一张自己的 `<svg>`（`.dpt-layer`），绝对定位、`pointer-events: none`；
3. 给盒子打自己的类（`dpt-host`），用 CSS 在左侧让出 14px 左右的"道床"，用 `--dsh-tool-indent` 控制子调用缩进；再关掉宿主/其他插件可能画在同一位置的 `::before/::after` 连接线；
4. 所有自有节点带 `data-dpt-*` 前缀，卸载时按前缀一次清掉。

**它从不 wrap、不 replace、不动 React 渲染出来的节点**（文件头注释即写明 "never wraps or replaces React-rendered nodes"）。宿主的折叠、`web_fetch` 链接、文件按钮、展开正文全部原样保留。

### 1.3 slot 用在哪

只注册了一个：`ctx.slots.inject('settings.section', ...)`（见 `client.js` 尾部 `apply()`）。也就是说 `"inject": ["@deepseek-ai/dsh-client-ui-chat", "@deepseek-ai/dsh-client-ui-tool"]` 这是**模块依赖声明**（要用宿主共享模块表里的 React 等），不是"往这些 slot 塞东西"。

---

## 2. 树形数据从哪来

**只有一个来源：已经渲染出来的 DOM。**

- README 明确写了边界：*"插件读取已显示的聊天结构、元素尺寸和当前会话已加载的 Chat 投影，不额外加载历史；不注册模型工具、不执行命令、不发送网络请求。"*
- 例外一处：0.10.0 的"代码视图"会只读订阅 `uiSession` 的 Chat 投影，用来拿工具参数原文（`ctx.inject(['uiSession','sessions'], …)`）。**这属于它后来的重型功能，MVP 不需要。**
- 偏好存 `localStorage`，键 `dsh.process-tree.v1`；卸载不清偏好（有意为之）。
- 它同时维护一份**自身的状态快照**（每个 callId 的 state），用来处理"宿主标记失败但结构化结果说成功"这类不一致（`hostFailures` 计数）。

它依赖的锚点（`client.js` 里 `STRUCTURE_SELECTOR` 一行可看全）：

```
[data-chat-flow-kind] [data-chat-call-id] [data-subcalls]
[data-disclosure-row] [data-sample] [data-variant="think"]
[data-step-process-content]   ← 每个过程组一张 SVG
```

我核对过当前安装版（本机 app.asar），这些锚点今天都还在：
- `host:ui-tool 1959-1962`：`div.callRow[data-chat-anchor-key="call:<id>"][data-chat-call-id=<id>]`；
- `host:ui-tool 1992`：子调用容器 `div.subCalls[data-subcalls]`；
- `host:ui-chat 4211-4240`：组 → 体 → 内容盒 `[data-step-process-content][data-chat-flow]`；
- `host:ui-chat 3805-3814`：每个流程行 `div.flowItem[data-chat-flow-kind=<kind>]`。

**状态从哪读**：工具卡片根节点 `div[data-tool][data-state]`（`host:ui-tool 1833`），值由 `host:ui-tool 317` 算出来：

```
!done ? (phase === 'preparing' ? 'preparing' : 'running')
      : error?.code === 'interrupted' ? 'stopped'
      : isError ? 'error' : 'ok'
```

---

## 3. 层级怎么判定

**父子 = DOM 包含，不做任何 id 配对。**

宿主的结构是递归的（`host:ui-tool 1970-1997`）：

```html
<div data-chat-call-id="A">          <!-- 父调用 -->
  <工具卡片 A />
  <div data-subcalls>                 <!-- 只有 phase !== 'preparing' 且 subCalls.length > 0 才出现 -->
    <div data-chat-call-id="A.1"> <卡片/> <div data-subcalls> … </div> </div>
    <div data-chat-call-id="A.2"> … </div>
  </div>
</div>
```

所以插件只需要：

1. `host.querySelectorAll('[data-chat-call-id]')` 拿到这一组里所有调用行；
2. 父 = `el.parentElement.closest('[data-chat-call-id]')`；深度 = 往上数了几层 `[data-chat-call-id]`；
3. `getBoundingClientRect()` 量出每行相对内容盒的 (x, y)；
4. 按深度算缩进 x，画"干线 + 肘形分叉 + 圆点"。

两个必须知道的点：

- **`preparing` 阶段没有 `[data-subcalls]`**：流式刚发出调用时它是"一行光杆"，子调用是后来插进来的。任何"缓存父节点结构"的写法都会漏。
- **配对与生命周期归运行时**：宿主 `subCalls` 是运行时投影，插件只读它，不自己拿 `tool/call` 与 `tool/result` 配对（README "已知边界" 段落点名了这一点）。

---

## 4. 它踩过的坑（按证据）

| # | 现象 | 证据 | 对我们的启示 |
| --- | --- | --- | --- |
| 1 | **状态词表会加值**：宿主成功态是 `ok`，不是 `completed`；少了这一条，"完成的长叶子"不出现 | CHANGELOG 0.8.2 "Recognize the host's `ok` tool state as completed"；`host:ui-tool 317` | 状态归一必须自带词表 + 未知值兜底，不能写死一个 `completed` |
| 2 | **流式空行**：行先以空内容挂上，之后往已有文本节点里追加，**行尺寸可能不变**，只在尺寸变化上触发的重建会漏节点 | CHANGELOG 0.8.2 "Observe initially empty process rows until they gain content" | 观察 `childList` + `characterData`，不能只靠 ResizeObserver |
| 3 | **性能**：200 条调用的合成会话，6000 px/s 快速滚动时基线有 49.31% 的帧 >25ms；原因是自己的 SVG 子节点变更触发了宿主 `:has()` 祖先选择器的样式重算 | docs/COMPATIBILITY.md「0.8.2 botanical opt-in」：`enabled 1/537 (0.19%)` vs `baseline 179/363 (49.31%)` | 装饰层必须节流（rAF 合并 + 只画脏组 + 只画视口附近），且能少动 DOM 就少动 |
| 4 | **它的解法有代价**：可选的"影子 DOM 隔离"能让查询快，但外部 CSS/别的插件就摸不到内部元素了，所以默认关 | 同上「turning it off restores the previous DOM」 | 我们不做影子 DOM；宁可少画，也不把宿主 DOM 藏起来 |
| 5 | **私有契约会变**：`data-*` 是宿主内部约定；0.11.0 干脆去掉 DSH 版本门槛，改成"列已验证宿主 + 装不上就别装" | CHANGELOG 0.11.0 "Remove the DSH version gate"；COMPATIBILITY「Known boundaries」 | 锚点缺失时**静默降级不报错**，并留一条可自查的契约检测脚本（我们写了 `test/host-contract.mjs`） |
| 6 | **不能包装/替换 React 节点**：一包装，宿主的折叠、`web_fetch` 链接、文件按钮、`useDisclosure` 全断 | README「保留原生交互」；`host:ui-tool 1970` | 只 append 自己的节点 |
| 7 | **React 必须来自宿主共享模块表**（不能自带一份 React，否则 hooks 上下文不对） | COMPATIBILITY「React must come from the host's shared module table」 | `require('react')`，且只在真要注册 slot 时才 require |
| 8 | **泄漏**：风格切换 / 暂停 / 卸载时没释放订阅和动画 → 卸载后还在跑 | CHANGELOG 0.10.0 "release subscriptions on suspension, style switch and unload"；`client.js` 尾部 `ctx.effect(... return () => { flushSettings(); manager.stop(); style.remove(); … })` | `ctx.effect` 里 return 清理函数；observer / rAF / `<style>` / 自有节点 / 属性 一个都不能漏 |
| 9 | **插件打架**：和别的缩进 / 连接线插件同区域改样式会互相覆盖，官方建议"别同时开两个" | README「建议停用重复添加缩进或过程连接线的插件」 | 我们的层带 `data-ptree` 前缀，检测到别的层已存在时不重复画 |
| 10 | **设置存储可能不可用**（localStorage 被禁）→ 设置页要报错而不是崩 | README「若存储不可用，设置页会提示」 | 读写包 try/catch，失败就当默认值 |
| 11 | **旧宿主 DOM 变异**：宿主改版后锚点没了，插件"装了但什么都不显示" | COMPATIBILITY「Unsupported markup may show no tree even when the package loads」 | 一条 `console.warn` 说清"没找到锚点"，别静默 |
| 12 | **我们自己的教训**：之前有插件复用官方 slot id 替换组件，导致 DSH 进安全模式、配置被重置 | 本仓库 `CODE-REVIEW.md`「快速显示花费 v0.3」 | 装饰 > 替换；这条和上面第 6 条同源 |

---

## 5. 我们做的话：能简化什么 / 必须保留什么

### 5.1 能简化（MVP 明确不做）

| 简化 | 理由 |
| --- | --- |
| 只做**一种**线条风格（安静肘形），不做经典曲线 / 植物手稿 / 代码块 | 三种风格 + 4 套 IDE 配色占了它 1MB bundle 的绝大部分；MVP 只要"看得出层级" |
| 不做设置面板体系（多方案配色、强度、行距、动画开关） | 只留一个"开 / 关"，配色交给 CSS 变量（外部可覆盖） |
| 不做代码视图（`def`/函数体、6 种语言、迷你地图、失败列表） | 那部分是它 0.9~0.11 的主线，跟"画树"是两件事 |
| 不做视口窗口化 / 分批转换 / SVG 复用池 | 我们只在"视口 ±600px 的组"上画，折叠的组整块跳过；长会话天然被摊薄 |
| 不做历史加载、不做 session 订阅 | 只读 DOM，零数据面 |
| 不改写原生链接 / 文件按钮 | 不去碰宿主交互，就没有第 6 条坑 |
| 不设 DSH 版本门槛 | 学它 0.11.0 的结论：版本号挡不住不兼容，只会挡住能用的新版 |

### 5.2 必须保留（不做就会坏）

1. **只装饰、不替换**：append 自有 SVG / 自有 `<style>`，绝不 wrap 或替换 React 节点。
2. **`ctx.effect` + 清理**：断开 MutationObserver / ResizeObserver / IntersectionObserver，取消 rAF，移除 `<style>`、所有 `[data-ptree]` 节点与 `data-ptree-host` 属性。
3. **状态归一 + 未知兜底**：`ok/completed/success/done → 完成`；`running/preparing/in_progress → 运行中`；`error/failed → 失败`；其余（含 `stopped`、缺字段）→ 中性灰，不猜成功。
4. **尊重 `hidden` / 折叠**：行高度为 0 就跳过；不 force-open、不改 `aria-expanded`。
5. **只量已渲染的 DOM**：不用 `innerText` 猜状态，不解析 JSON。
6. **节流**：MutationObserver 只标脏，真正重画在 `requestAnimationFrame` 里合并，一帧最多一轮。
7. **深浅色走 CSS 变量**：`[data-ds-dark-theme]` 两处（`<html>` 或 `<body>`）都要覆盖；不写死颜色。
8. **降级要安静但可查**：锚点找不到 → 不画、不抛、`console.warn` 一次。
9. **`preparing` 光杆行也要有节点**（调用一出现就画，不等子调用）。

### 5.3 实现时定下的两个取舍

- **道床只给过程行，不给"最终回答"行**：宿主会把最终回答也渲染在组内容里（`[data-turn-process-answer]`）。给它加 14px 缩进等于告诉人"这也是一步调用"，所以 CSS 里用 `:not([data-turn-process-answer])` 把它排除。
- **只有工具调用上圆点，思考行不上点**：树干会从它们背后穿过。理由是本插件只回答"工具调用怎么嵌套"，给思考行加节点会把语义扩成"整轮流程"，那是参考项目做的事（它按 `data-variant="think"` 画实心点），我们不做。

---

## 6. 哪些是"参考了思路"（声明）

**参考了思路，没有复制代码。** 具体是这四处：

1. **架构选择**：视觉插件 = 宿主空壳 + 客户端 DOM 装饰层；`window.__ModuleLoader__.load` 的 id 必须等于包名；`cordis.patch.yml` 只 insert 一行。→ 来自它的文件布局与 `index.js` 的空实现。
2. **锚点集合**：`[data-step-process-content]` 当容器、`[data-chat-call-id]` 当节点、`[data-subcalls]` 表达父子、`[data-state]` 表达状态。→ 来自它的 `STRUCTURE_SELECTOR`，并用本机 app.asar 里的宿主源码逐个核过。
3. **层级判定**：用 DOM 包含关系 + `parentElement.closest(...)`，不做 id 配对。→ 同上。
4. **生命周期纪律**：`ctx.effect` 包裹挂载并返回清理；`localStorage` 存偏好；深浅色用 `[data-ds-dark-theme]`。→ 来自它 `apply()` 的收尾。

**没抄的部分**（都是我们自己写的）：几何与绘制（`elbow()` / `plan()` / 量测与调度循环）、颜色与状态映射表、CSS 变量体系、设置开关组件、契约检测与单测。它 1MB 的 `client.js` 与我们的 `lib/client.js` 在结构、命名、算法上没有对应关系——它的每种风格是一套几何引擎，我们只有一条肘形路径。
