/**
 * dsh-memhub · 独立全屏星图页（`GET /memhub/graph`）
 *
 * 设计约束（哥哥明确要求）：
 *   - **按需渲染**：打开页面才 fetch 一次图数据；不轮询、不 SSE、不常驻
 *   - 关掉页面就什么也不跑
 *   - 想更新就点「刷新」，不自动拉
 *
 * 为什么不用 lib/client.js：那是设置页里的 React 组件，走宿主打包；
 * 这个页面要能单独打开（自带 URL），所以做成零依赖的自包含 HTML。
 */

const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>memhub 星图</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 13px/1.5 -apple-system, "Segoe UI", system-ui, sans-serif;
         background: #0f1115; color: #d8dee9; }
  header { display: flex; align-items: center; gap: 12px; padding: 10px 16px;
           border-bottom: 1px solid #222834; position: sticky; top: 0; background: #0f1115; z-index: 2; }
  header h1 { font-size: 14px; margin: 0; font-weight: 600; }
  header .stats { color: #7d8899; font-size: 12px; }
  button { background: #1b2130; color: #d8dee9; border: 1px solid #2b3446; border-radius: 6px;
           padding: 4px 12px; cursor: pointer; font-size: 12px; }
  button:hover { background: #222b3d; }
  main { display: flex; height: calc(100vh - 45px); }
  #stage { flex: 1; min-width: 0; }
  svg { display: block; width: 100%; height: 100%; }
  aside { width: 320px; border-left: 1px solid #222834; padding: 14px; overflow: auto; }
  aside h2 { font-size: 13px; margin: 0 0 8px; color: #8fa3bf; font-weight: 600; }
  .kv { margin: 6px 0; }
  .kv b { color: #8fa3bf; font-weight: 500; display: inline-block; min-width: 64px; }
  .hint { color: #5d6677; font-size: 12px; }
  .empty { color: #5d6677; padding: 20px; }
  .legend { display: flex; gap: 12px; font-size: 12px; color: #7d8899; margin-left: auto; }
  .legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
</style>
</head>
<body>
<header>
  <h1>memhub 星图</h1>
  <span class="stats" id="stats">未加载</span>
  <span class="legend">
    <span><i style="background:#7aa2f7"></i>core</span>
    <span><i style="background:#9ece6a"></i>long</span>
    <span><i style="background:#7dcfff"></i>mid</span>
    <span><i style="background:#e0af68"></i>event</span>
    <span><i style="background:#9aa5b1"></i>working</span>
    <span><i style="background:#bb9af7"></i>实体</span>
  </span>
  <button id="refresh">刷新</button>
</header>
<main>
  <div id="stage"><div class="empty">点「刷新」拉取一次图数据（不自动更新）</div></div>
  <aside>
    <h2>节点详情</h2>
    <div id="detail" class="hint">点一个节点看详情。</div>
    <p class="hint" style="margin-top:18px">这个页面只在打开时拉一次数据；关掉就不再运行。数据源 <code>/memhub/api/graph</code>。</p>
  </aside>
</main>
<script>
const COLORS = { core: '#7aa2f7', long: '#9ece6a', mid: '#7dcfff', event: '#e0af68', working: '#9aa5b1', entity: '#bb9af7' };
const RINGS = { entity: 60, core: 110, long: 170, mid: 225, event: 275, working: 330 };
let lastGraph = null;

function layout(nodes) {
  const groups = { entity: [], core: [], long: [], mid: [], event: [], working: [] };
  for (const node of nodes) {
    const key = node.kind === 'entity' ? 'entity' : (RINGS[node.tier] ? node.tier : 'event');
    groups[key].push(node);
  }
  const placed = new Map();
  const W = 1000, H = 800, cx = W / 2, cy = H / 2;
  for (const [key, list] of Object.entries(groups)) {
    const radius = RINGS[key];
    list.forEach((node, index) => {
      const angle = (index / Math.max(1, list.length)) * Math.PI * 2 - Math.PI / 2;
      placed.set(node.id, {
        ...node,
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      });
    });
  }
  return { placed, W, H };
}

function render(graph) {
  const { nodes, edges, stats } = graph;
  const { placed, W, H } = layout(nodes);
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  for (const edge of edges) {
    const a = placed.get(edge.source);
    const b = placed.get(edge.target);
    if (!a || !b) continue;
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
    line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
    line.setAttribute('stroke', edge.origin === 'auto' ? '#243044' : '#3d4a60');
    line.setAttribute('stroke-width', edge.origin === 'auto' ? '0.6' : '1');
    svg.appendChild(line);
  }

  for (const node of placed.values()) {
    const circle = document.createElementNS(svgNS, 'circle');
    const color = COLORS[node.kind === 'entity' ? 'entity' : node.tier] || '#888';
    circle.setAttribute('cx', node.x); circle.setAttribute('cy', node.y);
    circle.setAttribute('r', node.kind === 'entity' ? 5 : 3.4);
    circle.setAttribute('fill', color);
    circle.setAttribute('opacity', '0.9');
    circle.style.cursor = 'pointer';
    circle.addEventListener('click', (event) => {
      event.stopPropagation();
      showDetail(node);
    });
    const title = document.createElementNS(svgNS, 'title');
    title.textContent = node.label || node.id;
    circle.appendChild(title);
    svg.appendChild(circle);
    if (node.kind === 'entity') {
      const text = document.createElementNS(svgNS, 'text');
      text.setAttribute('x', node.x + 8); text.setAttribute('y', node.y + 4);
      text.setAttribute('fill', '#bb9af7'); text.setAttribute('font-size', '11');
      text.textContent = node.label || '';
      svg.appendChild(text);
    }
  }

  const stage = document.getElementById('stage');
  stage.innerHTML = '';
  stage.appendChild(svg);
  document.getElementById('stats').textContent =
    nodes.length + ' 节点 · ' + edges.length + ' 边（原始 ' + (stats?.edgesRaw ?? '?') + '，auto 过滤 ' + (stats?.autoFiltered ?? '?') + '）';
  lastGraph = graph;
}

function showDetail(node) {
  const box = document.getElementById('detail');
  const rows = [
    ['id', node.id],
    ['kind', node.kind],
    ['tier', node.tier || '—'],
    ['importance', node.importance ?? '—'],
    ['entityKind', node.entityKind || '—'],
  ];
  box.className = '';
  box.innerHTML = '<div class="kv"><b>标题</b>' + (node.label || '') + '</div>' +
    rows.map(([key, value]) => '<div class="kv"><b>' + key + '</b>' + value + '</div>').join('');
}

async function load() {
  const stats = document.getElementById('stats');
  stats.textContent = '拉取中…';
  try {
    const res = await fetch('/memhub/api/graph', { headers: { accept: 'application/json' } });
    const data = await res.json();
    if (!data.ok) throw new Error('接口返回不 ok');
    render(data.graph);
  } catch (error) {
    stats.textContent = '拉取失败：' + error.message;
  }
}

document.getElementById('refresh').addEventListener('click', load);
</script>
</body>
</html>`

export function graphPageHtml() {
  return PAGE
}
