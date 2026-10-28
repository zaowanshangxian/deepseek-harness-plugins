/**
 * 人格绑定（表达风格层）—— 参数模型 + 情绪映射 + 预设库。
 *
 * 设计原则：
 * - 插件不复制人设文案，只描述「用什么表情、多密、什么不能用」。
 * - 人格不写死：预设只是填好的参数；用户可加自定义档（customPersonas）。
 * - 绝不硬编码某个 preset id（standard 只是本机的），映射表由用户配置。
 */

/** 情绪 → 分类。表格与人格无关：人格只影响「同一情绪选哪种表达」。 */
export const EMOTIONS = {
  joy: { label: '开心', packs: ['emoji-happy', 'emoji-face', 'kao-happy', 'phrase-reply'] },
  cute: { label: '可爱', packs: ['emoji-cute', 'kao-cute', 'kao-sweet', 'phrase-cute'] },
  love: { label: '爱心', packs: ['emoji-love', 'kao-heart'] },
  sad: { label: '难过', packs: ['emoji-sad', 'kao-cry'] },
  angry: { label: '生气', packs: ['emoji-angry', 'kao-angry'] },
  shock: { label: '震惊', packs: ['emoji-shock', 'kao-shock'] },
  cheer: { label: '加油', packs: ['emoji-cheer', 'kao-action', 'phrase-cheer'] },
  praise: { label: '夸夸', packs: ['phrase-praise', 'emoji-happy'] },
  comfort: { label: '安慰', packs: ['phrase-heal', 'emoji-cute'] },
  shy: { label: '害羞', packs: ['kao-shy', 'emoji-cute'] },
  speechless: { label: '无语', packs: ['kao-sweat', 'emoji-face'] },
  sleep: { label: '困了', packs: ['emoji-sleep', 'kao-sleepy'] },
  work: { label: '工作', packs: ['emoji-work', 'phrase-work'] },
  greet: { label: '打招呼', packs: ['kao-greet', 'phrase-greet'] },
  food: { label: '吃的', packs: ['emoji-food'] },
  animal: { label: '动物', packs: ['emoji-animal', 'kao-cat'] },
  gesture: { label: '手势', packs: ['emoji-gesture'] },
  nature: { label: '天气', packs: ['emoji-nature'] },
  party: { label: '节日', packs: ['emoji-party', 'phrase-festival'] },
  meme: { label: '玩梗', packs: ['phrase-meme'] },
  moyu: { label: '摸鱼', packs: ['phrase-moyu'] },
  decorate: { label: '装饰', packs: ['art-symbol', 'art-frame', 'art-divider', 'art-combo'] },
}

/**
 * 预设人格。dims 是 0–1 的风格参数（供客户端展示与后续排序使用）；
 * kinds 限制可用大类；maxPerReply/workModeMaxPerReply 是发送密度；denyPacks 是禁用分类。
 */
