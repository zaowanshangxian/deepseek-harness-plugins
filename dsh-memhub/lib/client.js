/**
 * dsh-memhub · Client 半侧（面板）
 * 设置页一节：技能库（启停）/ 记忆星图 / 情感状态 / 自我叙述。
 * 数据只读 /memhub/api/state 与 /graph；启停走 POST /skill/toggle（仍然备份 .bak-toggle）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-memhub',
  factory: function (require) {
    var React = require('react')
    var h = React.createElement
    var module = { exports: {} }
    var exports = module.exports

    var COLORS = { core: '#f2c14e', long: '#8ab4f8', mid: '#5fd3f3', event: '#7ee0b0', working: '#9aa5b1', entity: '#c792ea' }
    var S = {
      wrap: { padding: '12px 4px', fontSize: 13, lineHeight: 1.6 },
      row: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid rgba(128,128,128,.15)' },
      name: { fontWeight: 600, minWidth: 160 },
      dim: { opacity: 0.65, fontSize: 12 },
      btn: { marginLeft: 'auto', fontSize: 12, padding: '2px 8px', borderRadius: 6, border: '1px solid rgba(128,128,128,.35)', background: 'transparent', color: 'inherit', cursor: 'pointer' },
      tab: { fontSize: 12, padding: '3px 10px', borderRadius: 999, border: '1px solid rgba(128,128,128,.3)', background: 'transparent', color: 'inherit', cursor: 'pointer' },
      tabOn: { fontSize: 12, padding: '3px 10px', borderRadius: 999, border: '1px solid rgba(138,180,248,.7)', background: 'rgba(138,180,248,.15)', color: 'inherit', cursor: 'pointer' },
    }

    function api(path) {
      return fetch('/memhub/api' + path, { headers: { accept: 'application/json' } }).then(function (r) {
        return r.json()
      })
    }
    function post(path, body) {
      return fetch('/memhub/api' + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then(function (r) {
        return r.json()
      })
    }

    function SkillsView(props) {
      var state = props.state
      if (!state) return h('div', { style: S.dim }, '加载中…')
      return h(
        'div',
        { style: S.wrap },
        h('div', { style: S.dim }, '共 ' + state.skills.length + ' 个技能 ｜ 描述不常驻 ｜ 按用途分组'),
        (function () {
          var groups = {}
          state.skills.forEach(function (skill) {
            var category = skill.category || '其他'
            if (!groups[category]) groups[category] = []
            groups[category].push(skill)
          })
          return Object.keys(groups)
            .sort()
            .map(function (category) {
              return h(
                'div',
                { key: category, style: { marginTop: 10 } },
                h('div', { style: { opacity: 0.65, fontSize: 12, fontWeight: 600 } }, category + '（' + groups[category].length + '）'),
                groups[category].map(function (skill) {
                  return h(
                    'div',
                    { key: skill.name, style: S.row },
                    h('span', { style: S.name }, skill.name),
                    h('span', { style: S.dim }, (skill.description || '').slice(0, 34)),
                    h(
                      'button',
                      {
                        style: S.btn,
                        onClick: function () {
                          var label = skill.hidden ? '启用' : '停用'
                          if (typeof window !== 'undefined' && window.confirm && !window.confirm(label + '技能「' + skill.name + '」？')) return
                          post('/skill/toggle', { name: skill.name, enabled: skill.hidden }).then(function (result) {
                            if (!result.ok) {
                              if (typeof window !== 'undefined' && window.alert) window.alert(result.error || '操作失败')
                              return
                            }
                            props.reload()
                          })
                        },
                      },
                      skill.hidden ? '启用' : '停用',
                    ),
                  )
                }),
              )
            })
        })(),
      )
    }

    function layout(graph) {
      var pos = {}
      var cx = 420
      var cy = 220
      var rings = { core: 55, long: 90, mid: 125, event: 155, working: 185 }
      var buckets = { core: [], long: [], mid: [], event: [], working: [] }
      var entities = []
      for (var i = 0; i < graph.nodes.length; i += 1) {
        var node = graph.nodes[i]
        if (node.kind === 'entity') entities.push(node)
        else (buckets[node.tier] || buckets.event).push(node)
      }
      Object.keys(buckets).forEach(function (tier) {
        var list = buckets[tier]
        for (var j = 0; j < list.length; j += 1) {
          var angle = (j / Math.max(1, list.length)) * Math.PI * 2
          pos[list[j].id] = {
            x: cx + Math.cos(angle) * rings[tier],
            y: cy + Math.sin(angle) * rings[tier],
            node: list[j],
          }
        }
      })
      for (var k = 0; k < entities.length; k += 1) {
        var a = (k / Math.max(1, entities.length)) * Math.PI * 2
        pos[entities[k].id] = {
          x: cx + Math.cos(a) * 26,
          y: cy + Math.sin(a) * 26,
          node: entities[k],
        }
      }
      return pos
    }

    function GraphView(props) {
      var graph = props.graph
      var [selected, setSelected] = React.useState(null)
      if (!graph) return h('div', { style: S.dim }, '星图加载中…')
      var pos = layout(graph)
      var keys = Object.keys(pos)
      var lines = graph.edges
        .map(function (edge, index) {
          var a = pos[edge.source]
          var b = pos[edge.target]
          if (!a || !b) return null
          return h('line', {
            key: 'e' + index,
            x1: a.x,
            y1: a.y,
            x2: b.x,
            y2: b.y,
            stroke: '#8ab4f8',
            strokeOpacity: 0.1,
            strokeWidth: 1,
          })
        })
        .filter(Boolean)
      var dots = keys.map(function (id) {
        var point = pos[id]
        var node = point.node
        var active = selected && selected.id === id
        var r = node.kind === 'entity' ? 6 : node.tier === 'core' ? 8 : node.tier === 'long' ? 5 : 4
        var fill = node.kind === 'entity' ? COLORS.entity : COLORS[node.tier] || COLORS.event
        return h(
          'circle',
          {
            key: id,
            cx: point.x,
            cy: point.y,
            r: active ? r + 2 : r,
            fill: fill,
            stroke: active ? '#ffffff' : 'transparent',
            strokeWidth: 1.5,
            style: { cursor: node.kind === 'memory' ? 'pointer' : 'default' },
            onClick: function () {
              if (node.kind !== 'memory') return
              setSelected({ id: node.id, label: node.label, tier: node.tier })
            },
          },
          h('title', null, node.label + '（' + (node.kind === 'entity' ? node.entityKind : node.tier) + '）'),
        )
      })
      var memoryTier = function (tier) {
        post('/memory/tier', { id: selected.id, tier: tier }).then(function () {
          setSelected({ id: selected.id, label: selected.label, tier: tier })
          if (props.reload) props.reload()
        })
      }
      var actions = selected
        ? h(
            'div',
            { style: { marginTop: 8, padding: 8, border: '1px solid rgba(128,128,128,.3)', borderRadius: 8 } },
            h('div', null, '选中：' + selected.label + '（' + selected.tier + '）'),
            h(
              'div',
              { style: { display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' } },
              ['core', 'long', 'mid', 'event', 'working'].map(function (tier) {
                return h('button', { key: tier, style: S.btn, onClick: function () { memoryTier(tier) } }, '设为 ' + tier)
              }),
              h(
                'button',
                {
                  style: S.btn,
                  onClick: function () {
                    if (window.confirm && !window.confirm('删除（归档）「' + selected.label + '」？可恢复。')) return
                    post('/memory/archive', { id: selected.id, archived: true }).then(function () {
                      setSelected(null)
                      if (props.reload) props.reload()
                    })
                  },
                },
                '删除',
              ),
              h(
                'button',
                {
                  style: S.btn,
                  onClick: function () {
                    post('/memory/archive', { id: selected.id, archived: false }).then(function () {
                      if (props.reload) props.reload()
                    })
                  },
                },
                '恢复',
              ),
            ),
          )
        : h('div', { style: S.dim }, '点一个记忆节点：可改主次（tier）、删除（归档）或恢复。')
      return h(
        'div',
        { style: S.wrap },
        h('div', { style: S.dim }, '节点 ' + graph.nodes.length + ' ｜ 边 ' + graph.edges.length + ' ｜ 过滤 auto 边 ' + graph.stats.autoFiltered),
        h('svg', { viewBox: '0 0 840 440', style: { width: '100%', height: 440 } }, lines, dots),
        actions,
        h(
          'div',
          { style: S.dim },
          '内环实体·core · long · mid · event · 外环 working（不注入/不衰减，按需读）；金=core、蓝=long、青=mid、绿=event、灰=working、紫=实体。',
        ),
      )
    }

    function PersonaView(props) {
      var persona = props.state ? props.state.persona : null
      if (!persona) return h('div', { style: S.dim }, '加载中…')
      var base = persona.baseline || {}
      var effective = persona.effective || {}
      var dims = ['warmth', 'playfulness', 'clinginess', 'catness', 'tsundere', 'formality', 'humor']
      return h(
        'div',
        { style: S.wrap },
        h('div', { style: S.dim }, '蓝图：' + (base.blueprint || '') + ' ｜ 演化步长上限 0.02，情感偏置 24h 半衰期衰减到 0'),
        dims.map(function (key) {
          var b = Number(base[key] || 0)
          var e = Number(effective[key] || 0)
          var diff = Number((e - b).toFixed(3))
          return h(
            'div',
            { key: key, style: S.row },
            h('span', { style: S.name }, key),
            h('span', { style: S.dim }, 'base ' + b.toFixed(2) + ' ｜ 生效 ' + e.toFixed(2) + (diff !== 0 ? '（偏置 ' + diff + '）' : '')),
          )
        }),
        h('div', { style: S.dim }, '约束：' + (base.boundaries || []).join('；')),
      )
    }

    function AffectView(props) {
      var affect = props.state ? props.state.affect : null
      if (!affect) return h('div', { style: S.dim }, '加载中…')
      return h(
        'div',
        { style: S.wrap },
        h('div', null, 'mood：' + affect.mood + '（强度 ' + Number(affect.intensity).toFixed(2) + '）'),
        h('div', null, '亲近 ' + Number(affect.closeness).toFixed(2) + ' ｜ 语气软硬 ' + Number(affect.softness).toFixed(2) + ' ｜ 表情密度 ' + Number(affect.emoji_density).toFixed(2)),
        h('div', { style: S.dim }, '依据：' + ((affect.basis && affect.basis.length) ? affect.basis.join(', ') : '（无依据，回落中性）')),
        h('div', { style: S.dim }, '约束：' + (affect.boundaries || []).join('；')),
      )
    }

    function SelfView(props) {
      var state = props.state
      if (!state) return h('div', { style: S.dim }, '加载中…')
      return h(
        'div',
        { style: S.wrap },
        h('div', null, '自我叙述：' + (state.self ? state.self.title + '（' + state.self.count + ' 段活跃）' : '（还没有）')),
        h('div', { style: S.dim }, '教训 ' + state.lessons.length + ' 条 ｜ 技能台账 ' + state.ledger.length + ' 条 ｜ 待改版 ' + state.revisions.length + ' 个'),
        state.lessons.slice(-5).map(function (lesson) {
          return h('div', { key: lesson.id, style: S.row }, h('span', { style: S.dim }, lesson.trigger + ' → ' + String(lesson.right || '').slice(0, 40)))
        }),
      )
    }

    function Panel() {
      var [state, setState] = React.useState(null)
      var [graph, setGraph] = React.useState(null)
      var [tab, setTab] = React.useState('skills')
      function reload() {
        api('/state').then(setState).catch(function () {})
        api('/graph').then(function (result) { setGraph(result.graph) }).catch(function () {})
      }
      React.useEffect(reload, [])
      if (!state) return h('div', { style: S.dim }, '记忆·技能中枢加载中…')
      var tabs = [
        ['skills', '技能库'],
        ['graph', '记忆星图'],
        ['affect', '情感'],
        ['self', '自我'],
        ['persona', '性格'],
      ]
      return h(
        'div',
        { style: S.wrap },
        h(
          'div',
          { style: { display: 'flex', gap: 6, marginBottom: 10 } },
          tabs.map(function (item) {
            return h(
              'button',
              { key: item[0], style: tab === item[0] ? S.tabOn : S.tab, onClick: function () { setTab(item[0]) } },
              item[1],
            )
          }),
        ),
        tab === 'skills' && h(SkillsView, { state: state, reload: reload }),
        tab === 'graph' && h(GraphView, { graph: graph, reload: reload }),
        tab === 'affect' && h(AffectView, { state: state }),
        tab === 'self' && h(SelfView, { state: state }),
        tab === 'persona' && h(PersonaView, { state: state }),
      )
    }

    function SettingsPage() {
      return h('div', { style: S.wrap }, h(Panel))
    }

    exports.inject = ['slots']
    exports.apply = function (ctx) {
      try {
        ctx.slots.register(
          { name: 'settings.section', id: 'memhub-settings', order: 57, label: '记忆·技能中枢' },
          SettingsPage,
        )
      } catch (error) {
        try {
          console.warn('[memhub] settings section skipped', error)
        } catch (ignored) {
          /* ignore */
        }
      }
    }
    return module.exports
  },
})
