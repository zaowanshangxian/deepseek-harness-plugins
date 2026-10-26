# 架构

这份文档只讲**与本仓库相关**的部分：DSH 插件怎么被加载、两个插件各自站在哪、哪些地方不能碰。

## 1. DSH 插件的最小形态

一个可安装的插件文件夹 = 三样东西：

```text
<插件>/
├── package.json        # 名字、入口、dsh 清单（bundle.patch / client.platform）
├── cordis.patch.yml    # 往宿主里插一行（id + 包名）
└── lib/                # 实际被加载的代码（构建产物）
```

`package.json` 里决定它怎么活：

```json
{
  "dsh": {
    "manifestVersion": 1,
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": [] }
  }
}
```

- **Host 半侧**：`main` 指向的模块，导出 `name` + `apply(ctx)`，在 Node 进程里跑。
  能拿到 `ctx.tools`（注册工具）、`ctx.systemPrompt`（注入提示）、`ctx.webServer`（挂 HTTP 路由）、
  `ctx.settings`、`ctx.credentials` 等服务。
- **Client 半侧**：`./client` 导出的文件，在浏览器里由 `window.__ModuleLoader__.load({ id, factory })` 装载。
  通过 `ctx.slots` 注册 UI（`ctx.slots.inject(name, …)` + `ctx.slots.register(options, Component)`）。
- 两侧共享 `package.json` 的包名，profile 的 `dsh.profile.bundles` 里列出包名决定装不装。

> 改了 Host 代码要重启 DSH；改了 Client 代码刷新页面即可（linked 安装实测，老版本可能要重启）。

## 2. 两个插件的位置

```text
                    ┌──────────────────── DSH Host（Node）────────────────────┐
                    │                                                          │
  更多表情和颜文字 ──┤ tools: emoji_pack                                        │
  （Host 参与）      │ systemPrompt: more-emoji-usage / more-emoji-settings     │
                    │ webServer: /more-emoji/api/settings  → settings.json     │
                    │                                                          │
  输入框花费金额 ────┤ 空壳（只有 name + 空 apply）                              │
  （纯 Client）      │                                                          │
                    └──────────────────────────────────────────────────────────┘
                                      │ 浏览器（DSH Web UI）
                    ┌─────────────────┴────────────────────────────────────────┐
                    │ 更多表情和颜文字                                          │
                    │   conversation.input.left      😊 按钮                   │
                    │   conversation.input.overlay   面板                      │
                    │   settings.general.item        一键发送                  │
                    │   settings.section             配置页                    │
                    │   plugins.bundle.config        插件页入口                │
                    │ 输入框花费金额                                            │
                    │   settings.section             配置页 / 定位状态          │
                    │   （+ DOM 观察：官方用量卡片的 <dl>）                     │
                    └──────────────────────────────────────────────────────────┘
```

具体的锚点、数据流、代码地图见各插件 `docs/DESIGN.md`。

## 3. 三条不变量

1. **不接管官方槽位**：不复用官方 slot id、不替换官方组件。只允许「新 id 注册」或「纯 DOM 观察追加」。
   （v0.3 曾用官方 usage 格子 id 替换组件，导致 `@deepseek-ai/dsh-client-ui-chat` 激活失败、DSH 进安全模式、profile 被重置。）
2. **保险丝**：每个注册点独立 `try/catch`；插件自己的错误不许冒泡到宿主。
3. **可卸载**：不写 DSH 配置文件；自身状态只落在 `localStorage` 与自己的 `settings.json`；卸载后官方 UI 原样。

## 4. 依赖方向

```text
输入框花费金额 ──可选──> dsh-token-mb（只读 HTTP：/token-mb/summary）
更多表情和颜文字 ──无──> 任何第三方插件
两个插件之间 ──无依赖──
```

- `dsh-token-mb` 没装：花费插件退回估算，功能不缺失（只是精度下降）
- 两个插件都**零 `dependencies`**，只有可选的 `peerDependencies`（表情插件的工具定义用 `@deepseek-ai/dsh-tools`）

## 5. 版本与兼容

- `engines.dsh`: `>=0.2.1-rc.2 <0.3.0`（主力测试 `0.2.1-rc.3`）
- 兼容性靠**官方公开契约**，不靠内部实现：
  - 表情插件：slots 名字、`inputActions` 的 `captureInsertion`/`insertText`/`submit`、`tools`/`systemPrompt`/`webServer` 服务
  - 花费插件：卡片的 `role="dialog"` + `aria-label`、明细 `<dl>`、单轮面板的 `data-turn-usage-details`
- 官方改版时优先「静默降级」，让插件不显示，也不影响官方功能；排错路径写在各自的 TROUBLESHOOTING 里

## 6. 构建产物为什么要提交

`lib/` 是 DSH 真正加载的东西，构建过程只是把 `src/` 的内容内联拼起来（表情插件还要内联 36 张贴纸 base64）。
仓库里提交 `lib/` 是为了「clone 下来直接能装」，代价是每次改 `src/` 都要重新构建并一起提交
（CI 里做一致性检查，见 [DEVELOPMENT](./DEVELOPMENT.md)）。
