#!/usr/bin/env bash
# 一次性反向对照脚本（不进交付物）：把每个已修的 bug 逐个注回一份临时副本，
# 确认 test/browser-smoke.mjs（或 test/plan.test.mjs）里对应的回归断言真的会 FAIL
# —— 否则那些断言是空的。
#
# 每例都校验"补丁真的改了文件"，避免静默无效的补丁把对照变成幻觉。
# 用法：bash test/negative-control.sh
set -u
SRC="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
echo "临时副本：$WORK"

# run_case <名字> <补丁.py>...（可多个）；补丁用 argv[1] 拿文件、原地改
run_case() {
  local name="$1"
  shift
  rm -rf "$WORK/case"
  cp -r "$SRC" "$WORK/case"
  local before after patch
  before="$(sha1sum <"$WORK/case/lib/client.js")"
  for patch in "$@"; do
    python "$patch" "$WORK/case/lib/client.js" || { echo "补丁执行失败：$name / $patch"; return; }
  done
  after="$(sha1sum <"$WORK/case/lib/client.js")"
  if [ "$before" = "$after" ]; then
    echo "───── 注入：$name ─────"
    echo "  补丁没改到文件（锚点失配），这一例无效"
    return
  fi
  echo "───── 注入：$name ─────"
  ( cd "$WORK/case" && node test/browser-smoke.mjs 2>&1 | grep -E "^  FAIL|结果：" )
}

# run_unit_case <名字> <补丁.py>：对照纯函数单测（plan / 状态词表）
run_unit_case() {
  local name="$1" patch="$2"
  rm -rf "$WORK/case"
  cp -r "$SRC" "$WORK/case"
  local before after
  before="$(sha1sum <"$WORK/case/lib/client.js")"
  python "$patch" "$WORK/case/lib/client.js" || { echo "补丁执行失败：$name"; return; }
  after="$(sha1sum <"$WORK/case/lib/client.js")"
  echo "───── 注入：$name ─────"
  if [ "$before" = "$after" ]; then
    echo "  补丁没改到文件（锚点失配），这一例无效"
    return
  fi
  ( cd "$WORK/case" && node --test test/plan.test.mjs 2>&1 | grep -E "^✖|^ℹ (pass|fail)" )
}

# ── 补丁 1：只拆"跳过自有权重层"的闸门 ──
cat >"$WORK/p1.py" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
old = "return Boolean(el && typeof el.closest === 'function' && el.closest('[' + LAYER_ATTR + ']'))"
assert old in s, 'anchor missing'
s = s.replace(old, 'return false')
open(p, 'w', encoding='utf-8').write(s)
PY

# ── 补丁 2：只拆签名比较 ──
cat >"$WORK/p2.py" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
old = 'if (runtime.sigs.get(host) === sig && layerIntact(existing, snapshot.nodes.length)) return false'
assert old in s, 'anchor missing'
s = s.replace(old, 'if (false) return false')
open(p, 'w', encoding='utf-8').write(s)
PY

# ── 补丁 3：整块 replaceChildren（每帧换新节点） ──
cat >"$WORK/p3.py" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
old = """      const cache = cacheOf(layer)
      syncPool(ensureGroup(layer, 'paths'), cache.paths, 'path', paths)
      syncPool(ensureGroup(layer, 'dots'), cache.dots, 'circle', dots)"""
new = """      const fragment = document.createDocumentFragment()
      for (const spec of paths) {
        const el = document.createElementNS(SVG_NS, 'path')
        for (const name of Object.keys(spec.attrs)) setAttr(el, name, spec.attrs[name])
        fragment.appendChild(el)
      }
      for (const spec of dots) {
        const el = document.createElementNS(SVG_NS, 'circle')
        for (const name of Object.keys(spec.attrs)) setAttr(el, name, spec.attrs[name])
        fragment.appendChild(el)
      }
      layer.replaceChildren(fragment)"""
assert old in s, 'anchor missing'
s = s.replace(old, new)
open(p, 'w', encoding='utf-8').write(s)
PY

# ── 补丁 4：圆点 y 量整行 ──
cat >"$WORK/p4.py" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
old = 'const rect = (cardOf(row) || row).getBoundingClientRect()'
assert old in s, 'anchor missing'
s = s.replace(old, 'const rect = row.getBoundingClientRect()')
open(p, 'w', encoding='utf-8').write(s)
PY

