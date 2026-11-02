/*!
 * 「工具」Client 半侧（v0.3，独立侧栏面板）。
 *
 * 不再往官方「Token 用量」卡片里塞行——那个卡片本来就挤。改成和 Token 面板一样：
 * 侧栏一个「工具」入口 + 中栏独立面板，两块内容：
 *   1. 工具税：每轮固定注入的工具 schema 有多少 token，按插件归属；
 *   2. 工具账单：近 14 天每个工具调用了多少次、分摊多少 token、分摊多少钱。
 *
 * 数据来自 Host 半（只读）：POST /api/tool-tax/report · POST /api/tool-tax/tools
 * 不接管、不替换任何官方槽位；只注册自己的 sidebar + main。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-tool-tax',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var h = React.createElement

    var BASE = '/api/tool-tax'
    var SLOT_ID = 'tooltax'

    var C = {
      text: 'var(--dsh-text, #1f2328)',
      muted: 'var(--dsh-text-muted, #57606a)',
      line: 'var(--dsh-border, #d0d7de)',
      soft: 'var(--dsh-bg-subtle, #f6f8fa)',
      accent: '#1f6feb',
      warn: '#bf8700',
    }

    function post(path, body) {
      return fetch(BASE + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
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

    function card(title, subtitle, children) {
      return h(
        'section',
        { style: { border: '1px solid ' + C.line, borderRadius: 10, background: '#fff', marginBottom: 18 } },
        h(
          'div',
          { style: { padding: '14px 18px 10px', borderBottom: '1px solid ' + C.line } },
          h('div', { style: { fontSize: 14, fontWeight: 600, color: C.text } }, title),
          subtitle ? h('div', { style: { fontSize: 12, color: C.muted, marginTop: 3 } }, subtitle) : null,
        ),
        h('div', { style: { padding: '6px 18px 14px' } }, children),
      )
    }

    function th(text, align) {
      return h(
        'th',
        {
          style: {
            textAlign: align || 'right',
            padding: '8px 10px',
            borderBottom: '1px solid ' + C.line,
            color: C.muted,
            fontWeight: 600,
            fontSize: 12,
            whiteSpace: 'nowrap',
          },
        },
        text,
      )
    }

    function td(text, align, mono) {
      return h(
        'td',
        {
          style: {
            textAlign: align || 'right',
            padding: '6px 10px',
            borderBottom: '1px solid #eaeef2',
            fontSize: 12.5,
            color: C.text,
            fontFamily: mono ? 'ui-monospace,SFMono-Regular,Menlo,monospace' : undefined,
            whiteSpace: 'nowrap',
          },
        },
        text,
      )
    }

    function ToolPanel() {
      var state = React.useState({ loading: true, report: null, bills: null, error: '' })
      var s = state[0]
      var set = state[1]
      var reloadState = React.useState(0)
      var reload = reloadState[1]

      React.useEffect(
        function () {
          var alive = true
          set(function (prev) { return { ...prev, loading: true, error: '' } })
          Promise.all([post('/report', { force: true }), post('/tools', { force: true })])
            .then(function (values) {
              if (!alive) return
              set({ loading: false, report: values[0], bills: values[1], error: '' })
            })
            .catch(function (error) {
              if (!alive) return
              set({ loading: false, report: null, bills: null, error: String(error && error.message ? error.message : error) })
            })
          return function () { alive = false }
        },
        [reloadState[0]],
      )

      if (s.loading) {
        return h('div', { style: { padding: 28, color: C.muted, fontSize: 13 } }, '读取中…（工具税要扫插件源码，首次约 1 秒）')
      }
      if (s.error) {
        return h(
          'div',
          { style: { padding: 28, color: '#d1242f', fontSize: 13 } },
          '读取失败：' + s.error,
          h('button', {
            onClick: function () { reload(function (n) { return n + 1 }) },
            style: { marginLeft: 12, border: 0, background: C.soft, borderRadius: 6, padding: '4px 10px', cursor: 'pointer' },
          }, '重试'),
        )
      }

      var report = s.report || {}
      var bills = s.bills || {}
      var plugins = report.plugins || []
      var tools = (bills.tools || []).slice(0, 25)

      return h(
        'div',
        { style: { padding: '22px 26px 40px', maxWidth: 1020, margin: '0 auto' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 } },
          h('div', null,
            h('div', { style: { fontSize: 18, fontWeight: 700, color: C.text } }, '工具'),
            h('div', { style: { fontSize: 12, color: C.muted, marginTop: 3 } }, '每轮固定税 · 近 14 天调用与花费 · 只读'),
          ),
          h('button', {
            onClick: function () { reload(function (n) { return n + 1 }) },
            style: { border: '1px solid ' + C.line, background: '#fff', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', color: C.text },
          }, '刷新'),
        ),

        card(
          '工具税（每轮固定注入）',
          '模型每轮请求都要读一遍全部工具的 JSON Schema。这里是它的量，按插件归属。',
          h(
            'div',
            null,
            h('div', { style: { display: 'flex', gap: 26, alignItems: 'baseline', margin: '6px 0 12px' } },
              h('div', null,
                h('div', { style: { fontSize: 26, fontWeight: 700, color: C.accent } }, '≈ ' + fmt(report.totalTokens || 0)),
                h('div', { style: { fontSize: 11.5, color: C.muted } }, 'tokens / 轮'),
              ),
              h('div', { style: { fontSize: 12, color: C.muted } },
                '区间 ' + fmt(report.tokenRange && report.tokenRange[0]) + ' ~ ' + fmt(report.tokenRange && report.tokenRange[1]) +
                ' · 共 ' + (report.toolCount || 0) + ' 个工具 · ' + (report.totalChars || 0) + ' 字符',
              ),
            ),
            plugins.length
              ? h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
                  h('thead', null, h('tr', null, th('插件', 'left'), th('工具数'), th('tokens/轮'), th('占比'))),
                  h('tbody', null, plugins.map(function (p) {
                    return h('tr', { key: p.name },
                      td(p.name, 'left', true),
                      td(String(p.tools)),
                      td(fmt(p.tokens)),
                      td(Math.round((p.tokens / Math.max(1, report.totalTokens || 1)) * 100) + '%'),
                    )
                  })),
                )
              : h('div', { style: { fontSize: 12.5, color: C.muted } }, '没有可归属的第三方工具（或 ctx.tools.schemas() 为空）。'),
            report.unattributed && report.unattributed.tools
              ? h('div', { style: { fontSize: 12, color: C.muted, marginTop: 10 } },
                  '未归属：' + report.unattributed.tools + ' 个工具 / ' + fmt(report.unattributed.tokens) + ' tokens（' + (report.unattributed.names || []).join('、') + '）')
              : null,
            h('div', { style: { fontSize: 11.5, color: C.muted, marginTop: 10, lineHeight: 1.55 } }, report.method || ''),
          ),
        ),

        card(
          '工具账单（近 ' + (bills.windowDays || 14) + ' 天）',
          '会话 ' + (bills.sessionsScanned || 0) + ' 个 · 调用 ' + (bills.totalCalls || 0) + ' 次 · 合计 ' + fmt(bills.totalTokens || 0) + ' tokens / ' + money(bills.totalCny || 0),
          tools.length
            ? h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
                h('thead', null, h('tr', null, th('工具', 'left'), th('调用'), th('tokens'), th('金额'), th('占比'))),
                h('tbody', null, tools.map(function (t) {
                  return h('tr', { key: t.name },
                    td(t.name, 'left', true),
                    td(String(t.calls)),
                    td(fmt(t.tokens)),
                    td(money(t.cny)),
                    td(Math.round((t.share || 0) * 100) + '%'),
                  )
                })),
              )
            : h('div', { style: { fontSize: 12.5, color: C.muted } }, '窗口内没有工具调用记录。'),
          h('div', { style: { fontSize: 11.5, color: C.muted, marginTop: 10, lineHeight: 1.55 } },
            bills.method || 'tool/call 按 (turn,step) 平摊该轮 usage；金额按 DeepSeek 峰谷价（与 dsh-token-mb 同表）。'),
        ),
      )
    }

    function ToolIcon(props) {
      var size = (props && props.size) || 16
      var active = props && props.active
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block' } },
        h('rect', { x: 3, y: 3, width: 7, height: 7, rx: 1.5, stroke: active ? C.accent : 'currentColor', strokeWidth: 1.8 }),
        h('rect', { x: 14, y: 3, width: 7, height: 7, rx: 1.5, stroke: active ? C.accent : 'currentColor', strokeWidth: 1.8 }),
        h('rect', { x: 3, y: 14, width: 7, height: 7, rx: 1.5, stroke: active ? C.accent : 'currentColor', strokeWidth: 1.8 }),
        h('rect', { x: 14, y: 14, width: 7, height: 7, rx: 1.5, stroke: active ? C.accent : 'currentColor', strokeWidth: 1.8 }),
      )
    }

    exports.inject = ['slots']

    exports.apply = function (ctx) {
      try {
        ctx.slots.inject('sidebar.panellist', function () {
          return ctx.slots.register(
            { name: 'sidebar.panellist', id: SLOT_ID, order: 91, label: function () { return '工具' } },
            function (props) { return h(ToolIcon, { size: props && props.size ? props.size : 16, active: props && props.active }) },
          )
        })
      } catch (e) { /* 静默 */ }
      try {
        ctx.slots.inject('main', function () {
          return ctx.slots.register({ name: 'main', key: SLOT_ID }, ToolPanel)
        })
      } catch (e) { /* 静默 */ }
    }

    exports._internal = { ToolPanel: ToolPanel, ToolIcon: ToolIcon, fmt: fmt, money: money }

    return module.exports
  },
})
