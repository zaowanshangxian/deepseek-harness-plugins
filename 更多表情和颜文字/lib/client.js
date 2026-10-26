/*!
 * 「更多表情和颜文字」Client 半侧（浏览器）。
 *
 * 手写的模块壳，不走打包器：DSH Web 壳通过 window.__ModuleLoader__ 装载模块，
 * react 由壳的模块表提供（require('react')），数据由 tools/build.mjs 内联成字面量。
 *
 * 两个 Slot：
 *  - conversation.input.left    → 输入框左侧的启动按钮（😊）
 *  - conversation.input.overlay → 面板（fixed 定位在按钮上方，Esc / 点外部关闭）
 *
 * 插入策略：优先找到 composer 的 textarea / contenteditable，做原生 setter + input 事件，
 * 让 React 受控组件同步；找不到就退回写剪贴板并提示。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-more-emoji',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var DATA = {"KINDS":[{"id":"emoji","label":"表情","hint":"Emoji 表情"},{"id":"kaomoji","label":"颜文字","hint":"日式颜文字"},{"id":"art","label":"文字表情","hint":"组合表情与装饰字符"},{"id":"phrase","label":"短句","hint":"聊天文字短句"}],"PACKS":[{"id":"emoji-face","kind":"emoji","name":"常用笑脸","items":["😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","😉","😌","😋","😛","😜","🤪","😝","🤗","🤭","🤫","🤔","😐","😑","😶","😏","😒","🙄","😬","😮"]},{"id":"emoji-cute","kind":"emoji","name":"可爱卖萌","items":["🥺","😍","🥰","😘","😚","🤗","🫶","🧸","🌸","🌷","🌼","🍭","🍬","🎀","🐰","🐱","🐾","🩷","🥹","😳","🫣","🫠","🎈","🧁","🍓","🦄","🐣","🌙","⭐️","💫"]},{"id":"emoji-love","kind":"emoji","name":"爱心","items":["❤️","🧡","💛","💚","💙","💜","🤎","🤍","🖤","💖","💗","💓","💞","💕","💘","💝","💟","❣️","💔","❤️‍🔥","❤️‍🩹","💌","🫶","😍","😘","🥰","💏","💑","🫂","🌹"]},{"id":"emoji-happy","kind":"emoji","name":"开心庆祝","items":["🎉","🎊","✨","🎈","🎁","🥳","🤩","🎇","🎆","🍾","🥂","🏆","👏","🙌","🕺","💃","🎵","🎶","🎤","🎪"]},{"id":"emoji-sad","kind":"emoji","name":"伤心委屈","items":["😢","😭","🥺","😞","😔","😟","😕","😣","😖","😩","😫","🥹","💔","😿","😥","😰","🫠","😪","😮‍💨","🫥"]},{"id":"emoji-angry","kind":"emoji","name":"生气无语","items":["😤","😠","😡","🤬","🙄","😒","😑","😶","💢","🗯️","👊","😾","🙃","😮‍💨","🫠","💀","☠️","🔪","🤨","😖"]},{"id":"emoji-shock","kind":"emoji","name":"惊讶震惊","items":["😮","😯","😲","😳","🤯","😱","😵","😵‍💫","🫨","🙀","❕","❔","‼️","⁉️","💥","⚡️","😨","😧","😦","🥴"]},{"id":"emoji-cheer","kind":"emoji","name":"加油鼓励","items":["💪","✊","👏","🙌","👍","🔥","✨","🌟","💯","🎯","🚀","🏅","🥇","🎖️","🫡","🤝","🙏","👊","⚡️","💥"]},{"id":"emoji-work","kind":"emoji","name":"工作学习","items":["💻","⌨️","🖥️","📝","📌","📎","🗂️","📊","📈","✅","❌","⚠️","🔧","⚙️","🧠","💡","🔍","📅","⏰","📚","✏️","🖊️","📋","📁","🗃️","🔑","🛠️","🧩","📞","📨"]},{"id":"emoji-food","kind":"emoji","name":"美食","items":["🍚","🍜","🍲","🍣","🍱","🍔","🍟","🍕","🌮","🍰","🎂","🍦","🍧","🍩","🍪","☕️","🍵","🥤","🍺","🍻","🍷","🧋","🍓","🍑","🍇","🍉","🥭","🍍","🥟","🍤"]},{"id":"emoji-animal","kind":"emoji","name":"动物","items":["🐱","🐶","🐰","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🐔","🐤","🦄","🐝","🦋","🐢","🐙","🦊","🐧","🐳","🐬","🦦","🐹","🐿️","🦔","🐺","🐴","🦌"]},{"id":"emoji-gesture","kind":"emoji","name":"手势","items":["👋","🤚","✋","🖖","👌","🤌","🤏","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","👇","☝️","👍","👎","✊","👊","🙏","🤝","💪","🫶","👏","🙌","✍️","🤲","🫰"]},{"id":"emoji-nature","kind":"emoji","name":"天气自然","items":["☀️","🌤️","⛅️","🌥️","☁️","🌧️","⛈️","🌩️","❄️","☃️","⛄️","🌊","🌈","🌪️","🌙","🌟","✨","🔥","💧","🍀","🌱","🌿","🍃","🌸","🌻","🍁","🌾","🌵","🌲","🌴"]},{"id":"emoji-party","kind":"emoji","name":"节日庆典","items":["🎄","🎅","🤶","🎁","🎉","🎊","🧨","🎆","🎇","🎈","🎂","🕯️","🎃","👻","🦃","🍁","🌙","🥮","🏮","🧧"]},{"id":"emoji-symbol","kind":"emoji","name":"符号标记","items":["✅","❌","⚠️","❓","❗️","💯","🔴","🟠","🟡","🟢","🔵","🟣","⚫️","⚪️","🔔","🎵","🎶","🔆","♻️","🆗"]},{"id":"emoji-sleep","kind":"emoji","name":"困倦睡觉","items":["😴","🥱","😪","🛌","💤","🌙","⭐️","🐑","😵‍💫","🥴","😌","🌛","🕛","🛏️","🧸","🌜","☁️","💭","🫧","😶‍🌫️"]},{"id":"kao-happy","kind":"kaomoji","name":"开心","items":["(＾▽＾)","(≧▽≦)","(◕‿◕)","(＾ω＾)","(๑>◡<๑)","ヽ(•‿•)ノ","(◍•ᴗ•◍)","(｡◕‿◕｡)","ヽ(・∀・)ﾉ","(☆▽☆)","(≧∇≦)/","(°▽°)","(๑˃̵ᴗ˂̵)و","(｡•̀ᴗ-)✧","ヾ(≧▽≦*)o","(ﾉ◕ヮ◕)ﾉ","(◠‿◠)","(｡･ω･｡)ﾉ♡","ヽ(＾Д＾)ﾉ","(๑•̀ㅂ•́)و✧"]},{"id":"kao-cute","kind":"kaomoji","name":"可爱","items":["(`･ω･´)","(｡･ω･｡)","(´･ω･`)","(๑´ω`๑)","(◕ᴗ◕✿)","(๑•́ ₃ •̀๑)","(｡>﹏<｡)","(〃∀〃)","ʕ•ᴥ•ʔ","ʕ￫ᴥ￩ʔ","(=^･ω･^=)","ฅ^•ﻌ•^ฅ","(=｀ω´=)","(๑•ᴗ•๑)","(´｡• ᵕ •｡`)","(づ｡◕‿‿◕｡)づ","(◍•ᴗ•◍)✧","ʕ•̀ω•́ʔ✧","(=^･ｪ･^=)","(๑ơ ₃ ơ)ﻭ"]},{"id":"kao-sweet","kind":"kaomoji","name":"撒娇卖萌","items":["(´• ω •`)","(๑´ㅂ`๑)","(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)","(ღ˘⌣˘ღ)","(๑•́ω•̀)","(｡・ω・｡)ﾉ♡","(づ￣ ³￣)づ","♡( ◡‿◡ )","(´ε｀ )♡","(灬ºωº灬)","(◍•ᴗ•◍)❤","(´♡‿♡`)","(っ˘з(˘⌣˘ )","(๑•́ ₃ •̀๑)♡","(⁄˘⁄ ⁄ ω⁄ ⁄ ˘⁄)♡","(๑>ᴗ<๑)","(´,,•ω•,,)♡","(｡•́︿•̀｡)","(๑´∀`๑)","(◕‿◕)♡"]},{"id":"kao-sweat","kind":"kaomoji","name":"汗与无语","items":["(￣▽￣;)","(・_・;)","(´･_･`)","(￣ω￣;)","(；一_一)","(ーー;)","(￣～￣;)","(；´Д｀)","(￣ヘ￣)","(¬_¬)","(⇀‸↼‶)","(・∀・;)","(￣□￣;)","(lll￣□￣)","(￣ー￣)","(¬‿¬)","(－‸ლ)","(ㆆ_ㆆ)","(￣ ￣|||)","(;￢_￢)"]},{"id":"kao-angry","kind":"kaomoji","name":"生气炸毛","items":["(╬ Ò﹏Ó)","(╯°□°）╯︵ ┻━┻","(ノಠ益ಠ)ノ彡┻━┻","(＃`Д´)","(￣^￣)","(¬_¬)凸","(ﾉ｀Д´)ﾉ","(╬ಠ益ಠ)","(ᗒᗣᗕ)՞","(╯°Д°)╯","(＃￣ω￣)","(눈_눈)","(╬￣皿￣)","(｀Д´)","(ಠ_ಠ)","(¬､¬)","(￣皿￣)","(｡•̀ ᴖ •́｡)","(ꐦ°᷄д°᷅)","(ง •̀_•́)ง"]},{"id":"kao-cry","kind":"kaomoji","name":"哭与委屈","items":["(｡•́︿•̀｡)","(╥﹏╥)","(っ˘̩╭╮˘̩)っ","(｡╯︵╰｡)","(´；ω；`)","(ಥ﹏ಥ)","(ᗒᗩᗕ)","(T_T)","(╯︵╰,)","(｡í _ ì｡)","(っ- ‸ - ς)","(>_<)","(｡ﾉω＼｡)","(っ˃̣̣̥⌓˂̣̣̥ς)","(｡ᵕ ᵕ｡)","(｡•́︵•̀｡)","(´;ω;`)","(｡•́ - •̀｡)","(இ﹏இ`｡)","(╥_╥)"]},{"id":"kao-shock","kind":"kaomoji","name":"震惊","items":["(⊙_⊙)","(⊙o⊙)","(ﾟДﾟ)","(゜ロ゜)","(・o・)","(O_O)","(◎_◎;)","(꒪Д꒪)","(ﾟдﾟ)","(｡ŏ_ŏ)","(°ロ°) !","(⊙﹏⊙)","(ﾟΩﾟ;)","(;ﾟДﾟ)","(☉_☉)","(・□・;)","(o_O)","(⊙_☉)","(๑•́ ₃ •̀๑)?","(ﾟ∀ﾟ)"]},{"id":"kao-greet","kind":"kaomoji","name":"打招呼","items":["(｡･ω･)ﾉﾞ","(^-^)/","(＾▽＾)/","ヾ(＾∇＾)","(・ω・)ノ","(｡◕‿◕｡)ﾉ","(＾ω＾)ノ","ヽ(・∀・)ﾉ","(ﾉ´ヮ`)ﾉ","(๑˃̵ᴗ˂̵)و","(o´▽`o)ﾉ","(^-^*)ノ","(／・ω・)／","(｡•̀ᴗ-)✧","(๑>◡<๑)ﾉ","(´▽`)/","ヾ(•ω•`)o","(・∀・)ノ","(｡･ω･｡)ﾉ","(＾◡＾)ノ"]},{"id":"kao-action","kind":"kaomoji","name":"动作加油","items":["(๑•̀ㅂ•́)و✧","ᕦ(ò_óˇ)ᕤ","(ง •̀_•́)ง","٩(๑•̀ω•́๑)۶","ヽ(•̀ω•́ )ゝ","╰(°▽°)╯","(๑•̀ㅁ•́๑)✧","(๑˃ᴗ˂)ﻭ","(ﾉ≧∀≦)ﾉ","└(＾＾)┐","٩(◕‿◕)۶","(๑•̀ ₃ •́)✧","(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧","٩(ˊᗜˋ*)و","ᕙ(`▽´)ᕗ","(๑•̀ㅂ•́)و","┗(＾0＾)┓","(๑•̀ω•́)ノ","(ง •̀ω•́)ง✧","╭(°A°`)╮"]},{"id":"kao-heart","kind":"kaomoji","name":"爱心","items":["(♥ω♥*)","(｡♥‿♥｡)","(´,,•ω•,,)♡","(ღ˘⌣˘ღ)","(◍•ᴗ•◍)❤","(´♡‿♡`)","(灬♥ω♥灬)","(❤ω❤)","(⁄ ⁄•⁄ω⁄•⁄ ⁄)♡","(๑´ㅂ`๑)♡","(ღ•͈ᴗ•͈ღ)","(๑ơ ₃ ơ)ﻭ♡","(づ￣ ³￣)づ","(´ε｀ )♡","(｡・ω・｡)ﾉ♡","(◕‿◕)♡","(๑>ᴗ<๑)♡","(♥_♥)","(ღ˘⌣˘ღ)♡","(灬ºωº灬)♡"]},{"id":"kao-cat","kind":"kaomoji","name":"猫猫","items":["(=^･ω･^=)","(=^･ｪ･^=)","ฅ^•ﻌ•^ฅ","(=｀ω´=)","(=^‥^=)","／(=･ｘ･=)＼","／(=´x`=)＼","(=^･^=)","ฅ(＾・ω・＾ฅ)","(^・ω・^ )","(=ΦωΦ=)","(=；ω；=)","／(≧ x ≦)＼","(=^ ◡ ^=)","ヾ(=･ω･=)o","(=ＴωＴ=)","／(=⌒x⌒=)＼","(=^・^=)","(=•ω•=)","(=^‥^)ﾉ☆"]},{"id":"kao-shy","kind":"kaomoji","name":"害羞","items":["(⁄ ⁄•⁄ω⁄•⁄ ⁄)","(〃∀〃)","(๑´ㅂ`๑)","(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)","(灬ºωº灬)","(￣▽￣*)ゞ","(๑////๑)","(◕///◕)","(〃ﾉωﾉ)","(´-ω-`)","(๑´∀`๑)","(⁄˘⁄ ⁄ ω⁄ ⁄ ˘⁄)♡","(๑•́ω•̀)","(〃▽〃)","(◕‿◕✿)","(´,,•ω•,,)","(๑>ᴗ<๑)","(๑´ㅂ`๑)♡","(≧////≦)","(￣ω￣;)"]},{"id":"kao-sleepy","kind":"kaomoji","name":"困倦睡觉","items":["(－_－) zzZ","(￣o￣) zzZ","(´-ω-`)","(￣﹃￣)","(￣ρ￣)","(˘ω˘)","(∪｡∪)｡｡｡zzz","(－ω－) zzZ","(￣▽￣)~*","( _ _ ) Zzz","(≖_≖ )","(￣.￣)","(´～`)","(￣ω￣)","(˘▽˘)","(ᴗ_ ᴗ。)","(๑ᵕ⌓ᵕ̤)","(´-﹏-`；)","(￣▽￣)ゞ","(－。－)"]},{"id":"kao-long","kind":"kaomoji","name":"长条颜文字","items":["ヽ(￣ω￣(￣ω￣〃)ゝ","(っ˘з(˘⌣˘ ) ♡","ヽ(•‿•)ノ","╰(°▽°)╯","(๑˃ᴗ˂)ﻭ","ლ(´ڡ`ლ)","(っ´ω`)ﾉ(╥ω╥)","ヽ(＾Д＾)ﾉ","＊*•̩̩͙✩•̩̩͙*˚","(๑ơ ₃ ơ)ﻭ","ヽ(´ω`)ﾉ","（￣︶￣）↗","￣へ￣","（づ￣3￣）づ╭❤～","(๑•̀ㅂ•́)و✧","ヾ(⌐■_■)ノ♪","( ͡° ͜ʖ ͡°)","ಠ‿ಠ","(╯‵□′)╯","ᕕ( ᐛ )ᕗ"]},{"id":"art-combo","kind":"art","name":"组合表情","items":["✨(◍•ᴗ•◍)✨","💖(づ￣ ³￣)づ💖","🥺(´• ω •`)🥺","🎉ヽ(•‿•)ノ🎉","🌸(๑>◡<๑)🌸","⭐️(๑•̀ㅂ•́)و✧⭐️","🍀(｡•̀ᴗ-)✧🍀","🔥💪(ง •̀_•́)ง💪🔥","🎀(´,,•ω•,,)♡🎀","🌙(˘ω˘)🌙","💫(◕‿◕)💫","🧸(｡･ω･｡)ﾉ♡🧸","🍓(๑´ㅂ`๑)🍓","🌈(◠‿◠)🌈","🎈(๑>◡<๑)🎈","☕️(￣▽￣)~*☕️","🫶(♥ω♥*)🫶","🌸(⁄ ⁄•⁄ω⁄•⁄ ⁄)🌸","✨(๑˃ᴗ˂)ﻭ✨","💤(－ω－) zzZ💤"]},{"id":"art-frame","kind":"art","name":"框框字","items":["╭━━━━━━╮\n┃ 好耶！ ┃\n╰━━━━━━╯","╭━━━━━━╮\n┃ 收到！ ┃\n╰━━━━━━╯","╭━━━━━━╮\n┃ 贴贴～ ┃\n╰━━━━━━╯","╭━━━━━━╮\n┃ 晚安啦 ┃\n╰━━━━━━╯","╭━━━━━━╮\n┃ 谢谢你 ┃\n╰━━━━━━╯","╭━━━━━━╮\n┃ 冲鸭！ ┃\n╰━━━━━━╯","╭━━━━━━╮\n┃ 震惊！ ┃\n╰━━━━━━╯","╭━━━━━━╮\n┃ 无语… ┃\n╰━━━━━━╯","╭━━━━━━╮\n┃ 抱抱你 ┃\n╰━━━━━━╯","╭━━━━━━╮\n┃ 辛苦啦 ┃\n╰━━━━━━╯","┏━━━━━━┓\n┃ 好家伙 ┃\n┗━━━━━━┛","┏━━━━━━┓\n┃ 绝了！ ┃\n┗━━━━━━┛","┏━━━━━━┓\n┃ 明白了 ┃\n┗━━━━━━┛","┏━━━━━━┓\n┃ 在的～ ┃\n┗━━━━━━┛","┏━━━━━━┓\n┃ 安排了 ┃\n┗━━━━━━┛","┌────────┐\n│ 摸鱼中 │\n└────────┘","┌────────┐\n│ 建设中 │\n└────────┘","┌────────┐\n│ 已阅 ✓ │\n└────────┘","┌────────┐\n│ 待机中 │\n└────────┘","┌────────┐\n│ 加载中…│\n└────────┘"]},{"id":"art-divider","kind":"art","name":"分割与装饰","items":["·:*¨༺ ༻¨*:·","✧･ﾟ: *✧･ﾟ:*","₊˚⊹ ☾ ⋆⁺₊✧","⋆｡°✩ ⋆｡°✩","┄┄┄ ✦ ┄┄┄","━━━━━━━━━━","══════════","✦•┈๑⋅⋯ ⋯⋅๑┈•✦","˚₊· ͟͟͞͞➳❥","✩₊˚.⋆☾⋆⁺₊✧","๑⋅⋯⋯⋅๑","·˚ ༘ ⋆｡˚","☆.。.:*・°☆","⊹ ࣪ ˖ ୨୧ ˖ ࣪ ⊹","♡₊˚ 🦢・₊✧","─=≡Σ((( つ•̀ω•́)つ","～(￣▽￣～)(～￣▽￣)～","☽ ⋆｡°✩₊˚","ੈ✩‧₊˚","⋆ ˚｡⋆୨୧˚"]},{"id":"art-symbol","kind":"art","name":"符号表情","items":["¯\\_(ツ)_/¯","(☞ﾟヮﾟ)☞","☜(ﾟヮﾟ☜)","( ͡• ͜ʖ ͡•)","ಠ_ಠ","ಠ‿↼","(╯︵╰,)","ᕕ( ᐛ )ᕗ","(⌐■_■)","ヽ༼ຈل͜ຈ༽ﾉ","(ง ͠° ͟ل͜ ͡°)ง","༼ つ ◕_◕ ༽つ","(•_•) ( •_•)>⌐■-■","(⌐■_■)ᕤ","┬─┬ ノ( ゜-゜ノ)","( ﾟдﾟ)","(☞ﾟ∀ﾟ)☞","♪(┌・。・)┌","┌(・。・)┘♪","(＾＾)ｂ","d(￣▽￣)b"]},{"id":"phrase-praise","kind":"phrase","name":"夸夸","items":["太强了吧！","好厉害～","绝了！","yyds","666","不愧是你","这也太顶了","牛哇！","满分！","干得漂亮","我直接跪了","好耶～","棒耶！","太牛了"]},{"id":"phrase-cute","kind":"phrase","name":"撒娇","items":["贴贴～","抱抱","摸摸头","要抱抱","呜呜呜","好嘛好嘛","求求了","你最好了","不可以凶我","哄哄我嘛","我不管我就要","人家不依","哼唧","要贴贴"]},{"id":"phrase-reply","kind":"phrase","name":"日常回复","items":["收到！","好滴","好嘞","没问题","明白啦","懂了懂了","在的在的","稍等我一下","马上来","安排上了","这就去","有道理","确实","可不是嘛","笑死","哈哈哈哈","真实","离谱","可以可以"]},{"id":"phrase-greet","kind":"phrase","name":"早晚安","items":["早安喵～","早安呀","起床啦","新的一天冲鸭","午安","该休息啦","晚安","好梦","早点睡呀","别熬夜了","睡个好觉","明天见","梦里见","晚安喵"]},{"id":"phrase-moyu","kind":"phrase","name":"摸鱼吐槽","items":["今天也是摸鱼的一天","上班如上坟","不想上班","想下班","卷不动了","躺平了","摆烂中","打工人实锤","工资到账了吗","先摸一会儿","累了困了","老板不在嘿嘿","今日份快乐","摸鱼被抓"]},{"id":"phrase-cheer","kind":"phrase","name":"鼓励","items":["加油鸭！","你可以的","别放弃","相信自己","已经很棒了","慢慢来不着急","会好起来的","我陪着你","冲鸭！","稳住","别慌","包在我身上","一定行","坚持住","你是最棒的"]},{"id":"phrase-festival","kind":"phrase","name":"节庆祝福","items":["新年快乐！","万事如意","恭喜发财","生日快乐","节日快乐","中秋快乐","国庆快乐","春节快乐","圣诞快乐","元宵快乐","端午安康","七夕快乐","元旦快乐","新年暴富"]},{"id":"phrase-meme","kind":"phrase","name":"网络梗","items":["真香","破防了","emo了","栓Q","绝绝子","蚌埠住了","笑不活了","离大谱","我的妈呀","狠狠爱了","一眼真","纯纯大冤种","社死现场","爷青回","针不戳","格局打开","拿捏了","离谱他妈给离谱开门"]},{"id":"phrase-heal","kind":"phrase","name":"温柔安慰","items":["辛苦啦","别难过","抱抱你","我懂你","慢慢来","会好的","别自责","你已经很好了","先休息一下吧","给自己一点时间","我在呢","别怕","有我在","会过去的"]},{"id":"phrase-work","kind":"phrase","name":"工作沟通","items":["收到，我看看","马上处理","稍等","这个我来","已完成","同步一下","确认无误","辛苦了","麻烦啦","感谢配合","有问题随时说","进度如何","截止什么时候","先对齐一下"]}]}
    var KINDS = DATA.KINDS
    var PACKS = DATA.PACKS
    var h = React.createElement

    // ── 小工具 ─────────────────────────────────────────────────────────
    function kindLabel(id) {
      for (var i = 0; i < KINDS.length; i += 1) {
        if (KINDS[i].id === id) return KINDS[i].label
      }
      return id
    }

    // ── 弹层状态：模块级 store，按钮与面板各占一个 Slot，靠它同步 ──────
    var store = { open: false, kind: 'emoji', query: '', anchor: null }
    var listeners = new Set()

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

    // ── 记录 composer 控件，插入时定位光标 ────────────────────────────
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
      return rect.width > 40 && rect.height > 10
    }

    function findComposer() {
      if (lastComposer && isVisible(lastComposer)) return lastComposer
      var candidates = Array.prototype.slice.call(
        document.querySelectorAll('textarea, [contenteditable="true"]'),
      )
      var hinted = candidates.filter(function (el) {
        var hint = (el.getAttribute('placeholder') || '') + (el.getAttribute('aria-label') || '')
        return /消息|发送|输入|Message|Ask|Composer/i.test(hint)
      })
      var pool = hinted.length > 0 ? hinted : candidates
      var best = null
      var bestArea = 0
      for (var i = 0; i < pool.length; i += 1) {
        var el = pool[i]
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

    function copyToClipboard(text) {
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

    function insertAtCaret(el, text) {
      if (el.tagName === 'TEXTAREA') {
        var start = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length
        var end = typeof el.selectionEnd === 'number' ? el.selectionEnd : start
        var next = el.value.slice(0, start) + text + el.value.slice(end)
        var descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
        descriptor.set.call(el, next)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        var caret = start + text.length
        window.requestAnimationFrame(function () {
          try {
            el.selectionStart = caret
            el.selectionEnd = caret
          } catch (error) {
            /* ignore */
          }
        })
        return true
      }

      var selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) {
        var range = document.createRange()
        range.selectNodeContents(el)
        range.collapse(false)
        if (selection) {
          selection.removeAllRanges()
          selection.addRange(range)
        }
      }
      try {
        if (document.execCommand('insertText', false, text)) return true
      } catch (error) {
        /* fall through */
      }
      try {
        var live = window.getSelection()
        if (!live || live.rangeCount === 0) return false
        var caretRange = live.getRangeAt(0)
        caretRange.deleteContents()
        var node = document.createTextNode(text)
        caretRange.insertNode(node)
        caretRange.setStartAfter(node)
        caretRange.collapse(true)
        live.removeAllRanges()
        live.addRange(caretRange)
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
        return true
      } catch (error) {
        return false
      }
    }

    // ── 提示条 ─────────────────────────────────────────────────────────
    var toastSeq = 0

    function toast(message) {
      var host = document.getElementById('more-emoji-toasts')
      if (!host) {
        host = document.createElement('div')
        host.id = 'more-emoji-toasts'
        host.setAttribute('aria-live', 'polite')
        document.body.appendChild(host)
      }
      var item = document.createElement('div')
      item.className = 'more-emoji-toast'
      item.textContent = message
      host.appendChild(item)
      toastSeq += 1
      var id = toastSeq
      window.setTimeout(function () {
        item.classList.add('more-emoji-toast-out')
      }, 1200)
      window.setTimeout(function () {
        if (item.parentNode) item.parentNode.removeChild(item)
        if (host && host.childNodes.length === 0 && id > 0) {
          // 保留下次复用
        }
      }, 1700)
    }

    function insertText(text, options) {
      var el = findComposer()
      var ok = false
      if (el) {
        try {
          el.focus()
          ok = insertAtCaret(el, text)
        } catch (error) {
          ok = false
        }
      }
      if (!ok) {
        var copied = copyToClipboard(text)
        toast(copied ? '已复制到剪贴板，粘贴即可' : '没找到输入框，请手动复制')
        return false
      }
      if (options && options.keepOpen !== false) {
        toast('已插入' + (options.label ? '：' + options.label : ''))
      }
      return true
    }

    // ── 样式（主题变量，自动适配深浅色）────────────────────────────────
    var STYLE_ID = 'more-emoji-style'
    var CSS = [
      '.more-emoji-launcher{display:inline-flex;align-items:center;justify-content:center;',
      'width:28px;height:28px;border-radius:8px;border:none;background:transparent;',
      'cursor:pointer;font-size:15px;line-height:1;padding:0;transition:background .15s ease,transform .15s ease;',
      'color:var(--dsw-alias-label-primary)}',
      '.more-emoji-launcher:hover{background:var(--dsw-alias-bg-layer-2);transform:translateY(-1px)}',
      '.more-emoji-launcher:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.more-emoji-panel{position:fixed;z-index:2147483000;width:396px;max-width:92vw;',
      'background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);',
      'border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.18),0 2px 8px rgba(0,0,0,.08);',
      'display:flex;flex-direction:column;overflow:hidden;color:var(--dsw-alias-label-primary);',
      'font-size:13px;backdrop-filter:blur(8px)}',
      '.more-emoji-head{display:flex;align-items:center;gap:6px;padding:8px 10px 6px;',
      'border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.more-emoji-tab{border:none;background:transparent;color:var(--dsw-alias-label-secondary);',
      'cursor:pointer;padding:4px 9px;border-radius:8px;font-size:12.5px;line-height:1.4}',
      '.more-emoji-tab:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.more-emoji-tab[data-active="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary);font-weight:600}',
      '.more-emoji-search{margin-left:auto;width:110px;border:1px solid var(--dsw-alias-border-l1);',
      'border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);',
      'font-size:12px;padding:3px 7px;outline:none}',
      '.more-emoji-search:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.more-emoji-close{border:none;background:transparent;color:var(--dsw-alias-label-secondary);',
      'cursor:pointer;width:22px;height:22px;border-radius:6px;font-size:14px;line-height:1;padding:0}',
      '.more-emoji-close:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.more-emoji-body{overflow-y:auto;overscroll-behavior:contain;padding:6px 8px 10px;max-height:min(46vh,360px)}',
      '.more-emoji-group-title{position:sticky;top:0;z-index:1;padding:4px 2px 3px;font-size:11px;',
      'color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-overlay);',
      'letter-spacing:.02em}',
      '.more-emoji-items{display:flex;flex-wrap:wrap;gap:2px;margin-bottom:4px}',
      '.more-emoji-item{border:none;background:transparent;color:var(--dsw-alias-label-primary);',
      'cursor:pointer;border-radius:7px;padding:3px 5px;line-height:1.3;font-family:inherit;',
      'transition:background .12s ease}',
      '.more-emoji-item:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.more-emoji-item:active{background:var(--dsw-alias-brand-primary);color:#fff}',
      '.more-emoji-item[data-kind="emoji"]{font-size:21px;padding:2px 4px;line-height:1.15}',
      '.more-emoji-item[data-kind="kaomoji"]{font-size:12.5px;font-family:ui-monospace,Consolas,monospace;white-space:nowrap}',
      '.more-emoji-item[data-kind="art"]{font-size:12.5px;font-family:ui-monospace,Consolas,monospace;white-space:pre;text-align:left;padding:4px 6px}',
      '.more-emoji-item[data-kind="phrase"]{font-size:12.5px;border:1px solid var(--dsw-alias-border-l1);margin:1px}',
      '.more-emoji-empty{padding:25px 10px;text-align:center;color:var(--dsw-alias-label-secondary)}',
      '.more-emoji-foot{display:flex;align-items:center;gap:8px;padding:6px 10px;',
      'border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.more-emoji-foot .grow{flex:1}',
      '.more-emoji-rand{border:1px solid var(--dsw-alias-border-l1);background:transparent;',
      'color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:7px;font-size:11px;padding:2px 8px}',
      '.more-emoji-rand:hover{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}',
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

    // ── 面板 ───────────────────────────────────────────────────────────
    function collectGroups(kind, query) {
      var groups = []
      var needle = String(query || '').trim().toLowerCase()
      for (var i = 0; i < PACKS.length; i += 1) {
        var pack = PACKS[i]
        if (pack.kind !== kind) continue
        var items = pack.items
        if (needle !== '') {
          items = pack.items.filter(function (item) {
            return item.toLowerCase().indexOf(needle) !== -1 || pack.name.toLowerCase().indexOf(needle) !== -1
          })
        }
        if (items.length > 0) groups.push({ pack: pack, items: items })
      }
      return groups
    }

    function countItems(groups) {
      var total = 0
      for (var i = 0; i < groups.length; i += 1) total += groups[i].items.length
      return total
    }

    function randomInsert(kind) {
      var groups = collectGroups(kind, '')
      if (groups.length === 0) return
      var group = groups[Math.floor(Math.random() * groups.length)]
      var item = group.items[Math.floor(Math.random() * group.items.length)]
      insertText(item, { label: item })
      setStore({ open: false })
    }

    function Panel() {
      var state = useStore()
      var bodyRef = React.useRef(null)

      React.useEffect(function () {
        function onKey(event) {
          if (event.key === 'Escape') {
            setStore({ open: false })
          }
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

      // 面板浮在「整个输入框」上方（按钮在工具栏行，直接锚按钮会盖住文本域）。
      var anchor = state.anchor || { left: 24, top: window.innerHeight - 120, width: 396 }
      var width = Math.min(420, Math.max(240, window.innerWidth - 24))
      var left = Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12))
      var bottom = Math.max(12, window.innerHeight - anchor.top + 10)
      var totalMax = Math.max(220, Math.min(380, anchor.top - 24))
      var bodyMax = Math.max(120, totalMax - 92)

      var groups = collectGroups(state.kind, state.query)
      var total = countItems(groups)

      return h(
        'div',
        {
          id: 'more-emoji-panel',
          className: 'more-emoji-panel',
          role: 'dialog',
          'aria-label': '更多表情和颜文字',
          style: { left: left + 'px', bottom: bottom + 'px', width: width + 'px', maxHeight: totalMax + 'px' },
          onMouseDown: function (event) {
            // 面板自身不抢 composer 焦点，插入时光标位置不丢
            if (event.target.tagName !== 'INPUT') event.preventDefault()
          },
        },
        h(
          'div',
          { className: 'more-emoji-head' },
          KINDS.map(function (kind) {
            return h(
              'button',
              {
                key: kind.id,
                type: 'button',
                className: 'more-emoji-tab',
                'data-active': kind.id === state.kind ? 'true' : 'false',
                title: kind.hint,
                onClick: function () {
                  setStore({ kind: kind.id })
                },
              },
              kind.label,
            )
          }),
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
          { className: 'more-emoji-body', ref: bodyRef, style: { maxHeight: bodyMax + 'px' } },
          groups.length === 0
            ? h('div', { className: 'more-emoji-empty' }, '没有匹配的表情，换个关键词试试～')
            : groups.map(function (group) {
                return h(
                  'div',
                  { key: group.pack.id },
                  h('div', { className: 'more-emoji-group-title' }, group.pack.name),
                  h(
                    'div',
                    { className: 'more-emoji-items' },
                    group.items.map(function (item, index) {
                      return h(
                        'button',
                        {
                          key: group.pack.id + '-' + index,
                          type: 'button',
                          className: 'more-emoji-item',
                          'data-kind': group.pack.kind,
                          title: '插入：' + item,
                          onClick: function () {
                            insertText(item, { label: item })
                          },
                        },
                        item,
                      )
                    }),
                  ),
                )
              }),
        ),
        h(
          'div',
          { className: 'more-emoji-foot' },
          h('span', { className: 'grow' }, kindLabel(state.kind) + ' · 共 ' + total + ' 条 · 点击插入光标处'),
          h(
            'button',
            {
              type: 'button',
              className: 'more-emoji-rand',
              title: '随机插一个',
              onClick: function () {
                randomInsert(state.kind)
              },
            },
            '随机一发',
          ),
        ),
      )
    }

    // ── 启动按钮 ───────────────────────────────────────────────────────
    function Launcher() {
      var state = useStore()
      var ref = React.useRef(null)

      return h(
        'button',
        {
          id: 'more-emoji-launcher',
          ref: ref,
          type: 'button',
          className: 'more-emoji-launcher',
          title: '更多表情和颜文字',
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
            // 锚定输入框（文本域）而不是按钮：面板浮在输入框上方，不挡输入内容。
            var composer = findComposer()
            var rect = composer ? composer.getBoundingClientRect() : null
            if (!rect || rect.width < 80) {
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
          function () {
            return h(Launcher)
          },
        )
      })

      ctx.slots.inject('conversation.input.overlay', function () {
        return ctx.slots.register(
          { name: 'conversation.input.overlay', id: 'more-emoji-panel', order: 45 },
          function () {
            return h(Panel)
          },
        )
      })
    }

    return module.exports
  },
})
