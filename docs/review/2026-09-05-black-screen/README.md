# Abyssal Reverie v1.1.0 — 黑屏问题 Codex 审核包

生成时间：2026-09-05 12:14 (GMT+8)
应用：Abyssal Reverie · 深海绮梦 v1.1.0
技术栈：Tauri 2.11.5 + React 19 + TypeScript + Vite 8 + Tailwind 4 + Rust + SQLite

---

## 0. TL;DR（给审核者）

存在**两个独立的 bug**，它们的屏幕表现不同，必须分开处理：

| # | 问题 | 状态 | 屏幕表现 |
|---|------|------|----------|
| **Bug 1** | `src-tauri/Cargo.toml` 缺失 Tauri 2 强制的 `[features] custom-protocol`，导致前端资源未嵌入二进制，运行时回落到 `devUrl` | ✅ **已修复并验证**（commit `5d3659c`） | **白屏** |
| **Bug 2** | 资源已正确加载（CSS 生效），但 **React 未挂载 / 未渲染出任何内容** | ❌ **未解决，本次审核重点** | **黑屏** |

**黑屏 ≠ 修复失败。** 恰恰相反：白屏 → 黑屏的转变证明 Bug 1 的修复已生效（CSS 现在能加载了，而 `body` 背景是 `#050709` 纯黑）。Bug 2 是一个此前被 Bug 1 完全掩盖的独立缺陷 —— 因为 v1.1.0 从未成功启动过，Bug 2 从引入至今从未被观测到。

---

## 0.5 【重要修正】v1.0.0 对照实验 —— 前面关于 CSP 的推断全部作废

v1.0.0 = commit `5df02d6`。对 v1.0.0 → v1.1.0 做逐文件 diff：

| 文件 | v1.0.0 → v1.1.0 的差异 |
|------|------------------------|
| `src-tauri/tauri.conf.json` | **仅版本号 1.0.0 → 1.1.0**（CSP 一字未改） |
| `vite.config.ts` | **无差异** |
| `index.html` | **无差异** |
| `src/main.tsx` | **无差异** |
| `package.json` | 仅 version + license |

**结论：`tauri.conf.json` 里的 CSP、`index.html`、Vite 配置、React 挂载入口与 v1.0.0 完全一致。**
v1.0.0 在这套完全相同的配置下能正常显示，因此：

- ❌ **H1（CSP 阻止 module script）—— 排除。** CSP 与能用的 v1.0.0 一字不差。
- ❌ **H2（`crossorigin`）—— 排除。** 该属性由同一份 `vite.config.ts` 生成。
- ❌ **H3（`frontendDist` 解析）—— 排除。** 配置未变。

> 补充：本轮探针在「CSP 开启」下日志为空，曾被误读为"脚本被拦"。真正原因是
> `connect-src ipc: http://ipc.localhost` 拦截了探针自身外发的 `fetch`，
> 与业务脚本无关。**空日志证明的是 fetch 被拦，不能证明脚本被拦。**

### v1.0.0 与 v1.1.0 在这台机器上表现一致

直接运行 v1.0.0 免安装包（`D:\360安全浏览器下载\abyssal-reverie.exe`，20,488,704 B）实测：

| 指标 | v1.0.0 | v1.1.0 |
|------|--------|--------|
| 进程内存 | 32.8 MB | 32.8 MB |
| WebView 进程 CPU delta（3s 采样） | 全为 0 | 全为 0 |
| 直接子进程数 | 0 | 0 |

**两者完全一致** —— 强烈指向**环境/运行时问题**，而非 v1.1.0 代码回归。

### v1.1.0 真正的改动是一次大重构

`src/App.tsx` 净减 **1420 行**，被拆分为 `src/features/**`、`src/components/**`、
`src/domain/**`、`src/services/**`，同时 Rust 侧新增 schema v3 / tags / `finish_timer`。
若最终确认是代码问题，嫌疑范围应锁定在这次重构（尤其是模块循环依赖与模块级副作用）。

