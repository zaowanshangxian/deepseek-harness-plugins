/*!
 * 「输入框花费金额」Client 半侧。
 *
 * 数据来源：官方客户端投影 `useProjection('tokenUsage')`（与官方用量条同源，实时随会话更新），
 * 不扫日志、不额外拉接口。
 *
 * 计价口径：DeepSeek 官方 CNY / 百万 token 峰谷价（与 dsh-token-mb 同口径，2026-09-19 抓取）：
 *   deepseek-flash / v4-flash：缓存命中 0.02/0.04，未缓存输入 1/2，输出 4/8（低谷/高峰）
 *   deepseek-v4-pro          ：缓存命中 0.15/0.3，未缓存输入 4.5/9，输出 13.5/27
 * 高峰：北京时间 周一至周五 9:00-12:00、14:00-18:00；其余为低谷。金额为估算，允许与官方账单几分差异。
 *
 * 失败隔离：投影不可用或注册失败时整块不渲染 / 只跳过，不影响界面。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-inline-cost',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var h = React.createElement

    var PRICE = {
      'deepseek-flash': {
        cacheHit: { offPeak: 0.02, peak: 0.04 },
        cacheMiss: { offPeak: 1, peak: 2 },
        output: { offPeak: 4, peak: 8 },
      },
      'deepseek-v4-pro': {
        cacheHit: { offPeak: 0.15, peak: 0.3 },
        cacheMiss: { offPeak: 4.5, peak: 9 },
        output: { offPeak: 13.5, peak: 27 },
      },
    }
    var DEFAULT_MODEL = 'deepseek-flash'

    function num(value, fallback) {
      var first = Number(value)
      if (Number.isFinite(first)) return first
      var second = Number(fallback)
      return Number.isFinite(second) ? second : 0
    }

    /** 北京时间（UTC+8）峰谷判定，与官方计价一致。 */
    function isPeak(nowMs) {
      var d = new Date(nowMs + 8 * 3600 * 1000)
      var dow = d.getUTCDay()
      if (dow === 0 || dow === 6) return false
      var hour = d.getUTCHours() + d.getUTCMinutes() / 60
      return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
    }

    function modelKey(usage) {
      var raw = String((usage && (usage.model || usage.provider)) || '').toLowerCase()
      if (raw.indexOf('pro') >= 0) return 'deepseek-v4-pro'
      return DEFAULT_MODEL
    }

    function computeCost(usage, nowMs) {
      var u = usage || {}
      var hit = num(u.cacheReadTokens)
      var miss = num(u.uncachedInputTokens, u.inputTokens)
      var cacheWrite = num(u.cacheWriteTokens)
      var out = num(u.outputTokens)
      var key = modelKey(u)
      var tier = PRICE[key] || PRICE[DEFAULT_MODEL]
      var slot = isPeak(nowMs) ? 'peak' : 'offPeak'
      var hitRate = tier.cacheHit[slot]
      var missRate = tier.cacheMiss[slot]
      var outRate = tier.output[slot]
      var costHit = (hit / 1e6) * hitRate
      var costMiss = ((miss + cacheWrite) / 1e6) * missRate
      var costOut = (out / 1e6) * outRate
      return {
        hit: hit,
        miss: miss,
        cacheWrite: cacheWrite,
        out: out,
        peak: slot === 'peak',
        model: key,
        cost: costHit + costMiss + costOut,
        costHit: costHit,
        costMiss: costMiss,
        costOut: costOut,
      }
    }

    function fmtTokens(n) {
      if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
      return String(Math.round(n))
    }

    function money(n) {
      if (n > 0 && n < 0.01) return '¥' + n.toFixed(4)
      return '¥' + n.toFixed(2)
    }

    function InlineCost(props) {
      var usage = null
      try {
        usage = props && typeof props.useProjection === 'function' ? props.useProjection('tokenUsage') : null
      } catch (error) {
        usage = null
      }
      if (!usage || typeof usage !== 'object') return null

      var c = computeCost(usage, Date.now())
      if (c.hit + c.miss + c.cacheWrite + c.out === 0) return null

      var modelLabel = c.model === 'deepseek-v4-pro' ? 'V4-Pro' : 'V4.1-Flash'
      var title = [
        '本会话花费（估算，按 ' + modelLabel + ' 当前' + (c.peak ? '高峰' : '低谷') + '价）',
        '缓存命中 ' + fmtTokens(c.hit) + ' tok ≈ ' + money(c.costHit),
        '未缓存输入 ' + fmtTokens(c.miss) + ' tok ≈ ' + money(c.costMiss),
        c.cacheWrite > 0 ? '缓存写入 ' + fmtTokens(c.cacheWrite) + ' tok' : '',
        '输出 ' + fmtTokens(c.out) + ' tok ≈ ' + money(c.costOut),
        '金额为估算，允许与官方账单有几分差异',
      ]
        .filter(Boolean)
        .join('\n')

      return h(
        'div',
        {
          title: title,
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexWrap: 'wrap',
            padding: '2px 2px 0',
            fontSize: '11px',
            color: 'var(--dsw-alias-label-secondary)',
            cursor: 'default',
          },
        },
        h('span', null, '缓存命中 ' + fmtTokens(c.hit)),
        h('span', null, '未缓存输入 ' + fmtTokens(c.miss)),
        h('span', null, '输出 ' + fmtTokens(c.out)),
        h(
          'span',
          { style: { color: 'var(--dsw-alias-brand-primary)', fontWeight: 600 } },
          '花费 ≈ ' + money(c.cost),
        ),
      )
    }

    exports.inject = ['slots']

    exports.apply = function (ctx) {
      function guard(label, fn) {
        try {
          return fn()
        } catch (error) {
          try {
            console.warn('[inline-cost] ' + label + ' 注册失败（已跳过，不影响界面）', error)
          } catch (ignored) {
            /* ignore */
          }
          return undefined
        }
      }

      guard('composer.dock', function () {
        ctx.slots.inject('conversation.composer.dock', function () {
          return ctx.slots.register(
            { name: 'conversation.composer.dock', id: 'inline-cost', order: 2 },
            function (props) {
              return h(InlineCost, props)
            },
          )
        })
      })
    }

    return module.exports
  },
})