export const PERSONAS = [
  {
    id: 'daughter',
    name: '活泼女儿',
    dims: { cuteness: 0.8, formality: 0.2, bite: 0.1, intimacy: 0.8, density: 3 },
    kinds: ['emoji', 'kaomoji', 'phrase'],
    maxPerReply: 3,
    workModeMaxPerReply: 1,
    denyPacks: [],
    guide: '语气软、爱用颜文字与可爱表情；工作模式收敛，最多一个 ✅。',
  },
  {
    id: 'sweet',
    name: '乖巧甜',
    dims: { cuteness: 0.9, formality: 0.1, bite: 0.0, intimacy: 0.9, density: 3 },
    kinds: ['emoji', 'kaomoji', 'phrase'],
    maxPerReply: 3,
    workModeMaxPerReply: 1,
    denyPacks: ['emoji-angry', 'kao-angry', 'phrase-meme'],
    guide: '乖巧甜、多安慰类表情，不用攻击性或阴阳怪气的表情。',
  },
  {
    id: 'tsundere',
    name: '傲娇',
    dims: { cuteness: 0.5, formality: 0.3, bite: 0.6, intimacy: 0.5, density: 2 },
    kinds: ['emoji', 'kaomoji', 'phrase'],
    maxPerReply: 2,
    workModeMaxPerReply: 1,
    denyPacks: ['phrase-heal'],
    guide: '嘴硬心软：先怼一句再补一个软表情；正经事不阴阳怪气。',
  },
  {
    id: 'sassy',
    name: '毒舌',
    dims: { cuteness: 0.4, formality: 0.2, bite: 0.8, intimacy: 0.4, density: 2 },
    kinds: ['emoji', 'kaomoji', 'phrase'],
    maxPerReply: 2,
    workModeMaxPerReply: 1,
    denyPacks: ['kao-sweet', 'phrase-cute'],
    guide: '毒舌但不辱骂；嘲讽只对事不对人，不加卖萌表情。',
  },
  {
    id: 'kuudere',
    name: '冷淡三无',
    dims: { cuteness: 0.3, formality: 0.5, bite: 0.1, intimacy: 0.3, density: 1 },
    kinds: ['emoji'],
    maxPerReply: 1,
    workModeMaxPerReply: 1,
    denyPacks: ['kao-sweet', 'phrase-cute', 'phrase-meme'],
    guide: '寡言克制，最多一个表情收尾，不用颜文字。',
  },
  {
    id: 'colleague',
    name: '专业同事',
    dims: { cuteness: 0.1, formality: 0.8, bite: 0.2, intimacy: 0.2, density: 1 },
    kinds: ['emoji'],
    maxPerReply: 1,
    workModeMaxPerReply: 1,
    denyPacks: ['kao-sweet', 'phrase-cute', 'phrase-meme', 'art-combo'],
    guide: '只用表情符号收尾，禁止颜文字、叠词与卖萌短句。',
  },
  {
    id: 'cat',
    name: '猫系',
    dims: { cuteness: 0.9, formality: 0.1, bite: 0.2, intimacy: 0.7, density: 4 },
    kinds: ['kaomoji', 'phrase', 'emoji'],
    maxPerReply: 4,
    workModeMaxPerReply: 1,
    denyPacks: ['phrase-work'],
    guide: '猫系颜文字与短句为主，喵系语气，但不影响事实准确。',
  },
  {
    id: 'oneesan',
    name: '温柔姐姐',
    dims: { cuteness: 0.6, formality: 0.3, bite: 0.0, intimacy: 0.7, density: 3 },
    kinds: ['emoji', 'kaomoji', 'phrase'],
    maxPerReply: 3,
    workModeMaxPerReply: 1,
    denyPacks: ['phrase-meme', 'kao-angry'],
    guide: '温柔体贴、先安抚再给建议；不用嘲讽或阴阳怪气的表情。',
  },
  {
    id: 'cool',
    name: '高冷御姐',
    dims: { cuteness: 0.2, formality: 0.6, bite: 0.4, intimacy: 0.3, density: 1 },
    kinds: ['emoji'],
    maxPerReply: 1,
    workModeMaxPerReply: 1,
    denyPacks: ['kao-sweet', 'phrase-cute', 'emoji-cute'],
    guide: '话少而准，最多一个表情收尾；不用叠词与卖萌。',
  },
  {
    id: 'chuuni',
    name: '中二',
    dims: { cuteness: 0.4, formality: 0.3, bite: 0.3, intimacy: 0.5, density: 3 },
    kinds: ['emoji', 'kaomoji', 'art', 'phrase'],
    maxPerReply: 3,
    workModeMaxPerReply: 1,
    denyPacks: ['phrase-work'],
    guide: '中二腔但不影响事实；正经问题立刻恢复正常语气。',
  },
  {
    id: 'lazy',
    name: '慵懒',
    dims: { cuteness: 0.5, formality: 0.2, bite: 0.1, intimacy: 0.6, density: 2 },
    kinds: ['emoji', 'kaomoji', 'phrase'],
    maxPerReply: 2,
    workModeMaxPerReply: 1,
    denyPacks: ['phrase-cheer', 'emoji-party'],
    guide: '懒散、慢半拍的语气，但不拖延正事；少用打鸡血类表情。',
  },
  {
    id: 'genki',
    name: '元气',
    dims: { cuteness: 0.8, formality: 0.2, bite: 0.1, intimacy: 0.6, density: 4 },
    kinds: ['emoji', 'kaomoji', 'phrase'],
    maxPerReply: 4,
    workModeMaxPerReply: 1,
    denyPacks: ['kao-cry', 'emoji-sad'],
    guide: '元气满满，多用鼓励与庆祝类表情，少用丧气表情。',
  },
]

/** 表情频率档位：auto = 跟随人格；off/low/normal/high 直接给上限。 */
export const EMOJI_FREQUENCY = {
  auto: null,
  off: 0,
  low: 1,
  normal: 3,
  high: 6,
}

/** 口癖频率：every = 每 N 条一次；0 = 不启用。 */
export const CATCHPHRASE_FREQUENCY = [0, 2, 3, 5, 8]

/** 档位索引 */
export const PERSONA_BY_ID = new Map(PERSONAS.map((persona) => [persona.id, persona]))

function clamp01(value, fallback) {
  const num = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(1, Math.max(0, num))
}

function clampCount(value, fallback) {
  const num = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(6, Math.max(0, num))
}

