/*!
 * 「Token 用量 + 花费金额」Client 半侧（v0.5，纯观察 + 文本解析版）。
 *
 * 不接管、不替换、不注册任何官方槽位。官方「Token 用量」卡片打开后：
 *   1. 直接对卡片 textContent 做正则，读出官方显示的数字（不依赖 DOM 层级结构）
 *   2. 在卡片末尾追加一行「花费金额 ≈ ¥x」
 *   3. 卡片关闭时自动移除该行
 *
 * 容错：任何异常静默跳过；找不到卡片/数字则不显示。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-inline-cost',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    var ROW_ID = 'inline-cost-row'
    var PRICE = {
      read: { offPeak: 0.02, peak: 0.04 },
      miss: { offPeak: 1, peak: 2 },
      output: { offPeak: 4, peak: 8 },
    }

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

    /** 找官方「Token 用量」卡片（最深、排除脚本/样式等文本容器）。 */
    function findCard() {
      var nodes = document.querySelectorAll('*')
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

    /** 从卡片可见文本解析四项数字（不假设 DOM 结构）。 */
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
      return { peak: peak, cost: costRead + costMiss + costOutput, costRead: costRead, costMiss: costMiss, costOutput: costOutput }
    }

    function buildTitle(cost) {
      return (
        '按当前' +
        (cost.peak ? '高峰' : '低谷') +
        '价估算：缓存命中 ' +
        money(cost.costRead) +
        ' / 未缓存 ' +
        money(cost.costMiss) +
        ' / 输出 ' +
        money(cost.costOutput) +
        '\n金额为估算，允许与官方账单有几分差异'
      )
    }

    function removeRow() {
      var row = document.getElementById(ROW_ID)
      if (row && row.parentNode) row.parentNode.removeChild(row)
    }

    function setTitle(text) {
      try {
        if (!window.__inlineCostBaseTitle) window.__inlineCostBaseTitle = document.title || 'DSH'
        var next = 'IC5 ' + text + ' | ' + window.__inlineCostBaseTitle
        if (document.title !== next) document.title = next
      } catch (error) {
        /* ignore */
      }
    }

    function sync() {
      try {
        var card = findCard()
        if (!card) {
          removeRow()
          setTitle('card=0')
          return
        }
        var metric = readMetrics(card)
        var hasEnough = metric.out !== null || metric.read !== null || metric.miss !== null
        setTitle(
          'card=1 out=' +
            (metric.out === null ? 0 : 1) +
            ' read=' +
            (metric.read === null ? 0 : 1) +
            ' text=' +
            String(card.textContent || '').length,
        )
        if (!hasEnough || metric.out === null) return
        var cost = computeCost(metric)
        var valueText = '≈ ' + money(cost.cost)
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
          valueSpan.textContent = valueText
          valueSpan.style.fontWeight = '600'
          row.appendChild(labelSpan)
          row.appendChild(valueSpan)
          card.appendChild(row)
        } else {
          var spans = row.children
          if (spans && spans.length >= 2) {
            if (spans[0].textContent !== '花费金额') spans[0].textContent = '花费金额'
            if (spans[1].textContent !== valueText) spans[1].textContent = valueText
          } else {
            row.textContent = '花费金额 ' + valueText
          }
        }
        row.title = buildTitle(cost)
      } catch (error) {
        /* 静默降级：绝不影响官方卡片 */
      }
    }

    exports.apply = function () {
      try {
        if (window.__inlineCostInstalled) return
        window.__inlineCostInstalled = true
        setTitle('loaded')
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
