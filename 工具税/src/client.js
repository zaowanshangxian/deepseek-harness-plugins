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
