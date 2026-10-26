/*!
 * 「Token 用量 + 花费金额」Client 半侧（v0.6，官方记录优先版）。
 *
 * 不接管、不替换、不注册任何官方槽位。官方「Token 用量」卡片打开时，在卡片末尾追加一行「花费金额」：
 *   1. 优先用 token-mb 的官方记录（GET /token-meter-panel/summary）：
 *      取最近写入的会话（排除子代理），其 cny 即「本会话累计花费」，按每次调用实际峰谷/模型算，最准
 *   2. token-mb 不在/未返回时，退回解析官方卡片文字做估算（与 v0.5 相同）
 *   3. 卡片关闭自动移除该行；任何异常静默跳过
 *
 * 金额口径：官方记录优先；估算 = Flash 峰谷价 × 卡片上显示的数字。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-inline-cost',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var h = React.createElement


    // ── 客户端错误记录（无悬浮 UI；选项在插件配置页里，可手动关闭，不自动上传）──
    function installErrorReporter(options) {
      try {
        var id = options.id
        var title = options.title
        var version = options.version || ''
        var repo = options.repo || 'zaowanshangxian/deepseek-harness-plugins'
        var SKEY = 'dsh-errors:' + id
        var OFFKEY = 'dsh-errors-off:' + id
        var enabled = true
        try { enabled = window.localStorage.getItem(OFFKEY) !== '1' } catch (e) {}
        function list() {
          try { return JSON.parse(window.localStorage.getItem(SKEY) || '[]') } catch (e) { return [] }
        }
        function write(items) {
          try { window.localStorage.setItem(SKEY, JSON.stringify(items.slice(0, 20))) } catch (e) {}
        }
        function setEnabled(value) {
          enabled = value !== false
          try { window.localStorage.setItem(OFFKEY, enabled ? '0' : '1') } catch (e) {}
        }
        function record(kind, message, stack) {
          if (!enabled) return
          var items = list()
          var text = String(message || '').slice(0, 300)
          for (var i = 0; i < items.length; i += 1) {
            if (items[i].m === text && items[i].k === kind) return
          }
          items.unshift({ t: Date.now(), k: kind, m: text, s: String(stack || '').slice(0, 800) })
          write(items)
        }
        function reportText() {
          var items = list()
          return '插件: ' + title + ' (' + id + ' v' + version + ')\nUA: ' + (navigator.userAgent || '') +
            '\n时间: ' + new Date().toISOString() + '\n\n' +
            items.map(function (e) {
              return '[' + new Date(e.t).toISOString() + '] ' + e.k + ': ' + e.m + '\n' + e.s
            }).join('\n\n')
        }
        function issueUrl() {
          var items = list().slice(0, 3).map(function (e) { return '- [' + e.k + '] ' + e.m })
          var body = [
            '### 插件',
            title + ' (' + id + ' v' + version + ')',
            '',
            '### 环境',
            'DSH desktop / web',
            'UA: ' + (navigator.userAgent || ''),
            '时间: ' + new Date().toISOString(),
            '',
            '### 错误记录',
            items.join('\n') || '（无）',
            '',
            '### 复现步骤',
            '1. ',
            '2. ',
          ].join('\n')
          return 'https://github.com/' + repo + '/issues/new?template=bug-report.yml&title=' +
            encodeURIComponent('[' + title + '] ' + (items[0] || '错误上报')) + '&body=' + encodeURIComponent(body)
        }
        window.addEventListener('error', function (event) {
          try {
            var stack = String((event.error && event.error.stack) || '')
            var src = String(event.filename || '')
            if (stack.indexOf(id) === -1 && src.indexOf(id) === -1) return
            record('error', event.message || 'unknown error', stack)
          } catch (e) {}
        }, true)
        window.addEventListener('unhandledrejection', function (event) {
          try {
            var reason = event.reason
            var stack = String((reason && reason.stack) || reason || '')
            if (stack.indexOf(id) === -1) return
            record('rejection', String((reason && reason.message) || reason), stack)
          } catch (e) {}
        })
        window.__dshErrorReporter = window.__dshErrorReporter || {}
        window.__dshErrorReporter[id] = {
          isEnabled: function () { return enabled },
          setEnabled: setEnabled,
          list: list,
          clear: function () { write([]) },
          copyText: function () { try { navigator.clipboard.writeText(reportText()) } catch (e) {} },
          reportText: reportText,
          issueUrl: issueUrl,
          record: record,
        }
      } catch (error) {
        /* reporter 自身绝不抛错 */
      }
    }


    var ROW_ID = 'inline-cost-row'
    var SUMMARY_URL = '/token-meter-panel/summary'
    var SUMMARY_TTL = 30000
    var PRICE = {
      read: { offPeak: 0.02, peak: 0.04 },
      miss: { offPeak: 1, peak: 2 },
      output: { offPeak: 4, peak: 8 },
    }

    var summaryState = { at: 0, payload: null, failed: false, loading: false }

    function isPeak(nowMs) {
      var d = new Date(nowMs + 8 * 3600 * 1000)
      var dow = d.getUTCDay()
      if (dow === 0 || dow === 6) return false
      var hour = d.getUTCHours() + d.getUTCMinutes() / 60
      return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
    }

    function parseUnit(text) {
      var raw = String(text || '').replace(/[,\s]/g, '')
      var m = raw.match(/([0-9]+(?:\.[0-9]+)?)([kKmMbB])?/)
      if (!m) return null
      var value = parseFloat(m[1])
      if (!Number.isFinite(value)) return null
      var unit = (m[2] || '').toLowerCase()
      if (unit === 'k') value *= 1e3
      else if (unit === 'm') value *= 1e6
      else if (unit === 'b') value *= 1e9
      return value
    }

    function money(n) {
      if (!Number.isFinite(n)) return '—'
      if (n > 0 && n < 0.01) return '¥' + n.toFixed(4)
      return '¥' + n.toFixed(2)
    }

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

    function findCard() {
      var nodes = collectAll(document, [])
      var best = null
      var bestDepth = -1
      for (var i = 0; i < nodes.length; i += 1) {
        var el = nodes[i]
        var tag = (el.tagName || '').toUpperCase()
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA') continue
        var text = (el.textContent || '').replace(/\s+/g, '')
        if (text.indexOf('未缓存输入') === -1) continue
        if (text.indexOf('缓存读取') === -1) continue
        if (text.indexOf('输出') === -1) continue
        if (text.indexOf('用量') === -1) continue
        var depth = 0
        var cursor = el
        while (cursor) {
          depth += 1
          cursor = cursor.parentElement
        }
        if (depth > bestDepth) {
          bestDepth = depth
          best = el
        }
      }
      return best
    }

    function readMetrics(card) {
      var text = String(card.textContent || '').replace(/\s+/g, '')
      function grab(label) {
        var re = new RegExp(label + '([0-9][0-9,.]*)([kKmMbB]?)(?=tok|个|$)')
        var m = text.match(re)
        return m ? parseUnit(m[1] + m[2]) : null
      }
      return {
        read: grab('缓存读取'),
        miss: grab('未缓存输入'),
        write: grab('缓存写入'),
        out: grab('输出'),
      }
    }

    function computeCost(metric) {
      var peak = isPeak(Date.now())
      var slot = peak ? 'peak' : 'offPeak'
      var read = metric.read || 0
      var miss = metric.miss || 0
      var write = metric.write || 0
      var output = metric.out || 0
      var costRead = (read / 1e6) * PRICE.read[slot]
      var costMiss = ((miss + write) / 1e6) * PRICE.miss[slot]
      var costOutput = (output / 1e6) * PRICE.output[slot]
      return { peak: peak, cost: costRead + costMiss + costOutput }
    }

    /** 官方记录里定位当前会话：最近写入、非子代理、有调用。 */
    function currentSessionFromSummary(payload) {
      try {
        var sessions = payload && payload.sessions
        if (!sessions || typeof sessions !== 'object') return null
        var best = null
        for (var key in sessions) {
          if (!Object.prototype.hasOwnProperty.call(sessions, key)) continue
          var item = sessions[key]
          if (!item || !item.calls) continue
          if (item.isSubagent) continue
          var t = Number(item.lastTime) || 0
          if (!best || t > best.lastTime) best = { lastTime: t, item: item }
        }
        return best ? best.item : null
      } catch (error) {
        return null
      }
    }

    function refreshSummary() {
      try {
        if (summaryState.loading) return
        if (Date.now() - summaryState.at < SUMMARY_TTL) return
        summaryState.loading = true
        fetch(SUMMARY_URL, { credentials: 'same-origin' })
          .then(function (response) {
            if (!response || !response.ok) throw new Error('summary http ' + (response && response.status))
            return response.json()
          })
          .then(function (payload) {
            summaryState.payload = payload
            summaryState.failed = false
            summaryState.at = Date.now()
            summaryState.loading = false
            sync()
          })
          .catch(function () {
            summaryState.failed = true
            summaryState.at = Date.now()
            summaryState.loading = false
            sync()
          })
      } catch (error) {
        summaryState.loading = false
      }
    }

    function buildTooltip(official, estimate) {
      var lines = []
      if (official) {
        lines.push('本会话累计（token-mb 官方记录）：' + money(official.cny) + '，' + official.calls + ' 次调用')
        lines.push('  · 缓存命中 ' + (official.hit || 0).toLocaleString() + ' / 未缓存 ' + (official.miss || 0).toLocaleString() + ' / 输出 ' + (official.out || 0).toLocaleString() + ' tok')
        if (official.tier) {
          lines.push('  · 高峰 ¥' + Number(official.tier.peak && official.tier.peak.cny || 0).toFixed(4) + ' / 低谷 ¥' + Number(official.tier.offPeak && official.tier.offPeak.cny || 0).toFixed(4))
        }
        if (official.unpricedCalls) lines.push('  · 其中 ' + official.unpricedCalls + ' 次调用无官方价（不计入金额）')
        if (estimate) lines.push('本轮估算：' + money(estimate.cost) + '（' + (estimate.peak ? '高峰' : '低谷') + '价）')
      } else {
        lines.push('本轮估算（token-mb 不可用）：' + money(estimate.cost) + '，按 ' + (estimate.peak ? '高峰' : '低谷') + '价')
        lines.push('金额为估算，允许与官方账单有几分差异')
      }
      return lines.join('\n')
    }

    function sync() {
      try {
        try { if (window.localStorage.getItem('dsh-inline-cost:disabled') === '1') { removeRow(); return } } catch (e) {}
        var card = findCard()
        window.__inlineCostStatus = { card: !!card, row: !!document.getElementById(ROW_ID), at: Date.now() }
        if (!card) {
          removeRow()
          return
        }
        refreshSummary()
        var official = currentSessionFromSummary(summaryState.payload)
        var metric = readMetrics(card)
        var estimate = metric.out !== null || metric.read !== null || metric.miss !== null ? computeCost(metric) : null
        if (!official && !estimate) return

        var valueText = official ? '≈ ' + money(official.cny) : '≈ ' + money(estimate.cost)
        var row = document.getElementById(ROW_ID)
        if (!row) {
          row = document.createElement('div')
          row.id = ROW_ID
          row.style.cssText =
            'display:flex;justify-content:space-between;gap:18px;padding:4px 0 2px;border-top:1px solid rgba(128,128,128,.25);margin-top:4px;font:inherit;font-size:inherit;color:inherit'
          var labelSpan = document.createElement('span')
          labelSpan.textContent = '花费金额'
          labelSpan.style.opacity = '0.75'
          var valueSpan = document.createElement('span')
          valueSpan.style.fontWeight = '600'
          row.appendChild(labelSpan)
          row.appendChild(valueSpan)
          card.appendChild(row)
        }
        var spans = row.children
        if (spans && spans.length >= 2) {
          if (spans[0].textContent !== '花费金额') spans[0].textContent = '花费金额'
          if (spans[1].textContent !== valueText) spans[1].textContent = valueText
        } else {
          row.textContent = '花费金额 ' + valueText
        }
        var tooltip = buildTooltip(official, estimate)
        if (row.title !== tooltip) row.title = tooltip
      } catch (error) {
        /* 静默降级：绝不影响官方卡片 */
      }
    }

    function removeRow() {
      var row = document.getElementById(ROW_ID)
      if (row && row.parentNode) row.parentNode.removeChild(row)
    }


    // ── 插件配置页（设置 → 输入框花费金额；也出现在插件页）──────────────
    function InlineCostSettings() {
      var revState = React.useState(0)
      var setRev = revState[1]
      var reporter = window.__dshErrorReporter && window.__dshErrorReporter['dsh-plugin-inline-cost']
      var disabled = false
      try { disabled = window.localStorage.getItem('dsh-inline-cost:disabled') === '1' } catch (e) {}
      var items = reporter ? reporter.list() : []
      var box = { padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px', lineHeight: 1.5 }
      var rowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }
      var titleStyle = { fontWeight: 600 }
      var descStyle = { fontSize: '12px', opacity: 0.7 }
      var btnStyle = { fontSize: '12px', padding: '4px 10px', borderRadius: '999px', border: '1px solid rgba(128,128,128,.35)', background: 'transparent', color: 'inherit', cursor: 'pointer' }
      function row(label, desc, checked, onChange, disabledInput) {
        return h('label', { style: rowStyle },
          h('span', null,
            h('div', { style: titleStyle }, label),
            desc ? h('div', { style: descStyle }, desc) : null),
          h('input', { type: 'checkbox', checked: checked, disabled: disabledInput, onChange: function (e) { onChange(e.target.checked) } }))
      }
      return h('div', { style: box },
        h('div', { style: { fontWeight: 600, fontSize: '15px' } }, '输入框花费金额'),
        h('div', { style: descStyle }, '不提供任何「关闭官方组件」的选项；下面开关只影响本插件自己的显示与错误记录。'),
        row('显示「花费金额」行', '关闭后不再向官方用量卡片注入；随时可以再打开。', !disabled, function (on) {
          try { window.localStorage.setItem('dsh-inline-cost:disabled', on ? '0' : '1') } catch (e) {}
          if (window.__inlineCostResync) window.__inlineCostResync()
          setRev(function (n) { return n + 1 })
        }),
        row('启用错误上报', '只记录本插件相关错误，存在浏览器本地，不会自动上传；取消勾选即手动关闭。', reporter ? reporter.isEnabled() : false, function (on) {
          if (reporter) reporter.setEnabled(on)
          setRev(function (n) { return n + 1 })
        }, !reporter),
        h('div', { style: descStyle }, '最近错误：' + items.length + ' 条' + (items.length ? '（最新：' + items[0].m + '）' : '')),
        h('div', { style: descStyle }, (function () {
          var status = window.__inlineCostStatus
          if (!status) return '定位状态：尚未检测（打开一次官方用量卡片后回来查看）'
          return '定位状态：' + (status.card ? '已找到用量卡片' : '未找到用量卡片') + (status.row ? '，已插入花费行' : '，未插入花费行') + '（' + new Date(status.at).toLocaleTimeString() + '）'
        })()),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '2px' } },
          h('button', { type: 'button', style: btnStyle, onClick: function () { if (reporter) reporter.copyText(); setRev(function (n) { return n + 1 }) } }, '复制报告'),
          h('button', { type: 'button', style: btnStyle, onClick: function () { if (reporter) window.open(reporter.issueUrl(), '_blank') } }, '去 GitHub 提 issue'),
          h('button', { type: 'button', style: btnStyle, onClick: function () { if (reporter) reporter.clear(); setRev(function (n) { return n + 1 }) } }, '清空')),
      )
    }

    exports.inject = ['slots']

    exports.apply = function () {
    // 客户端调试 / 错误上报：只记本地，面板可手动关闭
    installErrorReporter({
      id: 'dsh-plugin-inline-cost',
      title: '输入框花费金额',
      version: '0.8.1',
      toggle: { key: 'dsh-inline-cost:disabled', label: '停用「花费金额」显示（可随时再开）', onChange: function () { if (window.__inlineCostResync) window.__inlineCostResync() } },
    })

      try {
        if (window.__inlineCostInstalled) return
        window.__inlineCostInstalled = true
        window.__inlineCostResync = sync
        if (!window.__inlineCostTimer) {
          window.__inlineCostTimer = setInterval(sync, 1500)
        }
        var observer = new MutationObserver(function () {
          sync()
        })
        observer.observe(document.body, { childList: true, subtree: true })
        sync()
      } catch (error) {
        /* ignore */
      }
    }

    return module.exports
  },
})
