#!/usr/bin/env node
/**
 * 浏览器冒烟测试：真的开一个 headless 浏览器（本机 Edge / Chrome），用"宿主形状"的
 * 合成 DOM 跑一遍 client.js 的完整生命周期。
 *
 * 验的是单测覆盖不到的那一层：量测 → 画线 → 反应 → 清理。
 *   1. 挂载后过程组里出现一张 <svg data-ptree>，左侧让出道床；
 *   2. 三个调用（父 / 子 / 另一个父）画成 1 条干线 + 1 条分叉 + 3 个圆点；
 *   3. 圆点坐标跟着 [data-subcalls] 的 padding 走（父 7px、子 21px）；
 *   4. 三态颜色不同；深色主题下换另一套（挂 body 与挂 :root 都认）；
 *   5. 宿主把某一行的 data-state 改成 error，下一帧圆点跟着变红；
 *   6. 调用清理函数后：SVG / <style> / 自有属性全部消失（不残留、不继续跑）。
 *   7. 【回归】父圆点落在**卡片**中线上，不是"整行中心"（行里还塞着整棵子树）；
 *   8. 【回归】静置 1 秒：paint 次数不增长、过程组里 0 条 DOM 变更（没有自触发重绘循环）；
 *   9. 【回归】运行中圆点是同一个节点、呼吸动画 currentTime 在推进（没有每帧重建）；
 *  10. 【回归】行内控件（按钮）的 data-state 不污染调用状态；
 *  11. 【回归】过程组从 DOM 里移除后不再被观察（观察者/可见集不只是涨）。
 *
 * 找不到浏览器就 SKIP（退出码 0），因为它不是正确性门槛，只是"更硬一点的证据"。
 * 用法：node test/browser-smoke.mjs [--browser <exe>]
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
]

const argIndex = process.argv.indexOf('--browser')
const browser = argIndex > -1 ? process.argv[argIndex + 1] : CANDIDATES.find((p) => existsSync(p))
if (!browser) {
  console.log('SKIP：没找到 Edge / Chrome，跳过浏览器冒烟测试')
  process.exit(0)
}

const source = await readFile(join(ROOT, 'lib/client.js'), 'utf8')
const profile = await mkdtemp(join(tmpdir(), 'ptree-smoke-'))

const child = spawn(
  browser,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    'about:blank',
  ],
  { stdio: 'ignore', windowsHide: true },
)

let socket = null
try {
  const port = await waitForPort(profile)
  const target = await waitForTarget(port)
  socket = await connect(target.webSocketDebuggerUrl)
  await socket.send('Runtime.enable')

  const expression = '(' + pageTest.toString() + ')(' + JSON.stringify(source) + ')'
  const { result, exceptionDetails } = await socket.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (exceptionDetails) throw new Error('页面里抛了：' + JSON.stringify(exceptionDetails))

  const report = result.value
  let failed = 0
  for (const check of report.checks) {
    console.log((check.ok ? '  ok   ' : '  FAIL ') + check.name + (check.ok || !check.detail ? '' : ' — ' + check.detail))
    if (!check.ok) failed += 1
  }
  console.log('')
  console.log(failed ? '结果：' + failed + ' 项失败' : '结果：全部通过（' + browser.split(/[\\/]/).pop() + '）')
  process.exitCode = failed ? 1 : 0
} catch (error) {
  console.error('浏览器冒烟测试失败：', error?.message || error)
  process.exitCode = 1
} finally {
  try {
    socket?.close()
  } catch {
    /* 已经断了 */
  }
  child.kill()
  await rm(profile, { recursive: true, force: true }).catch(() => {})
}

async function waitForPort(dir) {
  const file = join(dir, 'DevToolsActivePort')
  for (let i = 0; i < 150; i += 1) {
    if (existsSync(file)) {
      const lines = (await readFile(file, 'utf8')).trim().split(/\r?\n/)
      if (lines[0]) return Number(lines[0])
    }
    await sleep(100)
  }
  throw new Error('浏览器没写出 DevToolsActivePort')
}

