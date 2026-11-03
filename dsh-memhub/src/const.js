/**
 * dsh-memhub · 常量。
 * 单独成文件：tests / tools 需要引用，但不能 import host.js（那里依赖 DSH 运行时 dsh-tools）。
 */
import os from 'node:os'
import path from 'node:path'

/** DSH 家目录：测试/沙箱可用 DSH_HOME 指到临时目录。 */
export const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')

/** 技能库默认位置：DSH 原生技能目录，原地不动。 */
export const DEFAULT_VAULT = path.join(DSH_HOME, 'skills')

/** 插件自己的数据目录（派生索引 / sidecar / 教训 / 自我 / 情感 / 人格）。 */
export const DATA_ROOT = path.join(DSH_HOME, 'memhub')

/** 公共区：跨工作区共享的工程记忆与教训（本机事实，可用 config.sharedRoot 覆盖）。 */
export const DEFAULT_SHARED_ROOT = 'L:\\DSH\\shared\\memhub'

/**
 * 常驻系统提示只有这一行。要求：
 * - 不出现具体技能名（避免 UI 把技能名渲染成卡片）
 * - 48 字符（≈30 tokens）
 */
export const HINT_TEXT = [
  '## 能力库',
  '有章法的事先 skill_search 再 skill_load；别猜，闲聊不查。',
].join('\n')

/** 工具名（统一 skill_* 前缀，避开 zzerx 的 memory_* 互斥锁）。 */
export const TOOLS = {
  search: 'skill_search',
  load: 'skill_load',
  list: 'skill_list',
  register: 'skill_register',
}
