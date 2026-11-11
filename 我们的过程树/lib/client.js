/*!
 * 「我们的过程树」— Client 半（MVP 0.1）。
 *
 * 做的事只有三件：
 *   1. 把过程组里平铺的工具调用按**嵌套关系**画成树（干线 + 肘形分叉 + 圆点）；
 *   2. 运行 / 完成 / 失败三态用颜色区分；
 *   3. 深色 / 浅色各一套配色，全部走 CSS 变量。
 *
 * 做法（参考项目 dsh-process-tree 的思路，代码另写）：
 *   - 只装饰，不接管。宿主 React 渲染出来的节点一个都不 wrap、不 replace，折叠状态、
 *     文件按钮、web_fetch 链接全部原样。我们只在宿主的过程组内容盒
 *     `[data-step-process-content]` 里追加一张自己的 `<svg data-ptree>`。
 *   - 数据只有一个来源：已经渲染出来的 DOM。
 *       容器 = [data-step-process-content]
 *       节点 = [data-chat-call-id]
 *       父子 = 子节点被包在父节点的 [data-subcalls] 里（DOM 包含关系，不做 id 配对）
 *       状态 = 节点内的 [data-state]（宿主词表：ok / error / running / preparing / stopped）
 *     不读 session、不订阅事件、不发网络请求、不写任何宿主状态。
 *   - 生命周期交给 ctx.effect：挂载时注册，卸载时把 observer / rAF / <style> / 自有节点
 *     / 自有属性全部还回去。
 *
 * 有意不做（见 ANALYSIS.md §5.1）：三种树形风格、IDE 配色方案、代码视图、迷你地图、
 * 失败列表、视口窗口化、历史加载。锚点缺失时静默降级，只 warn 一次。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-process-tree',
  factory(require) {
    'use strict'

    const PLUGIN_ID = 'dsh-plugin-process-tree'
    const SVG_NS = 'http://www.w3.org/2000/svg'

    const HOST_SEL = '[data-step-process-content]'
    const CALL_SEL = '[data-chat-call-id]'
    const HOST_ATTR = 'data-ptree-host'
    const LAYER_ATTR = 'data-ptree'
    const STYLE_ATTR = 'data-plugin'
    const STYLE_ID = PLUGIN_ID + '/tree.css'

    /** 左侧留给树线的道床宽度；每深一层再从上一层的道床中间往里让出同样宽度。 */
    const GUTTER = 14
    const DOT_R = 2.6
    const ELBOW_R = 6
    /** 视口外多远还愿意画（px）。far 的组整块跳过，长会话天然被摊薄。 */
    const VIEW_MARGIN = '600px 0px'

    const STORAGE_KEY = 'ptree.enabled.v1'
    const CHANGE_EVENT = 'dsh-process-tree:change'

    // 宿主的状态词表（来自 dsh-client-ui-tool 的 state 推导）。未知值一律当 idle，
    // 不猜成功——把"不确定"染成绿色比不画更误导。
    const DONE_STATES = new Set(['ok', 'completed', 'complete', 'success', 'succeeded', 'done'])
    const RUNNING_STATES = new Set(['running', 'preparing', 'pending', 'in_progress', 'provisioning'])
    const FAILED_STATES = new Set(['error', 'failed', 'failure'])

    /**
     * 行内交互控件：它们的 data-state 是"按钮自己忙 / 已复制"，不是调用的状态。
     * 注意 `[role="button"]` 也在里面——宿主真身的 bash 卡片根节点**本身就是** role="button"，
     * 所以只在"退化路径"里排除它，卡片根节点（卡片的直接子级）要走另一条路认。
     */
    const CONTROL_SEL = 'button,[role="button"],input,select,textarea'

    /* ------------------------------------------------------------------ *
     * 纯函数：状态归一 + 几何。不碰 DOM，单测直接打这几个（test/plan.test.mjs）。
     * ------------------------------------------------------------------ */

    /** 宿主写在行上的原始状态 → 我们的三态 + idle。 */
    function classify(raw) {
      const value = String(raw == null ? '' : raw).trim().toLowerCase()
      if (!value) return 'idle'
      if (DONE_STATES.has(value)) return 'done'
      if (RUNNING_STATES.has(value)) return 'running'
      if (FAILED_STATES.has(value)) return 'failed'
      // stopped / interrupted / unknown …：宿主说"没有明确成败"，我们就别染色。
      return 'idle'
    }

    function round(value) {
      const n = Math.round(Number(value) * 10) / 10
      return String(Number.isFinite(n) ? n : 0).replace(/\.0$/, '')
    }

    /**
     * 从父节点垂直干线拐进子节点圆点的肘形路径。
     * 起点落在父圆点上，先沿父的 x 直下，再四分之一圆弧拐到子行的中线，最后横到子圆点。
     */
    function elbow(x0, y0, x1, y1, radius) {
      const dy = y1 - y0
      const dir = dy < 0 ? -1 : 1
      const limit = Math.max(0, x1 - x0)
      const r = Math.min(radius == null ? ELBOW_R : radius, Math.abs(dy) / 2, limit)
      const knee = y1 - dir * r
      return (
        'M' + round(x0) + ',' + round(y0) +
        'L' + round(x0) + ',' + round(knee) +
        'Q' + round(x0) + ',' + round(y1) + ' ' + round(x0 + r) + ',' + round(y1) +
        'L' + round(x1) + ',' + round(y1)
      )
    }

    /**
     * nodes: [{ id, parent, x, y, state }]（x / y 已是相对容器左上角的中线坐标）
     * 返回 { trunks, branches, dots }：竖直干线、每一条分叉、每一个圆点。
     */
    function plan(nodes) {
      const byId = new Map()
      for (const node of nodes) byId.set(node.id, node)

      const dots = []
      const branches = []
      /** 顶层节点按 x 归组：父节点被折叠过滤掉时，孤儿会留在更深的位置（x 更大）。 */
      const spans = new Map()

      for (const node of nodes) {
        // 带上 id：绘制层按 id 复用同一个 SVG 节点，否则每帧换新身份，CSS 动画会每帧从 0 开始。
        dots.push({ id: node.id, x: node.x, y: node.y, state: node.state })

        const parent = node.parent == null ? null : byId.get(node.parent)
        if (parent) {
          branches.push({ id: node.id, d: elbow(parent.x, parent.y, node.x, node.y), state: node.state })
          continue
        }
        // 找不到父节点（被折叠过滤掉了）也当顶层：宁可少一条干线，不要断线、更不要画斜线。
        const key = round(node.x)
        const span = spans.get(key)
        if (!span) {
          spans.set(key, { x: node.x, y0: node.y, y1: node.y })
        } else {
          if (node.y < span.y0) span.y0 = node.y
          if (node.y > span.y1) span.y1 = node.y
        }
      }

      // 每个 x 一条竖直干线。跨不同 x 相连只会画出一条没有意义的斜线，
      // 所以分成多条——同 x 的顶层节点连成一条，不同 x 的各画各的。
      const trunks = []
      for (const span of spans.values()) {
        if (!(span.y1 > span.y0)) continue
        trunks.push({
          x: span.x,
          d: 'M' + round(span.x) + ',' + round(span.y0) + 'L' + round(span.x) + ',' + round(span.y1),
        })
      }

      return { trunks, branches, dots }
    }

    /* ------------------------------------------------------------------ *
     * 样式：深浅两套配色只差变量，切换靠宿主的 [data-ds-dark-theme]。
     * ------------------------------------------------------------------ */

    const CSS = [
      '[data-ptree-host]{position:relative}',
      // 顶层流程行让出道床；[data-subcalls] 是递归容器，padding 会逐层累加，
      // 所以子调用不需要逐层算缩进，CSS 自己会长。
      // 最终回答那一行不加道床：它不属于过程树，缩进它只会让人误以为它是一步工具调用。
      '[data-ptree-host]>[data-chat-flow-kind]:not([data-turn-process-answer]){padding-left:' + GUTTER + 'px}',
      '[data-ptree-host] [data-subcalls]{padding-left:' + GUTTER + 'px}',
      '[data-ptree]{position:absolute;left:0;top:0;overflow:visible;pointer-events:none;',
      '--ptree-line:#cfd4db;--ptree-done:#5f8f6d;--ptree-running:#2f6f9f;--ptree-failed:#c2453e;--ptree-idle:#9aa3ad}',
      // 我们的 <svg> 是宿主的兄弟节点，可能被宿主的 `~ [data-chat-flow-kind]` 一类的规则带上 margin。
      // 对绝对定位元素来说 margin 会把它整体推偏，坐标就全错了——用属性选择器压到 0（特异性高于宿主）。
      '[data-ptree-host]>[data-ptree]{margin:0}',
      // 深色标记宿主挂在 <body> 上；`:root[data-ds-dark-theme]` 只是兼容老写法。
      // 不用 `:root:has(body[...])`：:root 一旦成为 has-root，页面里任何 DOM 变更都要触发一次样式重算。
      'body[data-ds-dark-theme] [data-ptree],:root[data-ds-dark-theme] [data-ptree]{',
      '--ptree-line:#3a4048;--ptree-done:#7aa88a;--ptree-running:#6aa9d6;--ptree-failed:#e06c63;--ptree-idle:#6b737d}',
      '[data-ptree] path{fill:none;stroke-width:1.25;stroke-linecap:round;stroke:var(--ptree-line)}',
      '[data-ptree] path[data-state="running"]{stroke:var(--ptree-running)}',
      '[data-ptree] path[data-state="failed"]{stroke:var(--ptree-failed)}',
      '[data-ptree] circle{stroke:none;fill:var(--ptree-idle)}',
      '[data-ptree] circle[data-state="done"]{fill:var(--ptree-done)}',
      '[data-ptree] circle[data-state="running"]{fill:var(--ptree-running);animation:ptree-breathe 1.8s ease-in-out infinite}',
      '[data-ptree] circle[data-state="failed"]{fill:var(--ptree-failed)}',
      '@keyframes ptree-breathe{0%,100%{opacity:1}50%{opacity:.45}}',
      '@media (prefers-reduced-motion:reduce){[data-ptree] circle[data-state="running"]{animation:none}}',
    ].join('')

    /* ------------------------------------------------------------------ *
     * 运行时状态。全部在 mount / unmount 里成对建立与释放。
     * ------------------------------------------------------------------ */

    const runtime = {
      active: false,
      style: null,
      /** 每个已注册 host 一条：只观察自己这棵子树（childList / attributes，不含 characterData）。 */
      mutations: null,
      /** 全应用只留一条最便宜的通道：document.body 的 childList，只用来发现"冒出了新的过程组"。 */
      scan: null,
      resizes: null,
      viewport: null,
      /** Set<Element>；null 表示没有 IntersectionObserver，一律当可见。 */
      visible: null,
      /** 已注册并观察中的 host。离开文档就摘掉——长会话里不能只涨不降。 */
      hosts: new Set(),
      /** host → 上次画完的签名。签名没变就一个字节都不写（自触发循环的终点）。 */
      sigs: new WeakMap(),
      frame: 0,
      dirty: new Set(),
      warned: false,
      // 只给测试看的计数，不参与任何逻辑：paint 真的写过几次 DOM、collect 跑过几次。
      paints: 0,
      collects: 0,
    }

    function warnOnce(where, error) {
      if (runtime.warned) return
      runtime.warned = true
      try {
        console.warn('[process-tree] ' + where + '：没画成，插件其余部分不受影响。', error)
      } catch {
        /* console 都没有就算了 */
      }
    }

    function isVisible(host) {
      return runtime.visible === null || runtime.visible.has(host)
    }

    function schedule(host) {
      if (!runtime.active) return
      if (host) runtime.dirty.add(host)
      if (runtime.frame) return
      runtime.frame = requestAnimationFrame(flush)
    }

    function scheduleAll() {
      if (!runtime.active) return
      for (const host of runtime.hosts) runtime.dirty.add(host)
      schedule(null)
    }

    function flush() {
      runtime.frame = 0
      if (!runtime.active) return
      pruneHosts()
      const targets = runtime.dirty
      runtime.dirty = new Set()
      for (const host of targets) {
        if (!host.isConnected || !runtime.hosts.has(host) || !isVisible(host)) continue
        try {
          paint(host)
        } catch (error) {
          warnOnce('paint', error)
        }
      }
    }

    /* ------------------------------------------------------------------ *
     * 量测：把宿主 DOM 读成 [{ id, parent, x, y, state }]。
     * ------------------------------------------------------------------ */

    /** 行里"自己的卡片"：跳过子调用容器与自有权重层的第一个直接子元素。 */
    function ownCard(row) {
      let first = null
      for (const child of row.children || []) {
        // 自己的 SVG 层和子调用容器都不是"这一行的卡片"。
        if (child.hasAttribute(LAYER_ATTR) || child.hasAttribute('data-subcalls')) continue
        if (first === null) first = child
        if (child.hasAttribute('data-state')) return child
      }
      return first
    }

    /**
     * 量哪个盒子算"这一行的中线"。
     *
     * 宿主的 callRow 把 [data-subcalls]（整棵子树）也放在**同一行内部**，所以有子调用的行
     * 高度 = 自己的卡片 + 全部子调用。量整行会把圆点放到整块的中心（所有有子调用的父节点
     * 都下移；盲审实测 cy=24，卡片中心却是 12）。
     *
     * 叶子行（没有子调用容器）整行就是那张卡片，量行最准——连 padding 一起，中线才是视觉中线。
     * 有子调用的行只能量行内第一张"自己的"卡片。退化（卡片外多包一层）就用那个包层。
     */
    function cardOf(row) {
      if (!row.querySelector('[data-subcalls]')) return row
      return ownCard(row) || row
    }

    function readState(row) {
      // 行自己带 data-state：这是这一行的事实，直接认。
      if (row.matches('[data-state]')) return classify(row.getAttribute('data-state'))
      const card = ownCard(row)
      if (card) {
        // 正常路径：卡片自己就带状态。
        if (card.hasAttribute('data-state')) return classify(card.getAttribute('data-state'))
        // 宿主真身有的工具卡片是"外层壳 + 内层根节点带 state"：
        // bash 卡片就是 `.card`（无 state）> `.root[data-state][role=button]`。
        // 状态就在卡片的直接子级上——先认非控件的那个，全是控件时才退而认控件
        // （它就是这个卡片的根节点，不是行内小按钮）。
        let control = null
        for (const child of card.children || []) {
          if (!child.hasAttribute('data-state')) continue
          if (child.matches(CONTROL_SEL)) {
            if (!control) control = child
            continue
          }
          return classify(child.getAttribute('data-state'))
        }
        if (control) return classify(control.getAttribute('data-state'))
      }
      // 兜底：行内最外层候选。只认"归属还是这一行、不在子调用里、也不是行内交互控件"的那一个
      // ——复制按钮的 copied、忙闲按钮的 busy 也带 data-state，认它们会把圆点染成假状态。
      // 宁可 idle，也不猜。
      for (const found of row.querySelectorAll('[data-state]')) {
        if (found.closest(CALL_SEL) !== row) continue
        const nested = found.closest('[data-subcalls]')
        if (nested && row.contains(nested)) continue
        if (found.closest(CONTROL_SEL)) continue
        return classify(found.getAttribute('data-state'))
      }
      return 'idle'
    }

    function collect(host) {
      const hostRect = host.getBoundingClientRect()
      const nodes = []

      for (const row of host.querySelectorAll(CALL_SEL)) {
        // 只认"最近的过程组容器是自己"的行，避免把嵌套组里的调用算进来。
        if (row.closest(HOST_SEL) !== host) continue
        const id = row.getAttribute('data-chat-call-id')
        if (!id) continue

        // 量卡片，不量整行（整行含子树）。
        const rect = (cardOf(row) || row).getBoundingClientRect()
        // 折叠组、hidden 行、还没长出来的空行：高度为 0，直接跳过（不强开）。
        if (rect.height <= 0) continue

        const parentRow = row.parentElement ? row.parentElement.closest(CALL_SEL) : null
        const parent = parentRow && host.contains(parentRow) ? parentRow.getAttribute('data-chat-call-id') : null

        nodes.push({
          id: String(id),
          parent: parent == null ? null : String(parent),
          // 道床中线：卡片左边缘往左半个道床。卡片被 [data-subcalls] 的 padding 逐层推右，
          // 所以这里量的是真实位置，不靠深度算——宿主改 padding 也不会画歪。
          x: rect.left - hostRect.left - GUTTER / 2,
          y: rect.top - hostRect.top + rect.height / 2,
          state: readState(row),
        })
      }

      return {
        nodes,
        width: host.clientWidth,
        height: host.scrollHeight || host.clientHeight,
      }
    }

    /* ------------------------------------------------------------------ *
     * 绘制：一张 <svg> 装两个 <g>（线 / 圆点），按 id 复用节点。
     *
     * 不用 replaceChildren 整块重建：圆点节点每帧换新身份，CSS @keyframes 就每帧
     * 从第 0 帧重新开始（运行时圆点的呼吸动画永远停在第一帧、currentTime 恒为 0）。
     * 复用之后节点身份稳定、动画连续；而"签名没变就一个字节不写"同时也是
     * 自触发重绘循环的终点——我们的 DOM 变更不会再把自己叫醒。
     * ------------------------------------------------------------------ */

    /** layer 元素 → { paths: Map<key, Element>, dots: Map<key, Element> }；随元素一起被 GC。 */
    const layerCaches = new WeakMap()

    function ensureLayer(host) {
      const existing = host.querySelector(':scope > [' + LAYER_ATTR + ']')
      if (existing) return existing
      const svg = document.createElementNS(SVG_NS, 'svg')
      svg.setAttribute(LAYER_ATTR, '1')
      svg.setAttribute('aria-hidden', 'true')
      svg.setAttribute('focusable', 'false')
      // 挂在宿主最后，不用 insertBefore(svg, host.firstChild)：插到最前面会让宿主的第一行
      // 不再命中 :first-child，凭空多出 6px 上边距——装饰层不该改宿主的布局。
      // 代价是它可能命中宿主的 `~` 兄弟规则，所以 CSS 里把 margin 显式压成 0（见 [data-ptree] 规则）。
      host.appendChild(svg)
      return svg
    }

    function ensureGroup(layer, name) {
      const selector = ':scope > g[data-ptree-' + name + ']'
      let group = layer.querySelector(selector)
      if (!group) {
        group = document.createElementNS(SVG_NS, 'g')
        group.setAttribute('data-ptree-' + name, '1')
        layer.appendChild(group) // 先 paths 后 dots：线在圆点下面
      }
      return group
    }

    /** 只在值真的变了时才写属性——多写一笔就多一条 mutation 记录（也就多一次自唤醒的风险）。 */
    function setAttr(el, name, value) {
      if (value === null || value === undefined) {
        if (el.hasAttribute(name)) el.removeAttribute(name)
        return
      }
      const text = String(value)
      if (el.getAttribute(name) === text) return
      el.setAttribute(name, text)
    }

    /**
     * 把 group 的子节点对齐到 specs（按 key 复用）：新的追加在末尾，已有的一律原地不动
     * （移动节点也会让正在跑的 CSS 动画重启）。删掉的从缓存和 DOM 里一起摘掉。
     */
    function syncPool(group, cache, tag, specs) {
      const keep = new Set()
      for (const spec of specs) {
        keep.add(spec.key)
        let el = cache.get(spec.key)
        if (el && el.parentNode !== group) {
          // 宿主重渲染时可能把我们已画好的节点摘掉：还活着的就原样挂回去
          // （身份不变 → 正在跑的 CSS 动画不会重启）。
          group.appendChild(el)
        }
        if (!el) {
          el = document.createElementNS(SVG_NS, tag)
          cache.set(spec.key, el)
          group.appendChild(el)
        }
        for (const name of Object.keys(spec.attrs)) setAttr(el, name, spec.attrs[name])
      }
      for (const [key, el] of cache) {
        if (keep.has(key)) continue
        cache.delete(key)
        el.remove()
      }
    }

    function clearPool(layer) {
      const cache = layerCaches.get(layer)
      if (!cache) return
      for (const map of [cache.paths, cache.dots]) {
        for (const el of map.values()) el.remove()
        map.clear()
      }
    }

    function cacheOf(layer) {
      let cache = layerCaches.get(layer)
      if (!cache) {
        cache = { paths: new Map(), dots: new Map() }
        layerCaches.set(layer, cache)
      }
      return cache
    }

    /** 一次绘制依赖的全部输入。任何一项变了才值得动 DOM。 */
    function signature(snapshot) {
      const parts = [Math.round(snapshot.width), Math.round(snapshot.height)]
      for (const node of snapshot.nodes) {
        parts.push(
          node.id +
            '|' + (node.parent == null ? '' : node.parent) +
            '|' + node.state +
            '|' + round(node.x) + ',' + round(node.y),
        )
      }
      return parts.join(';')
    }

    /** 层还在，而且每个节点都有对应的圆点（宿主重渲染有可能把我们插进去的节点丢掉）。 */
    function layerIntact(layer, nodeCount) {
      if (!layer) return false
      const dots = layer.querySelector(':scope > g[data-ptree-dots]')
      if (!dots || !layer.querySelector(':scope > g[data-ptree-paths]')) return false
      return dots.childElementCount === nodeCount
    }

    /** 画。返回 true 表示这次真的写了 DOM。 */
    function paint(host) {
      runtime.collects += 1
      const snapshot = collect(host)
      const sig = signature(snapshot)
      const existing = host.querySelector(':scope > [' + LAYER_ATTR + ']')

      // 没变、而且该有的层还在：一个字节都不碰（观察者就不会再被我们自己的写操作叫醒）。
      // 层不见了要继续往下画，否则宿主重渲染丢掉我们的 <svg> 之后会永远画不回来。
      if (runtime.sigs.get(host) === sig && layerIntact(existing, snapshot.nodes.length)) return false

      // 这个组里没有工具调用（纯思考 / 纯文本）：不建空图层，什么都不留。
      if (!snapshot.nodes.length) {
        if (existing) clearPool(existing)
        runtime.sigs.set(host, sig)
        return false
      }

      const layer = existing || ensureLayer(host)
      const drawn = plan(snapshot.nodes)
      const width = Math.max(1, Math.round(snapshot.width))
      const height = Math.max(1, Math.round(snapshot.height))

      setAttr(layer, 'width', width)
      setAttr(layer, 'height', height)
      setAttr(layer, 'viewBox', '0 0 ' + width + ' ' + height)

      const paths = []
      // 干线和"完成 / 未定"的分叉不染色：CSS 默认色就是中性线。
      for (const trunk of drawn.trunks) {
        paths.push({ key: 't:' + round(trunk.x), attrs: { d: trunk.d, 'data-state': null } })
      }
      for (const branch of drawn.branches) {
        const tint = branch.state === 'running' || branch.state === 'failed' ? branch.state : null
        paths.push({ key: 'b:' + branch.id, attrs: { d: branch.d, 'data-state': tint } })
      }
      const dots = drawn.dots.map((dot) => ({
        key: 'd:' + dot.id,
        attrs: { cx: round(dot.x), cy: round(dot.y), r: DOT_R, 'data-state': dot.state },
      }))

      const cache = cacheOf(layer)
      syncPool(ensureGroup(layer, 'paths'), cache.paths, 'path', paths)
      syncPool(ensureGroup(layer, 'dots'), cache.dots, 'circle', dots)

      runtime.sigs.set(host, sig)
      runtime.paints += 1
      return true
    }

    /* ------------------------------------------------------------------ *
     * 挂载 / 卸载。
     * ------------------------------------------------------------------ */

    function installStyle() {
      removeStyle()
      const style = document.createElement('style')
      style.setAttribute(STYLE_ATTR, PLUGIN_ID)
      style.setAttribute('data-plugin-css', STYLE_ID)
      style.textContent = CSS
      document.head.appendChild(style)
      runtime.style = style
    }

    function removeStyle() {
      const nodes = document.querySelectorAll('style[' + STYLE_ATTR + '="' + PLUGIN_ID + '"]')
      for (const node of nodes) {
        try {
          node.remove()
        } catch {
          /* 已经是孤儿节点 */
        }
      }
      runtime.style = null
    }

    /** 观察每个 host 子树时要看的属性：只挑会让树变形 / 变色的那几个。 */
    const HOST_OBSERVE = {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state', 'hidden', 'style', 'aria-expanded', 'data-chat-flow-kind', 'data-chat-call-id'],
    }

    /** 落在我们自己的 SVG 层里？这类变更永远不该反过来把我们叫醒（自触发循环的闸门）。 */
    function insideLayer(node) {
      const el = node && node.nodeType === 1 ? node : node && node.parentElement
      return Boolean(el && typeof el.closest === 'function' && el.closest('[' + LAYER_ATTR + ']'))
    }

    function hasElementNode(nodes) {
      for (const node of nodes) if (node.nodeType === 1) return true
      return false
    }

    /** 松手：observer / 可见集 / 脏集 / 签名缓存里都不再留这个 host。 */
    function releaseHost(host) {
      try {
        runtime.resizes?.unobserve(host)
      } catch {
        /* 观察器已经断了 */
      }
      try {
        runtime.viewport?.unobserve(host)
      } catch {
        /* 已经断了 */
      }
      try {
        runtime.mutations?.unobserve(host)
      } catch {
        /* 已经断了 */
      }
      runtime.hosts.delete(host)
      runtime.visible?.delete(host)
      runtime.dirty.delete(host)
      runtime.sigs.delete(host)
    }

    /** 已经离开文档的 host 全部摘掉：长会话里 observer / 可见集只涨不降就是这里漏的。 */
    function pruneHosts() {
      for (const host of runtime.hosts) {
        if (!host.isConnected) releaseHost(host)
      }
    }

    function registerHosts() {
      if (!runtime.active) return
      pruneHosts()
      const hosts = document.querySelectorAll(HOST_SEL)
      for (const host of hosts) {
        if (!runtime.hosts.has(host)) {
          runtime.hosts.add(host)
          try {
            runtime.resizes?.observe(host)
          } catch {
            /* 这个元素观察不了，只影响自动重量的时机 */
          }
          try {
            runtime.viewport?.observe(host)
          } catch {
            /* 同上 */
          }
          try {
            runtime.mutations?.observe(host, HOST_OBSERVE)
          } catch {
            /* 同上 */
          }
        }
        if (!host.hasAttribute(HOST_ATTR)) host.setAttribute(HOST_ATTR, '1')
        runtime.dirty.add(host)
      }
      // 静默降级，但别静默到"以为在跑"：明明有过程行、却找不到组内容盒，
      // 那就是宿主契约变了（或者插件没被 DSH 加载）。只在确认有会话界面时说一次。
      if (!hosts.length && document.querySelector('[data-chat-flow-kind]')) {
        warnOnce('contract', '找到了过程行却没有 ' + HOST_SEL + '：宿主 DOM 契约可能变了')
      }
      schedule(null)
    }

    /** 全应用发现通道：只在 body 的 childList 里找"冒出了 / 走了新的过程组"，不在这里判脏。 */
    function onScan(records) {
      let seen = false
      let removed = false
      for (const record of records) {
        if (insideLayer(record.target)) continue
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue
          if (node.matches?.(HOST_SEL) || node.querySelector?.(HOST_SEL)) {
            seen = true
            break
          }
        }
        if (hasElementNode(record.removedNodes)) removed = true
      }
      if (seen) {
        registerHosts()
        return
      }
      if (removed) {
        pruneHosts()
        schedule(null)
      }
    }

    /** 已注册 host 自己的变更：只把"落在这个 host 里"的那几个标脏。 */
    function onMutations(records) {
      let scan = false
      const marked = new Set()
      for (const record of records) {
        // 最关键的一行：我们自己画的线 / 点的任何变更，一律不当变更。
        // 少了它，paint 里的每一笔写都会把自己排进下一帧 → 永久 60fps 重绘。
        if (insideLayer(record.target)) continue
        // 流式文本只追 / 改文本节点，不影响几何（真影响会改 host 尺寸，ResizeObserver 会叫我们）。
        if (record.type === 'childList' && !hasElementNode(record.addedNodes) && !hasElementNode(record.removedNodes)) {
          continue
        }
        const target = record.target.nodeType === 1 ? record.target : record.target.parentElement
        const host = target && target.closest ? target.closest(HOST_SEL) : null
        if (!host) {
          if (record.type === 'childList') scan = true
          continue
        }
        if (runtime.hosts.has(host)) marked.add(host)
        else scan = true
      }
      if (marked.size) {
        for (const host of marked) runtime.dirty.add(host)
        schedule(null)
      }
      if (scan) registerHosts()
    }

    function onResize(entries) {
      for (const entry of entries) {
        if (runtime.hosts.has(entry.target)) runtime.dirty.add(entry.target)
      }
      schedule(null)
    }

    function onViewport(entries) {
      if (runtime.visible === null) runtime.visible = new Set()
      for (const entry of entries) {
        if (!runtime.hosts.has(entry.target)) continue
        if (entry.isIntersecting) {
          runtime.visible.add(entry.target)
          // 重新可见时必须重新排队。滚出视口期间攒下的变更在 flush() 里被跳过了，而脏集
          // 在那之前就已经整体清空——不在这里补回来就永远补不回来：已经结束的过程组
          // 不会再产生 mutation 来叫醒我们，于是长会话里滚回去看到的是旧配色 + 错位的圆点。
          runtime.dirty.add(entry.target)
        } else {
          runtime.visible.delete(entry.target)
        }
      }
      schedule(null)
    }

    function mount() {
      if (runtime.active || typeof document === 'undefined' || !document.body) return
      runtime.active = true
      runtime.warned = false
      runtime.hosts = new Set()
      runtime.sigs = new WeakMap()
      installStyle()

      if (typeof ResizeObserver === 'function') runtime.resizes = new ResizeObserver(onResize)
      if (typeof IntersectionObserver === 'function') {
        runtime.viewport = new IntersectionObserver(onViewport, { rootMargin: VIEW_MARGIN })
      }
      runtime.mutations = new MutationObserver(onMutations)
      runtime.scan = new MutationObserver(onScan)
      // 全应用只留这一条最便宜的通道：childList，且只用来"发现新的过程组"。
      // 不挂 characterData / attributes（原来挂的是 body + subtree + characterData，等于
      // 每个流式 token 都进一次回调）；已注册 host 的属性 / 结构变更由它自己的 observer 报。
      runtime.scan.observe(document.body, { childList: true, subtree: true })
      window.addEventListener('resize', scheduleAll)

      registerHosts()
    }

    function unmount() {
      if (!runtime.active) return
      runtime.active = false
      for (const observer of [runtime.mutations, runtime.scan, runtime.resizes, runtime.viewport]) {
        try {
          observer?.disconnect()
        } catch {
          /* 已经断了 */
        }
      }
      runtime.mutations = null
      runtime.scan = null
      runtime.resizes = null
      runtime.viewport = null
      runtime.hosts = new Set()
      runtime.sigs = new WeakMap()
      runtime.visible = null
      window.removeEventListener('resize', scheduleAll)

      if (runtime.frame) cancelAnimationFrame(runtime.frame)
      runtime.frame = 0
      runtime.dirty = new Set()

      removeStyle()

      for (const host of document.querySelectorAll('[' + HOST_ATTR + ']')) {
        host.removeAttribute(HOST_ATTR)
        for (const layer of host.querySelectorAll(':scope > [' + LAYER_ATTR + ']')) {
          try {
            layer.remove()
          } catch {
            /* 已经不在树上了 */
          }
        }
      }
    }

    /* ------------------------------------------------------------------ *
     * 开关：localStorage 一个键，读写都吞异常（存储被禁时按默认值走）。
     * ------------------------------------------------------------------ */

    function readEnabled() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        return raw === null ? true : raw !== '0'
      } catch {
        return true
      }
    }

    function writeEnabled(on) {
      try {
        window.localStorage.setItem(STORAGE_KEY, on ? '1' : '0')
      } catch {
        /* 存不了就算了，本次会话仍然按点击后的状态生效 */
      }
    }

    /* ------------------------------------------------------------------ *
     * 官方槽位：设置页里的一个开关。视觉部分不用 slot（要装饰的是宿主已渲染的 DOM），
     * 这里用 slot 只是为了给用户一个正式入口。
     * ------------------------------------------------------------------ */

    function registerSettings(ctx) {
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function') return
      try {
        const React = require('react')

        function ProcessTreeToggle() {
          const [on, setOn] = React.useState(readEnabled())
          const toggle = () => {
            const next = !on
            writeEnabled(next)
            setOn(next)
            try {
              window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
            } catch {
              /* 老浏览器没有 CustomEvent 就靠下次重载 */
            }
          }
          return React.createElement(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '4px 0' } },
            React.createElement(
              'div',
              { style: { minWidth: 0 } },
              React.createElement('div', { style: { fontWeight: 600 } }, '过程树'),
              React.createElement(
                'div',
                { style: { fontSize: '12px', opacity: 0.72, marginTop: '2px' } },
                '工具调用按嵌套关系画成树，运行 / 完成 / 失败三态用颜色区分。',
              ),
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: toggle,
                style: {
                  flex: 'none',
                  cursor: 'pointer',
                  borderRadius: '999px',
                  border: '1px solid currentColor',
                  background: 'transparent',
                  color: 'inherit',
                  padding: '4px 12px',
                  font: 'inherit',
                },
              },
              on ? '已启用' : '已关闭',
            ),
          )
        }

        ctx.effect(
          () =>
            ctx.slots.inject('settings.section', () =>
              ctx.slots.register(
                { name: 'settings.section', id: PLUGIN_ID, order: 72, label: () => '过程树' },
                ProcessTreeToggle,
              ),
            ),
          'process-tree: settings section',
        )
      } catch (error) {
        warnOnce('settings', error)
      }
    }

    /* ------------------------------------------------------------------ *
     * 插件体。
     * ------------------------------------------------------------------ */

    function apply(ctx) {
      ctx.effect(() => {
        const sync = () => {
          if (readEnabled()) mount()
          else unmount()
        }
        sync()
        window.addEventListener(CHANGE_EVENT, sync)
        return () => {
          window.removeEventListener(CHANGE_EVENT, sync)
          unmount()
        }
      }, 'process-tree: decorate')

      registerSettings(ctx)
    }

    return {
      name: PLUGIN_ID,
      inject: ['slots'],
      apply,
      // 纯函数出口：单测不搭 DOM 也能验状态词表和几何。
      __internals: {
        classify,
        elbow,
        plan,
        /** 只给测试用：{ paints, collects, hosts } —— 用来证明"静置之后不再重画"。 */
        stats: () => ({ paints: runtime.paints, collects: runtime.collects, hosts: runtime.hosts.size }),
      },
    }
  },
})
