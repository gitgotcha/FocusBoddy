# 原始证据

生成时间：2026-09-05 12:15:56 +0800

## 1. Bug 1 的修复 diff (commit 5d3659c)

```diff
commit 5d3659c
Author: 乔炳源
Date: Sat Sep 5 11:57:03 2026 +0800

fix(build): restore custom-protocol feature so frontend assets are embedded

src-tauri/Cargo.toml was missing Tauri 2's mandatory

    [features]
    custom-protocol = ["tauri/custom-protocol"]

tauri's build script derives `dev = !custom-protocol`, so without the feature
the build ran in dev mode: frontendDist was never embedded and the app tried to
load its UI from devUrl (http://127.0.0.1:1420), producing a permanently white
window on machines with no dev server.

v1.0.0 escaped this because `tauri build` passes the feature through the CLI.
The v1.1.0 build fell back to `cargo build --release` (wmic.exe is blocked in
this environment), where the CLI does not participate, so the feature was lost.

Verified:
  - binary 12,176,384 -> 20,685,312 bytes, now contains the bundled
    JS/CSS/media assets (ocean-loop, focus-complete, index-*.js/css present)
  - cargo test: 95 passed / 0 failed / 1 ignored
  - frontend: vitest 24/24, tsc --noEmit clean
  - DB migration v2 -> v3 succeeds, integrity_check ok

Also documents the required build command and a size/self-check in README.


 README.md            | 16 ++++++++++++++++
 src-tauri/Cargo.toml |  7 +++++++
 2 files changed, 23 insertions(+)
```

### 完整 diff
```diff
commit 5d3659cc80af5c5598f51388cfcb95367318720d
Author: 乔炳源 <qiaobingyuan886@gmail.com>
Date:   Sat Sep 5 11:57:03 2026 +0800

    fix(build): restore custom-protocol feature so frontend assets are embedded
    
    src-tauri/Cargo.toml was missing Tauri 2's mandatory
    
        [features]
        custom-protocol = ["tauri/custom-protocol"]
    
    tauri's build script derives `dev = !custom-protocol`, so without the feature
    the build ran in dev mode: frontendDist was never embedded and the app tried to
    load its UI from devUrl (http://127.0.0.1:1420), producing a permanently white
    window on machines with no dev server.
    
    v1.0.0 escaped this because `tauri build` passes the feature through the CLI.
    The v1.1.0 build fell back to `cargo build --release` (wmic.exe is blocked in
    this environment), where the CLI does not participate, so the feature was lost.
    
    Verified:
      - binary 12,176,384 -> 20,685,312 bytes, now contains the bundled
        JS/CSS/media assets (ocean-loop, focus-complete, index-*.js/css present)
      - cargo test: 95 passed / 0 failed / 1 ignored
      - frontend: vitest 24/24, tsc --noEmit clean
      - DB migration v2 -> v3 succeeds, integrity_check ok
    
    Also documents the required build command and a size/self-check in README.

diff --git a/src-tauri/Cargo.toml b/src-tauri/Cargo.toml
index 90ac0a3..37914c8 100644
--- a/src-tauri/Cargo.toml
+++ b/src-tauri/Cargo.toml
@@ -13,6 +13,13 @@ crate-type = ["staticlib", "cdylib", "rlib"]
 [build-dependencies]
 tauri-build = { version = "2", features = [] }
 
+[features]
+# Required for production builds: without it Tauri's build script sets
+# `dev = !custom-protocol = true`, which skips embedding `frontendDist` into the
+# binary and makes the app load its UI from `devUrl` (http://127.0.0.1:1420).
+# That produces a permanently white window. DO NOT REMOVE.
+custom-protocol = ["tauri/custom-protocol"]
+
 [dependencies]
 tauri = { version = "2", features = ["tray-icon", "image-png"] }
 serde = { version = "1", features = ["derive"] }
```

## 2. 二进制与产物验证

```
--- EXE 体积 ---
20685312  src-tauri/target/release/abyssal-reverie.exe

--- 前端标记在 EXE 中的出现次数 ---
ocean-loop               1
focus-complete           1
index-Dj9-wjoe.js        1
index-CI2_bgWS.css       1
inter-latin.woff2        1

--- dist/ 全量清单 ---
   7699943  dist/media/ocean-loop.mp4
   1072668  dist/audio/focus-complete.wav
    262234  dist/assets/index-Dj9-wjoe.js
     83211  dist/media/ocean-poster.jpg
     48256  dist/fonts/inter-latin.woff2
     16751  dist/assets/index-CI2_bgWS.css
     14820  dist/fonts/dm-mono-latin.woff2
       554  dist/index.html

--- dist 合计字节 ---
9198437
```

