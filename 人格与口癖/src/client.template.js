/*!
 * 「人格与口癖」Client 半侧（浏览器）。
 *
 * 手写模块壳（与「更多表情和颜文字」同一套约定）：DSH Web 壳通过 window.__ModuleLoader__ 装载，
 * react 由壳提供，人格预设与频率档位由 tools/build.mjs 内联。
 *
 * 只注册两个扩展点，全部是「设置」里的页面，不接管任何官方槽位：
 *  - settings.section        → 设置页「人格与口癖」
 *  - plugins.bundle.config   → 插件配置页（同一个组件）
 *
 * 读写都走 Host 的 /persona-voice/api：settings（GET/POST）、preview（GET）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-persona-voice',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var h = React.createElement

    var DATA = __PERSONA_JSON__
    var PERSONAS = DATA.PERSONAS || []
    var STYLE_ID = 'dsh-persona-voice-style'
    var API = '/persona-voice/api/settings'
    var PREVIEW = '/persona-voice/api/preview'

    var EMPTY = { enabled: true, personaSource: 'manual', activePersona: 'daughter', emojiFrequency: 'auto', catchphraseEvery: 0, catchphrases: [], customPersonas: [] }

    function ensureStyle() {
      if (document.getElementById(STYLE_ID)) return
      var style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = [
        '.pv-page{padding:4px 0;font-size:13px;line-height:1.6}',
        '.pv-title{font-size:15px;font-weight:600;margin:0 0 6px}',
        '.pv-hint{opacity:.7;margin-bottom:10px}',
        '.pv-section{margin:14px 0 6px;font-weight:600}',
        '.pv-toolbar{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 10px}',
        '.pv-btn{border:1px solid rgba(128,128,128,.35);border-radius:6px;padding:3px 8px;background:transparent;color:inherit;cursor:pointer;font-size:12px}',
        '.pv-btn[data-active="true"]{font-weight:700;border-color:currentColor;text-decoration:underline}',
        '.pv-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0;border-top:1px solid rgba(128,128,128,.15)}',
        '.pv-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(128,128,128,.35);border-radius:999px;padding:2px 8px;margin:2px 6px 2px 0;font-size:12px}',
        '.pv-chip button{border:0;background:transparent;color:inherit;cursor:pointer;font-size:12px}',
        '.pv-input{border:1px solid rgba(128,128,128,.35);border-radius:6px;padding:3px 8px;background:transparent;color:inherit;font-size:12px;min-width:180px}',
        '.pv-pre{white-space:pre-wrap;font-size:12px;border:1px solid rgba(128,128,128,.2);border-radius:6px;padding:8px;margin-top:6px;opacity:.85}',
        '.pv-status{font-size:12px;opacity:.6;margin-top:8px}',
      ].join('\n')
      document.head.appendChild(style)
    }

    function currentPersona(settings) {
      for (var i = 0; i < PERSONAS.length; i += 1) {
        if (PERSONAS[i].id === settings.activePersona) return PERSONAS[i]
      }
      return PERSONAS[0]
    }

    function SettingsPage() {
      var state = React.useState(null)
      var settings = state[0]
      var setSettings = state[1]
      var loadingState = React.useState(true)
      var loading = loadingState[0]
      var setLoading = loadingState[1]
      var draftState = React.useState('')
      var draft = draftState[0]
      var setDraft = draftState[1]
      var statusState = React.useState('')
      var status = statusState[0]
      var setStatus = statusState[1]
      var previewState = React.useState('')
      var preview = previewState[0]
      var setPreview = previewState[1]

      React.useEffect(function () {
        fetch(API, { credentials: 'same-origin' })
          .then(function (response) { return response.json() })
          .then(function (body) {
            setSettings(body && body.settings ? body.settings : EMPTY)
            setLoading(false)
            return fetch(PREVIEW, { credentials: 'same-origin' })
          })
          .then(function (response) { return response.json() })
          .then(function (body) { if (body && body.text) setPreview(body.text) })
          .catch(function (error) { setStatus('读取失败：' + String(error)); setLoading(false) })
      }, [])

      function save(patch) {
        var next = Object.assign({}, settings, patch)
        setSettings(next)
        fetch(API, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        })
          .then(function (response) { return response.json() })
          .then(function (body) {
            if (body && body.settings) setSettings(body.settings)
            setStatus(body && body.persisted === false ? '已生效，但写入磁盘失败（重启会丢）' : '已保存')
            return fetch(PREVIEW, { credentials: 'same-origin' })
          })
          .then(function (response) { return response.json() })
          .then(function (body) { if (body && body.text) setPreview(body.text) })
          .catch(function (error) { setStatus('保存失败：' + String(error)) })
      }

      function addCatchphrase() {
        var text = String(draft || '').trim().slice(0, 24)
        if (!text) return
        var list = (settings.catchphrases || []).filter(function (item) { return item.text !== text })
        list.push({ text: text, mode: 'any', every: 3 })
        setDraft('')
        save({ catchphrases: list })
      }

      function removeCatchphrase(text) {
        save({ catchphrases: (settings.catchphrases || []).filter(function (item) { return item.text !== text }) })
      }

      if (loading || !settings) {
        return h('div', { className: 'pv-page' }, h('div', { className: 'pv-hint' }, '正在读取人格设置…'))
      }

      var persona = currentPersona(settings)
      var emojiOptions = [
        { id: 'auto', label: '跟随人格' },
        { id: 'off', label: '关闭' },
        { id: 'low', label: '少（1）' },
        { id: 'normal', label: '正常（3）' },
        { id: 'high', label: '多（6）' },
      ]
      var everyOptions = [
        { id: 0, label: '跟随人格' },
        { id: 2, label: '每 2 条' },
        { id: 3, label: '每 3 条' },
        { id: 5, label: '每 5 条' },
        { id: 8, label: '每 8 条' },
      ]

      return h(
        'div',
        { className: 'pv-page' },
        h('div', { className: 'pv-title' }, '人格与口癖'),
        h(
          'div',
          { className: 'pv-hint' },
          '只约束表达方式（人格、口癖、表情频率），不改变事实与结论。设置同时作用于系统提示与预览。',
        ),
        h(
          'div',
          { className: 'pv-row' },
          h('div', null, '启用'),
          h('input', {
            type: 'checkbox',
            checked: settings.enabled !== false,
            onChange: function (event) { save({ enabled: event.target.checked }) },
          }),
        ),
        h('div', { className: 'pv-section' }, '性格（' + persona.name + '）'),
        h(
          'div',
          { className: 'pv-toolbar' },
          PERSONAS.map(function (item) {
            return h(
              'button',
              {
                key: item.id,
                type: 'button',
                className: 'pv-btn',
                'data-active': String(settings.activePersona === item.id && settings.personaSource !== 'off'),
                title: item.guide,
                onClick: function () { save({ personaSource: 'manual', activePersona: item.id }) },
              },
              item.name,
            )
          }),
          h(
            'button',
            {
              type: 'button',
              className: 'pv-btn',
              'data-active': String(settings.personaSource === 'off'),
              onClick: function () { save({ personaSource: 'off' }) },
            },
            '关闭人格',
          ),
        ),
        h('div', { className: 'pv-section' }, '表情频率'),
        h(
          'div',
          { className: 'pv-toolbar' },
          emojiOptions.map(function (option) {
            return h(
              'button',
              {
                key: option.id,
                type: 'button',
                className: 'pv-btn',
                'data-active': String((settings.emojiFrequency || 'auto') === option.id),
                onClick: function () { save({ emojiFrequency: option.id }) },
              },
              option.label,
            )
          }),
        ),
        h('div', { className: 'pv-section' }, '口癖频率'),
        h(
          'div',
          { className: 'pv-toolbar' },
          everyOptions.map(function (option) {
            return h(
              'button',
              {
                key: String(option.id),
                type: 'button',
                className: 'pv-btn',
                'data-active': String(Number(settings.catchphraseEvery || 0) === option.id),
                onClick: function () { save({ catchphraseEvery: option.id }) },
              },
              option.label,
            )
          }),
        ),
        h('div', { className: 'pv-section' }, '口癖（留空 = 用人格默认）'),
        h(
          'div',
          { className: 'pv-toolbar' },
          (settings.catchphrases || []).length === 0
            ? h('span', { className: 'pv-hint' }, '当前用「' + persona.name + '」的默认口癖。')
            : (settings.catchphrases || []).map(function (item) {
                return h(
                  'span',
                  { key: item.text, className: 'pv-chip' },
                  h('span', null, item.text),
                  h('button', { type: 'button', title: '删除', onClick: function () { removeCatchphrase(item.text) } }, '×'),
                )
              }),
        ),
        h(
          'div',
          { className: 'pv-toolbar' },
          h('input', {
            className: 'pv-input',
            placeholder: '例如：喵～ / 哥哥 / 的说',
            value: draft,
            maxLength: 24,
            onChange: function (event) { setDraft(event.target.value) },
            onKeyDown: function (event) { if (event.key === 'Enter') { event.preventDefault(); addCatchphrase() } },
          }),
          h('button', { type: 'button', className: 'pv-btn', onClick: addCatchphrase }, '添加'),
        ),
        h('div', { className: 'pv-section' }, '当前注入到系统提示的内容'),
        h('div', { className: 'pv-pre' }, preview || '（预览为空）'),
        h('div', { className: 'pv-status' }, status),
      )
    }

    exports.inject = ['slots']

    exports.apply = function (ctx) {
      function guard(label, fn) {
        try {
          return fn()
        } catch (error) {
          try { console.warn('[persona-voice] ' + label + ' 注册失败（已跳过）', error) } catch (ignored) { /* ignore */ }
          return undefined
        }
      }

      guard('样式', function () { ensureStyle() })

      function registerSlot(slotName, options, component) {
        guard(slotName, function () {
          ctx.slots.inject(slotName, function () {
            return guard(slotName + ' register', function () {
              return ctx.slots.register(options, component)
            })
          })
        })
      }

      registerSlot(
        'settings.section',
        { name: 'settings.section', id: 'persona-voice-settings', order: 57, label: '人格与口癖' },
        function () { return h(SettingsPage) },
      )
      registerSlot(
        'plugins.bundle.config',
        { key: 'dsh-plugin-persona-voice' },
        function (props) { return h(SettingsPage, props) },
      )
    }

    return module.exports
  },
})
