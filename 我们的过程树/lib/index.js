// dsh-plugin-process-tree — Host 半。
//
// 这个插件的视觉全部在浏览器侧（./client.js）：它只在宿主已经渲染出来的过程组 DOM 上
// 追加自己的 SVG 连线层，不接管、不替换任何 React 节点。所以宿主这半本来就是"空壳"
// ——参考项目 dsh-process-tree 的 index.js 也是三行。
//
// 既然要占一行，就让它占得有用：挂一个**只读探针** `/process-tree/health`。
// 装完之后不用开界面就能确认「宿主半真的起来了、路由真的注册上了、卸载时真的注销了」，
// 同时把 `ctx.effect(register → 返回注销函数)` 这条规矩写成人能看懂的样板。
//
// 路径刻意**不放在宿主的 `/api` 命名空间里**：宿主对 `/api` 前缀有鉴权/中间件，而
// exact 路由先于 prefix 匹配，挂在 `/api/...` 下等于抢在宿主自己的前缀处理之前命中，
// 既是越界也会随宿主路由策略变化而碎。探针内容只有插件名/版本/锚点，不含会话数据。
//
// 边界（有意为之）：
//   - 只读：不写文件、不读会话、不发网络请求。
//   - 不设 DSH 版本门槛：参考项目的结论是版本号挡不住不兼容，只会挡住能用的新版
//     （dsh-process-tree 0.11.0 取消了 version gate）。锚点是否还在，由 client 半自己
//     静默降级 + 测试 `test/host-contract.mjs` 去核。

export const name = 'dsh-plugin-process-tree'

// webServer 是可选服务：没有它就不挂路由，插件其余部分不受影响（视觉全在 client 半）。
export const inject = ['webServer']

/** 宿主半版本，必须与 package.json 的 version 一致（test/host-contract.mjs 会核）。 */
export const VERSION = '0.1.2'

/** 探针路径。客户端不消费它，它只用于人工 / 脚本自检。不占宿主的 `/api` 命名空间。 */
export const ROUTE = '/process-tree/health'

export const meta = {
  title: '过程树',
  description:
    '把过程组里平铺的工具调用按嵌套关系画成树形连接线，运行 / 完成 / 失败三态用颜色区分；只装饰宿主已渲染的 DOM，可随时关掉。',
}

function sendJson(res, status, body) {
  try {
    res.statusCode = status
    res.setHeader?.('content-type', 'application/json; charset=utf-8')
    res.setHeader?.('cache-control', 'no-store')
    res.end?.(JSON.stringify(body))
  } catch {
    /* 响应已经断了就算了，探针不值得抛 */
  }
}

export function apply(ctx, config = {}) {
  const startedAt = Date.now()
  // 日志器只能从 ctx 拿：第二个参数是用户在 cordis.patch.yml 里写的 config，里面没有 logger。
  // 以前写成 config.logger，下面的 warn/debug 全是空转，降级时一声不吭。
  const logger = config.logger || ctx?.logger
  const server = ctx?.webServer

  if (!server || typeof server.register !== 'function') {
    // 没有 webServer 不是错误：视觉部分照样工作，只是少一个自检入口。
    logger?.debug?.('process-tree: webServer 不可用，跳过探针路由')
    return
  }

  const handler = (req, res) => {
    const method = String(req?.method ?? 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    sendJson(res, 200, {
      ok: true,
      plugin: name,
      version: VERSION,
      uptimeMs: Date.now() - startedAt,
      // 客户端半要的锚点；宿主改了这里就说明契约变了（client 半会静默降级）。
      anchors: ['data-step-process-content', 'data-chat-call-id', 'data-subcalls', 'data-state'],
    })
  }

  // ctx.effect 的规矩：注册时返回注销函数。卸载后路由必须消失，否则客户端还会打到
  // 一个已经没人处理的地址，热重载时更会越积越多。
  ctx.effect(
    () => server.register({ kind: 'exact', path: ROUTE, handler }),
    'process-tree: health route',
  )
}
