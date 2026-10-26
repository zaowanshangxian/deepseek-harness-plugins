/*!
 * 「Token 用量 + 花费金额」Client 半侧（v0.4，只读观察版）。
 *
 * 设计原则：**不接管、不替换、不注册任何官方槽位**。
 * 官方「Token 用量」卡片（点开自带用量条才出现）打开后，本插件：
 *   1. 直接在卡片 DOM 里读官方显示的数字（缓存读取/未缓存输入/缓存写入/输出）
 *   2. 在「输出」行后面克隆同样式的一行「花费金额 ≈ ¥x」
 *   3. 卡片关闭时自动移除该行
 *
 * 因此：
 * - 官方组件完全不被修改；任何时候移除本插件都零残留
 * - 不依赖 tokenUsage 投影，金额口径与卡片显示的数字严格一致
 * - 任何异常都静默跳过，不影响官方卡片
 *
 * 计价：DeepSeek 官方 CNY/百万 token 峰谷价（与 dsh-token-mb 同口径，2026-09-19 抓取）：
 *   flash：缓存命中 0.02/0.04，未缓存 1/2，输出 4/8（低谷/高峰）
 *   高峰=北京时间 周一至周五 9-12、14-18；金额为估算，允许与官方账单几分差异。
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

    /** 把卡片上的数字文本解析成 token 数：支持 435,718 / 6,467,892 / 12.3M / 1.2k。 */
    function parseTokens(text) {
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

    /** 找官方「Token 用量」卡片（最深层、含数值行的容器）；找不到返回 null。 */
    function findCard() {
      var nodes = document.querySelectorAll('*')
      var matches = []
      for (var i = 0; i < nodes.length; i += 1) {
        var el = nodes[i]
        var tag = (el.tagName || '').toUpperCase()
        // 排除脚本/样式等文本容器：它们的 textContent 也会包含这些标签字样
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA') continue
        var text = (el.textContent || '').replace(/\s+/g, '')
        if (text.indexOf('未缓存输入') === -1) continue
        if (text.indexOf('缓存读取') === -1) continue
        if (text.indexOf('输出') === -1) continue
        if (text.indexOf('用量') === -1) continue
        matches.push(el)
      }
      // 取最深的匹配（真正的卡片；其祖先也会匹配）
      var best = null
      for (var j = 0; j < matches.length; j += 1) {
        var depth = 0
        var cursor = matches[j]
        while (cursor) {
          depth += 1
          cursor = cursor.parentElement
        }
        if (best === null || depth > best.depth) best = { el: matches[j], depth: depth }
      }
      return best ? best.el : null
    }

    /**
     * 在卡片里按标签找一行：返回 { row, value }。
     * 官方结构是「标签格 + 数值格」的父元素（children >= 2）。
     */
    function readMetric(card, label) {
      var nodes = card.querySelectorAll('*')
      for (var i = 0; i < nodes.length; i += 1) {
        var el = nodes[i]
        if ((el.textContent || '').trim() !== label) continue
        var cursor = el
        for (var depth = 0; depth < 4 && cursor; depth += 1) {
          var parent = cursor.parentElement
          if (!parent || parent === card) break
          if (parent.children.length >= 2) {
            var valueCell = parent.children[parent.children.length - 1]
            var value = parseTokens(valueCell.textContent)
            if (value !== null && valueCell !== cursor) return { row: parent, value: value }
          }
          cursor = parent
        }
      }
      return null
    }

    function computeCost(metric) {
      var peak = isPeak(Date.now())
      var slot = peak ? 'peak' : 'offPeak'
      var read = metric.read ? metric.read.value : 0
      var miss = metric.miss ? metric.miss.value : 0
      var write = metric.write ? metric.write.value : 0
      var output = metric.out ? metric.out.value : 0
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

    function sync() {
      try {
        var card = findCard()
        if (!card) {
          removeRow()
          return
        }
        var metric = {
          read: readMetric(card, '缓存读取'),
          miss: readMetric(card, '未缓存输入'),
          write: readMetric(card, '缓存写入'),
          out: readMetric(card, '输出'),
        }
        if (!metric.out) return
        var cost = computeCost(metric)
        var valueText = '≈ ' + money(cost.cost)
        var row = document.getElementById(ROW_ID)
        if (!row) {
          row = metric.out.row.cloneNode(true)
          row.id = ROW_ID
          metric.out.row.parentNode.insertBefore(row, metric.out.row.nextSibling)
        }
        var cells = row.children
        if (cells && cells.length >= 2) {
          var labelText = '花费金额'
          if (cells[0].textContent !== labelText) cells[0].textContent = labelText
          for (var i = 1; i < cells.length; i += 1) {
            var text = i === 1 ? valueText : ''
            if (cells[i].textContent !== text) cells[i].textContent = text
          }
        } else if (row.textContent !== '花费金额 ' + valueText) {
          row.textContent = '花费金额 ' + valueText
        }
        if (row.title !== buildTitle(cost)) row.title = buildTitle(cost)
      } catch (error) {
        /* 静默降级：绝不影响官方卡片 */
      }
    }

    exports.apply = function () {
      try {
        if (window.__inlineCostInstalled) return
        window.__inlineCostInstalled = true
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
