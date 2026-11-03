/**
 * 沙箱 loader：把 host.js 对 DSH 运行时包 '@deepseek-ai/dsh-tools' 的 import
 * 重定向到本地 mock，让插件能在普通 node 里被真实执行（不安装、不碰客户端）。
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@deepseek-ai/dsh-tools') {
    return {
      url: new URL('./mock-dsh-tools.mjs', import.meta.url).href,
      shortCircuit: true,
    }
  }
  return nextResolve(specifier, context)
}