## 3. 黑屏来源：body 背景色

```css
/* ── Base ────────────────────────────────────────────────────────── */
body {
  background: #050709;
  color: rgba(235, 240, 241, 0.92);
  font-family: 'Microsoft YaHei', '微软雅黑', 'PingFang SC', 'Noto Sans SC', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
```

## 4. 构建产物完整性

```
--- CSS 前 120 字符 ---
/*! tailwindcss v4.2.2 | MIT License | https://tailwindcss.com */
@layer properties{@supports (((-webkit-hyphens:none)) 

--- JS 前 120 字符 ---
var e=Object.create,t=Object.defineProperty,n=Object.getOwnPropertyDescriptor,r=Object.getOwnPropertyNames,i=Object.getP

--- 关键类在构建 CSS 中的命中 ---
content-area     1
panel-enter      1
with-right       1
```

## 5. 已排除项（grep 证据）

```
--- ErrorBoundary 检索（应为空）---
（无命中 —— 全项目无错误边界）

--- TimerPanel 空值保护 ---
27:  const state = timer?.state ?? "idle";
28:  const mode  = timer?.mode ?? "focus";
29:  const total = timer?.durationSeconds ?? DEFAULT_SETTINGS.focusDurationMinutes * 60;
46:  const remaining = state === "running" && timer?.targetEndAt

--- GatewayProvider 是否同步 ---
1:import { createContext, useContext, useMemo, type ReactNode } from 'react'
22:  const instance = useMemo(() => gateway ?? new TauriAppGateway(), [gateway])
```

## 6. HTTP 回传探针实测结果（决定性证据）

探针代码见 `03-probe-technique.md`。以下为 WebView 内部真实时序，
由本地 HTTP 服务器（127.0.0.1:9911）从进程外部记录。

### 6.1 触发的探针（页面加载阶段）

```
sync|hidden=false|vis=visible|win=1440x900|bodyBg=rgb(5, 7, 9)|hasFocus=true
microtask
messagechannel
timeout0
js-start|readyState=interactive
mounted
dcl
load
tick1|rootKids=0|videos=0|text=
```

### 6.2 从未触发的探针（页面冻结后）

```
timeout500      (setTimeout 500ms)   ✗
beat            (setInterval 1000ms) ✗
raf1 / raf2     (requestAnimationFrame) ✗
tick30/tick150/tick400  (setTimeout(0) 链第 2 跳起) ✗
```

### 6.3 WebView 进程 CPU 采样（1.2 秒窗口）

```
APP Id=110232 WS_MB=31.8 Threads=24
全部 msedge / msedgewebview2 进程 CPUdelta = 0
```

### 6.4 结论

```
页面可见(1440x900)、有焦点、bodyBg=rgb(5,7,9)
  → JS 执行，render() 被调用
  → 微任务 / MessageChannel / setTimeout(0) 首跳 均正常
  → 随后页面冻结：长延时定时器、setInterval、rAF 全部停止
  → setTimeout(0) 链仅完成 1 跳
  → tick1 时 #root 子节点数 = 0，React 未提交任何内容
  → 渲染器进程 CPU delta = 0，完全空闲
⇒ 没有内容可绘制，只显示 body 的 #050709 → 黑屏
```

### 6.5 过程中暴露的其他问题

```
(a) 数据库迁移 panic —— 强杀进程导致 WAL 未 checkpoint 后，下次启动直接崩溃：
    "Failed to setup app: DATABASE_ERROR: schema migration failed ...
     attempt to write a readonly database"
    实测数据库本身是健康的（user_version=3, integrity_check=ok, 5 张表）。
    用外部工具（Python sqlite3）打开一次即可恢复 —— 说明是 WAL/shm 的瞬时状态问题。
    但这暴露了真实缺陷：DB 不可用时应用在 setup 阶段 panic，窗口根本不创建，
    用户只会看到"点了没反应"，没有任何提示。

(b) 沙箱每轮删除上限 50 项，Vite emptyOutDir 触发 SAFE_DELETE_BULK_CONFIRM_REQUIRED
    → 绕行：npx vite build --emptyOutDir false

(c) cmd | tail 会掩盖退出码，导致前端构建失败时 Cargo 仍用旧 dist 重新链接
    → 正确写法：cmd > log 2>&1; echo exit=$?; tail log
```
