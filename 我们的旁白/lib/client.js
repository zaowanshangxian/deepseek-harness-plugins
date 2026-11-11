/*!
 * 「进度旁白（简）」Client 半（浏览器）。
 *
 * 手写模块壳，和本仓库其它插件同一套约定：DSH Web 壳通过 window.__ModuleLoader__ 装载，
 * `react` 由壳提供。本文件只注册一个设置页，不接管任何官方槽位：
 *   settings.section      → 设置页「进度旁白（简）」
 *   plugins.bundle.config → 插件配置页（同一个组件）
 *
 * 模块契约：`factory(require)` 的返回值当 cordis 插件挂载，ctx 只从 `exports.apply(ctx)` 进来，
 * 依赖写在 `exports.inject` 里。**不要**在 factory 体里直接用 ctx —— 那是未定义的自由变量，
 * 报错还会被下面的 guard() 吞掉，表现就是设置页悄无声息地不出现。
 *
 * 读写都走宿主半的 /narrator-lite/api/config（GET / POST）。
 * 拿不到路由就只显示一句提示，不抛错、不阻塞设置页其它区块。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-narrator-lite',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var h = React.createElement

    var API = '/narrator-lite/api/config'
    var STYLE_ID = 'dsh-narrator-lite-style'
    var EMPTY = { enabled: true, silentSeconds: 90, cooldownSeconds: 120, maxPerTurn: 4 }

    /** 把样式插进 <head>，返回刚插进去的节点；已经存在就返回 null（别人的节点我们不负责清）。 */
    function ensureStyle() {
      if (document.getElementById(STYLE_ID)) return null
      var style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = [
        '.nl-page{padding:2px 0}',
        '.nl-title{font-size:14px;font-weight:600;margin-bottom:6px}',
        '.nl-hint{opacity:.7;margin-bottom:10px;font-size:12px;line-height:1.6}',
        '.nl-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid rgba(128,128,128,.15)}',
        '.nl-row label{font-size:13px}',
        '.nl-row .nl-sub{font-size:12px;opacity:.6;margin-top:2px}',
        '.nl-input{width:96px;border:1px solid rgba(128,128,128,.35);border-radius:6px;padding:3px 8px;background:transparent;color:inherit;font-size:13px;text-align:right}',
        '.nl-btn{border:1px solid rgba(128,128,128,.35);border-radius:6px;padding:3px 10px;background:transparent;color:inherit;cursor:pointer;font-size:12px}',
        '.nl-status{font-size:12px;opacity:.6;margin-top:8px;min-height:16px}',
        '.nl-warn{font-size:12px;color:#c76a00;background:rgba(199,106,0,.08);border-radius:6px;padding:6px 8px;margin-bottom:8px;line-height:1.6}',
      ].join('\n')
      document.head.appendChild(style)
      return style
    }

    /** `String(error)` 会带出 `Error: ` 前缀，状态栏里不想要那个前缀。 */
    function describeError(error) {
      if (error !== null && typeof error === 'object' && typeof error.message === 'string' && error.message !== '') {
        return error.message
      }
      return String(error)
    }

    /** 把宿主返回的 config 折成设置页的状态形状（缺字段补默认值）。 */
    function toPageSettings(values) {
      var source = values !== null && typeof values === 'object' ? values : {}
      return {
        enabled: source.enabled !== false,
        silentSeconds: source.silentSeconds || EMPTY.silentSeconds,
        cooldownSeconds: source.cooldownSeconds === 0 ? 0 : (source.cooldownSeconds || EMPTY.cooldownSeconds),
        maxPerTurn: typeof source.maxPerTurn === 'number' ? source.maxPerTurn : EMPTY.maxPerTurn,
        // 读不到现有配置时，上面那几个值是「默认值」而不是用户存过的东西：
        // 必须让用户看见这句话，而且不能在界面上装作能存。
        configWritable: source.configWritable !== false,
        configNote: typeof source.configNote === 'string' && source.configNote !== '' ? source.configNote : null,
      }
    }

    function SettingsPage() {
      var state = React.useState(null)
      var settings = state[0]
      var setSettings = state[1]
      var loadingState = React.useState(true)
      var loading = loadingState[0]
      var setLoading = loadingState[1]
      var statusState = React.useState('')
      var status = statusState[0]
      var setStatus = statusState[1]
      var saveSeqRef = React.useRef(0)

      function loadConfig() {
        setLoading(true)
        setStatus('')
        fetch(API, { credentials: 'same-origin' })
          .then(function (response) {
            // 403/500 的响应体里没有 config：以前直接回落成 EMPTY 当成真实设置渲染，
            // 用户会以为自己的配置没存上，于是又去改一遍。错误要让人看见。
            if (!response.ok) throw new Error('HTTP ' + response.status)
            return response.json()
          })
          .then(function (body) {
            if (body === null || typeof body !== 'object' || body.config === null || typeof body.config !== 'object') {
              throw new Error('响应里没有 config')
            }
            setSettings(toPageSettings(body.config))
            setLoading(false)
          })
          .catch(function (error) {
            setStatus('读取失败：' + describeError(error))
            setLoading(false)
          })
      }

      React.useEffect(loadConfig, [])

      function save(patch) {
        var previous = settings
        var next = Object.assign({}, settings, patch)
        // 数字框是「失焦即保存」，连着改两下会有两个请求在飞：只认最后一次的结果，
        // 否则先失败的那次会把后一次的值回滚掉。
        var seq = saveSeqRef.current + 1
        saveSeqRef.current = seq
        setSettings(next)
        setStatus('保存中…')
        fetch(API, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        })
          .then(function (response) {
            // 失败响应的 body 里带 error 说明（403 是 {ok:false,error:'forbidden'}），
            // 读不出来就只剩状态码，不能因为 parse 失败把这次当成成功。
            return response
              .json()
              .catch(function () { return null })
              .then(function (body) { return { ok: response.ok, status: response.status, body: body } })
          })
          .then(function (result) {
            if (seq !== saveSeqRef.current) return
            var body = result.body
            // 以前只看 persisted === false：403 的 body 没有 persisted，于是失败被显示成「已保存」
            if (!result.ok || (body !== null && typeof body === 'object' && body.ok === false)) {
              // 宿主会带一句人话说明（message），没有就退回错误码，再没有就只能报状态码
              var reason = body && body.message
                ? String(body.message)
                : (body && body.error ? String(body.error) : ('HTTP ' + result.status))
              setSettings(previous)
              setStatus('保存失败：' + reason)
              return
            }
            if (body && body.config) setSettings(toPageSettings(body.config))
            setStatus(body && body.persisted === false ? '已生效，但写盘失败（重启会丢）' : '已保存')
          })
          .catch(function (error) {
            if (seq !== saveSeqRef.current) return
            setSettings(previous)
            setStatus('保存失败：' + describeError(error))
          })
      }

      function numberRow(label, sub, key, min, max) {
        return h(
          'div',
          { className: 'nl-row', key: key },
          h('div', null, h('label', null, label), h('div', { className: 'nl-sub' }, sub)),
          h('input', {
            className: 'nl-input',
            type: 'number',
            min: min,
            max: max,
            step: 10,
            defaultValue: settings[key],
            // 配置不可信时锁住输入：宿主那边也会拒绝写入（409），两头都不许装作能存
            disabled: writable === false,
            key: key + ':' + settings[key],
            onBlur: function (event) {
              var value = Number(event.target.value)
              if (!Number.isFinite(value) || value === settings[key]) return
              save(key === 'silentSeconds'
                ? { silentSeconds: value }
                : { cooldownSeconds: value })
            },
            onKeyDown: function (event) {
              if (event.key === 'Enter') event.target.blur()
            },
          }),
        )
      }

      if (loading || !settings) {
        return h('div', { className: 'nl-page' }, h('div', { className: 'nl-hint' }, status || '正在读取进度旁白设置…'))
      }

      var writable = settings.configWritable !== false

      return h(
        'div',
        { className: 'nl-page' },
        h('div', { className: 'nl-title' }, '进度旁白（简）'),
        h(
          'div',
          { className: 'nl-hint' },
          '模型闷头干活、界面上很久没有正文时，往当前回合里插一句「说清进展」的提示，让它自己开口。'
            + '插话发生在两步之间，不会结束当前回合，也不会取消任务。',
        ),
        settings.configNote === null
          ? null
          : h('div', { className: 'nl-warn' }, settings.configNote),
        h(
          'div',
          { className: 'nl-row' },
          h('div', null, h('label', null, '启用'), h('div', { className: 'nl-sub' }, '关掉后不再计时、不再注入')),
          h('input', {
            type: 'checkbox',
            checked: settings.enabled !== false,
            disabled: writable === false,
            onChange: function (event) { save({ enabled: event.target.checked }) },
          }),
        ),
        numberRow('多久没有正文就提醒一次', '单位秒，10–3600，默认 90', 'silentSeconds', 10, 3600),
        numberRow(
          '两次提醒至少间隔',
          // 两个刹车（冷却、单回合上限）不能一起松：阈值最低 10 秒，0/0 等于每个 step 边界都插一句
          settings.maxPerTurn === 0
            ? '单位秒；单回合不限次时这一项不能设 0（会抬回 ' + EMPTY.cooldownSeconds + '）'
            : '单位秒，0 表示不限，默认 120',
          'cooldownSeconds',
          0,
          3600,
        ),
        h(
          'div',
          { className: 'nl-row' },
          h('div', null, h('label', null, '单个回合最多提醒'), h('div', { className: 'nl-sub' }, '在插件配置里改，0 表示不限')),
          h('span', { className: 'nl-sub' }, String(settings.maxPerTurn === 0 ? '不限' : settings.maxPerTurn + ' 次')),
        ),
        writable === false
          ? h(
              'div',
              { className: 'nl-row' },
              h('div', { className: 'nl-sub' }, '上面这几个值是默认值，不是你存过的设置。'),
              h('button', { className: 'nl-btn', type: 'button', onClick: loadConfig }, '重新读取'),
            )
          : null,
        h('div', { className: 'nl-status' }, status),
      )
    }

    function guard(label, fn) {
      try {
        return fn()
      } catch (error) {
        try {
          console.warn('[narrator-lite] ' + label + ' 注册失败（已跳过）', error)
        } catch (ignored) {
          // console 也可能不可用，忽略
        }
        return undefined
      }
    }

    // 宿主 ClientModuleSystem 的契约：`factory(require)` 的返回值被当成 cordis 插件挂载，
    // ctx 只能从 `exports.apply(ctx)` 进来，依赖写在 `exports.inject` 里。
    // 以前把注册直接写在 factory 体里引用 ctx —— 那是未定义的自由变量，
    // 设置页压根注册不上（而且只抛一条被吞掉的 ReferenceError）。
    exports.inject = ['slots']

    exports.apply = function (ctx) {
      // ---- 样式：挂载时插入、卸载时摘掉，两边都在 effect 里，不留孤儿 <style> ----
      guard('样式 effect', function () {
        ctx.effect(function () {
          var style = ensureStyle()
          return function () {
            if (style === null) return
            try {
              style.remove()
            } catch (ignored) {
              // 卸载期间移除失败不该抛给宿主
            }
          }
        })
      })

      // ---- 两个槽位：register 的返回值就是注销函数，收进 effect 统一注销 ----
      guard('槽位 effect', function () {
        ctx.effect(function () {
          var disposers = []
          var disposed = false

          function registerSlot(slotName, options, component) {
            guard(slotName, function () {
              ctx.slots.inject(slotName, function () {
                // inject 的回调可能延迟到槽位可用时才跑：插件已经卸载就别再注册了
                if (disposed) return undefined
                var off = guard(slotName + ' register', function () {
                  return ctx.slots.register(options, component)
                })
                if (typeof off === 'function') disposers.push(off)
                return off
              })
            })
          }

          registerSlot(
            'settings.section',
            { name: 'settings.section', id: 'narrator-lite-settings', order: 58, label: '进度旁白（简）' },
            function () { return h(SettingsPage) },
          )
          registerSlot(
            'plugins.bundle.config',
            // name 必须写：DSH 的 slots.register 靠 options.name 决定注册到哪个槽位，
            // 少了它就是 slot "undefined" is not declared——只 console.warn，界面看不出异常。
            { name: 'plugins.bundle.config', key: 'dsh-plugin-narrator-lite' },
            function (props) { return h(SettingsPage, props) },
          )

          return function () {
            disposed = true
            for (var index = 0; index < disposers.length; index += 1) {
              try {
                disposers[index]()
              } catch (ignored) {
                // 单个槽位注销失败不影响其它槽位
              }
            }
            disposers.length = 0
          }
        })
      })
    }

    return module.exports
  },
})