---

## 1. 症状演化（关键时间线）

| 阶段 | 用户报告 | 实质 |
|------|----------|------|
| 初始 | 「运行的和旧版没区别」 | 用户运行的是 GitHub Release 下载的 **v1.0.0** 免安装包，自然没有 v1.1 新功能 |
| ② | 「AbyssalReverie 无法正常运行」 | — |
| ③ | 「白屏了，打不开」 | Bug 1：资源未嵌入 |
| ④ 现在 | 「依然是黑屏」 | Bug 1 已修；**Bug 2 暴露** |

**为什么白→黑能证明修复生效：**

`src/index.css` 第 85-87 行：
```css
body {
  background: #050709;   /* RGB(5, 7, 9) —— 视觉上就是纯黑 */
}
```

- 修复**前**：CSS 完全没加载 → 浏览器默认白底 → **白屏**
- 修复**后**：CSS 加载成功，body 变黑，但 React 未渲染任何内容 → **黑屏**

---

## 2. Bug 1：已修复（供审核确认）

### 根因

`src-tauri/Cargo.toml` **完全没有 `[features]` 段**。

Tauri 2 的构建脚本 `tauri-2.11.5/build.rs` 第 255-261 行：

```rust
let custom_protocol = has_feature("custom-protocol");
let dev = !custom_protocol;
alias("dev", dev);
println!("cargo:dev={dev}");
```

`tauri-build` 读取 `DEP_TAURI_DEV` → `is_dev()` 为真时**跳过嵌入 `frontendDist`**，运行时改从 `devUrl`（`http://127.0.0.1:1420`）加载界面。生产机上没有开发服务器 → 永久白屏。

`pnpm tauri build` 会由 CLI 自动补上 `--features custom-protocol`；但**直接调用 `cargo build --release` 不会**，这是本项目的构建方式，因此踩坑。

### 修复（commit `5d3659c`）

```toml
[features]
custom-protocol = ["tauri/custom-protocol"]
```

### 验证

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| EXE 体积 | 12,176,384 B | **20,685,312 B** |
| `tauri-codegen-assets` 目录 | 缺失 | 存在 |
| build output 中的 `cargo:rustc-cfg=dev` | 存在 | 不存在 |
| EXE 内 `ocean-loop` 标记 | 0 | 1 |
| EXE 内 `index-Dj9-wjoe.js` | 0 | 1 |
| EXE 内 `index-CI2_bgWS.css` | 0 | 1 |
| `cargo test` | — | 95 passed / 0 failed / 1 ignored |
| `vitest run` | — | 24 / 24 passed |
| `tsc --noEmit` | — | 干净 |

`dist/` 全部内容（合计 9,198,437 B）已嵌入，包括 7.7 MB 的 `dist/media/ocean-loop.mp4`。

---

## 3. Bug 2：本次审核重点（未解决）

### 现象

应用启动后窗口标题正确（`Abyssal Reverie · 深海绮梦`），进程存活，WebView2 子进程（`msedge.exe`）正常派生，CSS 生效（背景变黑），但**界面上没有任何内容**。

### 已确证的事实

1. **进程健康**：PID 116260，Responding=True，Handles=351，Threads=21，无挂起
2. **WebView 活跃**：派生了 `msedge.exe` 子进程树（父进程 PPid=110280）
3. **CSS 已加载并生效**：body 背景为 `#050709`（黑） —— 这是黑屏的直接来源
4. **构建产物完整有效**：
   - `dist/assets/index-Dj9-wjoe.js`（262,234 B）语法完好，头部为正常 ESM 产物
   - `dist/assets/index-CI2_bgWS.css`（16,751 B）由 Tailwind v4.2.2 正常生成
   - 布局类 `content-area` / `panel-enter` / `with-right` 在 CSS 中均存在
