/*!
 * 「Token 用量 + 花费金额」Client 半侧（v0.9.6，真实 DOM 锚点版）。
 *
 * 不接管、不替换、不注册任何官方槽位。官方「Token 用量」卡片打开时，在卡片末尾追加一行「花费金额」：
 *   1. 锚点：官方卡片是 div[role="dialog"][aria-label="Token 用量"]（会话语义）/「Turn usage」（单轮语义），
 *      里面的 <dl> 是 dt/dd 两列网格 —— 我们只往这个 <dl> 追加 <dt>花费金额</dt><dd>≈ ¥x</dd>，
 *      所以样式、列宽、右对齐全部由官方 CSS 继承，不需要自己写样式。
 *   2. 单轮卡片（dl 带 data-turn-usage-details）：读卡片上的「提供方 / 模型」行选价格档
 *      （flash / v4-pro），再按本轮数字 × 峰谷价估算，金额是「本轮」；认不出型号时按 flash 价算，
 *      但悬停里会写明「按 flash 价估」，不假装知道用了哪个模型。
 *   3. 会话卡片：优先取 token-mb 官方记录（GET /token-mb/summary → data.sessions，按会话标题匹配，
 *      取不到就取最近写入的非子代理会话），它按每次调用实际峰谷/模型计价，和官方账单对得上；
 *      取不到时退回按卡片数字估算。
 *   4. 「今日累计」只用 summary 的分天聚合 data.days[今天]；上游没有分天数据时降级成「涉及会话累计」
 *      并改文案说明 —— 会话累计相加不等于当天花费，不假装精确。
 *   5. 卡片关闭即卸载：官方 portal 一移除，追加的 dt/dd 跟着消失；任何异常静默跳过。
 *   6. 生命周期全部挂在一个 effect 上（observer / 两个定时器 / 三个 document 监听），卸载时清干净。
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


    var ROW_DT = 'inline-cost-dt'
    var ROW_DD = 'inline-cost-dd'
    var BALANCE_DT = 'inline-cost-balance-dt'
    var BALANCE_DD = 'inline-cost-balance-dd'
    var TODAY_DT = 'inline-cost-today-dt'
    var TODAY_DD = 'inline-cost-today-dd'
    var TURN_DETAILS_ATTR = 'data-turn-usage-details'

    // token-mb（社区插件 dsh-token-mb）的只读路由：summary 返回 { ok, data: { sessions } }
    var SUMMARY_URLS = ['/token-mb/summary', '/token-meter-panel/summary']
    var SUMMARY_TTL = 30000
    // balance 返回 { ok, data: { supported, ok, balance_infos: [{ currency, total_balance }], total_costs: [...] } }
    var BALANCE_URLS = ['/token-mb/balance', '/token-meter-panel/balance']
    var BALANCE_TTL = 60000

    // 峰谷价（DeepSeek 官方 CNY / 百万 token；与 dsh-token-mb 的 PRICE_TIERS 同口径，2026-09-19 抓取）
    // 注意：官方价目表里**没有「缓存写入」这一档**，token-mb 也不对 cacheWrite 计费 —— 本插件同样不计，
    // 只在悬停里把它的 token 数显示出来（见 computeCost / buildTooltip）。
    var PRICE_TIERS = {
      flash: {
        label: 'deepseek-flash',
        hit: { offPeak: 0.02, peak: 0.04 },
        miss: { offPeak: 1, peak: 2 },
        out: { offPeak: 4, peak: 8 },
      },
      pro: {
        label: 'deepseek-v4-pro',
        hit: { offPeak: 0.15, peak: 0.3 },
        miss: { offPeak: 4.5, peak: 9 },
        out: { offPeak: 13.5, peak: 27 },
      },
    }

    // 只有 DeepSeek 官方路由才真的按 CNY 扣费（token-mb 的 OFFICIAL_PROVIDERS 同口径）；
    // 第三方中转 / 自建端点的 token 折成人民币没有意义，只能在悬停里标注「仅参考」。
    var OFFICIAL_PROVIDERS = ['deepseek-official', 'deepseek-account']

    /** 模型名 → 价格档；认不出返回 null（由调用方决定怎么标注，绝不静默按 flash 算而不说）。 */
    function priceTierOf(model) {
      var name = String(model || '').trim().toLowerCase()
      if (!name) return null
      if (name.indexOf('flash') !== -1) return 'flash'
      if (name.indexOf('pro') !== -1) return 'pro'
      return null
    }

    var summaryState = { at: 0, payload: null, failed: false, loading: false }
    var balanceState = { at: 0, payload: null, failed: false, loading: false }

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

    /** 官方「Token 用量」卡片：role=dialog + aria-label，兼容中英文两种文案。 */
    var DIALOG_LABELS = ['Token 用量', '本轮用量', 'Token usage', 'Turn usage']
    /** 单轮卡片里的「提供方 / 模型」行标签（官方 locale 的中英文写法，空白差异在比较时归一）。 */
    var MODEL_LABELS = ['提供方 / 模型', '提供方/模型', 'Provider / Model', 'Provider/Model']

    function findUsageDialog() {
      // 快路径：卡片是 portal 到 body 的，一次 querySelectorAll 就够（别每个 label 各查一次）
      var dialogs = null
      try { dialogs = document.querySelectorAll('[role="dialog"][aria-label]') } catch (e) {}
      if (dialogs) {
        for (var i = 0; i < dialogs.length; i += 1) {
          var label = dialogs[i].getAttribute('aria-label') || ''
          if (DIALOG_LABELS.indexOf(label) !== -1) return dialogs[i]
        }
      }
      // 慢路径只为兜底 shadow DOM 里的卡片。卡片绝大多数时间是关着的（1.5s 定时器 + 80ms 节流的
      // MutationObserver + 三个事件都会调 sync），所以先花一次 querySelector 确认页面上真有 dialog，
      // 才值得去遍历整个文档（含 shadowRoot）—— 否则等于每 80ms 扫一遍全站 DOM。
      var any = null
      try { any = document.querySelector('[role="dialog"]') } catch (e) {}
      if (!any) return null
      var nodes = collectAll(document, [])
      for (var j = 0; j < nodes.length; j += 1) {
        var el = nodes[j]
        if (!el.getAttribute || el.getAttribute('role') !== 'dialog') continue
        var label2 = el.getAttribute('aria-label') || ''
        if (DIALOG_LABELS.indexOf(label2) !== -1) return el
      }
      return null
    }

    /** 卡片里承载明细的两列网格 <dl>；单轮卡片带 data-turn-usage-details。 */
    function detailsList(dialog) {
      try {
        var turnList = dialog.querySelector('[' + TURN_DETAILS_ATTR + ']')
        if (turnList) return turnList
        var lists = dialog.querySelectorAll('dl')
        for (var i = 0; i < lists.length; i += 1) {
          if (lists[i].querySelector('dt')) return lists[i]
        }
      } catch (e) {}
      return null
    }

    /** 当前会话标题（官方面包屑），用于把 token-mb 记录对上号。 */
    function currentSessionTitle() {
      try {
        var crumbs = document.querySelector('nav[class*="crumbs"] [class*="crumbCurrent"]')
        if (crumbs) return String(crumbs.textContent || '').trim()
      } catch (e) {}
      return ''
    }

    function readMetrics(list) {
      var text = String(list.textContent || '').replace(/\s+/g, '')
      function grab(label) {
        var re = new RegExp(label + '([0-9][0-9,.]*)([kKmMbB]?)(?=tok|个|$|花费)')
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

    /**
     * 从卡片的 dt/dd 里读「提供方 / 模型」行：
     *   { text, provider, model, tier, mixed, official }，没有这一行返回 null。
     * 单轮卡片若一轮里走过多个模型（官方把 routes 用逗号连起来），tier 给 null —— 不拿一个价格套两个模型。
     */
    function readModel(list) {
      try {
        var children = (list && list.children) || []
        for (var i = 0; i + 1 < children.length; i += 1) {
          var dt = children[i]
          if (!dt || String(dt.tagName || '').toUpperCase() !== 'DT') continue
          var label = String(dt.textContent || '').replace(/\s+/g, '')
          var matched = false
          for (var j = 0; j < MODEL_LABELS.length; j += 1) {
            if (label === String(MODEL_LABELS[j]).replace(/\s+/g, '')) { matched = true; break }
          }
          if (!matched) continue
          var raw = String((children[i + 1] && children[i + 1].textContent) || '').trim()
          if (!raw) return null
          var pieces = raw.split(/[,，、]/)
          var provider = ''
          var model = ''
          var mixed = false
          for (var k = 0; k < pieces.length; k += 1) {
            var piece = pieces[k].trim()
            if (!piece) continue
            var slash = piece.indexOf('/')
            var p = slash === -1 ? '' : piece.slice(0, slash).trim()
            var m = slash === -1 ? piece : piece.slice(slash + 1).trim()
            if (!model) { model = m; provider = p }
            else if (m !== model) mixed = true
          }
          return {
            text: raw,
            provider: provider,
            model: model,
            tier: mixed ? null : priceTierOf(model),
            mixed: mixed,
            official: provider ? OFFICIAL_PROVIDERS.indexOf(provider) !== -1 : null,
          }
        }
      } catch (error) {}
      return null
    }

    /**
     * 按本轮 token 估算花费。价格档由调用方从卡片「提供方 / 模型」解析后传入（model.tier）；
     * 认不出来时按 flash 价算，但会带 assumedTier=true，让悬停文案去标注「按 flash 价估」——
     * 不静默用一档价去冒充全部模型（v4-pro 的输出价是 flash 的 3.4 倍）。
     */
    function computeCost(metric, model) {
      var peak = isPeak(Date.now())
      var slot = peak ? 'peak' : 'offPeak'
      var tierKey = (model && model.tier) || 'flash'
      var tier = PRICE_TIERS[tierKey] || PRICE_TIERS.flash
      var read = metric.read || 0
      var miss = metric.miss || 0
      var output = metric.out || 0
      // 缓存写入不计费：官方价目表没有这个档位，token-mb 的 costOf() 也只算 hit/miss/out
      var cost = (read / 1e6) * tier.hit[slot] +
        (miss / 1e6) * tier.miss[slot] +
        (output / 1e6) * tier.out[slot]
      return {
        peak: peak,
        cost: cost,
        tier: tierKey,
        tierLabel: tier.label,
        assumedTier: !(model && model.tier),
        modelLabel: (model && model.text) || '',
        provider: (model && model.provider) || '',
        nonOfficial: !!(model && model.official === false),
        writeTokens: metric.write || 0,
      }
    }

    /** 官方记录里定位当前会话：优先同名标题，其次最近写入的非子代理会话。 */
    function currentSessionFromSummary(payload, title) {
      try {
        var data = payload && (payload.data || payload)
        var sessions = data && data.sessions
        if (!sessions || typeof sessions !== 'object') return null
        var best = null
        var titled = null
        var wanted = String(title || '').trim()
        for (var key in sessions) {
          if (!Object.prototype.hasOwnProperty.call(sessions, key)) continue
          var item = sessions[key]
          if (!item || !item.calls) continue
          if (item.isSubagent) continue
          // 没有可用金额的记录不能拿来当「花费金额」——否则卡片上会出现「≈ —」
          if (!Number.isFinite(Number(item.cny))) continue
          var t = Number(item.lastTime) || 0
          if (wanted && String(item.title || '').trim() === wanted && (!titled || t > titled.lastTime)) {
            titled = { lastTime: t, item: item }
          }
          if (!best || t > best.lastTime) best = { lastTime: t, item: item }
        }
        return (titled || best) ? (titled || best).item : null
      } catch (error) {
        return null
      }
    }

    /** 北京时间 'YYYY-MM-DD'：token-mb 的分天桶就按这个键分（与机器时区解耦）。 */
    function cstDayKey(ms) {
      return new Date((Number(ms) || Date.now()) + 8 * 3600 * 1000).toISOString().slice(0, 10)
    }

    /**
     * 「今天花了多少」。
     *   首选：token-mb 的 data.days[今天] —— 它按每次调用当时的峰谷/模型算好，官方用量接口可用时
     *   直接来自平台用量页，口径就是「当天花费」（source='days'）。
     *   退路（老版本 token-mb 没有 days）：把「最后写入在今天」的会话各自的 cny 相加。这是
     *   **会话累计之和**，跨天会话会把前几天的花费一起带进来，不等于当天花费 —— 所以打上
     *   source='sessions'，由调用方把行名改成「涉及会话累计」并在悬停里说清楚。
     *   shortcut: 上游没有分天数据时只能退化；孪生包 dsh-token-meter-panel 也提供 days 之后删掉这条退路。
     */
    function todayTotal(payload) {
      try {
        var data = payload && (payload.data || payload)
        if (!data) return null
        var meter = String(data.meterSource || '')
        var key = typeof data.today === 'string' && data.today ? data.today : cstDayKey(Date.now())
        var days = data.days
        if (days && typeof days === 'object') {
          var bucket = days[key]
          var dayCny = Number(bucket && bucket.cny)
          if (bucket && Number.isFinite(dayCny)) {
            return {
              source: 'days',
              day: key,
              meter: meter,
              cny: dayCny,
              calls: Number(bucket.calls) || 0,
              hit: Number(bucket.hit) || 0,
              miss: Number(bucket.miss) || 0,
              out: Number(bucket.out) || 0,
              sessions: 0,
            }
          }
          // 上游给了分天数据但没有今天这一桶 → 今天没有花费；不要退回「会话累计」去凑一个数
          if (Object.keys(days).length) return null
        }
        var sessions = data.sessions
        if (!sessions || typeof sessions !== 'object') return null
        // 「今天」按北京时间算，和 token-mb 分天桶的日界保持一致（否则机器时区不在 +08 时两边对不上）
        var from = Date.parse(cstDayKey(Date.now()) + 'T00:00:00+08:00')
        var sum = 0
        var calls = 0
        var count = 0
        var hit = 0
        var miss = 0
        var out = 0
        for (var k in sessions) {
          if (!Object.prototype.hasOwnProperty.call(sessions, k)) continue
          var item = sessions[k]
          if (!item || item.isSubagent) continue
          var t = Number(item.lastTime) || 0
          if (t < from) continue
          var cny = Number(item.cny)
          if (!Number.isFinite(cny)) continue
          sum += cny
          calls += Number(item.calls) || 0
          hit += Number(item.hit) || 0
          miss += Number(item.miss) || 0
          out += Number(item.out) || 0
          count += 1
        }
        if (!count) return null
        return { source: 'sessions', day: cstDayKey(Date.now()), meter: meter, cny: sum, calls: calls, sessions: count, hit: hit, miss: miss, out: out }
      } catch (error) {
        return null
      }
    }

    function removeTodayRow() {
      var ids = [TODAY_DT, TODAY_DD]
      for (var i = 0; i < ids.length; i += 1) {
        var el = document.getElementById(ids[i])
        if (el && el.parentNode) el.parentNode.removeChild(el)
      }
    }

    function refreshSummary() {
      try {
        if (summaryState.loading) return
        if (Date.now() - summaryState.at < SUMMARY_TTL) return
        summaryState.loading = true
        var attempt = function (index) {
          if (index >= SUMMARY_URLS.length) {
            summaryState.failed = true
            summaryState.at = Date.now()
            summaryState.loading = false
            sync()
            return
          }
          fetch(SUMMARY_URLS[index], { credentials: 'same-origin' })
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
              attempt(index + 1)
            })
        }
        attempt(0)
      } catch (error) {
        summaryState.loading = false
      }
    }

    /** 账户余额（DeepSeek 官方账号，经 token-mb /balance 取）。拿不到就返回 null，不显示。 */
    /**
     * 账户余额。数据来自 token-mb 的开源只读路由（MIT，github.com/olimc2016/dsh-token-meter-panel）：
     *   GET {BASE}/balance -> { ok: true, data: { supported, ok, source, is_available,
     *        balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }],
     *        total_costs?: [{ currency, amount }] } }
     * 余额由 token-mb 在宿主侧查官方接口，浏览器只拿聚合数字；字段按上游源码取，不猜。
     * 用户在其设置里关掉 showBalance 时返回 { supported: false, reason: 'disabled' }。
     */
    function balanceOf(payload) {
      try {
        var data = payload && (payload.data || payload)
        if (!data) return null
        if (data.supported === false) return { disabled: true, reason: String(data.reason || '') }
        if (data.ok === false) return null
        var infos = data.balance_infos || []
        var picked = null
        for (var i = 0; i < infos.length; i += 1) {
          var info = infos[i]
          if (!info) continue
          var value = Number(info.total_balance)
          if (!Number.isFinite(value)) continue
          var currency = String(info.currency || 'CNY').toUpperCase()
          if (!picked || currency === 'CNY') picked = { balance: value, currency: currency }
          if (currency === 'CNY') break
        }
        if (!picked) return null
        var spent = null
        var costs = data.total_costs || []
        for (var j = 0; j < costs.length; j += 1) {
          var cost = Number(costs[j] && costs[j].amount)
          if (Number.isFinite(cost)) { spent = cost; break }
        }
        return { balance: picked.balance, currency: picked.currency, spent: spent, source: String(data.source || '') }
      } catch (error) {
        return null
      }
    }

    function refreshBalance() {
      try {
        if (balanceState.loading) return
        if (Date.now() - balanceState.at < BALANCE_TTL) return
        balanceState.loading = true
        var attempt = function (index) {
          if (index >= BALANCE_URLS.length) {
            balanceState.failed = true
            balanceState.at = Date.now()
            balanceState.loading = false
            sync()
            return
          }
          fetch(BALANCE_URLS[index], { credentials: 'same-origin' })
            .then(function (response) {
              if (!response || !response.ok) throw new Error('balance http ' + (response && response.status))
              return response.json()
            })
            .then(function (payload) {
              balanceState.payload = payload
              balanceState.failed = false
              balanceState.at = Date.now()
              balanceState.loading = false
              sync()
            })
            .catch(function () {
              attempt(index + 1)
            })
        }
        attempt(0)
      } catch (error) {
        balanceState.loading = false
      }
    }

    function buildTooltip(official, estimate, scope) {
      var lines = []
      if (official) {
        lines.push('本会话累计（token-mb 官方记录）：' + money(official.cny) + '，' + official.calls + ' 次调用')
        if (official.title) lines.push('  · 会话：' + official.title)
        lines.push('  · 缓存命中 ' + (official.hit || 0).toLocaleString() + ' / 未缓存 ' + (official.miss || 0).toLocaleString() + ' / 输出 ' + (official.out || 0).toLocaleString() + ' tok')
        if (official.tier) {
          lines.push('  · 高峰 ¥' + Number(official.tier.peak && official.tier.peak.cny || 0).toFixed(4) + ' / 低谷 ¥' + Number(official.tier.offPeak && official.tier.offPeak.cny || 0).toFixed(4))
        }
        if (official.unpricedCalls) lines.push('  · 其中 ' + official.unpricedCalls + ' 次调用无官方价（不计入金额）')
        if (estimate) lines.push('合计估算（按当前时段价' + (estimate.assumedTier ? '，型号未知按 flash 价' : '') + '）：' + money(estimate.cost) + '（' + (estimate.peak ? '高峰' : '低谷') + '价）')
      } else if (estimate) {
        // 这一支才是「卡片上显示的数字来自估算」的情况：把估算的假设全部摊开
        lines.push(scope === 'turn'
          ? '本轮估算：' + money(estimate.cost) + '，按 ' + (estimate.peak ? '高峰' : '低谷') + '价'
          : '本会话估算（token-mb 不可用）：' + money(estimate.cost) + '，按 ' + (estimate.peak ? '高峰' : '低谷') + '价')
        var priceLine = '  · 价目：' + estimate.tierLabel + '（' + (estimate.peak ? '高峰' : '低谷') + '价）'
        if (estimate.assumedTier) priceLine += '；卡片上认不出型号，按 flash 价估算，v4-pro 实际可能是这个数的 3 倍以上'
        lines.push(priceLine)
        if (estimate.modelLabel) lines.push('  · 卡片上的模型：' + estimate.modelLabel)
        if (estimate.writeTokens) {
          lines.push('  · 缓存写入 ' + estimate.writeTokens.toLocaleString() + ' tok：官方价目表没有这一档，本估算不计费')
        }
        if (estimate.nonOfficial) {
          lines.push('  · 提供方 ' + estimate.provider + ' 不是 DeepSeek 官方路由，金额只是按公开价参考')
        }
        lines.push('金额为估算，允许与官方账单有几分差异')
      }
      return lines.join('\n')
    }

    function removeRow() {
      var ids = [ROW_DT, ROW_DD, BALANCE_DT, BALANCE_DD, TODAY_DT, TODAY_DD]
      for (var i = 0; i < ids.length; i += 1) {
        var el = document.getElementById(ids[i])
        if (el && el.parentNode) el.parentNode.removeChild(el)
      }
      rowsInserted = false
    }

    function removeBalanceRow() {
      var ids = [BALANCE_DT, BALANCE_DD]
      for (var i = 0; i < ids.length; i += 1) {
        var el = document.getElementById(ids[i])
        if (el && el.parentNode) el.parentNode.removeChild(el)
      }
    }

    // 节流：MutationObserver 在流式输出时每秒会触发几十次；sync 走 querySelector 快路径后很便宜，合并成最多 80ms 一次
    var syncQueued = false
    var lastSyncAt = 0

    function scheduleSync() {
      if (syncQueued) return
      syncQueued = true
      var run = function () {
        syncQueued = false
        var now = Date.now()
        var wait = 80 - (now - lastSyncAt)
        if (wait > 0) {
          setTimeout(run, wait)
          return
        }
        lastSyncAt = Date.now()
        sync()
      }
      try {
        window.requestAnimationFrame(run)
      } catch (error) {
        setTimeout(run, 50)
      }
    }

    function disabledByUser() {
      try { return window.localStorage.getItem('dsh-inline-cost:disabled') === '1' } catch (e) { return false }
    }

    // 有没有插入过行：卡片关着的那些 sync 只花几次 querySelector 就返回，不再 getElementById 六次
    var rowsInserted = false

    /** 写配置页「定位状态」；状态没变就只更新检测时间，避免每次 sync 都新建对象。 */
    function publishStatus(card, row, scope) {
      var prev = window.__inlineCostStatus
      if (prev && prev.card === card && prev.row === row && prev.scope === scope) {
        prev.at = Date.now()
        return prev
      }
      var next = { card: card, row: row, scope: scope, at: Date.now(), balance: !!(prev && prev.balance) }
      window.__inlineCostStatus = next
      return next
    }

    function sync() {
      try {
        if (disabledByUser()) {
          if (rowsInserted) { removeRow(); rowsInserted = false }
          publishStatus(false, false, '')
          return
        }
        var dialog = findUsageDialog()
        var list = dialog ? detailsList(dialog) : null
        if (!list) {
          // 卡片关着（绝大多数 sync 都走到这里）：只做定位就返回，不扫文档、不刷新状态里的时间戳
          if (!rowsInserted) return
          removeRow()
          rowsInserted = false
          publishStatus(false, false, '')
          return
        }
        var perTurn = !!(list.hasAttribute && list.hasAttribute(TURN_DETAILS_ATTR))
        var scope = perTurn ? 'turn' : 'session'
        var metric = readMetrics(list)
        var model = perTurn ? readModel(list) : null
        var estimate = (metric.out !== null || metric.read !== null || metric.miss !== null) ? computeCost(metric, model) : null
        var official = null
        refreshBalance()
        var balance = balanceOf(balanceState.payload)
        // {disabled:true} 是 truthy 的占位对象（上游关了 showBalance），不能直接当「有余额」
        var balanceReady = !!(balance && !balance.disabled)
        if (!perTurn) {
          refreshSummary()
          official = currentSessionFromSummary(summaryState.payload, currentSessionTitle())
        }
        var shown = ''
        if (official && Number.isFinite(Number(official.cny))) shown = money(Number(official.cny))
        else if (estimate) shown = money(estimate.cost)
        if (!shown) {
          // 有卡片但既没有可用官方记录、也没有可估的数字：不写「≈ —」，直接不显示
          if (rowsInserted) { removeRow(); rowsInserted = false }
          publishStatus(true, false, scope)
          return
        }

        var valueText = '≈ ' + shown
        var dt = document.getElementById(ROW_DT)
        var dd = document.getElementById(ROW_DD)
        if (!dt || !dd || dt.parentNode !== list || dd.parentNode !== list) {
          removeRow()
          dt = document.createElement('dt')
          dt.id = ROW_DT
          dt.textContent = '花费金额'
          dd = document.createElement('dd')
          dd.id = ROW_DD
          // 官方 dl 是两列网格，按 dt、dd 顺序追加即自动排版；样式全部继承官方类。
          list.appendChild(dt)
          list.appendChild(dd)
        }
        if (dt.textContent !== '花费金额') dt.textContent = '花费金额'
        if (dd.textContent !== valueText) dd.textContent = valueText
        var tooltip = buildTooltip(official, estimate, scope)
        if (dd.title !== tooltip) dd.title = tooltip

        // 今日累计：只在会话卡片显示（单轮是"这一轮"的口径，不混入当天合计）
        var today = perTurn ? null : todayTotal(summaryState.payload)
        if (today) {
          var byDay = today.source === 'days'
          var todayLabel = byDay ? '今日累计' : '涉及会话累计'
          var tdt = document.getElementById(TODAY_DT)
          var tdd = document.getElementById(TODAY_DD)
          var anchor = document.getElementById(BALANCE_DT)
          if (!tdt || !tdd || tdt.parentNode !== list || tdd.parentNode !== list) {
            removeTodayRow()
            tdt = document.createElement('dt')
            tdt.id = TODAY_DT
            tdt.textContent = todayLabel
            tdd = document.createElement('dd')
            tdd.id = TODAY_DD
            // 插在余额行之前，保证顺序：花费金额 → 今日累计 → 账户余额
            if (anchor && anchor.parentNode === list) {
              list.insertBefore(tdt, anchor)
              list.insertBefore(tdd, anchor)
            } else {
              list.appendChild(tdt)
              list.appendChild(tdd)
            }
          }
          if (tdt.textContent !== todayLabel) tdt.textContent = todayLabel
          var todayText = money(today.cny)
          if (tdd.textContent !== todayText) tdd.textContent = todayText
          var tokenLine = '  缓存命中 ' + (today.hit || 0).toLocaleString() + ' / 未缓存 ' + (today.miss || 0).toLocaleString() + ' / 输出 ' + (today.out || 0).toLocaleString() + ' tok'
          var todayTip = byDay
            ? [
              '今天（北京时间 ' + today.day + '）00:00 起：' + today.calls + ' 次调用',
              '合计 ' + money(today.cny) + '（' + (today.meter === 'official' ? 'DeepSeek 平台用量接口' : 'token-mb 本地日志按次计价') + '）',
              tokenLine,
            ].join('\n')
            : [
              '这是今天有写入的会话各自的本会话累计之和：' + today.sessions + ' 个会话、' + today.calls + ' 次调用',
              '合计 ' + money(today.cny),
              '  当前 token-mb 没有分天数据，跨天会话会把更早的花费一起算进来 —— 不等于今天花了多少',
              tokenLine,
            ].join('\n')
          if (tdd.title !== todayTip) tdd.title = todayTip
        } else {
          removeTodayRow()
        }

        // 账户余额：两张卡片都显示（余额是账号级状态，与「本轮/本会话」口径无关）
        if (balanceReady) {
          var bdt = document.getElementById(BALANCE_DT)
          var bdd = document.getElementById(BALANCE_DD)
          if (!bdt || !bdd || bdt.parentNode !== list || bdd.parentNode !== list) {
            removeBalanceRow()
            bdt = document.createElement('dt')
            bdt.id = BALANCE_DT
            bdt.textContent = '账户余额'
            bdd = document.createElement('dd')
            bdd.id = BALANCE_DD
            list.appendChild(bdt)
            list.appendChild(bdd)
          }
          var balanceText = money(balance.balance)
          if (bdd.textContent !== balanceText) bdd.textContent = balanceText
          var balanceTip = ['DeepSeek 官方账号余额：' + money(balance.balance)]
          if (balance.spent !== null) balanceTip.push('累计消费：' + money(balance.spent))
          balanceTip.push('来源：token-mb /balance（只读）')
          var balanceTitle = balanceTip.join('\n')
          if (bdd.title !== balanceTitle) bdd.title = balanceTitle
        } else {
          removeBalanceRow()
        }
        rowsInserted = true
        var status = publishStatus(true, true, scope)
        status.balance = balanceReady
      } catch (error) {
        /* 静默降级：绝不影响官方卡片 */
      }
    }


    // ── 插件配置页（设置 → 快速显示花费；也出现在插件页）──────────────
    function InlineCostSettings() {
      var revState = React.useState(0)
      var setRev = revState[1]
      var reporter = window.__dshErrorReporter && window.__dshErrorReporter['dsh-plugin-inline-cost']
      var disabled = disabledByUser()
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
        h('div', { style: { fontWeight: 600, fontSize: '15px' } }, '快速显示花费 v0.9.6'),
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
          var scopeText = status.scope === 'turn' ? '单轮卡片' : status.scope === 'session' ? '会话卡片' : '卡片'
          return '定位状态：' + (status.card ? '已找到' + scopeText : '未找到用量卡片') +
            (status.row ? '，已插入花费行' : '，未插入花费行') + '（' + new Date(status.at).toLocaleTimeString() + '）'
        })()),
        h('div', { style: descStyle }, (function () {
          var balance = balanceOf(balanceState.payload)
          if (!balance) return '账户余额：未取到（需要 dsh-token-mb；打开一次用量卡片后回来查看）'
          if (balance.disabled) return '账户余额：已在 dsh-token-mb 设置里关闭（showBalance=false）'
          return '账户余额：' + money(balance.balance) +
            (balance.spent !== null ? '（累计消费 ' + money(balance.spent) + '）' : '')
        })()),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '2px' } },
          h('button', { type: 'button', style: btnStyle, onClick: function () { if (reporter) reporter.copyText(); setRev(function (n) { return n + 1 }) } }, '复制报告'),
          h('button', { type: 'button', style: btnStyle, onClick: function () { if (reporter) window.open(reporter.issueUrl(), '_blank') } }, '去 GitHub 提 issue'),
          h('button', { type: 'button', style: btnStyle, onClick: function () { if (reporter) reporter.clear(); setRev(function (n) { return n + 1 }) } }, '清空')),
      )
    }

    // 这一行注入的是 cordis 服务名（渲染器约定），和 package.json 里的 dsh.client.inject
    // （客户端模块 id：哪些 client 包的代码要先加载）**不是同一个东西**，不要「对齐」成一样：
    // 兄弟插件 dsh-plugin-save-token 同样是 code 里 inject ['slots','locale'] + manifest inject []。
    exports.inject = ['slots']

    /**
     * 装运行时（预热 + 两个定时器 + observer + 三个事件监听），返回清理函数。
     * 清理函数交给 ctx.effect —— 卸载/停用时把定时器、observer、监听全部摘掉，
     * 不再留下「插件已经卸了、每 1.5s 还在扫 DOM」的常驻开销。
     */
    function installRuntime() {
      var disposers = []
      function listen(target, type, handler) {
        if (!target || typeof target.addEventListener !== 'function') return
        try {
          target.addEventListener(type, handler, true)
          disposers.push(function () {
            try { target.removeEventListener(type, handler, true) } catch (e) {}
          })
        } catch (e) {}
      }
      function every(fn, ms) {
        var id = setInterval(fn, ms)
        disposers.push(function () { try { clearInterval(id) } catch (e) {} })
        return id
      }

      // 预热：先把 summary / balance 抓回来，卡片一开就能立刻出数（不用等首次请求）
      try { refreshSummary(); refreshBalance() } catch (e) {}
      every(function () {
        try { refreshSummary(); refreshBalance() } catch (e) {}
      }, 60000)

      window.__inlineCostResync = scheduleSync
      window.__inlineCostSync = sync          // 诊断用：手动跑一次同步
      every(scheduleSync, 1500)

      try {
        var observer = new MutationObserver(function () { scheduleSync() })
        observer.observe(document.body, { childList: true, subtree: true })
        disposers.push(function () { try { observer.disconnect() } catch (e) {} })
      } catch (e) {}

      // 用户点开卡片的那一刻就同步（capture 阶段监听，先于 React 渲染后的下一帧）
      var kick = function () { scheduleSync() }
      listen(document, 'pointerdown', kick)
      listen(document, 'click', kick)
      listen(document, 'keydown', kick)

      sync()

      return function () {
        for (var i = disposers.length - 1; i >= 0; i -= 1) {
          try { disposers[i]() } catch (e) {}
        }
        removeRow()
        if (window.__inlineCostSync === sync) delete window.__inlineCostSync
        if (window.__inlineCostResync === scheduleSync) delete window.__inlineCostResync
      }
    }

    exports.apply = function (ctx) {
      // 客户端调试 / 错误上报：只记本地，面板可手动关闭
      installErrorReporter({
        id: 'dsh-plugin-inline-cost',
        title: '快速显示花费',
        version: '0.9.6',
        toggle: { key: 'dsh-inline-cost:disabled', label: '停用「花费金额」显示（可随时再开）', onChange: function () { if (window.__inlineCostResync) window.__inlineCostResync() } },
      })

      try {
        if (ctx && typeof ctx.effect === 'function') {
          // 宿主支持 effect：装上，并在卸载时收回全部定时器 / observer / 监听
          ctx.effect(function () { return installRuntime() }, 'inline-cost: 用量卡片花费行')
        } else if (!window.__inlineCostInstalled) {
          // 老宿主（或测试替身）没有 effect：退回「只装一次、不回收」，至少不会装两遍
          window.__inlineCostInstalled = true
          installRuntime()
        }
      } catch (error) {
        /* ignore */
      }

      // 插件配置页（设置 → 快速显示花费；也出现在插件页配置）
      try {
        ctx.slots.inject('settings.section', function () {
          return ctx.slots.register(
            { name: 'settings.section', id: 'inline-cost-settings', order: 57, label: '快速显示花费' },
            function () {
              return h(InlineCostSettings)
            },
          )
        })
      } catch (error) {
        try { console.warn('[inline-cost] 配置页注册失败（不影响花费行）', error) } catch (ignored) {}
      }
    }

    // 单元测试窗口：把纯函数（不碰 DOM 的那几个）露出来给 tools/regress.mjs 直接断言。
    // 运行时没人读它；放在这里是为了让「今日口径 / 分档价 / 余额禁用 / 会话选价」能被离线测到，
    // 而不是只能靠真浏览器点一遍。
    exports.__internals = {
      PRICE_TIERS: PRICE_TIERS,
      isPeak: isPeak,
      parseUnit: parseUnit,
      money: money,
      priceTierOf: priceTierOf,
      readModel: readModel,
      computeCost: computeCost,
      currentSessionFromSummary: currentSessionFromSummary,
      todayTotal: todayTotal,
      cstDayKey: cstDayKey,
      balanceOf: balanceOf,
    }

    return module.exports
  },
})
