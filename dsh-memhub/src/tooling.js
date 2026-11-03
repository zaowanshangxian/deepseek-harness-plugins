/** 工具层共享小件：输出信封、目录、owner 身份判定。 */
import fs from 'node:fs'

export function textOutput() {
  return {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { text: { type: 'string', required: true } },
    },
    render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
  }
}

export function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    /* 不可写时静默降级 */
  }
}

/** 从工具执行上下文里尽力取会话 id（不同宿主版本字段不同）。 */
export function sessionIdOf(context) {
  const candidates = [
    context?.agent?.session?.id,
    context?.session?.id,
    context?.sessionId,
    context?.agent?.sessionId,
  ]
  return candidates.find((value) => typeof value === 'string' && value.length > 0) || null
}

/** owner 门：only=false 放行；only=true 时白名单必须命中，拿不到身份则保守拒绝。 */
export function isOwner(cfg, context) {
  const owner = cfg.owner || {}
  if (!owner.only) return true
  const sessionId = sessionIdOf(context)
  if (!sessionId) return false
  return (owner.sessions || []).includes(sessionId)
}

/** 工具返回统一错误文本。 */
export function fail(prefix, error) {
  return { text: `${prefix}：${String(error)}` }
}