5. **资源确实嵌入了 EXE**（见上表）
6. **数据库迁移成功**：`PRAGMA user_version` = 3，`integrity_check` = ok，5 张表，4 个默认标签，20 条历史 session 回填

### 已排除的假设

| 假设 | 排除依据 |
|------|----------|
| 加载门控卡住（`GatewayProvider` 等待异步初始化） | `gatewayContext.tsx` 全程同步，`useMemo` 直接构造实例，无 loading 态 |
| `timer === null` 导致渲染期 TypeError | `TimerPanel` 完全空值安全：`timer?.state ?? "idle"`、`timer?.mode ?? "focus"`，第 47 行的 `timer.targetEndAt` 已被 `timer?.targetEndAt` 短路保护 |
| `settings === null` 导致崩溃 | `const activeSettings = settings ?? DEFAULT_SETTINGS` |
| Tailwind 未扫描到类导致布局塌陷 | 关键类在构建 CSS 中均存在；且即便塌陷也应看到侧边栏 |
| 数据未加载导致空界面 | 即便 bootstrap 完全失败，React 仍应渲染出侧边栏 + TimerPanel 外壳（全部有默认值兜底） |
| 视频背景本身渲染成黑色遮住 UI | `OceanVideo` 为 `zIndex: 0`，且 v1.0.0 同样结构可正常显示 |

### 结论（已用探针实证，不再是猜测）

**页面在 `load` 之后立刻被冻结，React 的调度器来不及提交首帧。**

用 HTTP 回传探针（详见 `03-probe-technique.md`）从进程外部实测到的完整序列：

```
sync|hidden=false|vis=visible|win=1440x900|bodyBg=rgb(5, 7, 9)|hasFocus=true
microtask          ✓
messagechannel     ✓   ← React 18 Scheduler 用的就是这个，它是通的
timeout0           ✓
js-start|readyState=interactive
mounted            ← render() 确实被调用了
dcl
load
tick1|rootKids=0|videos=0|text=   ← 此时 React 一个节点都还没提交
```

随后**全部停止**：

```
timeout500     ✗
beat(1s)       ✗
raf1 / raf2    ✗   ← requestAnimationFrame 从未触发
tick30/150/400 ✗   ← setTimeout(0) 链只跑了一跳
```

补充证据：所有 `msedge` / `msedgewebview2` 进程的 **CPU delta 均为 0**（1.2 秒采样窗口），
渲染器存活但完全空闲。

**因果链**：JS 执行 → `render()` 被调用 → 页面随即被冻结 → React Scheduler 拿不到
执行机会 → `#root` 保持 0 个子节点 → 没有内容可绘制 → 只显示 `body` 的 `#050709` → **黑屏**。

注意 `requestAnimationFrame` 从不触发是关键：**rAF 只在合成器产帧时回调**，
它不触发说明这个页面从头到尾没有绘制过一帧。

### 仍然待裁决：页面为什么会被冻结？

上一节的机制是确证的，但「谁冻结了页面」还没有定论。按可能性排序：

| # | 假设 | 说明 |
|---|------|------|
| **F1** | **合成器 / GPU 问题** | rAF 从不触发是最强指向。若窗口从未被合成，Chromium 会冻结页面。项目依赖里有 `window-vibrancy`（Mica/Acrylic），这类效果在部分 Windows 版本上会破坏合成 |
| **F2** | **WebView2 运行时状态异常** | 本机存在大量**残留的 `msedge` / `msedgewebview2` 进程，最早可追溯到 9 月 2 日**。运行时状态可能已损坏。**这唯一假设能解释"为什么只有这台机器复现"** |
| **F3** | CSP / `crossorigin` | 本次探针全程在 **CSP 已关闭**的情况下运行，所以这两个假设**尚未被排除**，只是已不是主因（因为 JS 确实执行了） |
| **F4** | 其他 WebView2 干预策略 | 需 devtools 才能确认 |