async function waitForTarget(port) {
  for (let i = 0; i < 100; i += 1) {
    try {
      const list = await fetch('http://127.0.0.1:' + port + '/json/list').then((r) => r.json())
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch {
      /* 还没起来 */
    }
    await sleep(100)
  }
  throw new Error('没有可用的 page target')
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const pending = new Map()
    let nextId = 0
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
      if (message.id && pending.has(message.id)) {
        const { finish, fail } = pending.get(message.id)
        pending.delete(message.id)
        if (message.error) fail(new Error(message.error.message))
        else finish(message.result)
      }
    })
    ws.addEventListener('error', reject)
    ws.addEventListener('open', () =>
      resolve({
        send(method, params = {}) {
          const id = ++nextId
          return new Promise((finish, fail) => {
            pending.set(id, { finish, fail })
            ws.send(JSON.stringify({ id, method, params }))
          })
        },
        close() {
          ws.close()
        },
      }),
    )
  })
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * 在浏览器里跑。注意：这个函数会被 toString() 序列化后送进页面，
 * 所以它**不能**引用外部的任何变量（source 是入参）。
 */
async function pageTest(source) {
  const checks = []
  const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail: detail === undefined ? '' : String(detail) })
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  // 合成"宿主形状"的 DOM：过程组 → 流程行 → 调用行 → 工具卡片 / 子调用容器
  const base = document.createElement('style')
  // 第二条模仿宿主真身的 `~` 兄弟规则：过程行之后的兄弟节点吃 6px 上边距。
  // 我们的 <svg> 也是宿主的兄弟节点，会被它带上 margin——绝对定位元素带 margin 就整体偏了。
  base.textContent =
    '#root{width:640px;font:13px/20px sans-serif}' + '[data-chat-flow-kind] ~ *{margin-top:6px}'
  document.head.appendChild(base)

  const root = document.createElement('div')
  root.id = 'root'
  root.innerHTML = [
    '<div data-step-process-content data-chat-flow>',
    '  <div data-chat-flow-kind="reasoning">思考…</div>',
    '  <div data-chat-flow-kind="tool-call">',
    '    <div data-chat-anchor-key="call:a" data-chat-call-id="a">',
    '      <div data-tool="bash" data-state="ok">运行命令 · 检查文件</div>',
    '      <div data-subcalls>',
    '        <div data-chat-anchor-key="call:a1" data-chat-call-id="a1">',
    '          <div data-tool="read" data-state="running">读取文件</div>',
    '        </div>',
    '      </div>',
    '    </div>',
    '  </div>',
    '  <div data-chat-flow-kind="tool-call">',
    '    <div data-chat-anchor-key="call:b" data-chat-call-id="b">',
    '      <div data-tool="web_fetch" data-state="error">抓网页</div>',
    '    </div>',
    '  </div>',
    '  <div data-chat-flow-kind="assistant-step" data-turn-process-answer>最终回答</div>',
    '</div>',
  ].join('')
  document.body.appendChild(root)

  // 接住模块
  let mod = null
  window.__ModuleLoader__ = {
    load(entry) {
      mod = entry.factory(() => {
        throw new Error('冒烟测试里不提供 require')
      })
    },
  }
  ;(0, eval)(source)
  check('ModuleLoader 接住了 client.js', Boolean(mod && typeof mod.apply === 'function'))

  // 假装是 cordis ctx：effect 立刻执行并收集清理函数
  const disposers = []
  mod.apply({
    effect(fn) {
      const dispose = fn()
      disposers.push(dispose)
      return dispose
    },
  })
  await frame()

  const host = root.firstElementChild
  const layers = host.querySelectorAll(':scope > svg[data-ptree]')
  check('过程组里出现了一张自有 SVG', layers.length === 1, layers.length)
  check('宿主被标记了 data-ptree-host', host.hasAttribute('data-ptree-host'))
  check('自有 <style> 已注入', Boolean(document.querySelector('style[data-plugin="dsh-plugin-process-tree"]')))

  const paths = host.querySelectorAll('svg[data-ptree] path')
  const circles = host.querySelectorAll('svg[data-ptree] circle')
  check('画了 1 条干线 + 1 条分叉', paths.length === 2, paths.length)
  check('三个调用三个圆点', circles.length === 3, circles.length)

  const states = [...circles].map((c) => c.getAttribute('data-state'))
  check('三态各一个（done / running / failed）', states.join(',') === 'done,running,failed', states.join(','))

  const xs = [...circles].map((c) => Math.round(Number(c.getAttribute('cx'))))
  check('父调用在 7px 道床中线', Math.abs(xs[0] - 7) <= 1.5, xs[0])
  check('子调用按 [data-subcalls] 的 padding 右移一层', Math.abs(xs[1] - 21) <= 1.5, xs[1])

  /* ── 回归 7：圆点的 y 量的是"卡片中线"，不是"整行中心" ──
     宿主把 [data-subcalls] 也放在 callRow 内部，整行高度 = 卡片 + 整棵子树。
     量整行会把父圆点放到整块的中心（盲审实测 cy=24，卡片中心却是 12）。 */
  const parentRow = host.querySelector('[data-chat-call-id="a"]')
  const parentCard = parentRow.querySelector(':scope > [data-state]')
  const hostBox = host.getBoundingClientRect()
  const cardBox = parentCard.getBoundingClientRect()
  const rowBox = parentRow.getBoundingClientRect()
  const cardCenter = cardBox.top - hostBox.top + cardBox.height / 2
  const rowCenter = rowBox.top - hostBox.top + rowBox.height / 2
  const parentCy = Number(circles[0].getAttribute('cy'))
  check('父圆点落在卡片中线上', Math.abs(parentCy - cardCenter) <= 1, parentCy + ' vs 卡片 ' + cardCenter)
  check('整行中心明显更低（证明它确实含子树，不能拿来量）', rowCenter - cardCenter > 5, rowCenter + ' vs ' + cardCenter)

  /* 装饰层不该改宿主的布局：我们的 <svg> 挂在宿主最后（插最前面会让宿主第一行少了 :first-child），
     并且不能被宿主的兄弟规则带偏（绝对定位元素带 margin 就整体位移，坐标全错）。 */
  const layerBox = layers[0].getBoundingClientRect()
  const hostBox0 = host.getBoundingClientRect()
  check('自有 SVG 挂在宿主末尾（不挤占第一行）', host.lastElementChild === layers[0],
    host.lastElementChild && host.lastElementChild.tagName)
  check('自有 SVG 没被宿主兄弟规则带偏', Math.abs(layerBox.top - hostBox0.top) <= 1,
    layerBox.top + ' vs ' + hostBox0.top)
  check('自有 SVG 的 margin 被压成 0', getComputedStyle(layers[0]).marginTop === '0px',
    getComputedStyle(layers[0]).marginTop)

  /* 干线必须竖直：跨不同 x 的顶层节点相连只会画出没有含义的斜线（unit 测里另有分组的用例）。 */
  const trunkPaths = [...host.querySelectorAll('svg[data-ptree] path')].filter(
    (p) => p.getAttribute('data-state') === null,
  )
  const trunkVertical = trunkPaths.every((p) => {
    const xs = p.getAttribute('d').match(/-?\d+(\.\d+)?/g).filter((_, i) => i % 2 === 0)
    return new Set(xs).size === 1
  })
  check('干线是竖直的（不画斜线）', trunkVertical, trunkPaths.map((p) => p.getAttribute('d')).join(' | '))

  /* ── 回归 8 / 9：自触发重绘循环 + 呼吸动画 ──
     画完之后静置 1 秒：paint 计数不涨、过程组里 0 条 mutation 记录；
     运行中圆点必须还是同一个节点，动画 currentTime 必须往前走。 */
  const runningDot = host.querySelector('svg[data-ptree] circle[data-state="running"]')
  const breathe = runningDot && runningDot.getAnimations ? runningDot.getAnimations()[0] : null
  const t0 = breathe ? breathe.currentTime : -1
  await frame()
  await sleep(150) // 等 IntersectionObserver / ResizeObserver 的首轮回调落定
  const before = mod.__internals.stats()
  let records = 0
  const watcher = new MutationObserver((list) => {
    records += list.length
  })
  watcher.observe(host, { childList: true, subtree: true, attributes: true, characterData: true })
  await sleep(1000)
  watcher.disconnect()
  const afterIdle = mod.__internals.stats()
  check('静置 1 秒：paint 次数不增长', afterIdle.paints === before.paints, before.paints + ' → ' + afterIdle.paints)
  check('静置 1 秒：collect 次数不增长', afterIdle.collects === before.collects, before.collects + ' → ' + afterIdle.collects)
  check('静置 1 秒：过程组里 0 条 DOM 变更', records === 0, records + ' 条')
  const sameNode = host.querySelector('svg[data-ptree] circle[data-state="running"]') === runningDot
  check('运行中圆点保持同一个节点（没有每帧重建）', sameNode)
  const t1 = breathe ? breathe.currentTime : -1
  check('呼吸动画在推进（currentTime 在涨）', breathe ? t1 > t0 + 200 : false, t0 + ' → ' + t1)

  /* 强制一次真的重画（改另一个调用的状态）：运行中圆点必须还是同一个节点、动画不重启。
     这一条是"复用节点"的硬证据——整块 replaceChildren 的写法在这里必然换节点。 */
  host.querySelector('[data-chat-call-id="b"] > [data-state]').setAttribute('data-state', 'running')
  await frame()
  const afterRepaint = host.querySelector('svg[data-ptree] circle[data-state="running"]')
  check('重画之后运行中圆点还是同一个节点', afterRepaint === runningDot)
  check('重画之后还是同一个 Animation（没有从第 0 帧重启）',
    Boolean(breathe) && afterRepaint.getAnimations()[0] === breathe,
    breathe ? String(afterRepaint.getAnimations()[0] === breathe) : '没有动画')
  host.querySelector('[data-chat-call-id="b"] > [data-state]').setAttribute('data-state', 'error')
  await frame()

  const answer = host.querySelector('[data-turn-process-answer]')
  check('最终回答那一行不吃道床缩进', getComputedStyle(answer).paddingLeft === '0px', getComputedStyle(answer).paddingLeft)

  const runningFill = getComputedStyle(circles[1]).fill
  const doneFill = getComputedStyle(circles[0]).fill
  check('运行中与完成的颜色不同', runningFill !== doneFill, runningFill + ' vs ' + doneFill)
  check('运行中有呼吸动画', getComputedStyle(circles[1]).animationName === 'ptree-breathe')

  document.documentElement.setAttribute('data-ds-dark-theme', '')
  await frame()
  const darkFill = getComputedStyle(circles[0]).fill
  check('深色主题换一套配色（标记挂 :root）', darkFill !== doneFill, darkFill + ' vs ' + doneFill)
  document.documentElement.removeAttribute('data-ds-dark-theme')
  await frame()
  // 宿主实际是把标记挂在 <body> 上；用 :has() 写会让 :root 变成 has-root，页面任何变更都重算样式。
  document.body.setAttribute('data-ds-dark-theme', '')
  await frame()
  const bodyDarkFill = getComputedStyle(circles[0]).fill
  check('深色主题换一套配色（标记挂 body，宿主真实行为）', bodyDarkFill === darkFill, bodyDarkFill + ' vs ' + darkFill)
  document.body.removeAttribute('data-ds-dark-theme')
  await frame()

  // 宿主把父调用的状态改掉 → 下一帧跟着变
  host.querySelector('[data-chat-call-id="a"] > [data-state]').setAttribute('data-state', 'error')
  await frame()
  const afterState = host.querySelector('svg[data-ptree] circle').getAttribute('data-state')
  check('宿主 data-state 变化后圆点跟着变红', afterState === 'failed', afterState)

  // 折叠：行高度为 0 时不该再画它
  host.querySelector('[data-chat-call-id="b"]').style.display = 'none'
  await frame()
  check('隐藏的调用不再画', host.querySelectorAll('svg[data-ptree] circle').length === 2,
    host.querySelectorAll('svg[data-ptree] circle').length)
  host.querySelector('[data-chat-call-id="b"]').style.display = ''
  await frame()

  /* ── 回归 10：行内控件的 data-state 不能污染调用状态 ──
     卡片外面多包一层（退化路径）时，行内操作区的按钮也带 data-state="running"；
     认它就会把这一行的圆点染成假状态。 */
  const strayFlow = document.createElement('div')
  strayFlow.setAttribute('data-chat-flow-kind', 'tool-call')
  strayFlow.innerHTML =
    '<div data-chat-call-id="c"><div class="tool-shell">' +
    '<div class="tool-body">读一个文件</div>' +
    '<div class="tool-actions"><button data-state="running">复制</button></div>' +
    '</div></div>'
  host.appendChild(strayFlow)
  await frame()
  await frame()
  const strayDots = host.querySelectorAll('svg[data-ptree] circle')
  const strayDot = strayDots[strayDots.length - 1]
  check('新增调用被画出来', strayDots.length === 4, strayDots.length)
  check('行内按钮的 data-state 不污染调用状态', strayDot && strayDot.getAttribute('data-state') === 'idle',
    strayDot && strayDot.getAttribute('data-state'))
  strayFlow.remove()
  await frame()
  await frame()

  /* ── 回归 12：宿主真身的 bash 卡片形状 ──
     外层 `.card` 不带 state，状态挂在内层根节点 `.root[data-state][role="button"]` 上。
     只按"排除 role=button"读状态会把每个 shell 调用都读成 idle（跑完从蓝掉成灰）。 */
  const bashFlow = document.createElement('div')
  bashFlow.setAttribute('data-chat-flow-kind', 'tool-call')
  bashFlow.innerHTML =
    '<div data-chat-call-id="bash1"><div class="card">' +
    '<div class="root" data-sample="bash" data-state="ok" role="button">运行命令</div>' +
    '</div></div>'
  host.appendChild(bashFlow)
  await frame()
  await frame()
  const bashDots = host.querySelectorAll('svg[data-ptree] circle')
  const bashDot = bashDots[bashDots.length - 1]
  check('bash 卡片（state 挂在内层 role=button 根节点上）读成 done',
    bashDot && bashDot.getAttribute('data-state') === 'done', bashDot && bashDot.getAttribute('data-state'))
  bashFlow.remove()
  await frame()
  await frame()

  /* ── 回归 13：可见性闸门不能永久吃掉脏标记 ──
     滚出视口 → 宿主改了状态（按设计跳过绘制）→ 滚回视口：必须补画。
     不补的话长会话滚回去看到的是旧配色，而且已经结束的组不会再产生 mutation 来叫醒它。 */
  const stateB = host.querySelector('[data-chat-call-id="b"] > [data-state]')
  const dotB = () => host.querySelectorAll('svg[data-ptree] circle')[2]
  check('可见性回归的起点：b 是 failed', dotB() && dotB().getAttribute('data-state') === 'failed',
    dotB() && dotB().getAttribute('data-state'))
  root.style.paddingTop = '4000px' // 把过程组推出视口（rootMargin 600px 之外）
  await frame()
  await sleep(150)
  stateB.setAttribute('data-state', 'ok')
  await frame()
  await sleep(150)
  check('滚出视口期间的变更暂时不画（设计如此）', dotB().getAttribute('data-state') === 'failed',
    dotB().getAttribute('data-state'))
  root.style.paddingTop = ''
  await frame()
  await sleep(150)
  check('滚回视口后补画成新状态', dotB().getAttribute('data-state') === 'done', dotB().getAttribute('data-state'))

  /* 宿主重渲染有可能把我们插进去的 <svg> 丢掉：下一帧必须能画回来（签名闸门不能把它挡住）。 */
  host.querySelector(':scope > svg[data-ptree]').remove()
  await frame()
  await frame()
  const rebuilt = host.querySelectorAll(':scope > svg[data-ptree]').length
  check('自有 SVG 被删掉后能重建', rebuilt === 1 && host.querySelectorAll('svg[data-ptree] circle').length === 3,
    rebuilt + ' 层 / ' + host.querySelectorAll('svg[data-ptree] circle').length + ' 点')
  const afterRebuild = mod.__internals.stats().paints
  await sleep(300)
  check('重建之后不会再自己触发自己', mod.__internals.stats().paints === afterRebuild,
    afterRebuild + ' → ' + mod.__internals.stats().paints)

  /* 宿主把画好的节点摘掉（重渲染整块替换）：下一次真实变更时要把它们挂回来，不能只剩一张空 SVG。 */
  const dotsGroup = host.querySelector(':scope > svg[data-ptree] g[data-ptree-dots]')
  check('圆点装在 <g data-ptree-dots> 里（按 id 复用的容器）', Boolean(dotsGroup))
  if (dotsGroup) {
    dotsGroup.replaceChildren()
    host.querySelector('[data-chat-call-id="a"] > [data-state]').setAttribute('data-state', 'ok')
    await frame()
    check('被宿主摘掉的圆点会在下次变更时挂回来',
      host.querySelectorAll('svg[data-ptree] circle').length === 3,
      host.querySelectorAll('svg[data-ptree] circle').length)
  }

  /* ── 回归 11：过程组离开 DOM 后必须松手（observer / 可见集只涨不降就是这里漏的） ── */
  const host2 = document.createElement('div')
  host2.setAttribute('data-step-process-content', '')
  host2.innerHTML =
    '<div data-chat-flow-kind="tool-call"><div data-chat-call-id="x">' +
    '<div data-tool="read" data-state="ok">读一个文件</div></div></div>'
  document.body.appendChild(host2)
  await frame()
  await frame()
  check('第二个过程组被注册并画出自己的层', mod.__internals.stats().hosts === 2 &&
    host2.querySelectorAll(':scope > svg[data-ptree] circle').length === 1, mod.__internals.stats().hosts)
  host2.remove()
  await frame()
  await frame()
  check('过程组离开 DOM 后不再被观察', mod.__internals.stats().hosts === 1, mod.__internals.stats().hosts)

  // 清理
  for (const dispose of disposers) if (typeof dispose === 'function') dispose()
  await frame()
  check('清理后 SVG 消失', host.querySelectorAll('svg[data-ptree]').length === 0)
  check('清理后 <style> 消失', !document.querySelector('style[data-plugin="dsh-plugin-process-tree"]'))
  check('清理后自有属性消失', !host.hasAttribute('data-ptree-host'))

  return { checks }
}
