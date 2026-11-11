/**
 * 文本相似度（bigram Jaccard）。
 *
 * 为什么不用 Python difflib：跨语言。B 的 dedupe 用 `SequenceMatcher` 阈值 0.82，
 * 那是 difflib 的量纲；本实现是 bigram 集合的 Jaccard，**实测同义阈值约 0.6**
 * （拿 102 条真实记忆标定过：全库最高只有 0.46，0.2 以上仅 10 对）。
 *
 * 中文友好：按字符 bigram，不需要分词。
 *
 * 注意：**用全文算**，不要只截前 N 字——两条长记忆共享开头、尾部结论不同时，
 * 截断会把它们算成 1.000（2026-11-09 盲审实测：517 字 / 516 字，前 300 字相同，
 * 一条讲部署一条讲回滚，被判重复合并）。短文本反过来会虚高，调用方应按长度过滤。
 */

/** 字符串 → 字符 bigram 集合（去空白）。 */
export function bigrams(text) {
  const s = String(text || '').replace(/\s+/g, '')
  const set = new Set()
  for (let i = 0; i < s.length - 1; i += 1) set.add(s.slice(i, i + 2))
  return set
}

/** 两个 bigram 集合的 Jaccard。 */
export function jaccard(A, B) {
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const g of A) if (B.has(g)) inter += 1
  return inter / (A.size + B.size - inter)
}

/** 两个字符串的相似度 0–1（去掉空白后按 bigram 集合算 Jaccard）。 */
export function similarity(a, b) {
  return jaccard(bigrams(a), bigrams(b))
}

/**
 * 在一组候选里找与 target 最像的。
 * @returns {{item: any, score: number}|null}
 */
export function bestMatch(target, candidates, options = {}) {
  const threshold = Number(options.threshold) || 0.6
  const textOf = options.textOf || ((item) => `${item.title || ''} ${String(item.content || '')}`)
  let best = null
  for (const item of candidates) {
    const score = similarity(textOf(target), textOf(item))
    if (score >= threshold && (!best || score > best.score)) best = { item, score }
  }
  return best
}