> **关于 F3 的说明**：本轮为定位问题临时把 `csp` 设为 `null`，探针是在该配置下跑的。
> 源码已还原（CSP 恢复原值）。若要排除 F3，需恢复 CSP 后重跑同一套探针。

### 建议的下一步（按性价比排序）

1. **构建 debug 二进制拿 devtools**：
   `cargo build --features custom-protocol`（不加 `--release`）。Tauri 在 debug 下
   默认启用 devtools，窗口内右键 → 检查，可直接读 Console 与 Performance 面板，
   并当场执行 JS 验证「页面是否真的冻结」。**这是唯一能一锤定音的手段。**
2. **验证 F2**：清理残留的 WebView2 进程 / 修复 WebView2 Evergreen Runtime 后复测。
   ⚠️ 不要盲目 `kill msedge.exe` —— 那可能是用户正在使用的 Edge 浏览器，会丢标签页。
3. **验证 F1**：临时移除 `window-vibrancy` 相关调用后复测。

`tauri.conf.json` 中的 CSP：

```
default-src 'self' customprotocol: asset:;
img-src 'self' asset: data: blob:;
media-src 'self' asset: blob:;
style-src 'self' 'unsafe-inline';
font-src 'self' asset: data:;
connect-src ipc: http://ipc.localhost
```

疑点：
- **没有显式 `script-src`**，因此 `script-src` 回落到 `default-src 'self' customprotocol: asset:`
- `customprotocol:` 和裸 `asset:` 是 **Tauri v1 的协议名**。Tauri 2 使用 `tauri://` / `http://tauri.localhost` / `http://asset.localhost`
- Tauri 会为 IPC 注入内联脚本，需要 `'unsafe-inline'` 或自动注入的 nonce。若 nonce 注入未覆盖 `default-src` 回落路径，Tauri 自身脚本会被拦截

**为什么 CSS 能过而 JS 不能**：`style-src` 显式声明了 `'unsafe-inline'`，而 `script-src` 没有，且只能靠回落。

**建议验证**：将 CSP 临时改为 `"csp": null`（完全关闭），重新构建。若界面出现，即可确证。

#### H2 — `crossorigin` 属性在自定义协议下失败

`dist/index.html`：
```html
<script type="module" crossorigin src="/assets/index-Dj9-wjoe.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-CI2_bgWS.css">
```

Vite 默认给产物加 `crossorigin`。若 Tauri 的自定义协议被 Chromium 视为**不透明源（opaque origin）**，`crossorigin` 会触发真实 CORS 检查，而自定义协议响应通常不带 `Access-Control-Allow-Origin` → 脚本被拒。

**建议验证**：在 `vite.config.ts` 中设置 `build.modulePreload: false` 并移除 crossorigin，或直接在构建后手工编辑 `dist/index.html` 去掉 `crossorigin` 再打包验证。

#### H3 — 自定义协议未正确声明 `frontendDist`

`tauri.conf.json` 使用 `"frontendDist": "../dist"`。若 Tauri 2 在 Windows 上用 `http://tauri.localhost` 提供服务，需确认资源根目录解析正确。

#### H4 — JS 运行时异常（需控制台才能确认）

bundle 内某处在 WebView2 环境下抛错。由于无 ErrorBoundary 且无控制台访问，目前无法确认。

---

## 4. 为什么拿不到控制台错误（以及建议的取数方法）

已尝试并**失败**的方法：

- `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333"` —— 端口从未监听（`netstat` 验证），Tauri/WRY 会覆盖自定义参数，CDP 不可用
- `agent-browser` —— 未安装，需下载约 500 MB Chromium

**建议的取数方法（任一）**：

1. **构建 debug 二进制**：`cargo build --features custom-protocol`（不加 `--release`）。Tauri 在 debug 下默认启用 devtools，可在窗口内右键 → 检查，直接读取 Console。
2. **临时关闭 CSP**：将 `tauri.conf.json` 的 `app.security.csp` 设为 `null`，重建。若界面出现即确证 H1。
3. **加临时错误捕获**：在 `main.tsx` 顶部加
   ```ts
   window.addEventListener('error', e => console.error(e))
   window.addEventListener('unhandledrejection', e => console.error(e))
   ```
   配合方法 1 的 devtools 读取。

