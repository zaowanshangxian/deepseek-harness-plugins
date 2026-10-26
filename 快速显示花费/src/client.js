/*!
 * 「Token 用量 + 花费金额」Client 半侧（v0.9，真实 DOM 锚点版）。
 *
 * 不接管、不替换、不注册任何官方槽位。官方「Token 用量」卡片打开时，在卡片末尾追加一行「花费金额」：
 *   1. 锚点：官方卡片是 div[role="dialog"][aria-label="Token 用量"]（会话语义）/「Turn usage」（单轮语义），
 *      里面的 <dl> 是 dt/dd 两列网格 —— 我们只往这个 <dl> 追加 <dt>花费金额</dt><dd>≈ ¥x</dd>，
 *      所以样式、列宽、右对齐全部由官方 CSS 继承，不需要自己写样式。
 *   2. 单轮卡片（dl 带 data-turn-usage-details）：用卡片上的本轮数字按峰谷价估算，金额是「本轮」。
 *   3. 会话卡片：优先取 token-mb 官方记录（GET /token-mb/summary → data.sessions，按会话标题匹配，
 *      取不到就取最近写入的非子代理会话），它按每次调用实际峰谷/模型计价，和官方账单对得上；
 *      取不到时退回按卡片数字估算。
 *   4. 卡片关闭即卸载：官方 portal 一移除，追加的 dt/dd 跟着消失；任何异常静默跳过。
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
    var TURN_DETAILS_ATTR = 'data-turn-usage-details'

    // token-mb（社区插件 dsh-token-mb）的只读路由：summary 返回 { ok, data: { sessions } }
    var SUMMARY_URLS = ['/token-mb/summary', '/token-meter-panel/summary']
    var SUMMARY_TTL = 30000
    // balance 返回 { ok, data: { supported, ok, balance_infos: [{ currency, total_balance }], total_costs: [...] } }
    var BALANCE_URLS = ['/token-mb/balance', '/token-meter-panel/balance']
    var BALANCE_TTL = 60000

    var PRICE = {
      read: { offPeak: 0.02, peak: 0.04 },
      miss: { offPeak: 1, peak: 2 },
      output: { offPeak: 4, peak: 8 },
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
    function findUsageDialog() {
      var nodes = collectAll(document, [])
      for (var i = 0; i < nodes.length; i += 1) {
        var el = nodes[i]
        if (!el.getAttribute || el.getAttribute('role') !== 'dialog') continue
        var label = el.getAttribute('aria-label') || ''
        // 官方有两张同名卡片：会话级「Token 用量」、单轮级「本轮用量」（英文都是 Turn usage）
        if (label === 'Token 用量' || label === '本轮用量' || label === 'Token usage' || label === 'Turn usage') return el
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

    function computeCost(metric) {
      var peak = isPeak(Date.now())
      var slot = peak ? 'peak' : 'offPeak'
      var read = metric.read || 0
      var miss = (metric.miss || 0) + (metric.write || 0)
      var output = metric.out || 0
      var costRead = (read / 1e6) * PRICE.read[slot]
      var costMiss = (miss / 1e6) * PRICE.miss[slot]
      var costOutput = (output / 1e6) * PRICE.output[slot]
      return { peak: peak, cost: costRead + costMiss + costOutput }
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
        if (estimate) lines.push('合计估算（按当前时段价）：' + money(estimate.cost) + '（' + (estimate.peak ? '高峰' : '低谷') + '价）')
      } else if (estimate) {
        lines.push(scope === 'turn'
          ? '本轮估算：' + money(estimate.cost) + '，按 ' + (estimate.peak ? '高峰' : '低谷') + '价'
          : '本会话估算（token-mb 不可用）：' + money(estimate.cost) + '，按 ' + (estimate.peak ? '高峰' : '低谷') + '价')
        lines.push('金额为估算，允许与官方账单有几分差异')
      }
      return lines.join('\n')
    }

    function removeRow() {
      var ids = [ROW_DT, ROW_DD, BALANCE_DT, BALANCE_DD]
      for (var i = 0; i < ids.length; i += 1) {
        var el = document.getElementById(ids[i])
        if (el && el.parentNode) el.parentNode.removeChild(el)
      }
    }

    function removeBalanceRow() {
      var ids = [BALANCE_DT, BALANCE_DD]
      for (var i = 0; i < ids.length; i += 1) {
        var el = document.getElementById(ids[i])
        if (el && el.parentNode) el.parentNode.removeChild(el)
      }
    }

    // 节流：MutationObserver 在流式输出时每秒会触发几十次，全文档扫描太贵，合并成最多 400ms 一次
    var syncQueued = false
    var lastSyncAt = 0

    function scheduleSync() {
      if (syncQueued) return
      syncQueued = true
      var run = function () {
        syncQueued = false
        var now = Date.now()
        var wait = 400 - (now - lastSyncAt)
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

    function sync() {
      try {
        if (disabledByUser()) {
          removeRow()
          return
        }
        var dialog = findUsageDialog()
        var list = dialog ? detailsList(dialog) : null
        var perTurn = !!(list && list.hasAttribute && list.hasAttribute(TURN_DETAILS_ATTR))
        window.__inlineCostStatus = {
          card: !!list,
          row: !!document.getElementById(ROW_DT),
          scope: perTurn ? 'turn' : (list ? 'session' : ''),
          at: Date.now(),
        }
        if (!list) {
          removeRow()
          return
        }
        var metric = readMetrics(list)
        var estimate = (metric.out !== null || metric.read !== null || metric.miss !== null) ? computeCost(metric) : null
        var official = null
        var balance = null
        if (!perTurn) {
          refreshSummary()
          refreshBalance()
          official = currentSessionFromSummary(summaryState.payload, currentSessionTitle())
          balance = balanceOf(balanceState.payload)
        }
        if (!official && !estimate) return

        var valueText = official ? '≈ ' + money(official.cny) : '≈ ' + money(estimate.cost)
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
        var tooltip = buildTooltip(official, estimate, perTurn ? 'turn' : 'session')
        if (dd.title !== tooltip) dd.title = tooltip

        // 账户余额（只有会话卡片显示；单轮卡片保持「这一轮」的语义）
        if (!perTurn && balance) {
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
        if (window.__inlineCostStatus) window.__inlineCostStatus.balance = !!balance
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
        h('div', { style: { fontWeight: 600, fontSize: '15px' } }, '快速显示花费'),
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

    exports.inject = ['slots']

    exports.apply = function (ctx) {
      // 客户端调试 / 错误上报：只记本地，面板可手动关闭
      installErrorReporter({
        id: 'dsh-plugin-inline-cost',
        title: '快速显示花费',
        version: '0.9.2',
        toggle: { key: 'dsh-inline-cost:disabled', label: '停用「花费金额」显示（可随时再开）', onChange: function () { if (window.__inlineCostResync) window.__inlineCostResync() } },
      })

      try {
        if (!window.__inlineCostInstalled) {
          window.__inlineCostInstalled = true
          window.__inlineCostResync = scheduleSync
          window.__inlineCostSync = sync          // 诊断用：手动跑一次同步
          if (!window.__inlineCostTimer) {
            window.__inlineCostTimer = setInterval(scheduleSync, 1500)
          }
          var observer = new MutationObserver(function () {
            scheduleSync()
          })
          observer.observe(document.body, { childList: true, subtree: true })
          sync()
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

    return module.exports
  },
})
