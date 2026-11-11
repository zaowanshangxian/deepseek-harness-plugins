import test from 'node:test'
import assert from 'node:assert/strict'

// client.js 是给浏览器用的模块加载器格式：执行时就会调用
// window.__ModuleLoader__.load({ id, factory })。这里给它一个假的 window 把 factory
// 接住，就能在 Node 里验纯函数（状态词表 + 几何），不需要 DOM。
let loaded = null
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      assert.equal(entry.id, 'dsh-plugin-process-tree', 'ModuleLoader id 必须等于包名')
      loaded = entry.factory((name) => {
        throw new Error('测试里不该 require：' + name)
      })
    },
  },
}

await import('../lib/client.js')

assert.ok(loaded && loaded.__internals, 'client.js 没有暴露 __internals')
const { classify, elbow, plan } = loaded.__internals

test('状态词表：宿主三态都认得，未知值不猜成功', () => {
  assert.equal(classify('ok'), 'done')
  assert.equal(classify('completed'), 'done')
  assert.equal(classify('success'), 'done')
  assert.equal(classify('running'), 'running')
  assert.equal(classify('preparing'), 'running')
  assert.equal(classify('error'), 'failed')
  assert.equal(classify('failed'), 'failed')
  // 中断 / 停止：宿主说"没有明确成败"，我们不染成绿色也不染成红色。
  assert.equal(classify('stopped'), 'idle')
  assert.equal(classify('interrupted'), 'idle')
  assert.equal(classify(''), 'idle')
  assert.equal(classify(undefined), 'idle')
  assert.equal(classify('OK'), 'done', '大小写不敏感')
})

test('elbow：先竖、拐角、再横到子圆点', () => {
  const d = elbow(7, 20, 21, 40)
  assert.match(d, /^M7,20/)
  assert.match(d, /Q/)
  const nums = d.match(/-?\d+(\.\d+)?/g).map(Number)
  // 最后一个坐标对是子圆点
  assert.deepEqual(nums.slice(-2), [21, 40])
  // 竖直段必须停在父子之间
  assert.ok(nums[3] > 20 && nums[3] < 40)
})

test('elbow：子节点在上方时也要拐得对', () => {
  const d = elbow(7, 60, 21, 40)
  assert.match(d, /^M7,60/)
  assert.match(d, /Q/)
})

test('plan：父子出分叉，同 x 的顶层连成一条干线，每个节点一个圆点', () => {
  const nodes = [
    { id: 'a', parent: null, x: 7, y: 20, state: 'done' },
    { id: 'b', parent: 'a', x: 21, y: 40, state: 'running' },
    { id: 'd', parent: 'b', x: 35, y: 60, state: 'failed' },
    { id: 'c', parent: null, x: 7, y: 80, state: 'done' },
  ]
  const drawn = plan(nodes)
  assert.equal(drawn.dots.length, 4)
  assert.equal(drawn.branches.length, 2, 'b→a、d→b 各一条')
  assert.equal(drawn.trunks.length, 1, '两个同 x 的顶层节点之间一条干线')
  assert.match(drawn.trunks[0].d, /^M7,20L7,80$/)
  assert.equal(drawn.branches[0].state, 'running', '分叉跟着子节点的状态染色')
  assert.equal(drawn.branches[1].state, 'failed')
})

test('plan：父节点被折叠过滤掉时，子节点当顶层；顶层分处不同 x 就各画各的，不画斜线', () => {
  const drawn = plan([
    { id: 'orphan', parent: 'gone', x: 21, y: 10, state: 'done' },
    { id: 'solo', parent: null, x: 7, y: 50, state: 'done' },
  ])
  assert.equal(drawn.branches.length, 0)
  // 一条从 (7,50) 连到 (21,10) 的斜线没有任何含义：宁可断成两个孤点。
  assert.equal(drawn.trunks.length, 0)
  assert.equal(drawn.dots.length, 2)
})

test('plan：不同 x 的顶层组各出一条竖直干线', () => {
  const drawn = plan([
    { id: 'a', parent: null, x: 7, y: 10, state: 'done' },
    { id: 'c', parent: null, x: 7, y: 30, state: 'done' },
    { id: 'orphan1', parent: 'gone', x: 21, y: 20, state: 'done' },
    { id: 'orphan2', parent: 'gone', x: 21, y: 40, state: 'running' },
  ])
  assert.equal(drawn.trunks.length, 2)
  for (const trunk of drawn.trunks) {
    const xs = trunk.d.match(/-?\d+(\.\d+)?/g).map(Number).filter((_, i) => i % 2 === 0)
    assert.equal(new Set(xs).size, 1, '每条干线都必须竖直：' + trunk.d)
  }
})

test('plan：只有一个节点时不画干线', () => {
  const drawn = plan([{ id: 'only', parent: null, x: 7, y: 10, state: 'done' }])
  assert.equal(drawn.trunks.length, 0)
  assert.equal(drawn.dots.length, 1)
})

test('plan：空输入不炸', () => {
  const drawn = plan([])
  assert.equal(drawn.trunks.length, 0)
  assert.equal(drawn.dots.length, 0)
  assert.equal(drawn.branches.length, 0)
})

test('plan：圆点和分叉都带节点 id（绘制层靠它复用节点，丢了动画就会每帧重启）', () => {
  const drawn = plan([
    { id: 'a', parent: null, x: 7, y: 20, state: 'done' },
    { id: 'b', parent: 'a', x: 21, y: 40, state: 'running' },
    { id: 'c', parent: 'a', x: 21, y: 60, state: 'failed' },
  ])
  assert.deepEqual(drawn.dots.map((dot) => dot.id), ['a', 'b', 'c'])
  assert.deepEqual(drawn.branches.map((branch) => branch.id), ['b', 'c'])
})
