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


    var React = require('react')
    var DATA = {"KINDS":[{"id":"emoji","label":"表情","hint":"Emoji 表情"},{"id":"kaomoji","label":"颜文字","hint":"日式颜文字"},{"id":"art","label":"文字表情","hint":"组合表情与装饰字符"},{"id":"phrase","label":"短句","hint":"聊天文字短句"}],"PACKS":[{"id":"emoji-face","kind":"emoji","name":"常用笑脸","items":["😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","😉","😌","😋","😛","😜","🤪","😝","🤗","🤭","🤫","🤔","😐","😑","😶","😏","😒","🙄","😬","😮"]},{"id":"emoji-cute","kind":"emoji","name":"可爱卖萌","items":["🥺","😍","🥰","😘","😚","🤗","💞","🧸","🌸","🌷","🌼","🍭","🍬","🎀","🐰","🐱","🐾","💖","😊","😳","🙈","😅","🎈","🧁","🍓","🦄","🐣","🌙","⭐️","💫"]},{"id":"emoji-love","kind":"emoji","name":"爱心","items":["❤️","🧡","💛","💚","💙","💜","🤎","🤍","🖤","💖","💗","💓","💞","💕","💘","💝","💟","❣️","💔","❤️‍🔥","❤️‍🩹","💌","😻","😍","😘","🥰","💏","💑","🤗","🌹"]},{"id":"emoji-happy","kind":"emoji","name":"开心庆祝","items":["🎉","🎊","✨","🎈","🎁","🥳","🤩","🎇","🎆","🍾","🥂","🏆","👏","🙌","🕺","💃","🎵","🎶","🎤","🎪"]},{"id":"emoji-sad","kind":"emoji","name":"伤心委屈","items":["😢","😭","🥺","😞","😔","😟","😕","😣","😖","😩","😫","💧","💔","😿","😥","😰","🙁","😪","😮‍💨","😑"]},{"id":"emoji-angry","kind":"emoji","name":"生气无语","items":["😤","😠","😡","🤬","🙄","😒","😑","😶","💢","🗯️","👊","😾","🙃","😮‍💨","😐","💀","☠️","🔪","🤨","😖"]},{"id":"emoji-shock","kind":"emoji","name":"惊讶震惊","items":["😮","😯","😲","😳","🤯","😱","😵","😵‍💫","😬","🙀","❕","❔","‼️","⁉️","💥","⚡️","😨","😧","😦","🥴"]},{"id":"emoji-cheer","kind":"emoji","name":"加油鼓励","items":["💪","✊","👏","🙌","👍","🔥","✨","🌟","💯","🎯","🚀","🏅","🥇","🎖️","✌️","🤝","🙏","👊","⚡️","💥"]},{"id":"emoji-work","kind":"emoji","name":"工作学习","items":["💻","⌨️","🖥️","📝","📌","📎","🗂️","📊","📈","✅","❌","⚠️","🔧","⚙️","🧠","💡","🔍","📅","⏰","📚","✏️","🖊️","📋","📁","🗃️","🔑","🛠️","🧩","📞","📨"]},{"id":"emoji-food","kind":"emoji","name":"美食","items":["🍚","🍜","🍲","🍣","🍱","🍔","🍟","🍕","🌮","🍰","🎂","🍦","🍧","🍩","🍪","☕️","🍵","🥤","🍺","🍻","🍷","🍹","🍓","🍑","🍇","🍉","🥭","🍍","🥟","🍤"]},{"id":"emoji-animal","kind":"emoji","name":"动物","items":["🐱","🐶","🐰","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🐔","🐤","🦄","🐝","🦋","🐢","🐙","🦊","🐧","🐳","🐬","🦦","🐹","🐿️","🦔","🐺","🐴","🦌"]},{"id":"emoji-gesture","kind":"emoji","name":"手势","items":["👋","🤚","✋","🖖","👌","🤛","🤏","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","👇","☝️","👍","👎","✊","👊","🙏","🤝","💪","🤜","👏","🙌","✍️","🤲","🖐️"]},{"id":"emoji-nature","kind":"emoji","name":"天气自然","items":["☀️","🌤️","⛅️","🌥️","☁️","🌧️","⛈️","🌩️","❄️","☃️","⛄️","🌊","🌈","🌪️","🌙","🌟","✨","🔥","💧","🍀","🌱","🌿","🍃","🌸","🌻","🍁","🌾","🌵","🌲","🌴"]},{"id":"emoji-party","kind":"emoji","name":"节日庆典","items":["🎄","🎅","🤶","🎁","🎉","🎊","🧨","🎆","🎇","🎈","🎂","🕯️","🎃","👻","🦃","🍁","🌙","🥮","🏮","🧧"]},{"id":"emoji-symbol","kind":"emoji","name":"符号标记","items":["✅","❌","⚠️","❓","❗️","💯","🔴","🟠","🟡","🟢","🔵","🟣","⚫️","⚪️","🔔","🎵","🎶","🔆","♻️","🆗"]},{"id":"emoji-sleep","kind":"emoji","name":"困倦睡觉","items":["😴","🥱","😪","🛌","💤","🌙","⭐️","🐑","😵‍💫","🥴","😌","🌛","🕛","🛏️","🧸","🌜","☁️","💭","💨","😶‍🌫️"]},{"id":"kao-happy","kind":"kaomoji","name":"开心","items":["(＾▽＾)","(≧▽≦)","(◕‿◕)","(＾ω＾)","(๑>◡<๑)","ヽ(•‿•)ノ","(◍•ᴗ•◍)","(｡◕‿◕｡)","ヽ(・∀・)ﾉ","(☆▽☆)","(≧∇≦)/","(°▽°)","(๑˃̵ᴗ˂̵)و","(｡•̀ᴗ-)✧","ヾ(≧▽≦*)o","(ﾉ◕ヮ◕)ﾉ","(◠‿◠)","(｡･ω･｡)ﾉ♡","ヽ(＾Д＾)ﾉ","(๑•̀ㅂ•́)و✧"]},{"id":"kao-cute","kind":"kaomoji","name":"可爱","items":["(`･ω･´)","(｡･ω･｡)","(´･ω･`)","(๑´ω`๑)","(◕ᴗ◕✿)","(๑•́ ₃ •̀๑)","(｡>﹏<｡)","(〃∀〃)","ʕ•ᴥ•ʔ","ʕ￫ᴥ￩ʔ","(=^･ω･^=)","ฅ^•ﻌ•^ฅ","(=｀ω´=)","(๑•ᴗ•๑)","(´｡• ᵕ •｡`)","(づ｡◕‿‿◕｡)づ","(◍•ᴗ•◍)✧","ʕ•̀ω•́ʔ✧","(=^･ｪ･^=)","(๑ơ ₃ ơ)ﻭ"]},{"id":"kao-sweet","kind":"kaomoji","name":"撒娇卖萌","items":["(´• ω •`)","(๑´ㅂ`๑)","(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)","(ღ˘⌣˘ღ)","(๑•́ω•̀)","(｡・ω・｡)ﾉ♡","(づ￣ ³￣)づ","♡( ◡‿◡ )","(´ε｀ )♡","(灬ºωº灬)","(◍•ᴗ•◍)❤","(´♡‿♡`)","(っ˘з(˘⌣˘ )","(๑•́ ₃ •̀๑)♡","(⁄˘⁄ ⁄ ω⁄ ⁄ ˘⁄)♡","(๑>ᴗ<๑)","(´,,•ω•,,)♡","(｡•́︿•̀｡)","(๑´∀`๑)","(◕‿◕)♡"]},{"id":"kao-sweat","kind":"kaomoji","name":"汗与无语","items":["(￣▽￣;)","(・_・;)","(´･_･`)","(￣ω￣;)","(；一_一)","(ーー;)","(￣～￣;)","(；´Д｀)","(￣ヘ￣)","(¬_¬)","(⇀‸↼‶)","(・∀・;)","(￣□￣;)","(lll￣□￣)","(￣ー￣)","(¬‿¬)","(－‸ლ)","(ㆆ_ㆆ)","(￣ ￣|||)","(;￢_￢)"]},{"id":"kao-angry","kind":"kaomoji","name":"生气炸毛","items":["(╬ Ò﹏Ó)","(╯°□°）╯︵ ┻━┻","(ノಠ益ಠ)ノ彡┻━┻","(＃`Д´)","(￣^￣)","(¬_¬)凸","(ﾉ｀Д´)ﾉ","(╬ಠ益ಠ)","(ᗒᗣᗕ)՞","(╯°Д°)╯","(＃￣ω￣)","(눈_눈)","(╬￣皿￣)","(｀Д´)","(ಠ_ಠ)","(¬､¬)","(￣皿￣)","(｡•̀ ᴖ •́｡)","(ꐦ°᷄д°᷅)","(ง •̀_•́)ง"]},{"id":"kao-cry","kind":"kaomoji","name":"哭与委屈","items":["(｡•́︿•̀｡)","(╥﹏╥)","(っ˘̩╭╮˘̩)っ","(｡╯︵╰｡)","(´；ω；`)","(ಥ﹏ಥ)","(ᗒᗩᗕ)","(T_T)","(╯︵╰,)","(｡í _ ì｡)","(っ- ‸ - ς)","(>_<)","(｡ﾉω＼｡)","(っ˃̣̣̥⌓˂̣̣̥ς)","(｡ᵕ ᵕ｡)","(｡•́︵•̀｡)","(´;ω;`)","(｡•́ - •̀｡)","(இ﹏இ`｡)","(╥_╥)"]},{"id":"kao-shock","kind":"kaomoji","name":"震惊","items":["(⊙_⊙)","(⊙o⊙)","(ﾟДﾟ)","(゜ロ゜)","(・o・)","(O_O)","(◎_◎;)","(꒪Д꒪)","(ﾟдﾟ)","(｡ŏ_ŏ)","(°ロ°) !","(⊙﹏⊙)","(ﾟΩﾟ;)","(;ﾟДﾟ)","(☉_☉)","(・□・;)","(o_O)","(⊙_☉)","(๑•́ ₃ •̀๑)?","(ﾟ∀ﾟ)"]},{"id":"kao-greet","kind":"kaomoji","name":"打招呼","items":["(｡･ω･)ﾉﾞ","(^-^)/","(＾▽＾)/","ヾ(＾∇＾)","(・ω・)ノ","(｡◕‿◕｡)ﾉ","(＾ω＾)ノ","ヽ(・∀・)ﾉ","(ﾉ´ヮ`)ﾉ","(๑˃̵ᴗ˂̵)و","(o´▽`o)ﾉ","(^-^*)ノ","(／・ω・)／","(｡•̀ᴗ-)✧","(๑>◡<๑)ﾉ","(´▽`)/","ヾ(•ω•`)o","(・∀・)ノ","(｡･ω･｡)ﾉ","(＾◡＾)ノ"]},{"id":"kao-action","kind":"kaomoji","name":"动作加油","items":["(๑•̀ㅂ•́)و✧","ᕦ(ò_óˇ)ᕤ","(ง •̀_•́)ง","٩(๑•̀ω•́๑)۶","ヽ(•̀ω•́ )ゝ","╰(°▽°)╯","(๑•̀ㅁ•́๑)✧","(๑˃ᴗ˂)ﻭ","(ﾉ≧∀≦)ﾉ","└(＾＾)┐","٩(◕‿◕)۶","(๑•̀ ₃ •́)✧","(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧","٩(ˊᗜˋ*)و","ᕙ(`▽´)ᕗ","(๑•̀ㅂ•́)و","┗(＾0＾)┓","(๑•̀ω•́)ノ","(ง •̀ω•́)ง✧","╭(°A°`)╮"]},{"id":"kao-heart","kind":"kaomoji","name":"爱心","items":["(♥ω♥*)","(｡♥‿♥｡)","(´,,•ω•,,)♡","(ღ˘⌣˘ღ)","(◍•ᴗ•◍)❤","(´♡‿♡`)","(灬♥ω♥灬)","(❤ω❤)","(⁄ ⁄•⁄ω⁄•⁄ ⁄)♡","(๑´ㅂ`๑)♡","(ღ•͈ᴗ•͈ღ)","(๑ơ ₃ ơ)ﻭ♡","(づ￣ ³￣)づ","(´ε｀ )♡","(｡・ω・｡)ﾉ♡","(◕‿◕)♡","(๑>ᴗ<๑)♡","(♥_♥)","(ღ˘⌣˘ღ)♡","(灬ºωº灬)♡"]},{"id":"kao-cat","kind":"kaomoji","name":"猫猫","items":["(=^･ω･^=)","(=^･ｪ･^=)","ฅ^•ﻌ•^ฅ","(=｀ω´=)","(=^‥^=)","／(=･ｘ･=)＼","／(=´x`=)＼","(=^･^=)","ฅ(＾・ω・＾ฅ)","(^・ω・^ )","(=ΦωΦ=)","(=；ω；=)","／(≧ x ≦)＼","(=^ ◡ ^=)","ヾ(=･ω･=)o","(=ＴωＴ=)","／(=⌒x⌒=)＼","(=^・^=)","(=•ω•=)","(=^‥^)ﾉ☆"]},{"id":"kao-shy","kind":"kaomoji","name":"害羞","items":["(⁄ ⁄•⁄ω⁄•⁄ ⁄)","(〃∀〃)","(๑´ㅂ`๑)","(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)","(灬ºωº灬)","(￣▽￣*)ゞ","(๑////๑)","(◕///◕)","(〃ﾉωﾉ)","(´-ω-`)","(๑´∀`๑)","(⁄˘⁄ ⁄ ω⁄ ⁄ ˘⁄)♡","(๑•́ω•̀)","(〃▽〃)","(◕‿◕✿)","(´,,•ω•,,)","(๑>ᴗ<๑)","(๑´ㅂ`๑)♡","(≧////≦)","(￣ω￣;)"]},{"id":"kao-sleepy","kind":"kaomoji","name":"困倦睡觉","items":["(－_－) zzZ","(￣o￣) zzZ","(´-ω-`)","(￣﹃￣)","(￣ρ￣)","(˘ω˘)","(∪｡∪)｡｡｡zzz","(－ω－) zzZ","(￣▽￣)~*","( _ _ ) Zzz","(≖_≖ )","(￣.￣)","(´～`)","(￣ω￣)","(˘▽˘)","(ᴗ_ ᴗ。)","(๑ᵕ⌓ᵕ̤)","(´-﹏-`；)","(￣▽￣)ゞ","(－。－)"]},{"id":"kao-long","kind":"kaomoji","name":"长条颜文字","items":["ヽ(￣ω￣(￣ω￣〃)ゝ","(っ˘з(˘⌣˘ ) ♡","ヽ(•‿•)ノ","╰(°▽°)╯","(๑˃ᴗ˂)ﻭ","ლ(´ڡ`ლ)","(っ´ω`)ﾉ(╥ω╥)","ヽ(＾Д＾)ﾉ","＊*•̩̩͙✩•̩̩͙*˚","(๑ơ ₃ ơ)ﻭ","ヽ(´ω`)ﾉ","（￣︶￣）↗","￣へ￣","（づ￣3￣）づ╭❤～","(๑•̀ㅂ•́)و✧","ヾ(⌐■_■)ノ♪","( ͡° ͜ʖ ͡°)","ಠ‿ಠ","(╯‵□′)╯","ᕕ( ᐛ )ᕗ"]},{"id":"art-combo","kind":"art","name":"组合表情","items":["✨(◍•ᴗ•◍)✨","💖(づ￣ ³￣)づ💖","🥺(´• ω •`)🥺","🎉ヽ(•‿•)ノ🎉","🌸(๑>◡<๑)🌸","⭐️(๑•̀ㅂ•́)و✧⭐️","🍀(｡•̀ᴗ-)✧🍀","🔥💪(ง •̀_•́)ง💪🔥","🎀(´,,•ω•,,)♡🎀","🌙(˘ω˘)🌙","💫(◕‿◕)💫","🧸(｡･ω･｡)ﾉ♡🧸","🍓(๑´ㅂ`๑)🍓","🌈(◠‿◠)🌈","🎈(๑>◡<๑)🎈","☕️(￣▽￣)~*☕️","🫶(♥ω♥*)🫶","🌸(⁄ ⁄•⁄ω⁄•⁄ ⁄)🌸","✨(๑˃ᴗ˂)ﻭ✨","💤(－ω－) zzZ💤"]},{"id":"art-frame","kind":"art","name":"框框字","items":["╭━━━━━━╮\n┃ 好耶！ ┃\n╰━━━━━━╯","╭━━━━━━╮\n┃ 收到！ ┃\n╰━━━━━━╯","╭━━━━━━╮\n┃ 贴贴～ ┃\n╰━━━━━━╯","╭━━━━━━╮\n┃ 晚安啦 ┃\n╰━━━━━━╯","╭━━━━━━╮\n┃ 谢谢你 ┃\n╰━━━━━━╯","╭━━━━━━╮\n┃ 冲鸭！ ┃\n╰━━━━━━╯","╭━━━━━━╮\n┃ 震惊！ ┃\n╰━━━━━━╯","╭━━━━━━╮\n┃ 无语… ┃\n╰━━━━━━╯","╭━━━━━━╮\n┃ 抱抱你 ┃\n╰━━━━━━╯","╭━━━━━━╮\n┃ 辛苦啦 ┃\n╰━━━━━━╯","┏━━━━━━┓\n┃ 好家伙 ┃\n┗━━━━━━┛","┏━━━━━━┓\n┃ 绝了！ ┃\n┗━━━━━━┛","┏━━━━━━┓\n┃ 明白了 ┃\n┗━━━━━━┛","┏━━━━━━┓\n┃ 在的～ ┃\n┗━━━━━━┛","┏━━━━━━┓\n┃ 安排了 ┃\n┗━━━━━━┛","┌────────┐\n│ 摸鱼中 │\n└────────┘","┌────────┐\n│ 建设中 │\n└────────┘","┌────────┐\n│ 已阅 ✓ │\n└────────┘","┌────────┐\n│ 待机中 │\n└────────┘","┌────────┐\n│ 加载中…│\n└────────┘"]},{"id":"art-divider","kind":"art","name":"分割与装饰","items":["·:*¨༺ ༻¨*:·","✧･ﾟ: *✧･ﾟ:*","₊˚⊹ ☾ ⋆⁺₊✧","⋆｡°✩ ⋆｡°✩","┄┄┄ ✦ ┄┄┄","━━━━━━━━━━","══════════","✦•┈๑⋅⋯ ⋯⋅๑┈•✦","˚₊· ͟͟͞͞➳❥","✩₊˚.⋆☾⋆⁺₊✧","๑⋅⋯⋯⋅๑","·˚ ༘ ⋆｡˚","☆.。.:*・°☆","⊹ ࣪ ˖ ୨୧ ˖ ࣪ ⊹","♡₊˚ 🦢・₊✧","─=≡Σ((( つ•̀ω•́)つ","～(￣▽￣～)(～￣▽￣)～","☽ ⋆｡°✩₊˚","ੈ✩‧₊˚","⋆ ˚｡⋆୨୧˚"]},{"id":"art-symbol","kind":"art","name":"符号表情","items":["¯\\_(ツ)_/¯","(☞ﾟヮﾟ)☞","☜(ﾟヮﾟ☜)","( ͡• ͜ʖ ͡•)","ಠ_ಠ","ಠ‿↼","(╯︵╰,)","ᕕ( ᐛ )ᕗ","(⌐■_■)","ヽ༼ຈل͜ຈ༽ﾉ","(ง ͠° ͟ل͜ ͡°)ง","༼ つ ◕_◕ ༽つ","(•_•) ( •_•)>⌐■-■","(⌐■_■)ᕤ","┬─┬ ノ( ゜-゜ノ)","( ﾟдﾟ)","(☞ﾟ∀ﾟ)☞","♪(┌・。・)┌","┌(・。・)┘♪","(＾＾)ｂ","d(￣▽￣)b"]},{"id":"phrase-praise","kind":"phrase","name":"夸夸","items":["太强了吧！","好厉害～","绝了！","yyds","666","不愧是你","这也太顶了","牛哇！","满分！","干得漂亮","我直接跪了","好耶～","棒耶！","太牛了"]},{"id":"phrase-cute","kind":"phrase","name":"撒娇","items":["贴贴～","抱抱","摸摸头","要抱抱","呜呜呜","好嘛好嘛","求求了","你最好了","不可以凶我","哄哄我嘛","我不管我就要","人家不依","哼唧","要贴贴"]},{"id":"phrase-reply","kind":"phrase","name":"日常回复","items":["收到！","好滴","好嘞","没问题","明白啦","懂了懂了","在的在的","稍等我一下","马上来","安排上了","这就去","有道理","确实","可不是嘛","笑死","哈哈哈哈","真实","离谱","可以可以"]},{"id":"phrase-greet","kind":"phrase","name":"早晚安","items":["早安喵～","早安呀","起床啦","新的一天冲鸭","午安","该休息啦","晚安","好梦","早点睡呀","别熬夜了","睡个好觉","明天见","梦里见","晚安喵"]},{"id":"phrase-moyu","kind":"phrase","name":"摸鱼吐槽","items":["今天也是摸鱼的一天","上班如上坟","不想上班","想下班","卷不动了","躺平了","摆烂中","打工人实锤","工资到账了吗","先摸一会儿","累了困了","老板不在嘿嘿","今日份快乐","摸鱼被抓"]},{"id":"phrase-cheer","kind":"phrase","name":"鼓励","items":["加油鸭！","你可以的","别放弃","相信自己","已经很棒了","慢慢来不着急","会好起来的","我陪着你","冲鸭！","稳住","别慌","包在我身上","一定行","坚持住","你是最棒的"]},{"id":"phrase-festival","kind":"phrase","name":"节庆祝福","items":["新年快乐！","万事如意","恭喜发财","生日快乐","节日快乐","中秋快乐","国庆快乐","春节快乐","圣诞快乐","元宵快乐","端午安康","七夕快乐","元旦快乐","新年暴富"]},{"id":"phrase-meme","kind":"phrase","name":"网络梗","items":["真香","破防了","emo了","栓Q","绝绝子","蚌埠住了","笑不活了","离大谱","我的妈呀","狠狠爱了","一眼真","纯纯大冤种","社死现场","爷青回","针不戳","格局打开","拿捏了","离谱他妈给离谱开门"]},{"id":"phrase-heal","kind":"phrase","name":"温柔安慰","items":["辛苦啦","别难过","抱抱你","我懂你","慢慢来","会好的","别自责","你已经很好了","先休息一下吧","给自己一点时间","我在呢","别怕","有我在","会过去的"]},{"id":"phrase-work","kind":"phrase","name":"工作沟通","items":["收到，我看看","马上处理","稍等","这个我来","已完成","同步一下","确认无误","辛苦了","麻烦啦","感谢配合","有问题随时说","进度如何","截止什么时候","先对齐一下"]}],"STICKERS":[{"id":"sticker-01","group":"颜文字","caption":"开心","dataUrl":"data:image/png;base64,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"},{"id":"sticker-02","group":"颜文字","caption":"可爱","dataUrl":"data:image/png;base64,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"},{"id":"sticker-03","group":"颜文字","caption":"加油","dataUrl":"data:image/png;base64,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"},{"id":"sticker-04","group":"颜文字","caption":"委屈","dataUrl":"data:image/png;base64,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"},{"id":"sticker-05","group":"颜文字","caption":"得意","dataUrl":"data:image/png;base64,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"},{"id":"sticker-06","group":"颜文字","caption":"震惊","dataUrl":"data:image/png;base64,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"},{"id":"sticker-07","group":"颜文字","caption":"无语","dataUrl":"data:image/png;base64,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"},{"id":"sticker-08","group":"颜文字","caption":"贴贴","dataUrl":"data:image/png;base64,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"},{"id":"sticker-09","group":"颜文字","caption":"谢谢","dataUrl":"data:image/png;base64,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"},{"id":"sticker-10","group":"颜文字","caption":"晚安","dataUrl":"data:image/png;base64,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"},{"id":"sticker-11","group":"颜文字","caption":"生气","dataUrl":"data:image/png;base64,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"},{"id":"sticker-12","group":"颜文字","caption":"委屈","dataUrl":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAALoElEQVR42u1deVRTZxa/2RNIIGEJIKCIVUBcEIJUg2BLR6zW1kIFLTitgo6tFj1n2tI6lnZoZ1zQkVZrXWoVhcFqRUGUChQER9EO2NNRFByPAg5SlmxkBcLL/BGNEQGDJBDp/Z13OOTL996773e/373vvuULSafTwVNDdAwQAOC46KlXJQ3YAUi6WZ0xEAeIfkB6TXbDG2Z1AFJvMTeY4ADRcWRyED6IHoQDxEi9meAQPXAHiHOQN7P6IKrXZjKyP0Tog9LeFCA+gXRZTAevP0kByL5lddCTXurjmkCWhhKPKkB8EhmxvAhO9pEDxLlIzhAmg9ceC0EYe4YDDxQgyUMuhhq8V/uuAxBDqgDJKSRimESwABUwzKBi/rWmOgAxDDlAjAlgmEMQxp/hdQDyjwrAJIxABaACEKgAVAACFYB1AAIVgDkAgQpABSBQAagABDoAQxACCzFUAAJzwAh2AMmii0bTFReXEhq6sqzsF0vvy7xLevoRoXDFZ5/ts+hezKyAjRszhMLEnJxSQ8uXXx6pq2tatSoqPDzw2RqbSUmxM2ZMLir6+ezZS/qW/PzzQmHiJ5/stlIFlJX9kp9/PiRkUlTUi/qWc+eu5OWVz5snjI+f92wNfwASmUxJTV3l7e2+bVtWU5MIgPTKK2FhYdNKSirz8y9YnQIUCtXmzRlMJmP9+mX6lpYW8aZNBwMCJnz44R+f0QBtY8NMS1vLYNBSU/cRBAEAyclvsdk227f/s61NCuZ5Mk52ziwbOnQof8+enEWLXlq37s2RnTZ37z5++PDpJUsi16yJNUcIMoeSOru6jh0rplDIi5dEPmuRZsBL7OI/0Om03NwyhVI1+K2ZJwdUXLwqFrcHB/u7ujpZ6Libm8WzQhOEM5cXFFzsp1vh2UvCmctDhQn6qG2JhcezD501TaXSnCutspYcUFV1AwCCBBNN7N/aKsnKPLNjx5GiossmzpdTUHCRIHT29uyIiOn9dHvhxWAez06n0/1YcMFClgCAQOAHAFVXaqylEq66cgMABIKJpmyttqYuKWmLQqHSfyw8W7ElbR2J9IQVy8uvAMDs2QI6nd5PNxqNNvsFwYmcknPnqpYtX2gJSwBAIPAHgCtVNwbPnhkUQBC6hvomAPD29jCl//btmYZjBoCLF38tK6vqfxWZTHGzth4AZoUFPlp2fCec+XZKyjfGjWFhgQBw69Zdsbjd7Jbo4e7OZzDobW1SpVI9/HWAvF1JEDo2m0WlUp/YWaeDmpq6HkbU1NT1v9bNmw36+DB58vjHvjW8ZHt/8fd/Tj+Kb9bWm90Sw8LlcgBAKlUMfw6QyhQAwOXamXTaSyLxHHr2dHTk9r9WQ0MTAPBdHNhsmyfuwtaW5ermBAD19U1mt8QALo8DADKpfPgVQBA6ACCTTd1UbMxcYwvs7GwjIkKeIDK5CgB4XLs+hj/0HJ72HABob1ea3RLDQiGTAUDbrRske9TBK8DOjg0AUmm7if1jF0eSKaTjPxSLxTIf37Hr1sU5ONibsmJ3N9GjpUPTCQAdHV0905KOsKglACCRygGAx+UM/w0ZLo9NIpHkclU30U2hUEyJQjGxkTGxkabvwsmZBwDNzSId6IzPUhobm+//ffQomn8TAYAzn9f/0T2FJQ8Dr0QOAPY8ziAJNEMIolCoLi6OOp3ubkOzhWqfqVN9AEAuV16quGpcmumzaN2de8a7/vnyNalUDgABAb4Wsqe1VapWazgcWw7H1ioKscAgPwCoqrpuocsvnp6uISGTAWDb1oNXr/6XIIj6+nsb/rKDIAhXVyedTvdpytd1dxoJgqi+dist7SAABAf7e411t5A9lZXVABAY6GdK0TAUhZhAMOnM6fOV/66OfmOOhY45+ePEd/6U2tTUtmplqqHRx8frq53rk9b8vba2Lu7Njwztzs685I8TLXe3taryOgAECfytohADAGHoNFtbVkXFf0QimYWO2cXFcf+Bz99YNMfV1YlGo/L5DrGxc3fu2sBm2+zctSE2di6f70CjUV1cHKOiX9p/4As3N2cLWaJQqMrLKmk02uzZwea4HC2vMItZ3+w6knn4VPzSBe+8u3hkX44+lJG7Z/fRhQsjPkhebkU35WMXv8xiMU+e+GnwtYk1Q6lUH/3+RxqNFhf/inXdknRw4H7w4XKFQrVx474RfDdga9oBiaT9vaS4Ue4uZrolaT7zIl8OnTc/7Hx5VV5eyYjkv7i4ovDshfDZwdGL5phrmySd4jIgAB/MAnw0EYEKQAUgUAGoAAS+oIEhCIEhCBWAQAWgAhCoAFQAAhWAhRgCFYA5AIEKQAUgUAGoAAQqAOsABCoAcwACHYAhCIEKQAWYFwRBdGg0GrVGrdZo1GqNSqNWq9VKlUwik0mkMqnM8M+GLZ+O8nQfGb+makXI2ne45EyxKT2bGpv0Drj+a3VayiZTVnHkO23dtx0V0B8mTvGvvVZDoVDIFDKVSqVQKOI2UWtzqx3XfkrQVBaLxbRhMVlMFos5ysO9h/E8R15fm+3QdKiUKiv87V6rK8SCZgYHzXzk7cOT2Tm52TkeYzwS1q7sfZ0Hh7D123RyH6/q/3S6KHNPhhX+drJ1KaC8sPTAzm97/er6r9XLXo3v0bhsTWLYnBcMh5Dw+lsm7ISEOaBPcB0dJk71N3ysv12vlCuMOzCYDO8JzxleT+c6OpgYgh5Ma8EFQAX0jSlBAVOCAprv/fbL5crzxWVKuSJk1gwGi1leWOrj7ztm3NjCvAKJSBwxf8606UGOfKceg3rbdzsHP3fA71oBpQXFeUdypBIpAIwdP+6jjSk+/r4ns48DAIVKXZK4VDBzevb+zKy9GVl7M9gc9pzX5i2IWajVavUTFvVg//3EJFFL2+rktQJhCNYBJiFgelBh3o9zw4XCiHCPMZ6tzS2rlyQazWVIGj/RN2XbF7XXbvzrp7LaazdmzA4FIHVruwGASqWqlOrVSxIA4Ovs/Ta2NsZzOR3Ysbe8qHRBzOtR8TGogD7Bc3TY+M02w8fc7OMqpYrJYu3I2sfmsA3tPpP8fCb5GZ9iAgCdyTC06N2gx9eb07ESNhU5md+fOnqiR6NGrX4vbkWv/RPWvhMaEa6QKwCAZcMikcg8o7Qsk0gJgrDlsA0zXbJsbLAO6A/2DjzPsWMAQK1UtbW0AoCbxygqjab/VqVUilraAMDZhc+0YQGALYcNJJCIxQBgZ2/PsmX94+CuhzkgYY2ope3t1SswB5iKiPmREfMjlXLFpvV/BQA6g/F8eKjPJD/vCeM1avXWlL+JWtr4bq6f79hCZzwMOHW37gCAk4vzga/2lheVLIiJiloa++gpP6mrs2tldDwApB/aY29NJ6NUoHtD522rGhQMFnPpqoTaa9drrlafPnbyRNZRKo3GYNCVCiWJRHpzxVvG7Hd2dNysrgEAr+fGNd1tfMYuxdG9rSsJa7VamVgiahX9du+eXNau0Wj0p5jari4uj6vTgUqpTE/d7Ok1Ojh0RkiYkO/mcqGkXNvVBQCBzwefvtsIAKeO5pw6mvMwCW/aDlZfB1hLFCo5XZj9bUaPiQ3H+YwPj3xJ+GKYVqu9VH6h9Exh3a3bd+sacjK/f//zDfpToPF+Pnw3V6YNi83pcx5JhVxuNMOotYCk0+mg846VWNOh0fx5+btUKpXv6uLhNXqc7wTfyf6Ozk49ut2+eav0TKFCLl/7STIAnPkhd/Q4r0nTpvaz5a7OrpXRcQCQfmivFeUA+ljS/TnbO+usxCSiu5tswuSjIwF0L2u8Jfl7Yf+REHT/fKIeEEM3/Mc8dikCn44YZgUAQFcDMjIUoI3u47EUoy8QQ8B+r1dDMRIN74NZNE8kxZLD37PfHPAwGfwPubIA+x4mP5pI80C6hoD9vhVwXweNyJuZ2Hc37TS0V2jRDYMA1X0gdUCfPriHTD4V+6MGWIihG4aQ+oE74L4bmpDefql3G8SliIECnfFUpBvj//UHQgW0+MLoAAAAAElFTkSuQmCC"},{"id":"sticker-13","group":"颜文字","caption":"好耶","dataUrl":"data:image/png;base64,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"},{"id":"sticker-14","group":"颜文字","caption":"尴尬","dataUrl":"data:image/png;base64,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"},{"id":"sticker-15","group":"颜文字","caption":"星星眼","dataUrl":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAAM7ElEQVR42u1deVwT1xY+k4UEQjCEfaeCVsAdRbEgiKLiioqPoqWyVK217rV1RVtptT4tgqKvaqt1qcXqc0HAKgrSupVVgYAFInvYgywhrHl/jMaICGMYkjy53y9/TCbn3Dlzzv3OmTtz5waTSCQgL24WAAIAuFvIr4u9bQCQ08kNxlsEIBa5njCmWJAagNhC5FK5wmBORgBuIe/3ApPNexEA5HoFhIGCvK8AdOPMrhlwG3m/D+BmTiwAt4uQr/osBmY9BSAOeb+PMcmMWA1AUAxeYUA86v4KgatZVwxA3lcYZF2NUpBqpKA7xcgVioaLKWKAijAgAXV/JWGiKWKAsoECoGTQAADDkB+UVwMSiiXIC8pkAOr9qAagACAoMwWhHIQYgIowAmIACgACSkH981YEigBiAKoBCIgBiAEIqAijFISAUhBiAAJiQP8KAAYkfp7yktdPH7zW3Sol/hq5LSv3w/s7ft1U63VTB2UlJZDbMoXE1prqa09+s6qjvd1xhrf9pFk9yl8IDfpqzvAnSX8qy7HEDbAb5+rqFSiRdJz+bl1dVTmJNpCZgi7/uPtZdbkWV2/usk1E5HMfP1wT8tvjuzeURf+3MmCG31odQzNRfe3vYUFkpiCyIln0T/rD6xcAYFbABg1NrR7lhWXF2vrGRhaDBfwnSun+b2sAg6E+d/kmAEi/F0sia0ljQPTJEADQM7FwcJ9PRL44L8vUypZKo0lA0tHervjuL4cBI5ymmVjZAkDUyRDVKsIVJU95f98BAGfPjyk0KhGV4txMk0G2gIGhxaCywhzFU0AOAzAK5rrADwAKsh89zUpVoSL8MOZ3AKDS6OPc5xFUKc7lmVnZYABm1rbFuTzFpyD5DLB3ncnU0ASAB9HnSTGDRgqPHt29CQCDRzlqsAcQVKkofqpnagkAZoPskuIix03tOXHVVpV/4zuptaW5u4ElXW3H6TiOnmFfGAAAdAbT1sElJT4q4/4tiaQDwyjKHwkLK0orivgAYOfg0qm1iNAgQX4OlUbTNTY3NLc2NLcytLDm6BmJ6p+x2AMoGAUATKyGXD3+b1yxuUkkrCwVlpcKKwXCCkFdTeXURSt0DE3x1rR1DZznLC7Oy1q970yXloSuX2RiZaMt431yDcBhO3ZiSnxUfW11aV62qbUtCbOje4n87Ef4hsWQEZ1+KnySPuXDZcMnuJcV5pbys5+k3rt98US1oAjDsEEjx+Myagx1sahh99KZooY6lhZH19hc18hcz9jCerhDCT/r75uXPXw/lzY41WdF0GIXfmbKQLvRnY7Fz0guyH4csD2sTw0AAEubkfhGQfbj3gcASynv7ezo6F9Co0+FAcAP0RlqDHXZn5oa6/84e7i8MM9z+SYDs4HS/Q3PhO1trQN09PGvlSX5TBabzdGRCohFjX+cDS99+sRrZZCeySuL71z9aV9xTuZne050MiN8k7+Zte2cTzb2tQESScfa6bbtba0u8z5e+PkO5U9NrKkoAQBNDpfBVO/0k4Yme97yr2oqSqNPhrK1dT18V6oxNQCAzdGWFdM3tZQ9vQfXL6beiXGd7+e57MvXD+fuvTRosWvRP+nm7w+T7en5vFT/bSGdTqcvDMAwira+UVVpobC8tPfeI2EcUC+sBgAtbd03CXD1jT/68vtRLh7nQranxEd1NzRNTzwRvFaNob5i90+2DhO7lNFgD5i8MDDmzCHZnTGnD7ktDGSxOQowAAC0uHoAUCesUomRcGuzGM+k3YtZDB7qt3m/GoN58tt1orraTr/WVgguhgeX5ef6bwkZ4zaLgmHdNOW2wJ+fmSIdwZbys/m8lMleAQozgMFQB4DWZrFKjITxN40xCqGmrIeNLXjyGL+UlkVlaaGwUuA824dCpfbYCFOD5e69LOZM+IvuH+7uvYypwVKYAfjJSiQdKsEANQYDAFrETUSE70ZFOE5bQKPR8K/ixnp84/2R42qryqsFRQQPOsnTNy8jqbwwr7wwj5+ZPMnTl6AiKQa0iEUAQFdjksGAXrehweYAQGOdsEfJjo72u9Hnnecswr8mxUftWeEpKHh+G2DKwoDbF38meFA6kzlt0afXfz0Sc/bwtEWf0plMIlpkGdBQVwsALC0OCbciek8iroExADyrrmxra+1eMiXh+uCR41haHADIeBCX+SBuXcivp77/qrz4KQCMcpme8yhRVP+M4HGdZvvkpSfxM5KdZvsQVCHLgJqyEumJKz8FGVlY4wmxLD+ne8m4iycme/ljADmPHt6LueC7cY+2rsGSTXuP7VhZLSiiYBTn2T5/Rp4jeFw6jT598QqPjz6j0+gEVUgxoFpQ1NLcBABG5lYqUYQtX1yP52c96kbsaVaahqaWoblVfvbjG+eOBmzZT6XRAMDIwvrDNTsPbQoUVpZN8PBKjovqkUlSTJju5ThtAUFhsgyQnqbFkOEqwQBDcyuOjgEA8BITuu19v0zxChDk51w5vm9pUKga42UFGzzcYbbfmgMbfMUNdaOcpyXfvkbw0FQqlUqlEu7+5BjAS0zAr8TesxmhEkUYo2AjnKYAAC/xr5bmpi5lxE2NfF4q19DkXOiOwG0hTJZmJ4ExbjOdZ3mHbPAdaDcyIfJX0u8+k2VAR0d7+oM4/JYcjU5XiSIMABM8vACgWSxKvH2tSwGGusbQ8a5Hd64K2LKfra3TpYy79ydD7Ccc2b7CadaHpD//IsuAtL9u1NfWAIDTzH+RYhiWUUXOUgV7VnrxM1NNrWy2H4/E3t13X/eu8s5NTzI0G/j1qRuknCZpz4Q9AzfgD1pTEq6/q97nJf6Zm54EAHMD15HVyUibFWEz2tHexQMALhzZ00psVPz/9WlvbY04FAwAQ0Y72rt4qOK8oEVrd7K1darLii8d3//udf9rpw4KCnLVWZpLNu4mMceSOTVRi6v76c6DFCo19sKJtLux71L/z0q5G332CIZhgdt+0DU2I7FljFeN1gsCNDsa0PsBCIgB6CU9BJSCUApCQAxADEBAi/YhBiCgAKAijIAYgBiAgG5FoBSEgFIQYgACYgAqwggoBaEUhIAYgBiAgIowSkEIKAW9M3/mqSzs8BpLRGxV6O+6JpZyqIgb63cvcZPd77s17H7Uudy0+6+rDLZ3Wrw5pD8ygKNnpPbaMisA0N7WWi0oghfziOVQwV4sbkJXY7S1tfS4Mh/WP4vw7OWbB41yhC5ehi46sHI+dBUBoioYAICeqeXnByIuHw5OuXVF2o7nyu224ybh2xn3Yq/+5ztlRUD5DDgdvLpHGUwuFey1bemey+G7LofvepN8f6kBOMZOnS9N8bIQ1dXeufhz71UqivjbF3SuHJocLr5yEwC0iEUNtTX9sQjjSLzx3z5V6bIGzPDfMMxpKr79KCHmQmhQf7wM5RqY1JSXDNA1YKizAKC1WSysKAUAXWML2UV76HQ1TC4VXEvP1HL1gYhLh4OTb12R7jwfsvV8yFbVKMLKw9AJ7gmXTtLVGKsPRABAQVbasW1LAeCTXT9qcnTIUlFxYCUNynlHrKG2Zv9nni3iJiLXqRt/vCqHirixfpfvK+OAJdvD7kWey0m777Xm66Sbl/N5qX5BB9+zG817EFeUkzkzYH0/YkDksb0t4iaWlrZ0ldtmsaiqpAAAjCwHUagvDWNzdeVWeV4DGIy21ldqAJVKe9/+g3xeKj89kWtgcvXY3mZRwyjXGcYDh/SLACTfjsy4f2uAroH3+m+ly70WZKUd3boUAJYEHWS/lk/kUIEXNWBNaMSlw8FJsVdk99s4uNw4E575II73ML6poU7HyEydpdVfirDt2IkGe05o6ehfOLhTulPc2IBv/LZvM76SD44PZvkMGeMshwrW1YBAuqFvYjnUcXL6vVgAGDjU3ueLPfhKWooOgBELBI2KPqoGewC+zHfgzsPwciGk593Z54vdr3dnOVRwlBfxt8yXHQdIACA7+a/0e7GNdbVUGr29rdXSZpRSvG/EAkwikZSJFH3gu5Hnrv38A3H5MVPmGppbva3KTL81X3/kJlsD/IPCYn4JKyvIxWXsxrvajXc7fyAIAEZOnD7Tf50mh6tIPxhqKKkGaHK4JlY2xOW19Y3kUME39M0s14ZGXAwPToq9Iqp/hi/0TqXRbR1cxk9fMHDYmMZnNdEnw9ISrnMNTd19liv6MlQpDFAibpw90t7WOnGeL0vr5fLR+bzUm78d9dt2gK7GUDADMHzd2/L+FAMVgYEGAHokqfyRMM4AAKhoQt5QHPTV0UN5ULFZEfrqyBuK7v6vpCAclSgR9TH01NG8INUswlJUIRL0GXTVCQQAAKrEyFd94H0mMQbgqEYxIBU6zLecG/omBQQSvd8dAxAV+tr1RAMAADUoBnKBy5TrKuiNYWhGLiXsekYvLkO7hxCFoVtoM3o9DkDB6Guny+J/AsYW9wjiZpQAAAAASUVORK5CYII="},{"id":"sticker-16","group":"颜文字","caption":"想哭","dataUrl":"data:image/png;base64,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"},{"id":"sticker-17","group":"颜文字","caption":"蹦跳","dataUrl":"data:image/png;base64,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"},{"id":"sticker-18","group":"颜文字","caption":"怀疑","dataUrl":"data:image/png;base64,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"},{"id":"sticker-19","group":"文字","caption":"好耶！","dataUrl":"data:image/png;base64,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"},{"id":"sticker-20","group":"文字","caption":"收到！","dataUrl":"data:image/png;base64,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"},{"id":"sticker-21","group":"文字","caption":"在的～","dataUrl":"data:image/png;base64,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"},{"id":"sticker-22","group":"文字","caption":"贴贴","dataUrl":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAAFjklEQVR42u1dX2xTVRw+p3+gHaMrwzddou4fMlbEN1xg48UHFokuM2MIGzqcAbsQsjDmjLLNGUGyLCHZAyoulczFZBLFKAQfdCoygzAFFRfNcOJY6Uai0MG6tqsPdd1tb//c295zbu/2fbkPvbe3/dbv1+98v3Pa29FAIECSxpeXCEAI2fRY0g+lsgsA0RUthpwCfDUEeaWibJ2iBYD0zMogoQADUD8FlK5LoQADP0JAhcrwqPwCfA31FcXG6DXQQX1OiCFpNAd88xPkYoUNaxM5AOozhUheg8gSEIkrwh3wLd7+7BEusiADzl2GOPxQYovbBQG8MOeA7/D2547HbcIQRviq6IDzVyCEOlhfjAxQGQZCCKEYf9JkHgCokAGDCACVhyCMP+oWAPojAxa5A2ABOAAZAKALggMAZAAcACAD4AAAGYCZMAAHIAMAdEFwAIAMQBcEwAHIAABdEIYgAEMQHAAsqjZ047bN9zzTwdu1T1fbt7+gXZa4345mhuvOsYqXdkg5M//B3A8630lnlkWQATTREaodlrRpQ6miJ1NVWbToAMGTr7BY78teGXH/teujPr9P0gunkvRnyKLFDBCifNMTe3fujji4pX7r+MRNzbFopwsKe3KagCvuvY6TfY6TfREHayu22WvqObFo3QFBbK6rnLg1SQjZ+mRlY51d0yway4Aow6vwSHKDLxU9kB3LguiCqJz6RIwclIpGD51OF0NyFixad4Dc3XDUVFTba19Uk4VgLYhgLSiVLogGd2n03YTXi9PY7Q0fFjgAnweomQEyViIYsWj/I0kpDWPq2vBh0eJqqARlqvbUjIxeiz5H7e919PcKjwz0n80wm9VhQQYgA1LNAEqpnBlSXEvxYVkYM2HP3Id/GWZz/NFZR3XiP212dlZKBdiwaH8tyOv3uqemgntWizV+Oh5+9Y2y9RuER1yTrvIdFQn0Z8eyADLg95E/ZgP/v7lMJpOmWbQxE865P+fCmXOh3WMn3g3dfq/PUVZSeur9j2Ss3Yt3KeXGonkH+Hy+z744HdoddzmbO17x+/1aZFG0AJTw2T4+c2rc5RRyX7w81PX20bDToq71yzmBD4uCm46P/E6Xq7vnmLj+H37S/+nZz5XShg+LshsPB0zPTB/oaHFPuYMvaG2RreqpZ0Kv79DRt34e/iV1ZfiwKL4x/0zY4/E0tbf8Onw1dGRvfUPBw3mDP3w/+vdfhJAZr7ep7eUT3T0rw79Osr+1Od1YGGUAZbfddt9paNl3/sJgiO/Zyuri1WuWmkztza16vT54cOLWZNPrLV6/T16/wZeF0cawCxr5c2T77p1DV+b/eY2tqNhetyd4e3XhI7VV81/oHBu/4bzpTFsWTXZB2dnZwvG0MK+gq6PTYDSETthV83zeQ7mEkPzcfEf38ZwHciIWCcQQj858WJhmAKtZhjVrRWf7keca6jwej62ouKuj07LcIjzBaFhysOm14709bQcOipd8D7e+WVZSGrZIMOEqr94SoQ0fFq2uBeXn5u1vaLw6/FujfZ/RYBSfsKqg8EjbIYnLkDq9LsuSNX//3JdF+LAw++3osRtYlMcVMgTXiAG4QgYOAHClPIYgAEMQ2lAADkAGAOiC4AAAGYAuCIADkAEAuiA4AEAGwAEAMgAOAJABmAkDcAAyAEAXtCBAA4EAcf8DIdRBphUZoP4QRNAIoQta5BlACLn7L7TgjYws4U8XYxRS1wGEkHu3IQc/mC3IgHRzACFk+g4U4QHT8hhdkOAOgIP60f5/AMJY5XnAUpiAJUTyhmdACDNuaKU8lmRKnglHOxVQXP3YDgjCCx8oBGOmtDY0ehmmIGAK0i+TMw+IBR9qkBQMy2ROxFAGjtLLL0AQ/ruQNx70GSksRcgFipGU6EL8B1QyJr1nzjCRAAAAAElFTkSuQmCC"},{"id":"sticker-23","group":"文字","caption":"太强了","dataUrl":"data:image/png;base64,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"},{"id":"sticker-24","group":"文字","caption":"摸鱼中","dataUrl":"data:image/png;base64,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"},{"id":"sticker-25","group":"文字","caption":"冲鸭！","dataUrl":"data:image/png;base64,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"},{"id":"sticker-26","group":"文字","caption":"抱抱","dataUrl":"data:image/png;base64,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"},{"id":"sticker-27","group":"文字","caption":"晚安","dataUrl":"data:image/png;base64,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"},{"id":"sticker-28","group":"文字","caption":"早安","dataUrl":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAAHbklEQVR42u1dW1ATVxjeXGhiiGyA8V4lgKBgoYKCjcNwERCHu3JtbdEZCq1aHYEOfWjteJm2tqN2wKJVmGkfZAwiBLkrKDpKx8YRqEABGdKqiIIQMFw6BkL6YBs3tyUJ2U0I/zd52cM5J5vv2+8/5989e6DI5XLEYAwVIwAEQewTDG5K0VuAoctAOK4Y8YQJANQTIINuAgyVAKUGyRBnDAHEwP4sYBc3CwHEpUCgkWTYob8AYgHwZlQNtmsspgL7JEELpZocIC4DugjzQexMDgD2ifWBKr10dU8AS2RC2QHiK8AI8Sa4omUMGC4HcsiDbbR6CILgY8IQNFwBXJCK/wmnw+VvBg4YrgQiTGGCSoUD4PI3GUAAs8oDAKSDIh+uBhbAAfN6DIABAASAEAQAB4ADAOCAeSkABQSAEAQhCAAOAAcAwAHgAAAIMP/yACABHACDMAAcAAIAIASBAwDgAHgeAIAQBCEIAA4wOkZHxzu7/u7sEP3ZIersFO3bmxwSwjOT1dHEYmRkNHRrmhE7LL50istdrleTvr6BmNgD2JIbDUJzEICKIBRSPkaHfiewfPkSR+4KbPvGxhapdIqsn6/1M0cFMOQcAoN8sV1MTPwjvNdmcgHoFhDcBwaGIiL3GNAwI+P4jHXyzx9dv37tHM8DlL8iOTn84MEUvTooKLhcUHBZqUNsn4T+BJXvmouDsDpoNJqeJFBgGjrLkK0ewY3YA4Xgk7csB/D5VXx+FXH9+/h4HDq0x+Dm584VVVXdgkRMr6tS6ScwGG8tW7YEWyIQ1BUX1/j6evr4eHp5ubNYTJyuWSwWmTvImCQEESuAegmfXyUSPenuflRYWEGn07y81uXkfGVlRZ+nIYjNZnE4Nno1kUjGJJIxbX9dvNj+3j2t+wsKhQ9EoieKw6kp2erVq3DYz85Oy85Os+RBODJyS1ZWql7tz5/n5+cXGXZV8vmVKvKnpiaaT+ClW8IkSDt6e583Nt7HluzatQPlLIRp6CwVeFNSUlJ7/Lufde8oL+9CXt4Fvb47MzP1/Q+iLEcA/sUK/sUK4w3C5AQTCjyQgUzYfKehJKcdc/9ekBEREuLn4bFGvfzY0dOdnT2Kw7Aw/5RdOzTdSRVnZhzD7l57+MhBFxcuts6iRfZz2wEcDnr3d7z9YAsLy07n/qo4TEmJ27vvI0S3e3koaoOiqllFff0dLPtstnVmVrqdHareVU3NLSz7Dg4rIiKCLfCZMI2GZzUqhapy7xO/Pj7GxsZPnsjHlny2f7edHUe95pPHfZeKlO5K7dy5neQUwTzeD5j9NBWD3NxfBgfFisMFC5grVy6blk9TqUoyT05OHT7yo1QqVZSsclgRHRtKMiEU+XgrQtgqhC2BiYSePf/SGWdnB2xJS0t7+sdfqO9IbmuLBgTyQkL9Nm70pNFoMpns8NenamtvKin30zEez9sCV0WQCWsWKyY2rL7u9tjYOLZ8ePhlmaC2TFCLogsDg3j9zwfv3m3CVkhMiiKf/dcOaCPSAQkEO+CsigNe49Ur6c2G3yrK64TCFl3+SY7vJq+c3CN0Ot3C8gCT5agMBiNsW1DYtqBnff3l5dcqyuv6+1/gdOHu7jo4OLx06WKTOKCdoK6np6fb2x/qUvNqbUMR/83W4eERwfEJkbo0dHV1YjDewqkglU4Khc0NNxqrKq/LZDL8x85e3u+EhwcHh/ix2daW4AAqlebh4aZLzT9a2lUSHx0basSLgaGuhz2tDzqam9va27qw8xwcyOXypvutTfdbf/j+jL//pvCIYN7mjSQEpTk/CIvFI81NrU+fPu/tffb4UW93918SyeiMrXi8DWLxSFdXjybTSOvrb9fX3+ZwbEK3BiQlxzg4vG3x7wdQ8JcS4bWkUr/9JgfneRmi9Lx3wdZtgYlJMS4ujgiCdHR0l5XWXK1tGB+fQDQsaZWUllQnJEVb4LogI8LWFk1L//DkCbxHAtbWrPd4G7YE+/kH8JhMhqLczc3F7UuXjKxP6q7dEpRWtz7oUGkYFx/h6LhqHq6K0C8Vjk+MLuKX9/b2YQuZTIb7ujXe3h4+vl6e77rjRHMmkxkVHRYVHSbqeSQQVNdUXX/5UoIgiI0NO/3TFKL5MRMBKLOZwtLpVnv27T554qyTk4OzM9d1jfPatS7Oq7n6rr9zcuZmfb53/4G0hht3ygTVAQGbURQlfho60YUAEHhDBoF3xADgAHhPGAAhCEIQABwADgCAABCCAOAA2DcUAA4AAQAwCIMDAOAAcAAAHADPAwAQgiAEAcAB4AAAOAAEAEAIsgBQ5HI5MvkCiDANrBaBA8xi93QYBkCAeT0IW9kDEaYYAOyx74iBCUw7DbWyAy7Ivfzt1N+SBBOYKg9QYGoEGCFl6sPRkgnTOUAOmexrfFEbApFp7wXRUSCFyMsfxR0D3gwGEuCKAPZtdL4bSrcBukhgX7sD/vPBKPBmJPYX6jYN1SzDGBA4C+rZ+uQB2iADDQwCja1nIjaDDONAqc7UWxuUCYMMJFJvqABKYkwA4QiCIDSWwU3/BWB+NYARj3eCAAAAAElFTkSuQmCC"},{"id":"sticker-29","group":"文字","caption":"awsl","dataUrl":"data:image/png;base64,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"},{"id":"sticker-30","group":"文字","caption":"绝了","dataUrl":"data:image/png;base64,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"},{"id":"sticker-31","group":"文字","caption":"救命","dataUrl":"data:image/png;base64,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"},{"id":"sticker-32","group":"文字","caption":"？？？","dataUrl":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAAEYUlEQVR42u2cX0hUWRzHz525OY6Ozg71YDU+yAYSLZWG9kekCE16sYdeYtnteeuhEjbQwLB6KIxACvtH+7JE+BohRCFEmdEWjms+yEJQWNpGOJaRjY3dHiavY042986ZOTr38+E+zHWc3zC/3/l+f/ecO3M0wzCEXYZ6BQghisvtv1azWgCSLrcYFgowFCK9SZehTGoBXpB6WwSTKIOL7KePZFI3nwJe9JFDSVJYb10BZF+mFPosKuDlvwZZk87KdVpSCiD7aSJhYl1kX20N9DmeRJYyyqweMNzP8M8EK9ZqCSyI7GeM+FTrmI9avipg+AnDP7MimE64zvBX34RHBhj+alj+i+YiC2rR8Z8F0YRBWQ8YGZgiC0otCP/BglAAoADHKgABYEFYEFAAB/cALAgFUABQeRXEzQDmAcwDgB5AAQALogkDFoQFAQpgMQ5QAAUAFuOYBwAWxDwAUAAKAJowFgQL2oIGB/u6uq4/GXj06tXQ5OTH/PyC4uJVlRVbd+7c4/cHHBLWBtro80+pR2ls3Nsbup/wKb8/cKTpbFnZlqwPa7MAYRkFqK37eZ5nPR7vxfM3gsGS7A5rtwdoQsIxjdvtLioqDgZLdH1mE4RIZOJaR3v2h7V16LIq6fcH9v5+cPv2XT5foRAiHH7Tevrw48d3Y8+GQj1OCGvvKshI/VizZsNfV27V1//m8xXE/hIILD108Lj5NmNjo1kf1t4h5yqotfXvnBzPN3/0FfjjR5yNN1pcYVVOxDxzPo8QovveTfNxaelaLdvDLqyliGfP/rt0+ZR5Wle3W8obLa6wymbC/f3/NDT8Oj7+NnZaWbm1qqrWaWGtbNYhlc7OjnPnWqLRaOy0pKS0qemM08Iq+1bEw4d32tqazY0AV69ed+LEpcLCnxwVVqUFXb3abn6ejRu3tbV1BALLnBZWZQGePh00Hx840KLrSxwYVuVVUCQyYT4uWh50Zlhri3HvhicFCG5JOnjPOGlfzHr//t2F8yd7ero0TauqqvljX2N+foHTwlq3oJGIrFhHm/d3d982T6urdxw73u60sCotqDf0YNZp7wMpwRdXWMuXoRLvLpSt3xQfurx8swPDWj3cR/5sllXMiorqcPjN69cjubnempr6Qw0tOYnWHbM7rOUeMP5/RIDge0F8Mw6YiGFBgAJQANCE+ZUkYEEUANgrAgUA8wAUAMwDsCDAgigAYEE0YWAxjh4AFIDFOEABFACYBzAPACwICwIUgALANpphGNEPEyRCzfDP82JB6n8nLHAhmrCze4AQYmqCNpBp3F5v3I5ZuJBaC3LneslFRof/dMLj9oxDBGqbsNuDCDI1/ONSrZmbpsX4HKEbp3nIzx7oc7atxIjUzgNcORhROtM9J72uZP4J0pT9BD3AxPj0gZTJnPEuybO2FPG9F4DE7M+ngBkpRJFCCqnX81JdjPthCEgldT9WwAxIQVi41WJtNdQCU5Rh/mlunp3laJtQDFtJj+cL6L1zdAc6ZVoAAAAASUVORK5CYII="},{"id":"sticker-33","group":"文字","caption":"好家伙","dataUrl":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAAOh0lEQVR42u1deTxVaR9/zl1wrcm+3BDZCUmRkm2MpRQtWqhGezKpzPBSivaUtGramxYtU2kmabG2qVSWQoMQsiVLtmvpvn8czj3Ovd0sF/fzvs/3c/54zrP8zrm/3/NbzzkgTCYT9BcPigEEAMBepf9rkb4K4CFkOlfYqQyaACDrB0MMvRJA/EfI0v7AdtSP55Ag9wcPvWEdNw1IgKznEWxG9V0DIPd5CC7M5KwBiSVMyDWew5qO9EoDIPcHCRwZS9SAJMj9QcbUnnpAghwZXvTQgGS4/YcEVjglYAkgpRRyf+gwRRmBJoifTNAjuP2HHJOVEagB/KEBj8vg9h8eWCohUAOGGRQAAALZMHyAGjDcPuBJaSfkwrCaIGiAhlcAkP/QB0ANgBhOAUAJQBMETRAE1ACoARAwEYMaADEc1VD4MABqAIyCIGAmDE0QBDRBUAMgYCIGNQAC+gCoARBQA2AiBgGLcdAHQEABwEQMAmrA//j3AbzC+f0hr1LuS4yUHiEtO81rzRh9k8G778rS4sznyRUlhRUlhZUlRZZO7jMWr+0rkfY2RtAiJ20jM8OJU/XHWwoJixAmnNz5+6PY62jbfen66YvW8LUGVJYV19VU1dVUFedlz1ziS6C8Y+383PTnvaGz+8J9BRV17nNamxsvHNiKnb59njKz7wJ4++JRZWlRZWlR8j9XzaydfEIPESYwv7He3adQqQifJ2KfP5WgDQRBFFXHDKrmqmrqySurYqcfcjNbW5r7SiQtOQ5rT7B1Zp/Q2YkTAIXK14lYZ2dndXmXAKTkFGnCwv2nhQAEAQeD17xMiuvt1Ts6lv9kwGWCttGEoMOX8D0d7W1vniSgbZqIqLGFNTsremiAAHUwklae+YDq8hJsvyipcdj+Y/SNhb4jlXdpT9vbGEPs/Z4nxDZ9rUfbE21dqAKC7HO+ffs2+BowsPWXDu+MjT5J6Mx4luRp2cOI7zwXO3elP0cKMeeOpD9NxE6NzKfKK6vyfKshbN8ixt+6iLVtXOd1tLelJd9LiLls7+ZpZu3Y5aUZrG1BpQpgFO5dO5vz5vlP7l6648z5KAriAkEa572feDv62on92OloHcO1YYfIZDJhmte6ELq6Vl8vWlP5KWrbRo5DHwty87Jeo201bQMRMQnfGRZf62sBAEwmExMAg9GCLSHjNCD+1qVPxQVpKfeVVDWW/2ePuu7Y4fMBvVsuLCrKfqEXSXGnwzdhp3LKKv7hp4S6RYWfrqqlq2Vo2tdb+1RcQPAreLVjSV1bX06JLiohiQogN/1FWeG/yqM1AQBtLSwBULt9wPuMlxjlitIiaXmFgfCQggysGKdnbIZSSIm9gf4AAUEhe7cFAIBnD//5Ul0JAEBIJDExccKF3r16dnSLH7PbyIqPGBmw/4zECEmOxUEEMHevX5z5/FHvb0zf1GLx+hC8Q8VuoOTDvy8S7xLo28+cfz5yG3p6/6/z3v5hBA341tmBUki8HY11mts6S0rJDKSgOdAw1HiSzQKfwPmrf29jtHbvVr0FPoELfAIFaV15jZiEJEIiXiju2rn29rYuAyVE8w8/Kac0amjs4fWTkex/KW+Kk7ugEA1tP4671dz4FQDQ1tqCyzyaAAANtTWpCSzhOc79hS8SsU8fCxnd96quY4jS/FJVjvbIyCshXE3XvNW/aegYEib4bT88wLtSUlG//CSf0Jn18vHL5HvsNyMiKmZu65x05zoAgNHakhL7l+OcxQ11X7A5zV8bEADirp7FAjZd4wmjtfT4wgnnZ6djbZSVdTVVmEhkFencl4tJSHKfwGhtmblotelku4qSotLCvKK8nIbaGnRIQFDI2mW2rauHiJhEzwiy8+7Vs0l3rvvv+UNaThGrPZwOD/neVayc3VEBAAAe3LhoPW1OS1MjNlpRWtzS3HT/Bit2cpm/lF8Ssfx36bh43whBQFFeNtZDHz0mzGd+9psX31t+KGTdoZB1LEY4ua0K3pN053rK3ZsNtTW1n6uxgJ1TCtZuYmkzSoMVI9V+rrp/48KDG5caG+oAAJGb1m49doVMoQAAEm5fqSgt5hChIgAAoGM0Xp6uWlFSBACgiYgU4HYVAKC8pDDhdnRzYwN6Okpdy9hi6sC5x5tSRG5GGtoYISWD7vcPOVnYqIqGTj9ojrO0K/9YWFqYT+A+mUIZpaE9Rs8Iy8APBPl8+vgBAJCT/jJy868+MyffPHsU5T4AIP9dxuWocLQtMVKa+0XtXD0m2jhujbqy4/StmqoK/NCH3CxpOUVZRWX01NVzBcKLzcsDH/C1rrasqMvUahmMQwlmpKZgEzQNjO9E9zm4FZcYsWbT3oigtTKKyvLKKvLKKgp0VRUNHfpoTYRESnv04GCIX0d7OwCgpblpr/9yEplcVlRAoKMwSs3GZbaVszvSdXtdBVo9k4nvXqeyO6RpOKtSkJ2BJ9XS1CiroHQg+uHDmOjUhNhJdi4In5QistKeYEHFaB19AEB9bU1+dma3/dEUHzFSVpHeUFdLyJJampu6akey8jQRMWxISlYebRiMn3T6/musv43R+vbVs4S/rz5PjKvv9gHd9qGIcFdahuM8VmzQNTbDd0rJyo+UkWtpapy3amPwslncf9erx/GEntdPk9R1DB3cFzq4L+SjYlxBTibWvn3hhIauYX525rfuMtY4SxsEAauDdxNW7f195cuUh2h7oU/AJHsXzhXWyk/Febnvs16/z3yVn52JLxkJCtFGqWvmvcvguLD+y2ctA2P2X6emqadtZCopJc3uA/DIe5tOMEEAgEdxN+cs9eW7YtzcZX6lhfnpqSkAgKav9TvWLRESFsVGLeyc+0f2z0M7H8ZcwcchrJxZiW4zfa79DI+stGcRQazHAJ5rA0XFJY5tD0CDlr8vn5rptZKw1sLO2dzWqfZzJfer3712Hicz3cJ/swEAlWUl716l6o2byEMBkJDuQlW/DyEaLSD8xFRnd8wrYm5TXcdAbYwOx1XslTLC4eC2EPRMl2TklX6etTDs+JXD1xOnOEw/tj0Az30AQP2XamsnN/rorlrsleMRGc8fEchO+dmVyvZohTDnc3nps4RYbHSpfyiWo109GTlwjuEP3kRBZDJ5TfBut0WrCP0uHkv6TVNOib7Eb5OUnIKFnfMSv037L949ejPZe8MWKVn5MxFh6zwcMAuGISf9JUIizfH+FUsFIoJ9uYS/38OZA9s6Ozqw7a+pb2RsboVdIu1xAm81gMmrw8LWSahn1TPmwh81lZ84TiaUYjgeNi7ux2+lrA874DzHi66m/j4z7dDWDWtn2cRePYdmeQKCQo6zPPEZAAKY5jYO4yZZd6WvjV9Dfb3iY6K5XB30HHoWfwcvWqc5ixDAnOwwDeuJ2hFY97mKV0wjIQjgyfHh/dstPgsJzwWL8nIDvN3zczLZ5zNxzzoAV8rF+bkXj4WvdrMOXuGREheDPvYRpNEcZ3se/Sth/ko/XLmmGV2yMiBMtDsx7uzoiNoVvHn1/NLCPDxZ1sVxnR8Lco9sD8CGFFXUpjq5IgiYYGWvoqHdZehqa/YH+7YxWnjCN96YoNTEe1t8vBobWBkTidRV06+rqd68asHT+FhisR4XY7BnNLWfqx/EXInY5OftZL7Bc9rN88erK8rQIZqwiNuilcduJC5ZF9TGaD2+ZzO2SkRcHG2MlJHz33WYQqXioqlyzI5/D8UF70N//YXRXYJGEGS5/1b0hyAIMm8FK1fPyUjb5ueNhdHDmYg1N349sS80+e4tPDe91wfLKCiHB65F651tjNZbF07SVTVExMRFxSUoFGpq0j00ruiqRUtIEm6jndF6/tButCTJyqroqnO8feL/vn7jXNSNc1HsNzNaSw+jYzBuou/mPZFb/Ts7OhToqqFH/sTSC8ApCnj9NOlAyMZGXNbtPMfL0JT1wMtssq2BqXlW2jP0NPvNy+AVHn6hEXQ1jeEMQ4sL3j+NZ5VnERJpVcA2u+mzAQCB4cd3/baqjdGqoWsYEnnmyPbA1KT7HB24ho4BuwdeHbg9PMi3u/Ci6Trf28rRlUQif6mufPsqlUPyjCBOsz3xPZb2LiOl5S4c27dxx8GR0rJcfkXstT9P7gvF9xiOt1jkG0gs0G7dt97Lta6mGjOwGxfNCNr3h+F4iwE44YGZMF0j0w3bItByv5SM3OYDp+xdZ6NDxhMtN0eeHms2aevhc6Li4mqanCtCUx1niIiJsVOeZOc4xWGapb3LtqhLkZfu2Li4kclkBAH6JmbsRIRowmuCduibmBGI6JmM33kiWkpGlp0+fvtPsLITH8GqyGobmgTuPUahkAlLJKVlNm6PxD8x1TUy1TMePyAeltTz4HWEmIunCvNylm3YLCIm/r05L1Ie7vQnxqk6Y003HThJY3slDXB9A+XC0X0AASQymUKhCtGEZeQVxppZikmM6D2RqvKyFTOmom2HmR4rA8JeP00O81sKAJhgZe8Xuo+Lw0h7nLj3P75tjFZtQ5OQg2eFaLSBsA4prR+i90Fqa6qvnzmGkBAEIVGoVHEJSXUdfQOTCewPy4YAVeVly3ECWBUQBgA4tX+bpLTsTM9lPyxzvs96czEq4vddh7lsOL4TAAR8Oxp+HwABNQAKAAJ+JQm/E4aAX8pDHwABNQBqAARMxKAGQB8AATUAJmIQ0ARBEwQBi3FQAyBgIgY1AAJGQVADIKAGwEwYApogaIIgoAbARAxiMIEwmcxm3N+FghhKCAvSoA/gg78dDY0QjIL+v30AAKC1DbqBoYaQAA1qAN9oAACAAZVgCCEoQIM+gM80AADQ1g6VYCggQKVxFgAAoB3KYJBBpdJgGMqvJgh0/WsJqASDlvdSaT9OxNgnQQwS9zlrAOj6mxjNkGU8BJki3LdSxPcWQPCQ+9w0AMM3qAoDAOlH+5g0cBIQA2HdjzUAA7MTqkKvg0uycP/DUCiGoWF9PwXQM1SCwkCdbP+t9H8BByeSEs+Jn1MAAAAASUVORK5CYII="},{"id":"sticker-34","group":"文字","caption":"谢谢","dataUrl":"data:image/png;base64,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"},{"id":"sticker-35","group":"文字","caption":"辛苦了","dataUrl":"data:image/png;base64,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"},{"id":"sticker-36","group":"文字","caption":"我悟了","dataUrl":"data:image/png;base64,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"}]}
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
    var CUSTOM_PACK_ID = 'custom'
    var API_SETTINGS = '/more-emoji/api/settings'
    var SETTINGS_DEFAULT = {
      hideClient: false,
      preferCustom: true,
      allowedPacks: [],
      customWords: [],
    }

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
      settings: SETTINGS_DEFAULT,
      settingsStatus: 'loading',
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
      if (id === 'custom') return '常用'
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
      var list = Object.keys(next).map(function (k) {
        return next[k]
      })
      writeJson(STORAGE_FAV, list)
      setStore({ favorites: next })
      // 同步给 Host，让 emoji_pack / 系统提示也能按收藏加权
      saveSettings({ favoriteItems: list.map(function (entry) { return entryText(entry) }) })
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

    // ── 设置（与 Host 共用一份：DSH_HOME/more-emoji/settings.json）────
    function normalizeSettings(raw) {
      var input = raw && typeof raw === 'object' ? raw : {}
      return {
        hideClient: input.hideClient === true,
        preferCustom: input.preferCustom !== false,
        preferFavorites: input.preferFavorites !== false,
        favoriteItems: Array.isArray(input.favoriteItems)
          ? input.favoriteItems.filter(function (w) { return typeof w === 'string' && w !== '' })
          : [],
        allowedPacks: Array.isArray(input.allowedPacks)
          ? input.allowedPacks.filter(function (id) { return typeof id === 'string' })
          : [],
        customWords: Array.isArray(input.customWords)
          ? input.customWords.filter(function (w) { return typeof w === 'string' && w !== '' })
          : [],
      }
    }

    function loadSettings(attempt) {
      var tries = typeof attempt === 'number' ? attempt : 0
      function failed() {
        if (tries < 1) {
          window.setTimeout(function () { loadSettings(tries + 1) }, 2000)
        } else {
          setStore({ settingsStatus: 'error' })
        }
      }
      try {
        window
          .fetch(API_SETTINGS, { credentials: 'same-origin' })
          .then(function (response) { return response.json() })
          .then(function (payload) {
            if (payload && payload.settings) {
              setStore({ settings: normalizeSettings(payload.settings), settingsStatus: 'ready' })
            } else {
              failed()
            }
          })
          .catch(failed)
      } catch (error) {
        failed()
      }
    }

    function saveSettings(patch) {
      // 只发发生变化的字段：Host 做 read-merge-write，避免「设置还没加载完就点开关」把别的配置覆盖掉。
      var delta = patch && typeof patch === 'object' ? patch : {}
      var next = normalizeSettings(Object.assign({}, store.settings, delta))
      setStore({ settings: next, settingsStatus: 'saving' })
      try {
        window
          .fetch(API_SETTINGS, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(delta),
          })
          .then(function (response) { return response.json() })
          .then(function (payload) {
            if (payload && payload.settings) {
              var persisted = payload.persisted !== false && payload.ok !== false
              setStore({ settings: normalizeSettings(payload.settings), settingsStatus: persisted ? 'saved' : 'error' })
            } else {
              setStore({ settingsStatus: 'error' })
            }
          })
          .catch(function () { setStore({ settingsStatus: 'error' }) })
      } catch (error) {
        setStore({ settingsStatus: 'error' })
      }
    }

    function allowedPackSet() {
      var list = store.settings.allowedPacks
      return list && list.length > 0 ? new Set(list) : null
    }

    function isPackAllowed(packId) {
      var allow = allowedPackSet()
      return !allow || allow.has(packId)
    }

    function entryAllowed(entry) {
      if (!entry) return false
      if (entry.kind === 'sticker' || entry.kind === 'custom') return true
      return isPackAllowed(entry.packId)
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
      '.more-emoji-item[data-kind="custom"]{font-size:12.5px;border:1px solid var(--dsw-alias-border-l1);margin:1px}',
      '.more-emoji-page{padding:2px 0 18px;font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.more-emoji-page-title{font-size:16px;font-weight:650;margin:0 0 4px}',
      '.more-emoji-page-hint{font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:12px;line-height:1.5}',
      '.more-emoji-page-summary{font-size:12.5px;color:var(--dsw-alias-label-secondary)}',
      '.more-emoji-page-row{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:pointer}',
      '.more-emoji-page-row-main{min-width:0}',
      '.more-emoji-page-row-title{font-weight:550}',
      '.more-emoji-page-row-desc{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:2px;line-height:1.45}',
      '.more-emoji-page-switch{accent-color:var(--dsw-alias-brand-primary);width:16px;height:16px;margin:2px 0 0}',
      '.more-emoji-page-section{margin:16px 0 8px;font-weight:600;font-size:13px}',
      '.more-emoji-page-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
      '.more-emoji-page-btn{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:7px;font-size:12px;padding:3px 10px}',
      '.more-emoji-page-btn:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.more-emoji-page-count{margin-left:auto;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.more-emoji-page-kind{margin-bottom:8px}',
      '.more-emoji-page-kind-title{font-size:12px;color:var(--dsw-alias-label-secondary);margin:4px 0}',
      '.more-emoji-page-grid{display:flex;flex-wrap:wrap;gap:4px 14px}',
      '.more-emoji-page-check{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;cursor:pointer}',
      '.more-emoji-page-check input{accent-color:var(--dsw-alias-brand-primary);margin:0}',
      '.more-emoji-page-custom{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;min-height:24px}',
      '.more-emoji-page-empty{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.more-emoji-page-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 6px 2px 10px;font-size:12.5px}',
      '.more-emoji-page-chip-x{border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:13px;line-height:1;padding:0 2px}',
      '.more-emoji-page-chip-x:hover{color:var(--dsw-alias-state-error-primary)}',
      '.more-emoji-page-add{display:flex;gap:8px}',
      '.more-emoji-page-input{flex:1;min-width:80px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:12.5px;padding:5px 9px;outline:none}',
      '.more-emoji-page-input:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.more-emoji-page-status{margin-top:10px;font-size:12px;color:var(--dsw-alias-label-secondary);min-height:16px}',
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

      if (tab === 'custom') {
        var words = (store.settings.customWords || []).filter(function (word) {
          return needle === '' || word.toLowerCase().indexOf(needle) !== -1
        })
        if (words.length > 0) groups.push({ id: 'custom', title: '常用（' + words.length + '）', kind: 'custom', items: words })
        return groups
      }

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
          if (!entryAllowed(entry)) return false
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
        if (!isPackAllowed(pack.id)) return
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
      else if (tab === 'custom') entry = { kind: 'custom', packId: CUSTOM_PACK_ID, item: raw }
      else entry = { kind: tab, packId: group.id, item: raw }
      if (isStickerEntry(entry)) doSendSticker(entry)
      else doInsert(entry)
    }

    function entryOf(raw, tab, group) {
      if (tab === 'sticker') return { kind: 'sticker', packId: STICKER_PACK_ID, item: raw.sticker.id }
      if (tab === 'fav' || tab === 'recent') return raw
      if (tab === 'custom') return { kind: 'custom', packId: CUSTOM_PACK_ID, item: raw }
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
        if (state.settings.hideClient && state.open) setStore({ open: false })
      }, [state.settings.hideClient, state.open])
      React.useEffect(function () {
        if (state.tab === 'custom' && state.settings.customWords.length === 0) setStore({ tab: 'emoji' })
      }, [state.tab, state.settings.customWords.length])
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
      if (state.settings.hideClient) return null

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
      if (store.settings.customWords.length > 0) {
        tabs.push({ id: 'custom', label: '常用', title: '常用词 / 常用表情（权重更高）' })
      }

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

      if (state.settings.hideClient) return null

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


    // ── 设置页（设置 → 更多表情和颜文字；也出现在插件页）────────────────
    var SETTINGS_STATUS_TEXT = {
      loading: '正在读取设置…',
      ready: '',
      saving: '保存中…',
      saved: '已保存 ✓',
      error: '保存失败：Host 未响应，重启 DSH 后再试',
    }

    function SettingsPage(props) {
      var state = useStore()
      var settings = state.settings
      var status = SETTINGS_STATUS_TEXT[state.settingsStatus] || ''
      var loading = state.settingsStatus === 'loading'
      var debugState = React.useState(0)
      var setDebugRev = debugState[1]
      if (props && props.view === 'summary') {
        return h('div', { className: 'more-emoji-page-summary' }, '配置在「设置 → 更多表情和颜文字」：隐藏面板 / 允许分类 / 常用词')
      }

      var packsByKind = {}
      PACKS.forEach(function (pack) {
        if (!packsByKind[pack.kind]) packsByKind[pack.kind] = []
        packsByKind[pack.kind].push(pack)
      })
      var allowed = settings.allowedPacks

      function togglePack(packId, on) {
        var base = allowed.length > 0 ? allowed.slice() : PACKS.map(function (p) { return p.id })
        var next = base.filter(function (id) { return id !== packId })
        if (on) next.push(packId)
        saveSettings({ allowedPacks: next })
      }

      function setAll(on) {
        saveSettings({ allowedPacks: on ? PACKS.map(function (p) { return p.id }) : [] })
      }

      var inputState = React.useState('')
      var pendingWord = inputState[0]
      var setPendingWord = inputState[1]

      function addWord() {
        var word = String(pendingWord || '').trim().slice(0, 80)
        if (word === '') return
        var next = settings.customWords.filter(function (w) { return w !== word })
        next.push(word)
        setPendingWord('')
        saveSettings({ customWords: next })
      }

      function removeWord(word) {
        saveSettings({ customWords: settings.customWords.filter(function (w) { return w !== word }) })
      }

      var selectedCount = allowed.length > 0 ? allowed.length : PACKS.length

      return h(
        'div',
        { className: 'more-emoji-page' },
        h('div', { className: 'more-emoji-page-title' }, '更多表情和颜文字'),
        h(
          'div',
          { className: 'more-emoji-page-hint' },
          '这些设置同时作用于面板和 DeepSeek 的 emoji_pack 工具（Host 与客户端共用一份配置）。',
        ),
        h(
          'label',
          { className: 'more-emoji-page-row' },
          h(
            'div',
            { className: 'more-emoji-page-row-main' },
            h('div', { className: 'more-emoji-page-row-title' }, '隐藏表情入口（只影响本插件，不关闭官方组件）'),
            h(
              'div',
              { className: 'more-emoji-page-row-desc' },
              '勾选后输入框旁的 😊 按钮与浮层面板都不显示；只影响本插件，不会关闭任何官方组件。这个配置页仍然可用，随时可以关回来。',
            ),
          ),
          h('input', {
            type: 'checkbox',
            className: 'more-emoji-page-switch',
            checked: settings.hideClient,
            disabled: loading,
            onChange: function (event) { saveSettings({ hideClient: event.target.checked }) },
          }),
        ),
        h(
          'label',
          { className: 'more-emoji-page-row' },
          h(
            'div',
            { className: 'more-emoji-page-row-main' },
            h('div', { className: 'more-emoji-page-row-title' }, '优先发送常用表情'),
            h(
              'div',
              { className: 'more-emoji-page-row-desc' },
              '开启后，DeepSeek 需要发表情时会优先用下面「常用」里的词/表情（提高权重）。',
            ),
          ),
          h('input', {
            type: 'checkbox',
            className: 'more-emoji-page-switch',
            checked: settings.preferCustom,
            disabled: loading,
            onChange: function (event) { saveSettings({ preferCustom: event.target.checked }) },
          }),
        ),
        h(
          'label',
          { className: 'more-emoji-page-row' },
          h(
            'div',
            { className: 'more-emoji-page-row-main' },
            h('div', { className: 'more-emoji-page-row-title' }, '收藏也参与优先'),
            h(
              'div',
              { className: 'more-emoji-page-row-desc' },
              '开启后，⭐ 收藏的表情会同步给 DeepSeek，需要发表情时同样提高权重（和常用词一起）。',
            ),
          ),
          h('input', {
            type: 'checkbox',
            className: 'more-emoji-page-switch',
            checked: settings.preferFavorites,
            disabled: loading,
            onChange: function (event) { saveSettings({ preferFavorites: event.target.checked }) },
          }),
        ),
        h('div', { className: 'more-emoji-page-section' }, '允许发送的表情分类（不选 = 全部允许）'),
        h(
          'div',
          { className: 'more-emoji-page-toolbar' },
          h('button', { type: 'button', className: 'more-emoji-page-btn', disabled: loading, onClick: function () { setAll(true) } }, '全选'),
          h('button', { type: 'button', className: 'more-emoji-page-btn', disabled: loading, onClick: function () { setAll(false) } }, '全部允许'),
          h('span', { className: 'more-emoji-page-count' }, '已选 ' + selectedCount + ' / ' + PACKS.length),
        ),
        KINDS.map(function (kind) {
          return h(
            'div',
            { key: kind.id, className: 'more-emoji-page-kind' },
            h('div', { className: 'more-emoji-page-kind-title' }, kind.label),
            h(
              'div',
              { className: 'more-emoji-page-grid' },
              (packsByKind[kind.id] || []).map(function (pack) {
                var checked = allowed.length === 0 || allowed.indexOf(pack.id) !== -1
                return h(
                  'label',
                  { key: pack.id, className: 'more-emoji-page-check' },
                  h('input', {
                    type: 'checkbox',
                    checked: checked,
                    disabled: loading,
                    onChange: function (event) { togglePack(pack.id, event.target.checked) },
                  }),
                  pack.name,
                )
              }),
            ),
          )
        }),
        h('div', { className: 'more-emoji-page-section' }, '常用词 / 常用表情（权重更高）'),
        h(
          'div',
          { className: 'more-emoji-page-custom' },
          settings.customWords.length === 0
            ? h('div', { className: 'more-emoji-page-empty' }, '还没有常用词，下面加一条试试～')
            : settings.customWords.map(function (word) {
                return h(
                  'span',
                  { key: word, className: 'more-emoji-page-chip' },
                  h('span', null, word),
                  h(
                    'button',
                    { type: 'button', className: 'more-emoji-page-chip-x', title: '删除', onClick: function () { removeWord(word) } },
                    '×',
                  ),
                )
              }),
        ),
        h(
          'div',
          { className: 'more-emoji-page-add' },
          h('input', {
            className: 'more-emoji-page-input',
            placeholder: '例如：晚安喵～ / (๑•̀ㅂ•́)و✧ / 抱抱',
            value: pendingWord,
            disabled: loading,
            onChange: function (event) { setPendingWord(event.target.value) },
            onKeyDown: function (event) {
              if (event.key === 'Enter') {
                event.preventDefault()
                addWord()
              }
            },
          }),
          h('button', { type: 'button', className: 'more-emoji-page-btn', disabled: loading, onClick: addWord }, '添加'),
        ),
        h('div', { className: 'more-emoji-page-section' }, '调试与错误上报（本地记录，可随时关闭）'),
        (function () {
          var reporter = window.__dshErrorReporter && window.__dshErrorReporter['dsh-plugin-more-emoji']
          var items = reporter ? reporter.list() : []
          return h('div', { className: 'more-emoji-page-row', style: { display: 'block' } },
            h('label', { className: 'more-emoji-page-row', style: { display: 'flex' } },
              h('div', { className: 'more-emoji-page-row-main' },
                h('div', { className: 'more-emoji-page-row-title' }, '启用错误上报'),
                h('div', { className: 'more-emoji-page-row-desc' }, '只记录本插件相关错误，存在浏览器本地，不会自动上传；取消勾选即手动关闭。')),
              h('input', {
                type: 'checkbox',
                className: 'more-emoji-debug-switch',
                checked: reporter ? reporter.isEnabled() : false,
                disabled: !reporter,
                onChange: function (event) { if (reporter) reporter.setEnabled(event.target.checked); setDebugRev(function (n) { return n + 1 }) },
              })),
            h('div', { className: 'more-emoji-page-row-desc' },
              '最近错误 ' + items.length + ' 条' + (items.length ? '：' + items[0].m : '')),
            h('div', { className: 'more-emoji-page-toolbar' },
              h('button', { type: 'button', className: 'more-emoji-page-btn', onClick: function () { if (reporter) reporter.copyText(); setDebugRev(function (n) { return n + 1 }) } }, '复制报告'),
              h('button', { type: 'button', className: 'more-emoji-page-btn', onClick: function () { if (reporter) window.open(reporter.issueUrl(), '_blank') } }, '去 GitHub 提 issue'),
              h('button', { type: 'button', className: 'more-emoji-page-btn', onClick: function () { if (reporter) { reporter.clear(); setDebugRev(function (n) { return n + 1 }) } } }, '清空')),
          )
        })(),
        h('div', { className: 'more-emoji-page-status' }, status),
      )
    }

    // ── 插件入口 ───────────────────────────────────────────────────────
    exports.inject = ['slots']

    exports.apply = function (ctx) {
    // 客户端调试 / 错误上报：只记本地，面板可手动关闭
    installErrorReporter({
      id: 'dsh-plugin-more-emoji',
      title: '更多表情和颜文字',
      version: '0.7.0',
      
    })

      // 保险丝：任何一个扩展点注册失败都只跳过自己，绝不拖垮整个 Web UI。
      function guard(label, fn) {
        try {
          return fn()
        } catch (error) {
          try {
            console.warn('[more-emoji] ' + label + ' 注册失败（已跳过，不影响界面）', error)
          } catch (ignored) {
            /* ignore */
          }
          return undefined
        }
      }

      guard('样式', function () {
        ensureStyle()
      })
      guard('读取设置', function () {
        loadSettings()
      })
      guard('样式清理 effect', function () {
        ctx.effect(function () {
          return function () {
            var style = document.getElementById(STYLE_ID)
            if (style) style.remove()
          }
        })
      })

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
        'conversation.input.left',
        { name: 'conversation.input.left', id: 'more-emoji-launcher', order: 30, label: '表情' },
        function (props) {
          return h(Launcher, props)
        },
      )
      registerSlot('conversation.input.overlay', { name: 'conversation.input.overlay', id: 'more-emoji-panel', order: 45 }, function () {
        return h(Panel)
      })
      registerSlot(
        'settings.general.item',
        { name: 'settings.general.item', id: 'more-emoji-direct-send', order: 55, label: '更多表情和颜文字' },
        function () {
          return h(SettingsRow)
        },
      )
      registerSlot(
        'settings.section',
        { name: 'settings.section', id: 'more-emoji-settings', order: 56, label: '更多表情和颜文字' },
        function () {
          return h(SettingsPage)
        },
      )
      registerSlot('plugins.bundle.config', { key: 'dsh-plugin-more-emoji' }, function (props) {
        return h(SettingsPage, props)
      })
    }

    return module.exports
  },
})