/** 合并自定义档与预设（同 id 覆盖），并做边界收敛。 */
export function mergePersonas(custom) {
  const merged = new Map(PERSONA_BY_ID)
  for (const raw of Array.isArray(custom) ? custom : []) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || raw.id.trim() === '') continue
    const id = raw.id.trim()
    const base = merged.get(id) || {}
    const dims = Object.assign({}, base.dims || {})
    for (const key of ['cuteness', 'formality', 'bite', 'intimacy', 'density']) {
      if (raw.dims && Object.prototype.hasOwnProperty.call(raw.dims, key)) {
        dims[key] = clamp01(raw.dims[key], dims[key] ?? 0.5)
      }
    }
    merged.set(id, {
      id,
      name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim().slice(0, 24) : base.name || id,
      dims,
      kinds: Array.isArray(raw.kinds)
        ? raw.kinds.filter((kind) => ['emoji', 'kaomoji', 'art', 'phrase'].includes(kind))
        : base.kinds || ['emoji', 'kaomoji', 'phrase'],
      maxPerReply: clampCount(raw.maxPerReply, base.maxPerReply ?? 3),
      workModeMaxPerReply: 1,
      denyPacks: Array.isArray(raw.denyPacks)
        ? raw.denyPacks.filter((pack) => typeof pack === 'string')
        : base.denyPacks || [],
      guide: typeof raw.guide === 'string' && raw.guide.trim() !== ''
        ? raw.guide.trim().slice(0, 200)
        : base.guide || '',
    })
  }
  return merged
}

/**
 * 解析当前应该生效的人格。
 * source: 'off' 不启用 | 'manual' 用 activePersona | 'preset' 按会话 preset 查 personaMap
 */
export function resolvePersona(settings, presetId) {
  if (!settings || settings.personaSource === 'off') return null
  const personas = mergePersonas(settings.customPersonas)
  let key = settings.activePersona || ''
  if (settings.personaSource === 'preset') {
    const mapped = presetId && settings.personaMap ? settings.personaMap[presetId] : ''
    key = mapped || (key && key !== 'auto' ? key : 'daughter')
  } else if (!key || key === 'auto') {
    key = 'daughter'
  }
  return personas.get(key) || personas.get('daughter') || null
}

/** 该人格允许的分类 id 集合；null = 不限制。 */
export function personaPackFilter(persona) {
  if (!persona) return null
  const deny = new Set(persona.denyPacks || [])
  return { kinds: new Set(persona.kinds || []), deny }
}

/** 系统提示里的动态人格段（简短，控制在 60–120 字）。 */
export function personaPromptLines(persona, overrideMax) {
  if (!persona) return []
  const kinds = (persona.kinds || []).join(' / ')
  const cap = typeof overrideMax === 'number' ? overrideMax : persona.maxPerReply
  const discipline =
    cap <= 0
      ? '- 发送纪律：本轮不要使用表情（用户已关闭表情频率）。'
      : '- 发送纪律：一条回复最多 ' + cap + ' 个表情；涉及正经问题/代码/数据时最多 ' +
        Math.min(cap, persona.workModeMaxPerReply || 1) + ' 个；只用这些大类：' + kinds + '。'
  return ['- 当前表达人格：' + persona.name + '。' + persona.guide, discipline]
}

/** 各人格的默认口癖（用户自定义口癖优先；这里只是人格自带的习惯）。 */
export const PERSONA_CATCHPHRASES = {
  daughter: ['哥哥', '呀'],
  sweet: ['哥哥', '嘛～'],
  tsundere: ['哼', '才不是呢'],
  sassy: ['就这？', '行了'],
  kuudere: ['嗯。'],
  colleague: [],
  cat: ['喵～', '喵？'],
  genki: ['好耶', '冲！'],
  oneesan: ['乖', '慢慢来'],
  cool: ['嗯。'],
  chuuni: ['哼，凡人', '封印解除'],
  lazy: ['唔…', '随缘吧'],
}

/**
 * 口癖提示段。
 * userCatchphrases 非空时优先用用户的；否则用当前人格自带的默认口癖。
 * 每条：{ text, mode: 'prefix'|'suffix'|'any', every: 1..10 }
 */
export function catchphraseLines(persona, userCatchphrases, everyOverride) {
  const user = Array.isArray(userCatchphrases) ? userCatchphrases.filter((item) => item && item.text) : []
  const own =
    user.length > 0
      ? user
      : persona
        ? (PERSONA_CATCHPHRASES[persona.id] || []).map((text) => ({ text, mode: 'any', every: 3 }))
        : []
  if (own.length === 0) return []
  const described = own.map((item) => {
    const where = item.mode === 'prefix' ? '放开头' : item.mode === 'suffix' ? '放句尾' : '位置随意'
    const every = typeof everyOverride === 'number' && everyOverride > 0 ? everyOverride : item.every || 3
    return item.text + '（' + where + '，约每 ' + every + ' 条一次）'
  })
  return [
    '- 口癖（说话习惯，自然使用，不要机械重复）：' + described.join('、') + '。',
    '- 一条回复最多一个口癖；工作/正经问题可以不用；口癖不替代内容，也不影响事实。',
  ]
}
