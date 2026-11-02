/*!
 * 「工具」Client 半侧（v0.4，嵌进 Token 面板底部）。
 *
 * 不再单独占一个侧栏位——而是挂在官方 Token 面板（token-mb 的页面）滚动区的最下面，
 * 像一张普通卡片一样跟在「今日消费 / 近 7 天 / 余额」后面：
 *
 *   工具账单（近 14 天）：每个工具调用了多少次、分摊多少 token、分摊多少钱。
 *
 * 实现：纯 DOM，不接管、不替换官方组件。找到中栏可滚动容器 → 判断当前是 Token 页
 * （含「今日消费」或「账户余额」）→ 在末尾 append 自己的 section；切走时移除，零残留。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-tool-tax',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    var BASE = '/api/tool-tax'
    var MARK = 'data-tool-tax-embed'
    var C = {
      text: '#1f2328',
      muted: '#57606a',
      line: '#d0d7de',
      soft: '#f6f8fa',
      accent: '#1f6feb',
    }

    var cachedReport = null
    var cachedTools = null
    var inflight = null

    function post(path) {
      return fetch(BASE + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status)
          return res.json()
        })
        .then(function (payload) {
          var value = payload && payload.value ? payload.value : payload
          if (!value) throw new Error('空响应')
          return value
        })
    }

    function loadData() {
      if (inflight) return inflight
      inflight = Promise.all([post('/report'), post('/tools')])
        .then(function (values) {
          cachedReport = values[0]
          cachedTools = values[1]
          var data = { report: values[0], bills: values[1] }
          writeLocal(data)
          return data
        })
        .catch(function () { return null })
        .then(function (value) {
          inflight = null
          return value
        })
      return inflight
    }

    var LS_KEY = 'tool-tax:last'
    function readLocal() {
      try {
        var raw = window.localStorage.getItem(LS_KEY)
        if (!raw) return null
        var parsed = JSON.parse(raw)
        if (!parsed || !parsed.data) return null
        return parsed
      } catch (e) {
        return null
      }
    }
    function writeLocal(data) {
      try {
        window.localStorage.setItem(LS_KEY, JSON.stringify({ at: Date.now(), data: data }))
      } catch (e) {}
    }

    function fmt(n) {
      if (!Number.isFinite(n)) return '—'
      if (n >= 1e8) return (n / 1e8).toFixed(2) + ' 亿'
      if (n >= 1e4) return (n / 1e4).toFixed(1) + ' 万'
      return String(Math.round(n))
    }

    function money(n) {
      if (!Number.isFinite(n)) return '—'
      if (n >= 1) return '¥' + n.toFixed(2)
      if (n >= 0.01) return '¥' + n.toFixed(3)
      return '¥' + n.toFixed(4)
    }

    function el(tag, style, text) {
      var node = document.createElement(tag)
      if (style) node.style.cssText = style
      if (text !== undefined) node.textContent = text
      return node
    }

    function buildSection() {
      var section = el('div', 'border:1px solid ' + C.line + ';border-radius:10px;background:#fff;margin:14px 0 6px;')
      section.setAttribute(MARK, '1')

      var head = el('div', 'padding:14px 18px 10px;border-bottom:1px solid ' + C.line + ';')
      head.appendChild(el('div', 'font-size:14px;font-weight:600;color:' + C.text + ';', '工具账单（近 14 天）'))
      var sub = el('div', 'font-size:12px;color:' + C.muted + ';margin-top:3px;', '读取中…')
      head.appendChild(sub)
      section.appendChild(head)

      var body = el('div', 'padding:8px 18px 14px;')
      section.appendChild(body)
      section._sub = sub
      section._body = body
      return section
    }

    function fillSection(section, data) {
      if (!section || !data) return
      var bills = data.bills || {}
      var report = data.report || {}
      section._sub.textContent =
        '会话 ' + (bills.sessionsScanned || 0) + ' 个 · 调用 ' + (bills.totalCalls || 0) + ' 次 · 合计 ' +
        fmt(bills.totalTokens || 0) + ' tokens / ' + money(bills.totalCny || 0) +
        '（工具税 ≈ ' + fmt(report.totalTokens || 0) + ' tokens/轮）'

      var body = section._body
      body.textContent = ''
      var tools = (bills.tools || []).slice(0, 15)
      if (!tools.length) {
        body.appendChild(el('div', 'font-size:12.5px;color:' + C.muted + ';padding:6px 0;', '窗口内没有工具调用记录。'))
      } else {
        var table = el('table', 'width:100%;border-collapse:collapse;font-size:12.5px;')
        var thead = el('thead')
        var hr = el('tr')
        ;['工具', '调用', 'tokens', '金额', '占比'].forEach(function (label, i) {
          var th = el('th', 'text-align:' + (i === 0 ? 'left' : 'right') + ';padding:6px 8px;border-bottom:1px solid ' + C.line + ';color:' + C.muted + ';font-weight:600;font-size:12px;', label)
          hr.appendChild(th)
        })
        thead.appendChild(hr)
        table.appendChild(thead)
        var tbody = el('tbody')
        tools.forEach(function (t) {
          var tr = el('tr')
          var cells = [t.name, String(t.calls), fmt(t.tokens), money(t.cny), Math.round((t.share || 0) * 100) + '%']
          cells.forEach(function (text, j) {
            var td = el('td', 'text-align:' + (j === 0 ? 'left' : 'right') + ';padding:5px 8px;border-bottom:1px solid #eaeef2;' +
              (j === 0 ? 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;' : ''), text)
            tr.appendChild(td)
          })
          tbody.appendChild(tr)
        })
        table.appendChild(tbody)
        body.appendChild(table)
      }
      var note = el('div', 'font-size:11.5px;color:#8b949e;margin-top:9px;line-height:1.5;',
        bills.method || 'tool/call 按 (turn,step) 平摊该轮 usage；金额按 DeepSeek 峰谷价（与 dsh-token-mb 同表）。')
      body.appendChild(note)
    }

    /** 中栏里可滚动的内容容器（Token 面板就渲染在这里）。 */
    function findScrollHost() {
      var col = document.querySelector('[class*="centerCol"]')
      if (!col) return null
      var stack = [col]
      var guard = 0
      while (stack.length && guard < 400) {
        guard += 1
        var node = stack.shift()
        var kids = node.children || []
        for (var i = 0; i < kids.length; i += 1) {
          var k = kids[i]
          if (k.scrollHeight > k.clientHeight + 20) return k
          stack.push(k)
        }
      }
      return null
    }

    /**
     * 侧栏当前高亮的是不是「Token」。
     * 用结构锚点（NAV 里的 active 项），不靠页面文本——文本谁都能撞。
     */
    function sidebarActiveIsToken() {
      try {
        var nav = document.querySelector('nav[class*="panelList"]')
        if (!nav) return false
        var active = nav.querySelector('[class*="panelActive"]')
        if (!active) return false
        return (active.textContent || '').trim() === 'Token'
      } catch (e) {
        return false
      }
    }

    /**
     * 三重判定（从强到弱）：
     *   1. 侧栏「Token」高亮 —— 结构锚点，最稳
     *   2. 页面标题含「Token 用量」 —— 结构锚点，防止侧栏判断失效
     *   3. 不含会话输入框占位符 —— 排除会话页（0.4.0 的教训）
     * 文本（今日消费/账户余额）只作为日志/调试参考，不再单独当判据。
     */
    function isTokenPanel(host) {
      if (!sidebarActiveIsToken()) return false
      var text = (host && host.textContent) || ''
      if (text.indexOf('Token 用量') === -1 && text.indexOf('今日消费') === -1) return false
      if (text.indexOf('发送消息') !== -1 || text.indexOf('描述你想要构建的内容') !== -1) return false
      return true
    }

    function removeOwn() {
      var nodes = document.querySelectorAll('[' + MARK + ']')
      for (var i = 0; i < nodes.length; i += 1) {
        try { nodes[i].parentNode.removeChild(nodes[i]) } catch (e) {}
      }
    }

    function tick() {
      try {
        var host = findScrollHost()
        if (!host || !isTokenPanel(host)) {
          removeOwn()
          return
        }
        if (host.querySelector('[' + MARK + ']')) return
        var section = buildSection()
        host.appendChild(section)
        // 先用上次的结果秒出（localStorage），再异步刷新——打开即见，不等扫描。
        var local = readLocal()
        if (local && local.data) fillSection(section, local.data)
        loadData().then(function (data) {
          if (!data) {
            if (section._sub) section._sub.textContent = '读取失败（Host 半可能还没起来）'
            return
          }
          if (!document.body.contains(section)) return
          fillSection(section, data)
        })
      } catch (e) {}
    }

    var installed = false
    var timer = null
    var observer = null

    exports.inject = []
    exports.apply = function (ctx) {
      if (installed) return
      installed = true
      try {
        timer = setInterval(tick, 900)
        observer = new MutationObserver(function () {
          if (timer === null) return
          // 交给 interval 节流，这里只做轻量唤醒
        })
        observer.observe(document.documentElement || document.body, { childList: true, subtree: true })
        document.addEventListener('click', function () { setTimeout(tick, 120) }, true)
        tick()
      } catch (e) {}
    }

    exports._internal = { buildSection: buildSection, fillSection: fillSection, fmt: fmt, money: money, isTokenPanel: isTokenPanel, tick: tick, removeOwn: removeOwn }

    return module.exports
  },
})
