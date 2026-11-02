/*!
 * 「工具税」Client 半侧（v0.1，真实 DOM 锚点版）。
 *
 * 不接管、不替换、不注册任何官方槽位。官方「Token 用量」卡片打开时，在末尾追加一行
 * 「工具税 ≈ N tokens/轮」——这是每轮对话里，光把工具 JSON Schema 塞进提示词就要付的钱。
 *
 *   1. 锚点：官方卡片 div[role="dialog"][aria-label="Token 用量" / "Token usage"] 里的 <dl>；
 *      只往这个 <dl> 追加 <dt>工具税</dt><dd>≈ N tokens/轮</dd>，样式全部继承官方 CSS。
 *   2. 数据：POST /api/tool-tax/report（Host 半只读统计 ctx.tools.schemas()）。
 *   3. 悬停看明细：<dd> 的 title 里放「按插件 Top 5」；点击复制一行可粘贴的摘要。
 *   4. 卡片关闭即卸载；任何异常静默跳过，绝不影响官方界面。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-tool-tax',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var h = React.createElement

    var BASE = '/api/tool-tax'
    var ATTR = 'data-tool-tax'
    var ROW_MARK = 'data-tool-tax-row'
    var DIALOG_LABELS = ['Token 用量', '本轮用量', 'Token usage', 'Turn usage']

    var cachedReport = null
    var inflight = null
    var cachedTools = null
    var toolsInflight = null

    function collectAll(root, out) {
      try {
        var list = root.querySelectorAll('*')
        for (var i = 0; i < list.length; i += 1) {
          var el = list[i]
          out.push(el)
          if (el.shadowRoot) collectAll(el.shadowRoot, out)
        }
      } catch (e) {}
      return out
    }

    function findUsageDialog() {
      for (var i = 0; i < DIALOG_LABELS.length; i += 1) {
        var quick = document.querySelector('[role="dialog"][aria-label="' + DIALOG_LABELS[i] + '"]')
        if (quick) return quick
      }
      var nodes = collectAll(document, [])
      for (var j = 0; j < nodes.length; j += 1) {
        var el = nodes[j]
        if (!el.getAttribute || el.getAttribute('role') !== 'dialog') continue
        if (DIALOG_LABELS.indexOf(el.getAttribute('aria-label') || '') !== -1) return el
      }
      return null
    }

    function detailsList(dialog) {
      try {
        var lists = dialog.querySelectorAll('dl')
        for (var i = 0; i < lists.length; i += 1) {
          if (lists[i].querySelector('dt')) return lists[i]
        }
      } catch (e) {}
      return null
    }

    function fetchReport() {
      if (cachedReport) return Promise.resolve(cachedReport)
      if (inflight) return inflight
      inflight = fetch(BASE + '/report', {
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
          if (value && value.ok) cachedReport = value
          return cachedReport
        })
        .catch(function () {
          return null
        })
        .then(function (value) {
          inflight = null
          return value
        })
      return inflight
    }

    function fmt(n) {
      if (!Number.isFinite(n)) return '—'
      if (n >= 10000) return (n / 1000).toFixed(1) + 'k'
      return String(Math.round(n))
    }

    function summary(report) {
      var parts = []
      var list = (report.plugins || []).slice(0, 5)
      for (var i = 0; i < list.length; i += 1) {
        var p = list[i]
        parts.push(p.name + '：' + p.tools + ' 个工具 / ' + fmt(p.tokens) + ' tokens')
      }
      if (report.unattributed && report.unattributed.tools > 0) {
        parts.push('未归属：' + report.unattributed.tools + ' 个 / ' + fmt(report.unattributed.tokens) + ' tokens')
      }
      return parts
    }

    function fetchTools() {
      if (cachedTools) return Promise.resolve(cachedTools)
      if (toolsInflight) return toolsInflight
      toolsInflight = fetch(BASE + '/tools', {
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
          if (value && Array.isArray(value.tools)) cachedTools = value
          return cachedTools
        })
        .catch(function () { return null })
        .then(function (value) {
          toolsInflight = null
          return value
        })
      return toolsInflight
    }

    function money(n) {
      if (!Number.isFinite(n)) return '—'
      if (n >= 1) return '¥' + n.toFixed(2)
      if (n >= 0.01) return '¥' + n.toFixed(3)
      return '¥' + n.toFixed(4)
    }

    function closePanel() {
      try {
        var p = document.getElementById('tool-tax-panel')
        if (p && p.parentNode) p.parentNode.removeChild(p)
      } catch (e) {}
    }

    function openPanel(report) {
      try {
        closePanel()
        var wrap = document.createElement('div')
        wrap.id = 'tool-tax-panel'
        wrap.setAttribute(ATTR, '')
        wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font:13px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;'

        var card = document.createElement('div')
        card.style.cssText = 'width:min(760px,92vw);max-height:78vh;overflow:auto;background:#fff;color:#1f2328;border-radius:12px;padding:18px 20px;box-shadow:0 18px 60px rgba(0,0,0,.28);'

        var head = document.createElement('div')
        head.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px;'
        var title = document.createElement('div')
        title.textContent = '工具账单 · 近 ' + (report.windowDays || 14) + ' 天'
        title.style.cssText = 'font-size:15px;font-weight:600;'
        var close = document.createElement('button')
        close.textContent = '关闭'
        close.style.cssText = 'border:0;background:#eef1f4;color:#57606a;border-radius:6px;padding:4px 10px;cursor:pointer;'
        close.addEventListener('click', closePanel)
        head.appendChild(title)
        head.appendChild(close)
        card.appendChild(head)

        var sub = document.createElement('div')
        sub.style.cssText = 'color:#57606a;font-size:12px;margin-bottom:10px;'
        sub.textContent = '会话 ' + (report.sessionsScanned || 0) + ' 个 · 调用 ' + (report.totalCalls || 0) +
          ' 次 · 合计 ' + fmt(report.totalTokens || 0) + ' tokens / ' + money(report.totalCny || 0)
        card.appendChild(sub)

        var table = document.createElement('table')
        table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12.5px;'
        var thead = document.createElement('thead')
        var hr = document.createElement('tr')
        ;['工具', '调用', 'tokens', '金额', '占比'].forEach(function (label, i) {
          var th = document.createElement('th')
          th.textContent = label
          th.style.cssText = 'text-align:' + (i === 0 ? 'left' : 'right') + ';padding:6px 8px;border-bottom:1px solid #d0d7de;color:#57606a;font-weight:600;'
          hr.appendChild(th)
        })
        thead.appendChild(hr)
        table.appendChild(thead)

        var tbody = document.createElement('tbody')
        var list = (report.tools || []).slice(0, 20)
        for (var i = 0; i < list.length; i += 1) {
          var t = list[i]
          var tr = document.createElement('tr')
          var cells = [t.name, String(t.calls), fmt(t.tokens), money(t.cny), Math.round((t.share || 0) * 100) + '%']
          for (var j = 0; j < cells.length; j += 1) {
            var td = document.createElement('td')
            td.textContent = cells[j]
            td.style.cssText = 'text-align:' + (j === 0 ? 'left' : 'right') + ';padding:5px 8px;border-bottom:1px solid #eaeef2;' +
              (j === 0 ? 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;' : '')
            tr.appendChild(td)
          }
          tbody.appendChild(tr)
        }
        table.appendChild(tbody)
        card.appendChild(table)

        var note = document.createElement('div')
        note.style.cssText = 'color:#8b949e;font-size:11.5px;margin-top:10px;line-height:1.5;'
        note.textContent = report.method || '调用按 (turn,step) 平摊该轮用量；金额按 DeepSeek 峰谷价。'
        card.appendChild(note)

        wrap.appendChild(card)
        wrap.addEventListener('click', function (ev) { if (ev.target === wrap) closePanel() })
        document.body.appendChild(wrap)
      } catch (e) {}
    }

    function insertRow(dialog, report) {
      var list = detailsList(dialog)
      if (!list) return false
      if (list.querySelector('[' + ROW_MARK + ']')) return true

      var dt = document.createElement('dt')
      dt.setAttribute(ROW_MARK, '1')
      dt.setAttribute(ATTR, '')
      dt.textContent = '工具税'

      var dd = document.createElement('dd')
      dd.setAttribute(ROW_MARK, '1')
      dd.setAttribute(ATTR, '')
      dd.textContent = '≈ ' + fmt(report.totalTokens) + ' tokens/轮'
      dd.title = '每轮固定注入的工具 schema 估算：' + summary(report).join('\n') +
        '\n\n算法：' + report.method +
        '\n区间：' + fmt(report.tokenRange && report.tokenRange[0]) + ' ~ ' + fmt(report.tokenRange && report.tokenRange[1]) + ' tokens'
      dd.style.cursor = 'copy'

      try {
        dd.addEventListener('click', function () {
          var text = '工具税 ≈ ' + report.totalTokens + ' tokens/轮（' +
            (report.tokenRange ? report.tokenRange[0] + '~' + report.tokenRange[1] : '?') + '）；' +
            summary(report).join('；')
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(text)
              dd.textContent = '已复制'
              setTimeout(function () { dd.textContent = '≈ ' + fmt(report.totalTokens) + ' tokens/轮' }, 1200)
            }
          } catch (e) {}
        })
      } catch (e) {}

      try {
        list.appendChild(dt)
        list.appendChild(dd)
      } catch (e) {
        return false
      }

      // 第二行：工具账单（点击展开）
      try {
        var dt2 = document.createElement('dt')
        dt2.setAttribute(ROW_MARK, '1')
        dt2.setAttribute(ATTR, '')
        dt2.textContent = '工具账单'

        var dd2 = document.createElement('dd')
        dd2.setAttribute(ROW_MARK, '1')
        dd2.setAttribute(ATTR, '')
        dd2.textContent = '点击查看'
        dd2.title = '近 14 天每个工具的调用次数 / 分摊 tokens / 分摊金额'
        dd2.style.cursor = 'pointer'
        dd2.addEventListener('click', function () {
          dd2.textContent = '读取中…'
          fetchTools().then(function (tools) {
            if (tools) {
              dd2.textContent = '点击查看'
              openPanel(tools)
            } else {
              dd2.textContent = '读取失败'
              setTimeout(function () { dd2.textContent = '点击查看' }, 1500)
            }
          })
        })
        list.appendChild(dt2)
        list.appendChild(dd2)
      } catch (e) {}

      return true
    }

    var timer = null
    function schedule() {
      if (timer) return
      timer = setTimeout(function () {
        timer = null
        tick()
      }, 120)
    }

    function tick() {
      try {
        var dialog = findUsageDialog()
        if (!dialog) return
        var list = detailsList(dialog)
        if (!list) return
        if (list.querySelector('[' + ROW_MARK + ']')) return
        fetchReport().then(function (report) {
          if (!report || !report.ok) return
          var again = findUsageDialog()
          if (again) insertRow(again, report)
        })
      } catch (e) {}
    }

    function install() {
      try {
        var observer = new MutationObserver(schedule)
        observer.observe(document.documentElement || document.body, { childList: true, subtree: true })
        document.addEventListener('click', schedule, true)
        document.addEventListener('keyup', schedule, true)
      } catch (e) {}
    }

    /** 插件卸载：移除已插入的行，不留残影。 */
    function uninstall() {
      try {
        var rows = document.querySelectorAll('[' + ROW_MARK + ']')
        for (var i = 0; i < rows.length; i += 1) {
          var row = rows[i]
          if (row.parentNode) row.parentNode.removeChild(row)
        }
      } catch (e) {}
      cachedReport = null
    }

    exports.inject = []

    var installed = false

    exports.apply = function (ctx) {
      if (installed) return
      installed = true
      try {
        install()
      } catch (e) {
        /* 静默：任何异常都不能影响官方界面 */
      }
    }

    // 给冒烟测试用：不经过 Cordis，直接验注入逻辑
    exports._internal = {
      findUsageDialog: findUsageDialog,
      detailsList: detailsList,
      insertRow: insertRow,
      fetchReport: fetchReport,
      setReport: function (value) { cachedReport = value },
      tick: tick,
      uninstall: uninstall,
    }

    return module.exports
  },
})
