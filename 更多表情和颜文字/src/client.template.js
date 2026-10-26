/*!
 * 「更多表情和颜文字」Client 半侧（浏览器）。
 *
 * 手写的模块壳，不走打包器：DSH Web 壳通过 window.__ModuleLoader__ 装载模块，
 * react 由壳的模块表提供（require('react')），内容库与贴纸数据由 tools/build.mjs 内联。
 *
 * 扩展点：
 *  - conversation.input.left    → 输入框左侧的启动按钮（😊）
 *  - conversation.input.overlay → 面板（固定在输入框上方）
 *  - settings.general.item      → 设置→通用 里的「点一下直接发送」勾选项
 *
 * 发送链路（都用 composer 槽位注入的官方 API，不用 DOM 模拟）：
 *  - 文本：captureInsertion() 拿插入令牌 → insertText(text, token)
 *  - 图片贴纸：把 PNG 合成 paste 事件派发给 contenteditable，DSH 自己上传成附件
 *  - 一键发送：以上任一动作后调 submit()
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-more-emoji',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var DATA = __PACKS_JSON__
    var KINDS = DATA.KINDS
    var PACKS = DATA.PACKS
    var STICKERS = DATA.STICKERS || []
    var h = React.createElement

    var STORAGE_FAV = 'dsh-more-emoji:favorites'
    var STORAGE_RECENT = 'dsh-more-emoji:recent'
    var STORAGE_SEND = 'dsh-more-emoji:directSend'
    var RECENT_LIMIT = 40
    var STICKER_PACK_ID = 'sticker'
    var STICKER_PACK_NAME = '图片贴纸'

    // ── 持久化（localStorage，失败就降级为内存态）──────────────────────
    function readJson(key, fallback) {
      try {
        var raw = window.localStorage.getItem(key)
        if (!raw) return fallback
        var parsed = JSON.parse(raw)
        return parsed === null ? fallback : parsed
      } catch (error) {
        return fallback
      }
    }

    function writeJson(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
      } catch (error) {
        /* 隐私模式/配额满时忽略 */
      }
    }

    function readDirectSend() {
      try {
        return window.localStorage.getItem(STORAGE_SEND) === '1'
      } catch (error) {
        return false
      }
    }

    function writeDirectSend(value) {
      try {
        window.localStorage.setItem(STORAGE_SEND, value ? '1' : '0')
      } catch (error) {
        /* ignore */
      }
    }

    function entryKey(entry) {
      return entry.kind + '|' + entry.packId + '|' + entry.item
    }

    function loadEntries(key) {
      var list = readJson(key, [])
      if (!Array.isArray(list)) return []
      return list.filter(function (entry) {
        return entry && typeof entry.kind === 'string' && typeof entry.packId === 'string' && typeof entry.item === 'string'
      })
    }

    function loadFavorites() {
      var map = {}
      loadEntries(STORAGE_FAV).forEach(function (entry) {
        map[entryKey(entry)] = entry
      })
      return map
    }

    // ── 模块级 store（按钮/面板/设置行三个 Slot 共享）───────────────────
    var store = {
      open: false,
      anchor: null,
      tab: 'emoji',
      query: '',
      favorites: loadFavorites(),
      recent: loadEntries(STORAGE_RECENT),
      directSend: readDirectSend(),
      api: null,
      toast: '',
    }
    var listeners = new Set()
    var apiRef = { current: null }

    function setStore(patch) {
      store = Object.assign({}, store, patch)
      listeners.forEach(function (fn) {
        fn()
      })
    }

    function useStore() {
      var state = React.useState(0)
      var force = state[1]
      React.useEffect(function () {
        function onChange() {
          force(function (n) {
            return n + 1
          })
        }
        listeners.add(onChange)
        return function () {
          listeners.delete(onChange)
        }
      }, [])
      return store
    }

    // ── 条目解析 ───────────────────────────────────────────────────────
    var PACK_BY_ID = {}
    PACKS.forEach(function (pack) {
      PACK_BY_ID[pack.id] = pack
    })
    var STICKER_BY_ID = {}
    STICKERS.forEach(function (sticker) {
      STICKER_BY_ID[sticker.id] = sticker
    })

    function kindLabel(id) {
      for (var i = 0; i < KINDS.length; i += 1) {
        if (KINDS[i].id === id) return KINDS[i].label
      }
      if (id === 'sticker') return '贴纸'
      if (id === 'fav') return '收藏'
      if (id === 'recent') return '最近'
      return id
    }

    function isStickerEntry(entry) {
      return entry.kind === 'sticker'
    }

    function entryText(entry) {
      if (isStickerEntry(entry)) {
        var sticker = STICKER_BY_ID[entry.item]
        return sticker ? sticker.caption : entry.item
      }
      return entry.item
    }

    function entryCategory(entry) {
      if (isStickerEntry(entry)) {
        var sticker = STICKER_BY_ID[entry.item]
        return sticker ? '贴纸·' + sticker.group : STICKER_PACK_NAME
      }
      var pack = PACK_BY_ID[entry.packId]
      return pack ? packTitle(pack) : entry.packId
    }

    function packTitle(pack) {
      return kindLabel(pack.kind) + '·' + pack.name
    }

    function toggleFavorite(entry) {
      var key = entryKey(entry)
      var next = Object.assign({}, store.favorites)
      if (next[key]) {
        delete next[key]
      } else {
        next[key] = entry
      }
      writeJson(STORAGE_FAV, Object.keys(next).map(function (k) {
        return next[k]
      }))
      setStore({ favorites: next })
    }

    function pushRecent(entry) {
      var key = entryKey(entry)
      var next = [entry]
      store.recent.forEach(function (item) {
        if (entryKey(item) !== key) next.push(item)
      })
      next = next.slice(0, RECENT_LIMIT)
      writeJson(STORAGE_RECENT, next)
      setStore({ recent: next })
    }

    function setDirectSend(value) {
      writeDirectSend(value)
      setStore({ directSend: value })
    }

    // ── toast ──────────────────────────────────────────────────────────
    function toast(message) {
      var host = document.getElementById('more-emoji-toasts')
      if (!host) {
        host = document.createElement('div')
        host.id = 'more-emoji-toasts'
        document.body.appendChild(host)
      }
      var item = document.createElement('div')
      item.className = 'more-emoji-toast'
      item.textContent = message
      host.appendChild(item)
      window.setTimeout(function () {
        item.classList.add('more-emoji-toast-out')
      }, 1400)
      window.setTimeout(function () {
        if (item.parentNode) item.parentNode.removeChild(item)
      }, 1900)
    }

    // ── 输入框定位 / DOM 兜底插入 ──────────────────────────────────────
    var lastComposer = null

    function composerLike(el) {
      if (!el || el.nodeType !== 1) return false
      if (el.tagName === 'TEXTAREA') return true
      return el.isContentEditable === true
    }

    document.addEventListener(
      'focusin',
      function (event) {
        if (composerLike(event.target)) lastComposer = event.target
      },
      true,
    )

    function isVisible(el) {
      if (!el || !el.isConnected) return false
      var rect = el.getBoundingClientRect()
      return rect.width > 60 && rect.height > 12
    }

    function findComposer() {
      if (lastComposer && isVisible(lastComposer)) return lastComposer
      var nodes = Array.prototype.slice.call(
        document.querySelectorAll('[contenteditable="true"], textarea'),
      )
      var best = null
      var bestArea = 0
      for (var i = 0; i < nodes.length; i += 1) {
        var el = nodes[i]
        if (!isVisible(el)) continue
        var rect = el.getBoundingClientRect()
        var area = rect.width * rect.height
        if (area > bestArea) {
          bestArea = area
          best = el
        }
      }
      return best
    }

    function copyText(text) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text)
          return true
        }
      } catch (error) {
        /* ignore */
      }
      return false
    }

    function domInsert(text) {
      var el = findComposer()
      if (!el) return false
      try {
        el.focus()
      } catch (error) {
        /* ignore */
      }
      if (el.tagName === 'TEXTAREA') {
        var start = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length
        var end = typeof el.selectionEnd === 'number' ? el.selectionEnd : start
        var next = el.value.slice(0, start) + text + el.value.slice(end)
        var descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
        descriptor.set.call(el, next)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      }
      try {
        if (document.execCommand('insertText', false, text)) return true
      } catch (error) {
        /* fall through */
      }
      try {
        var selection = window.getSelection()
        if (!selection || selection.rangeCount === 0) return false
        var range = selection.getRangeAt(0)
        range.deleteContents()
        var node = document.createTextNode(text)
        range.insertNode(node)
        range.setStartAfter(node)
        range.collapse(true)
        selection.removeAllRanges()
        selection.addRange(range)
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
        return true
      } catch (error) {
        return false
      }
    }

    // ── 官方输入 API 封装 ──────────────────────────────────────────────
    function getActions() {
      var api = apiRef.current
      return api && api.actions ? api.actions : null
    }

    function insertTextOfficial(text) {
      var actions = getActions()
      if (!actions || typeof actions.insertText !== 'function') return false
      try {
        var token = typeof actions.captureInsertion === 'function' ? actions.captureInsertion() : undefined
        actions.insertText(text, token)
        return true
      } catch (error) {
        return false
      }
    }

    function submitNow() {
      var actions = getActions()
      if (!actions || typeof actions.submit !== 'function') return false
      try {
        actions.submit()
        return true
      } catch (error) {
        return false
      }
    }

    function attachmentIds() {
      var api = apiRef.current
      var input = api && api.input
      return input && Array.isArray(input.attachmentIds) ? input.attachmentIds.slice() : []
    }

    function waitForNewAttachment(beforeCount, timeoutMs) {
      return new Promise(function (resolve) {
        var deadline = Date.now() + (timeoutMs || 5000)
        ;(function poll() {
          if (attachmentIds().length > beforeCount) {
            resolve(true)
            return
          }
          if (Date.now() > deadline) {
            resolve(false)
            return
          }
          window.setTimeout(poll, 120)
        })()
      })
    }

    function pasteImageFile(file) {
      var editor = findComposer()
      if (!editor) return false
      try {
        editor.focus()
      } catch (error) {
        /* ignore */
      }
      try {
        var dt = new DataTransfer()
        dt.items.add(file)
        var event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
        editor.dispatchEvent(event)
        return true
      } catch (error) {
        return false
      }
    }

    function dataUrlToBlob(dataUrl) {
      var parts = dataUrl.split(',')
      var mime = /:(.*?);/.exec(parts[0])
      var binary = window.atob(parts[1])
      var bytes = new Uint8Array(binary.length)
      for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
      return new Blob([bytes], { type: mime ? mime[1] : 'image/png' })
    }

    // ── 插入 / 发送动作 ────────────────────────────────────────────────
    function doInsert(entry) {
      var text = entryText(entry)
      var official = insertTextOfficial(text)
      if (!official) {
        var ok = domInsert(text)
        if (!ok) {
          toast('没找到输入框，已复制到剪贴板')
          copyText(text)
          return
        }
      }
      pushRecent(entry)
      if (store.directSend) {
        window.setTimeout(function () {
          if (!submitNow()) toast('已插入，发送请按回车')
        }, 120)
        giveFeedback('已发送：' + shortLabel(text))
      } else {
        giveFeedback('已插入：' + shortLabel(text))
      }
    }

    function doSendSticker(entry) {
      var sticker = STICKER_BY_ID[entry.item]
      if (!sticker) return
      var before = attachmentIds().length
      var file = null
      try {
        file = new File([dataUrlToBlob(sticker.dataUrl)], sticker.id + '.png', { type: 'image/png' })
      } catch (error) {
        file = null
      }
      if (!file) {
        pasteStickerFallback(sticker)
        return
      }
      var pasted = pasteImageFile(file)
      if (!pasted) {
        pasteStickerFallback(sticker)
        return
      }
      pushRecent(entry)
      if (!store.directSend) {
        giveFeedback('已贴到输入框：' + sticker.caption)
        return
      }
      waitForNewAttachment(before, 5000).then(function (attached) {
        if (attached && submitNow()) {
          giveFeedback('已发送贴纸：' + sticker.caption)
        } else {
          giveFeedback('已贴到输入框，发送请按回车')
        }
      })
    }

    function pasteStickerFallback(sticker) {
      try {
        var blob = dataUrlToBlob(sticker.dataUrl)
        if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
          navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]).then(
            function () {
              toast('贴纸已复制为图片，Ctrl+V 粘贴即可')
            },
            function () {
              toast('贴纸插入失败，请重试')
            },
          )
          return
        }
      } catch (error) {
        /* ignore */
      }
      toast('贴纸插入失败，请重试')
    }

    function shortLabel(text) {
      return text.length > 12 ? text.slice(0, 12) + '…' : text
    }

    function giveFeedback(message) {
      setStore({ toast: message })
      toast(message)
    }

    // ── 样式（跟随 DSH 主题变量）────────────────────────────────────────
    var STYLE_ID = 'more-emoji-style'
    var CSS = [
      '.more-emoji-launcher{display:inline-flex;align-items:center;justify-content:center;',
      'width:28px;height:28px;border-radius:8px;border:none;background:transparent;',
      'cursor:pointer;font-size:15px;line-height:1;padding:0;transition:background .15s ease,transform .15s ease;',
      'color:var(--dsw-alias-label-primary)}',
      '.more-emoji-launcher:hover{background:var(--dsw-alias-bg-layer-2);transform:translateY(-1px)}',
      '.more-emoji-launcher:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.more-emoji-panel{position:fixed;z-index:2147483000;width:420px;max-width:94vw;',
      'background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);',
      'border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.18),0 2px 8px rgba(0,0,0,.08);',
      'display:flex;flex-direction:column;overflow:hidden;color:var(--dsw-alias-label-primary);',
      'font-size:13px;backdrop-filter:blur(8px)}',
      '.more-emoji-head{display:flex;align-items:center;gap:4px;padding:8px 10px 4px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.more-emoji-tab{border:none;background:transparent;color:var(--dsw-alias-label-secondary);',
      'cursor:pointer;padding:4px 8px;border-radius:8px;font-size:12.5px;line-height:1.4}',
      '.more-emoji-tab:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.more-emoji-tab[data-active="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary);font-weight:600}',
      '.more-emoji-close{margin-left:auto;border:none;background:transparent;color:var(--dsw-alias-label-secondary);',
      'cursor:pointer;width:24px;height:24px;border-radius:6px;font-size:15px;line-height:1;padding:0}',
      '.more-emoji-close:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.more-emoji-subrow{display:flex;align-items:center;gap:6px;padding:6px 10px 2px}',
      '.more-emoji-search{flex:1;min-width:60px;border:1px solid var(--dsw-alias-border-l1);',
      'border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);',
      'font-size:12px;padding:3px 8px;outline:none}',
      '.more-emoji-search:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.more-emoji-pill{border:1px solid var(--dsw-alias-border-l1);background:transparent;',
      'color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:999px;font-size:11.5px;padding:2px 9px;white-space:nowrap}',
      '.more-emoji-pill:hover{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}',
      '.more-emoji-pill[data-active="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);font-weight:600}',
      '.more-emoji-body{overflow-y:auto;overscroll-behavior:contain;padding:6px 8px 10px;max-height:min(46vh,360px)}',
      '.more-emoji-group-title{position:sticky;top:0;z-index:1;padding:4px 2px 3px;font-size:11px;',
      'color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-overlay);letter-spacing:.02em}',
      '.more-emoji-items{display:flex;flex-wrap:wrap;gap:2px;margin-bottom:4px}',
      '.more-emoji-cell{position:relative;display:flex}',
      '.more-emoji-item{border:none;background:transparent;color:var(--dsw-alias-label-primary);',
      'cursor:pointer;border-radius:7px;padding:3px 5px;line-height:1.3;font-family:inherit;text-align:left}',
      '.more-emoji-item:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.more-emoji-item[data-kind="emoji"]{font-size:21px;padding:2px 4px;line-height:1.15}',
      '.more-emoji-item[data-kind="kaomoji"]{font-size:12.5px;font-family:ui-monospace,Consolas,monospace;white-space:nowrap}',
      '.more-emoji-item[data-kind="art"]{font-size:12.5px;font-family:ui-monospace,Consolas,monospace;white-space:pre;padding:4px 6px}',
      '.more-emoji-item[data-kind="phrase"]{font-size:12.5px;border:1px solid var(--dsw-alias-border-l1);margin:1px}',
      '.more-emoji-item[data-kind="sticker"]{padding:2px}',
      '.more-emoji-item[data-kind="sticker"] img{width:56px;height:56px;display:block;border-radius:9px}',
      '.more-emoji-star{position:absolute;top:0;right:0;width:16px;height:16px;border:none;border-radius:50%;',
      'background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;',
      'padding:0;cursor:pointer;opacity:0;transition:opacity .12s ease}',
      '.more-emoji-cell:hover .more-emoji-star{opacity:1}',
      '.more-emoji-star[data-fav="true"]{opacity:1;color:#e8a800}',
      '.more-emoji-star:hover{color:#e8a800}',
      '.more-emoji-empty{padding:26px 10px;text-align:center;color:var(--dsw-alias-label-secondary)}',
      '.more-emoji-foot{display:flex;align-items:center;gap:8px;padding:6px 10px;',
      'border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.more-emoji-foot .grow{flex:1}',
      '.more-emoji-rand{border:1px solid var(--dsw-alias-border-l1);background:transparent;',
      'color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:7px;font-size:11px;padding:2px 8px}',
      '.more-emoji-rand:hover{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}',
      '.more-emoji-switch{display:inline-flex;align-items:center;gap:4px;cursor:pointer;user-select:none}',
      '.more-emoji-switch input{accent-color:var(--dsw-alias-brand-primary);margin:0}',
      '.more-emoji-setting{display:flex;align-items:flex-start;gap:12px;justify-content:space-between;',
      'padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:13px}',
      '.more-emoji-setting-main{min-width:0}',
      '.more-emoji-setting-title{font-weight:550;color:var(--dsw-alias-label-primary)}',
      '.more-emoji-setting-hint{margin-top:2px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.more-emoji-setting-toggle{display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap}',
      '.more-emoji-setting-toggle input{accent-color:var(--dsw-alias-brand-primary);width:16px;height:16px;margin:0}',
      '#more-emoji-toasts{position:fixed;left:50%;bottom:88px;transform:translateX(-50%);z-index:2147483001;',
      'display:flex;flex-direction:column;gap:6px;align-items:center;pointer-events:none}',
      '.more-emoji-toast{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);',
      'border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:5px 12px;font-size:12px;',
      'box-shadow:0 6px 18px rgba(0,0,0,.14);transition:opacity .4s ease,transform .4s ease;opacity:1}',
      '.more-emoji-toast-out{opacity:0;transform:translateY(4px)}',
    ].join('')

    function ensureStyle() {
      if (document.getElementById(STYLE_ID)) return
      var style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      document.head.appendChild(style)
    }

    // ── 列表构建 ───────────────────────────────────────────────────────
    function collectGroups(tab, query) {
      var needle = String(query || '').trim().toLowerCase()
      var groups = []

      if (tab === 'sticker') {
        var byGroup = {}
        STICKERS.forEach(function (sticker) {
          var text = (sticker.caption + ' ' + sticker.group).toLowerCase()
          if (needle !== '' && text.indexOf(needle) === -1) return
          if (!byGroup[sticker.group]) byGroup[sticker.group] = []
          byGroup[sticker.group].push({ sticker: sticker })
        })
        Object.keys(byGroup).forEach(function (group) {
          groups.push({ id: 'sticker-' + group, title: '贴纸·' + group, kind: 'sticker', items: byGroup[group] })
        })
        return groups
      }

      if (tab === 'fav' || tab === 'recent') {
        var list =
          tab === 'fav'
            ? Object.keys(store.favorites).map(function (key) {
                return store.favorites[key]
              })
            : store.recent
        var filtered = list.filter(function (entry) {
          var text = entryText(entry) + ' ' + entryCategory(entry)
          return needle === '' || text.toLowerCase().indexOf(needle) !== -1
        })
        if (filtered.length > 0) {
          groups.push({
            id: tab,
            title: tab === 'fav' ? '收藏（' + filtered.length + '）' : '最近使用（' + filtered.length + '）',
            kind: 'mixed',
            items: filtered,
          })
        }
        return groups
      }

      PACKS.forEach(function (pack) {
        if (pack.kind !== tab) return
        var items = pack.items
        if (needle !== '') {
          items = items.filter(function (item) {
            return item.toLowerCase().indexOf(needle) !== -1 || pack.name.toLowerCase().indexOf(needle) !== -1
          })
        }
        if (items.length > 0) {
          groups.push({ id: pack.id, title: pack.name, kind: pack.kind, items: items })
        }
      })
      return groups
    }

    function countItems(groups) {
      var total = 0
      groups.forEach(function (group) {
        total += group.items.length
      })
      return total
    }

    function randomInsert(tab) {
      var groups = collectGroups(tab, '')
      if (groups.length === 0) return
      var group = groups[Math.floor(Math.random() * groups.length)]
      var raw = group.items[Math.floor(Math.random() * group.items.length)]
      var entry
      if (tab === 'fav' || tab === 'recent') entry = raw
      else if (tab === 'sticker') entry = { kind: 'sticker', packId: STICKER_PACK_ID, item: raw.sticker.id }
      else entry = { kind: tab, packId: group.id, item: raw }
      if (isStickerEntry(entry)) doSendSticker(entry)
      else doInsert(entry)
    }

    function entryOf(raw, tab, group) {
      if (tab === 'sticker') return { kind: 'sticker', packId: STICKER_PACK_ID, item: raw.sticker.id }
      if (tab === 'fav' || tab === 'recent') return raw
      return { kind: tab, packId: group.id, item: raw }
    }

    function handleItem(raw, tab, group) {
      var entry = entryOf(raw, tab, group)
      if (isStickerEntry(entry)) {
        doSendSticker(entry)
      } else {
        doInsert(entry)
      }
    }

    // ── 面板 ───────────────────────────────────────────────────────────
    function Panel() {
      var state = useStore()
      React.useEffect(function () {
        function onKey(event) {
          if (event.key === 'Escape') setStore({ open: false })
        }
        function onPointer(event) {
          var panel = document.getElementById('more-emoji-panel')
          var launcher = document.getElementById('more-emoji-launcher')
          if (!panel) return
          if (panel.contains(event.target)) return
          if (launcher && launcher.contains(event.target)) return
          setStore({ open: false })
        }
        if (!state.open) return undefined
        document.addEventListener('keydown', onKey)
        document.addEventListener('mousedown', onPointer, true)
        return function () {
          document.removeEventListener('keydown', onKey)
          document.removeEventListener('mousedown', onPointer, true)
        }
      }, [state.open])

      if (!state.open) return null

      var anchor = state.anchor || { left: 24, top: window.innerHeight - 140, width: 420 }
      var width = Math.min(420, Math.max(240, window.innerWidth - 24))
      var left = Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12))
      var bottom = Math.max(12, window.innerHeight - anchor.top + 10)
      var totalMax = Math.max(240, Math.min(400, anchor.top - 24))
      var bodyMax = Math.max(140, totalMax - 132)

      var groups = collectGroups(state.tab, state.query)
      var total = countItems(groups)
      var favCount = Object.keys(state.favorites).length
      var recentCount = state.recent.length

      var tabs = KINDS.map(function (kind) {
        return { id: kind.id, label: kind.label, title: kind.hint }
      }).concat([{ id: 'sticker', label: '贴纸', title: '图片贴纸（发出去是图片）' }])

      return h(
        'div',
        {
          id: 'more-emoji-panel',
          className: 'more-emoji-panel',
          role: 'dialog',
          'aria-label': '更多表情和颜文字',
          style: { left: left + 'px', bottom: bottom + 'px', width: width + 'px', maxHeight: totalMax + 'px' },
          onMouseDown: function (event) {
            if (event.target.tagName !== 'INPUT') event.preventDefault()
          },
        },
        h(
          'div',
          { className: 'more-emoji-head' },
          tabs.map(function (tab) {
            return h(
              'button',
              {
                key: tab.id,
                type: 'button',
                className: 'more-emoji-tab',
                title: tab.title,
                'data-active': tab.id === state.tab ? 'true' : 'false',
                onClick: function () {
                  setStore({ tab: tab.id, query: '' })
                },
              },
              tab.label,
            )
          }),
          h(
            'button',
            {
              type: 'button',
              className: 'more-emoji-close',
              title: '关闭（Esc）',
              onClick: function () {
                setStore({ open: false })
              },
            },
            '×',
          ),
        ),
        h(
          'div',
          { className: 'more-emoji-subrow' },
          h('input', {
            className: 'more-emoji-search',
            type: 'search',
            placeholder: '搜索',
            value: state.query,
            onChange: function (event) {
              setStore({ query: event.target.value })
            },
          }),
          h(
            'button',
            {
              type: 'button',
              className: 'more-emoji-pill',
              'data-active': state.tab === 'fav' ? 'true' : 'false',
              title: '收藏',
              onClick: function () {
                setStore({ tab: state.tab === 'fav' ? 'emoji' : 'fav', query: '' })
              },
            },
            '⭐ ' + favCount,
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'more-emoji-pill',
              'data-active': state.tab === 'recent' ? 'true' : 'false',
              title: '最近使用',
              onClick: function () {
                setStore({ tab: state.tab === 'recent' ? 'emoji' : 'recent', query: '' })
              },
            },
            '🕘 ' + recentCount,
          ),
        ),
        h(
          'div',
          { className: 'more-emoji-body', style: { maxHeight: bodyMax + 'px' } },
          groups.length === 0
            ? h(
                'div',
                { className: 'more-emoji-empty' },
                state.tab === 'fav'
                  ? '还没有收藏，把鼠标移到条目上点 ☆ 就能收藏～'
                  : state.tab === 'recent'
                    ? '还没有使用记录，插几个表情试试～'
                    : '没有匹配的内容，换个关键词试试～',
              )
            : groups.map(function (group) {
                return h(
                  'div',
                  { key: group.id },
                  h('div', { className: 'more-emoji-group-title' }, group.title),
                  h(
                    'div',
                    { className: 'more-emoji-items' },
                    group.items.map(function (raw, index) {
                      var entry = entryOf(raw, state.tab, group)
                      var key = entryKey(entry)
                      var fav = Boolean(store.favorites[key])
                      var isSticker = isStickerEntry(entry)
                      var stickerMeta = isSticker ? STICKER_BY_ID[entry.item] : null
                      var content = isSticker
                        ? h('img', {
                            src: stickerMeta ? stickerMeta.dataUrl : '',
                            alt: stickerMeta ? stickerMeta.caption : entry.item,
                            draggable: false,
                          })
                        : state.tab === 'fav' || state.tab === 'recent'
                          ? entryText(entry)
                          : raw
                      var itemTitle = isSticker
                        ? '发送贴纸：' + (stickerMeta ? stickerMeta.caption : entry.item)
                        : '插入：' + entryText(entry)
                      return h(
                        'div',
                        { key: key + '-' + index, className: 'more-emoji-cell' },
                        h(
                          'div',
                          {
                            className: 'more-emoji-item',
                            role: 'button',
                            tabIndex: 0,
                            title: itemTitle,
                            'data-kind': isSticker ? 'sticker' : entry.kind,
                            onClick: function () {
                              handleItem(raw, state.tab, group)
                            },
                            onKeyDown: function (event) {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                handleItem(raw, state.tab, group)
                              }
                            },
                          },
                          content,
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'more-emoji-star',
                            title: fav ? '取消收藏' : '收藏',
                            'data-fav': fav ? 'true' : 'false',
                            onClick: function (event) {
                              event.stopPropagation()
                              toggleFavorite(entry)
                            },
                          },
                          fav ? '★' : '☆',
                        ),
                      )
                    }),
                  ),
                )
              }),
        ),
        h(
          'div',
          { className: 'more-emoji-foot' },
          h('span', { className: 'grow' }, kindLabel(state.tab) + ' · 共 ' + total + ' 条 · 点击即插入'),
          h(
            'label',
            { className: 'more-emoji-switch', title: '点一下直接发送（可在 设置→通用 里改）' },
            h('input', {
              type: 'checkbox',
              checked: state.directSend,
              onChange: function (event) {
                setDirectSend(event.target.checked)
              },
            }),
            '一键发送',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'more-emoji-rand',
              title: '随机插一个',
              onClick: function () {
                randomInsert(state.tab)
              },
            },
            '随机一发',
          ),
        ),
      )
    }

    // ── 启动按钮（顺带把 composer 的官方 API 存到 apiRef）────────────────
    function Launcher(props) {
      var state = useStore()
      var ref = React.useRef(null)
      var input = props && typeof props.useInput === 'function' ? props.useInput(function (s) {
        return s
      }) : null
      apiRef.current = {
        actions: (props && props.inputActions) || (apiRef.current && apiRef.current.actions) || null,
        input: input || (apiRef.current && apiRef.current.input) || null,
      }

      return h(
        'button',
        {
          id: 'more-emoji-launcher',
          ref: ref,
          type: 'button',
          className: 'more-emoji-launcher',
          title: '更多表情和颜文字（⭐收藏 · 🕘最近 · 贴纸）',
          'aria-label': '更多表情和颜文字',
          'aria-expanded': state.open ? 'true' : 'false',
          onMouseDown: function (event) {
            event.preventDefault()
          },
          onClick: function () {
            if (state.open) {
              setStore({ open: false })
              return
            }
            var composer = findComposer()
            var rect = composer ? composer.getBoundingClientRect() : null
            if (!rect || rect.width < 60) {
              rect = ref.current ? ref.current.getBoundingClientRect() : null
            }
            setStore({
              open: true,
              anchor: rect ? { left: rect.left, top: rect.top, width: rect.width } : null,
            })
          },
        },
        '😊',
      )
    }

    // ── 设置→通用 里的勾选项 ───────────────────────────────────────────
    function SettingsRow() {
      var state = useStore()
      return h(
        'div',
        { className: 'more-emoji-setting' },
        h(
          'div',
          { className: 'more-emoji-setting-main' },
          h('div', { className: 'more-emoji-setting-title' }, '更多表情和颜文字'),
          h(
            'div',
            { className: 'more-emoji-setting-hint' },
            '表情面板的「点一下直接发送」：勾选后点表情/贴纸会立刻发出，不再先插到输入框。',
          ),
        ),
        h(
          'label',
          { className: 'more-emoji-setting-toggle' },
          h('input', {
            type: 'checkbox',
            checked: state.directSend,
            onChange: function (event) {
              setDirectSend(event.target.checked)
            },
          }),
          '直接发送',
        ),
      )
    }

    // ── 插件入口 ───────────────────────────────────────────────────────
    exports.inject = ['slots']

    exports.apply = function (ctx) {
      ensureStyle()
      ctx.effect(function () {
        return function () {
          var style = document.getElementById(STYLE_ID)
          if (style) style.remove()
        }
      })

      ctx.slots.inject('conversation.input.left', function () {
        return ctx.slots.register(
          { name: 'conversation.input.left', id: 'more-emoji-launcher', order: 30, label: '表情' },
          function (props) {
            return h(Launcher, props)
          },
        )
      })

      ctx.slots.inject('conversation.input.overlay', function () {
        return ctx.slots.register({ name: 'conversation.input.overlay', id: 'more-emoji-panel', order: 45 }, function () {
          return h(Panel)
        })
      })

      ctx.slots.inject('settings.general.item', function () {
        return ctx.slots.register(
          { name: 'settings.general.item', id: 'more-emoji-direct-send', order: 55, label: '更多表情和颜文字' },
          function () {
            return h(SettingsRow)
          },
        )
      })
    }

    return module.exports
  },
})