# ── 补丁 5：状态读取不过滤行内控件 ──
cat >"$WORK/p5.py" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
old = 'if (found.closest(CONTROL_SEL)) continue'
assert old in s, 'anchor missing'
s = s.replace(old, '')
open(p, 'w', encoding='utf-8').write(s)
PY

# ── 补丁 6：不摘离场 host ──
cat >"$WORK/p6.py" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
old = '        if (!host.isConnected) releaseHost(host)'
assert old in s, 'anchor missing'
s = s.replace(old, '        if (false) releaseHost(host)')
open(p, 'w', encoding='utf-8').write(s)
PY

# ── 补丁 7：摘掉的节点不挂回去 ──
cat >"$WORK/p7.py" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
old = """        if (el && el.parentNode !== group) {
          // 宿主重渲染时可能把我们已画好的节点摘掉：还活着的就原样挂回去
          // （身份不变 → 正在跑的 CSS 动画不会重启）。
          group.appendChild(el)
        }"""
assert old in s, 'anchor missing'
s = s.replace(old, '')
open(p, 'w', encoding='utf-8').write(s)
PY

# ── 补丁 8：重新可见时不补脏标记（可见性闸门吃掉变更） ──
cat >"$WORK/p8.py" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
old = '          runtime.dirty.add(entry.target)'
assert old in s, 'anchor missing'
s = s.replace(old, '')
open(p, 'w', encoding='utf-8').write(s)
PY

# ── 补丁 9：不认"卡片直接子级上的状态"（bash 卡片读成 idle） ──
cat >"$WORK/p9.py" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
old = """        let control = null
        for (const child of card.children || []) {
          if (!child.hasAttribute('data-state')) continue
          if (child.matches(CONTROL_SEL)) {
            if (!control) control = child
            continue
          }
          return classify(child.getAttribute('data-state'))
        }
        if (control) return classify(control.getAttribute('data-state'))"""
assert old in s, 'anchor missing'
s = s.replace(old, '')
open(p, 'w', encoding='utf-8').write(s)
PY

# ── 补丁 10：把 <svg> 插回宿主最前面（挤掉宿主第一行的 :first-child） ──
cat >"$WORK/p10.py" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
old = '      host.appendChild(svg)'
assert old in s, 'anchor missing'
s = s.replace(old, '      host.insertBefore(svg, host.firstChild)')
open(p, 'w', encoding='utf-8').write(s)
PY

# ── 补丁 11：去掉自己的 margin:0（被宿主的兄弟规则推偏） ──
cat >"$WORK/p11.py" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
old = "      '[data-ptree-host]>[data-ptree]{margin:0}',\n"
assert old in s, 'anchor missing'
s = s.replace(old, '')
open(p, 'w', encoding='utf-8').write(s)
PY

# ── 补丁 12（单测）：干线不按 x 分组，跨不同 x 连成一条（会画出斜线） ──
cat >"$WORK/p12.py" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
old = "        const key = round(node.x)"
assert old in s, 'anchor missing'
s = s.replace(old, "        const key = 'all'")
open(p, 'w', encoding='utf-8').write(s)
PY

run_case "只拆 insideLayer 闸门（签名应兜住，预期全过）" "$WORK/p1.py"
run_case "只拆签名比较（闸门应兜住，预期全过）" "$WORK/p2.py"
run_case "只改回整块重建（签名会兜住，预期只掉动画相关）" "$WORK/p3.py"
run_case "三道防线全拆（还原自触发死循环，预期炸）" "$WORK/p1.py" "$WORK/p2.py" "$WORK/p3.py"
run_case "圆点 y 量整行（父节点错位）" "$WORK/p4.py"
run_case "状态读取不过滤行内控件（假状态）" "$WORK/p5.py"
run_case "不摘离场 host（只涨不降）" "$WORK/p6.py"
run_case "摘掉的节点不挂回去（层变空）" "$WORK/p7.py"
run_case "重新可见时不补脏标记（滚回来不补画）" "$WORK/p8.py"
run_case "不认卡片子级状态（bash 读成 idle）" "$WORK/p9.py"
run_case "把 <svg> 插回宿主最前面（挤掉第一行）" "$WORK/p10.py"
run_case "去掉自己的 margin:0（被兄弟规则推偏）" "$WORK/p11.py"
run_unit_case "干线不按 x 分组（跨 x 画斜线）" "$WORK/p12.py"

rm -rf "$WORK"
echo "对照结束"
