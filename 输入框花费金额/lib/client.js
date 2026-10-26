/*!
 * 「Token 用量 + 花费金额」Client 半侧（v0.3）。
 *
 * 注册到 conversation.composer.dock 的官方「usage」格子（复用 id 即替换该格子），
 * 外观/行为照官方用量条：平时只显示「X tok · 缓存命中 Y%」，点开弹层显示
 * 本轮用量 / 缓存命中 / 未缓存输入 / 缓存读取 / 缓存写入 / 输出，
 * 并在最后追加一列「花费金额」。不新增常驻行、不重复统计。
 *
 * 数据：官方投影 useProjection('tokenUsage')
 *   { uncachedInputTokens, cacheReadTokens, cacheWriteTokens, outputTokens }
 * 金额：DeepSeek CNY/百万 token 峰谷价（与 dsh-token-mb 同口径）：
 *   flash：缓存命中 0.02/0.04，未缓存 1/2，输出 4/8（低谷/高峰）
 *   pro  ：缓存命中 0.15/0.3，未缓存 4.5/9，输出 13.5/27
 *   高峰=北京时间 周一至周五 9-12、14-18；金额为估算，允许与账单几分差异。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-inline-cost',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var h = React.createElement

    var PRICE = {
      flash: {
        cacheHit: { offPeak: 0.02, peak: 0.04 },
        cacheMiss: { offPeak: 1, peak: 2 },
        output: { offPeak: 4, peak: 8 },
      },
      pro: {
        cacheHit: { offPeak: 0.15, peak: 0.3 },
        cacheMiss: { offPeak: 4.5, peak: 9 },
        output: { offPeak: 13.5, peak: 27 },
      },
    }

    function num(value) {
      var n = Number(value)
      return Number.isFinite(n) ? n : 0
    }

    function isPeak(nowMs) {
      var d = new Date(nowMs + 8 * 3600 * 1000)
      var dow = d.getUTCDay()
      if (dow === 0 || dow === 6) return false
      var hour = d.getUTCHours() + d.getUTCMinutes() / 60
      return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
    }

    function tokensText(n) {
      if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
      if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
      return String(Math.round(n))
    }

    function countText(n) {
      return Math.round(n).toLocaleString('en-US')
    }

    function money(n) {
      if (!Number.isFinite(n)) return '—'
      if (n > 0 && n < 0.01) return '¥' + n.toFixed(4)
      return '¥' + n.toFixed(2)
    }

    function readUsage(props) {
      try {
        if (!props || typeof props.useProjection !== 'function') return null
        var value = props.useProjection('tokenUsage')
        return value && typeof value === 'object' ? value : null
      } catch (error) {
        return null
      }
    }

    function measure(usage) {
      if (!usage) return null
      var uncached = num(usage.uncachedInputTokens)
      var read = num(usage.cacheReadTokens)
      var write = num(usage.cacheWriteTokens)
      var output = num(usage.outputTokens)
      var total = uncached + read + write + output
      var hitPct = read + uncached > 0 ? (read / (read + uncached)) * 100 : 0
      var peak = isPeak(Date.now())
      var tier = PRICE.flash
      var slot = peak ? 'peak' : 'offPeak'
      var costRead = (read / 1e6) * tier.cacheHit[slot]
      var costMiss = ((uncached + write) / 1e6) * tier.cacheMiss[slot]
      var costOutput = (output / 1e6) * tier.output[slot]
      return {
        uncached: uncached,
        read: read,
        write: write,
        output: output,
        total: total,
        hitPct: hitPct,
        peak: peak,
        cost: costRead + costMiss + costOutput,
        costRead: costRead,
        costMiss: costMiss,
        costOutput: costOutput,
      }
    }

    var S = {
      strip: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        background: 'transparent',
        border: 'none',
        padding: '2px 4px',
        borderRadius: '6px',
        font: 'inherit',
        fontSize: '12px',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
      },
      popover: {
        position: 'fixed',
        zIndex: 2147483000,
        minWidth: '320px',
        maxWidth: '420px',
        background: 'var(--dsw-alias-bg-elevated, #fff)',
        color: 'var(--dsw-alias-label-primary, #111)',
        border: '1px solid var(--dsw-alias-border-subtle, rgba(0,0,0,.1))',
        borderRadius: '12px',
        boxShadow: '0 10px 30px rgba(0,0,0,.18)',
        padding: '12px 14px',
        fontSize: '13px',
      },
      title: { fontWeight: 600, marginBottom: '8px' },
      row: { display: 'flex', justifyContent: 'space-between', gap: '18px', padding: '3px 0' },
      label: { color: 'var(--dsw-alias-label-secondary)' },
      value: { fontVariantNumeric: 'tabular-nums' },
      costRow: {
        display: 'flex',
        justifyContent: 'space-between',
        gap: '18px',
        marginTop: '8px',
        paddingTop: '8px',
        borderTop: '1px solid var(--dsw-alias-border-subtle, rgba(0,0,0,.08))',
      },
      costValue: { color: 'var(--dsw-alias-brand-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
      hint: { marginTop: '8px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' },
    }

    function UsageStrip(props) {
      var usage = readUsage(props)
      var m = measure(usage)
      var openState = React.useState(false)
      var open = openState[0]
      var setOpen = openState[1]
      var anchorState = React.useState(null)
      var anchor = anchorState[0]
      var setAnchor = anchorState[1]
      var rootRef = React.useRef(null)

      React.useEffect(
        function () {
          if (!open) return undefined
          function close(event) {
            if (rootRef.current && rootRef.current.contains(event.target)) return
            setOpen(false)
          }
          document.addEventListener('mousedown', close, true)
          return function () {
            document.removeEventListener('mousedown', close, true)
          }
        },
        [open],
      )

      function toggle() {
        var el = rootRef.current
        var rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null
        setAnchor(rect)
        setOpen(!open)
      }

      var label = m ? tokensText(m.total) + ' tok · 缓存命中 ' + m.hitPct.toFixed(0) + '%' : '用量 —'

      var popover = null
      if (open && m && anchor) {
        var top = window.innerHeight - anchor.top + 8
        var right = Math.max(8, window.innerWidth - anchor.right)
        popover = h(
          'div',
          { style: Object.assign({}, S.popover, { bottom: top + 'px', right: right + 'px' }) },
          h('div', { style: S.title }, 'Token 用量'),
          h('div', { style: S.row }, h('span', { style: S.label }, '本轮用量'), h('span', { style: S.value }, countText(m.total) + ' tok')),
          h('div', { style: S.row }, h('span', { style: S.label }, '缓存命中'), h('span', { style: S.value }, m.hitPct.toFixed(1) + '%')),
          h('div', { style: S.row }, h('span', { style: S.label }, '未缓存输入'), h('span', { style: S.value }, countText(m.uncached) + ' tok')),
          h('div', { style: S.row }, h('span', { style: S.label }, '缓存读取'), h('span', { style: S.value }, countText(m.read) + ' tok')),
          h('div', { style: S.row }, h('span', { style: S.label }, '缓存写入'), h('span', { style: S.value }, countText(m.write) + ' tok')),
          h('div', { style: S.row }, h('span', { style: S.label }, '输出'), h('span', { style: S.value }, countText(m.output) + ' tok')),
          h(
            'div',
            {
              style: S.costRow,
              title:
                '按当前' +
                (m.peak ? '高峰' : '低谷') +
                '价估算：缓存命中 ' +
                money(m.costRead) +
                ' / 未缓存 ' +
                money(m.costMiss) +
                ' / 输出 ' +
                money(m.costOutput),
            },
            h('span', { style: Object.assign({}, S.label, { fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }) }, '花费金额'),
            h('span', { style: S.costValue }, '≈ ' + money(m.cost)),
          ),
          h('div', { style: S.hint }, '按 DeepSeek-V4.1-Flash 当前' + (m.peak ? '高峰' : '低谷') + '价估算，允许与官方账单有几分差异'),
        )
      }

      return h(
        'div',
        { ref: rootRef, style: { position: 'relative', display: 'inline-flex' } },
        h('button', { type: 'button', style: S.strip, onClick: toggle, title: '查看本轮 token 用量与花费' }, label),
        popover,
      )
    }

    exports.inject = ['slots']

    exports.apply = function (ctx) {
      function guard(label, fn) {
        try {
          return fn()
        } catch (error) {
          try {
            console.warn('[inline-cost] ' + label + ' 失败（已跳过，不影响界面）', error)
          } catch (ignored) {
            /* ignore */
          }
          return undefined
        }
      }

      guard('usage cell', function () {
        ctx.slots.inject('conversation.composer.dock', function () {
          return ctx.slots.register(
            { name: 'conversation.composer.dock', id: 'usage', order: 1 },
            function (props) {
              return h(UsageStrip, props)
            },
          )
        })
      })
    }

    return module.exports
  },
})