---

## 5. 一并发现的独立缺陷（非本次黑屏主因，但建议修）

### 5.1 `<source>` 的 error 事件不冒泡 —— R1-04 兜底逻辑是死代码

`App.tsx` 第 92-105 行：

```jsx
<video
  poster="/media/ocean-poster.jpg"
  onError={() => setVideoFailed(true)}      // ← 永远不会触发
>
  <source src="/media/ocean-loop.mp4" type="video/mp4" />
</video>
```

`<source>` 元素的 `error` 事件**不会冒泡**到 `<video>`。因此 `videoFailed` 永远为 `false`，`App.tsx` 第 31 行注释所宣称的「R1-04: 视频加载失败时回落到 poster，避免黑屏」**从未生效**。

**建议修法**：把 `onError` 挂到 `<source>` 上，或改用 `video.src` 直接赋值（此时 error 会在 `<video>` 上触发）。

### 5.2 全项目无 ErrorBoundary

任何渲染异常都会静默变空白，且本应用 `body` 背景是纯黑 —— 这让所有渲染故障都伪装成同一种「黑屏」，极大增加排查成本。建议加一个顶层 ErrorBoundary，把异常直接显示出来。

### 5.3 NSIS 打包被阻断（环境问题，非代码问题）

`pnpm tauri build` 需要 `wmic.exe`，当前沙箱将其列入程序黑名单。临时方案是用 `cargo build --release --features custom-protocol` 产出便携版 EXE。

---

## 6. 文件清单

`files/` 目录下为审核所需的关键文件快照：

| 文件 | 用途 |
|------|------|
| `Cargo.toml` | Bug 1 修复位置（`[features]` 段） |
| `tauri.conf.json` | CSP / `frontendDist` / `devUrl`（H1、H3 相关） |
| `vite.config.ts` | `base: '/'`（H2 相关） |
| `index.html.dev.html` | 源 HTML |
| `index.html.dist.html` | 构建产物 HTML（`crossorigin` 所在处，H2 相关） |
| `main.tsx` | React 挂载入口 |
| `App.tsx` | 根组件（含 `OceanVideo` 缺陷 5.1） |
| `index.css` | `body { background: #050709 }`（黑屏来源） |
| `gatewayContext.tsx` | 已排除：无加载门控 |
| `tauriAppGateway.ts` | Tauri IPC 网桥 |
| `appGateway.ts` | 网桥接口定义 |
| `TimerPanel.tsx` | 已排除：空值安全 |

---

## 7. 复现步骤

```bash
cd "D:/Project/abyssal-reverie/Abyssal Reverie"

# 1. 构建前端
pnpm build

# 2. 构建便携版 EXE（必须带 custom-protocol，否则复现白屏而非黑屏）
cd src-tauri
cargo build --release --features custom-protocol

# 3. 运行
./target/release/abyssal-reverie.exe
```

**自检**：产物应约 20 MB。若只有 12 MB 说明资源未嵌入（回退到 Bug 1）。

```bash
grep -a -c "ocean-loop" src-tauri/target/release/abyssal-reverie.exe   # 期望 >= 1
```

---

## 8. 给审核者的三个问题

1. **H1（CSP）是否为黑屏主因？** 建议优先验证 —— 把 `csp` 设为 `null` 重建即可二分确认。
2. 若 CSP 不是主因，**H2（`crossorigin`）** 是否成立？Tauri 2 自定义协议在 Chromium 下是否被视为不透明源？
3. 除黑屏外，请一并审查 **5.1（`<source>` error 不冒泡）** 和 **5.2（缺 ErrorBoundary）** 两个独立缺陷的修法是否妥当。
