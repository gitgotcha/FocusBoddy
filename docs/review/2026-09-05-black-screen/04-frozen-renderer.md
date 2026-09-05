# 04 · 黑/白屏排查全记录（2026-09-05）

> **⚠️ 最终结论见 §14。本文 §1–§13 记录的是排查过程，其中包含的多个结论已被 §14 推翻。**  
> 保留过程是为了完整记录踩过的坑，**请以 §14 为准**。

---

## 1. 一句话结论（★ 已被 §14 推翻，保留作历史记录）

~~**不是 v1.1.0 的代码回归。** 用 v1.0.0 源码（`5df02d6`）原样构建出来的程序，在这台机器上**逐字节复现**了 v1.1.0 的冻结特征。  
故障发生在 **WebView2 渲染进程**：页面加载成功、JS 执行约 80 ms，随后渲染进程主线程**阻塞挂起**（CPU 增量 0），  
所有 ≥500 ms 的定时器、`requestAnimationFrame`、`setInterval` 全部不再触发，React 因此永远无法提交首帧。~~

**→ 真实原因：排查工具链自身的沙箱注入。见 §14。**

---

## 2. v1.0.0 对照实验（用户要求：仿照 v1.0 怎么做）

| 文件                | v1.0.0 → v1.1.0 差异                                           |
| ----------------- | ------------------------------------------------------------ |
| `tauri.conf.json` | **仅** `"version": "1.0.0"` → `"1.1.0"`（CSP 等全部一致）            |
| `vite.config.ts`  | 无变化                                                          |
| `index.html`      | 无变化                                                          |
| `src/main.tsx`    | 无变化                                                          |
| `src/index.css`   | 无变化                                                          |
| `pnpm-lock.yaml`  | 无变化                                                          |
| `package.json`    | 仅 version / license                                          |
| `src/App.tsx`     | **净减 1420 行**（重构拆分到 features/ components/ domain/ services/） |

**v1.0.0 参考构建实测**（worktree `D:/Project/abyssal-reverie/v10-ref`，注入同一份探针、`csp: null`）：

```
js-start|readyState=interactive
sync|hidden=false|vis=visible|win=1440x900|bodyBg=rgb(5, 7, 9)|hasFocus=true
microtask
dcl
load
messagechannel
timeout0
tick1|rootKids=0|videos=0|text=
--- 以下全部不再出现 ---
timeout500   ✗
beat (1s)    ✗
raf1 / raf2  ✗
tick30/150/400 ✗
```

与 v1.1.0 的探针序列**完全一致**。

---

## 3. 探针信号的精确时间分布（关键证据）

`probe-log.txt` 中的一轮完整记录（UTC，本地时间 +8）：

```
05:46:26.479  js-start|readyState=interactive
05:46:26.500  sync|...bodyBg=rgb(5, 7, 9)|hasFocus=true
05:46:26.523  microtask
05:46:26.527  dcl
05:46:26.530  load
05:46:26.534  messagechannel
05:46:26.538  timeout0
05:46:26.542  tick1|rootKids=0|videos=0|text=
--- 82 ms 后一切停止 ---
```

含义：

- `bodyBg=rgb(5, 7, 9)` → **CSS 已加载**（这正是屏幕发黑的原因，`index.css` L85-87 `body{background:#050709}`）
- `messagechannel` 触发 → React 19 的 Scheduler 底层原语可用
- `timeout0` 与 `tick1` 触发 → 任务队列可用
- `timeout500` / `beat` / `raf1` / `tick30` **永不触发** → 主线程在 `tick1` 之后被挂起
- 全部 WebView2 进程 **CPU 增量 = 0** → 是**阻塞**，不是死循环（死循环会吃满一个核）

---


## 4. 已排除的假说（附证据）

| 假说                                   | 结论              | 证据                                                                                                             |
| ------------------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------- |
| H1 CSP 拦截模块脚本                        | ❌ 排除            | `tauri.conf.json` 相对 v1.0.0 只改了版本号；且 `js-start` 证明 JS 执行了                                                      |
| H2 `crossorigin` 属性                  | ❌ 排除            | `index.html` 与 v1.0.0 完全相同；JS 已加载                                                                              |
| H3 `frontendDist` 配置                 | ❌ 排除            | `vite.config.ts` 无变化；资源确认已嵌入二进制                                                                                |
| 陈旧 WebView2 进程干扰                     | ❌ **排除（推翻 F2）** | 现存 12 个 `msedgewebview2.exe` 全部属于 Windows 自身组件（SearchHost / Widgets），UDF 指向 `MicrosoftWindows.Client.*`，与本应用无关 |
| `window-vibrancy`（Mica）与 WebView2 冲突 | ❌ 排除            | `Cargo.toml` 与 Rust 源码中**完全没有** vibrancy 依赖                                                                    |
| JS 模态框阻塞（`alert`/`confirm`）          | ❌ 排除            | `src/**` 中无 `alert(` / `confirm(` / `prompt(` / `showModalDialog` / `window.print`                             |
| 同步 XHR                               | ❌ 排除            | 仅测试文件里出现过正则字面量                                                                                                 |
| 前端死循环                                | ❌ 排除            | `src/**` 无 `while(` / `for(;;)`；且 CPU 增量为 0                                                                    |
| Rust 主线程阻塞                           | ❌ 排除            | `lib.rs` setup 无阻塞调用，后台 ticker 在独立 `std::thread::spawn`                                                        |
| 单实例插件互相干扰                            | ❌ 排除            | 杀净后仅启动**一个**实例，冻结依旧完全复现                                                                                        |
| 数据库损坏                                | ❌ 排除            | `integrity_check=ok`、`user_version=3`、5 张表；应用无 panic（stdout/stderr 为空）                                         |
| 高度塌陷                                 | ❌ 排除            | `index.css` L19-23 `html,body,#root{height:100%}` 完好；探针回读 `win=1440x900`                                       |

---

## 5. 环境信息

| 项                | 值                                                                             |
| ---------------- | ----------------------------------------------------------------------------- |
| 操作系统             | Windows 11 25H2（注册表 ProductName 显示 Windows 10 Home China）Build **26200.9168** |
| WebView2 Runtime | **152.0.4191.62**（`C:\Program Files (x86)\Microsoft\EdgeWebView\Application`） |
| GPU              | NVIDIA GeForce RTX 4050 **Laptop** GPU（Optimus 双显卡），驱动 32.0.15.9649，状态 OK     |
| React / Vite     | 19.2.4 / 8.0.5                                                                |
| Tauri            | 2.11.5                                                                        |

### WebView2 运行时更新时间线（重要）

| 版本                | 安装时间                      |
| ----------------- | ------------------------- |
| 151.0.4129.107    | 2026-08-26                |
| 152.0.4191.53     | 2026-09-02 21:10          |
| **152.0.4191.62** | **2026-09-04 23:09 ← 当前** |

运行时**在 9/4 23:09 自动升级**。用户反馈「v1.0 能用」的时间点若早于此，则升级是高度可疑的环境变量。

---

## 6. 无效的实验（记录以免复踩）

| 实验                                                                                                              | 结果                               | 教训                                      |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------- |
| `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--disable-gpu --disable-gpu-compositing --disable-software-rasterizer"` | WebView2 **完全没起来**（0 个进程），探针 0 条 | 参数导致 WebView2 初始化失败，**不是**「GPU 不是原因」的证据 |
| `--disable-features=CalculateNativeWinOcclusion ...`                                                            | 同样 0 进程、0 探针                     | 同上，遮挡假说**尚未被有效验证**                      |
| `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER=...\152.0.4191.53`                                                          | 0 进程（ws 降到 28.7 MB），0 探针         | 版本降级实验**也无效**，需换方法重做                    |
| `--enable-logging=stderr --v=1 --log-file=...`                                                                  | 未生成任何日志文件                        | WebView2 有浏览器参数白名单，日志类参数被忽略             |

**结论：凡是通过 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 传参的实验，在这台机器上都会让 WebView2 起不来，全部作废。**  
需要改用其它方式（修改代码 / 注册表策略 / 降级运行时）来验证 GPU 与遮挡两条线索。

---

## 7. 测量陷阱（务必注意）

1. **空探针日志 ≠ 脚本被拦截。**  
   首轮在启用 CSP 时探针日志为空，我一度误判为「脚本被 CSP 拦截」。真实原因是  
   `connect-src ipc: http://ipc.localhost` 拦掉了探针**自己**的 `fetch`。
2. **探针服务器必须自检。**  
   本次出现过 `EADDRINUSE`（旧实例占用 9911），新进程在 `listen()` 前就把日志**截断**成只剩 banner，  
   旧实例则继续写入已被删除的句柄 —— 结果「探针一条都没打过来」是**假象**。  
   验证方式：`curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:9911/?t=selftest"`，再看日志是否新增该行。
3. **`rm -f probe-log.txt` 会制造上面这个陷阱。** 改端口或先确认端口空闲再启动。
4. **应用退出码 127** 在 Git Bash 下出现过程序其实正常运行的情况，不能作为「启动失败」的判据。

---

## 8. 环境副作用（本轮产生，可回滚）

| 操作                  | 原位置                                                 | 备份位置                              |
| ------------------- | --------------------------------------------------- | --------------------------------- |
| 重命名 WebView2 用户数据目录 | `%LOCALAPPDATA%\com.abyssalreverie.focus\EBWebView` | 同目录 `EBWebView.bak-20260905-1340` |

原目录内 `Local State` 显示 `variations_crash_streak = 15`、`exited_cleanly = true`。  
重命名后 WebView2 进程存活时间从约 0.1 s 延长到 20 s 以上，但最终仍会退出 —— **缓解而非根治**。

数据库（`%APPDATA%\com.abyssalreverie.focus\`）未改动，应用数据无风险。

---

## 9. 给审核者的问题

1. 在 Chromium 152 的渲染进程里，**「`load` 之后约 80 ms、CPU 增量为 0、所有定时器与 rAF 停摆、无任何 JS 错误」**  
   最可能对应哪一类阻塞？（怀疑是主线程同步等待合成器 / GPU IPC，但 `--disable-gpu` 实验因 WebView2 起不来而无效。）
2. 有什么**不依赖 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`** 的手段，可以在这台机器上验证 GPU 合成与窗口遮挡两条线索？
3. WebView2 Runtime **152.0.4191.62** 是否存在已知的渲染进程冻结回归？如何优雅地做版本降级对照？
4. 应用层面是否值得增加**看门狗**：若首帧在 N 秒内未提交，则弹错误对话框而不是黑屏？  
   （当前 `src/` 中**没有任何 ErrorBoundary**，`grep -rn "ErrorBoundary\|componentDidCatch\|getDerivedStateFromError" src/` 为空。）

---

## 10. 决定性切分实验（14:00–14:20）—— 已在浏览器里完整渲染成功

把探针注入同一份前端产物后，用普通浏览器打开。结果：

```
BROWSER|js-start|readyState=loading|ua=…Chrome/15…
BROWSER|tick1|rootKids=0|videos=0|bodyBg=rgb(5, 7, 9)|text=
BROWSER|dcl
BROWSER|load
BROWSER|raf1                                    ✅ rAF 正常
BROWSER|tick30|rootKids=1|videos=1
        |text=专注 短休 长休 专注 25:00 专注 当前任务 暂无任务，前往任务面板添加
BROWSER|timeout500   ✅
BROWSER|timeout2000  ✅
BROWSER|beat1 … beat23   ✅ 心跳连续 23 秒
```

**同一份产物在浏览器里：React 提交首帧、video 元素创建、界面文字完整渲染、定时器与 rAF 全部正常。**  
→ **前端代码 100% 排除。**

### 三方对照表

| 环境                          | 资源加载方式       | 结果                                              |
| --------------------------- | ------------ | ----------------------------------------------- |
| 浏览器（Chromium）               | HTTP         | ✅ 完整渲染，心跳持续 23 s+                               |
| Tauri 生产模式                  | 自定义协议 + 内嵌资源 | ❌ 页面加载后 **82 ms** 冻结                            |
| Tauri dev 模式（`devUrl`→HTTP） | HTTP         | ❌ **22 ms** 冻结，CSS 都未生效（`bodyBg=rgba(0,0,0,0)`） |

**关键：dev 模式走的是普通 HTTP，绕开了自定义协议与内嵌资源，仍然冻结。**  
→ **自定义协议 / 内嵌资源 / 资源加载方式全部排除。**

### 页面内容也排除：最简页面同样冻结

构造了一个只有「文字 + 内联 CSS + 探针」的极简页面（无 React、无字体、无 JS 依赖），  
在 Tauri 窗口里打开：

```
MIN|js-start|readyState=loading
MIN|load
MIN|dcl
MIN|tick1|bodyBg=rgb(5, 7, 9)|videos=0
--- 之后无任何 raf1 / timeout500 / 心跳 ---
```

先后验证过两版：带 `<video>`（7.7 MB MP4）的冻结在 `tick1`，**移除 `<video>` 后依然冻结在 `tick1`**。  
→ **页面内容与媒体资源也排除。**

### 最终定位

> **WebView2 渲染进程在这个 Tauri 窗口里，无论页面内容是什么、资源怎么加载，都会在脚本启动后约 20–80 ms 冻结。**

故障层级是 **WebView2 宿主 / 窗口**，不是应用层。

### `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 在本机不可用（已用 3 组参数重复验证）

传参后 `msedgewebview2.exe` 进程数为 **0**：

| 传入参数                                                                                                                       | WebView2 进程数 | 宿主内存    |
| -------------------------------------------------------------------------------------------------------------------------- | ------------ | ------- |
| 不传（基线）                                                                                                                     | 4            | 32 MB   |
| `--disable-gpu --disable-gpu-compositing --disable-software-rasterizer`                                                    | **0**        | 28.7 MB |
| `--disable-features=CalculateNativeWinOcclusion --disable-renderer-backgrounding --disable-backgrounding-occluded-windows` | **0**        | 31.5 MB |
| `--disable-features=CalculateNativeWinOcclusion`（单参数）                                                                      | **0**        | 30.1 MB |

同时确认本机全部 12 个 `msedgewebview2.exe` 都隶属 Windows 自身  
（`MicrosoftWindows.Client.CBS_cw5n1h2txyewy` = SearchHost、`…WebExperience…` = Widgets），  
**与本应用无关**，所以「0 个」不是过滤条件写错。

→ **GPU 合成、窗口遮挡两条线索在本机用环境变量方式无法验证**，需改走代码 / 注册表 / 运行时降级。

---

## 12. 第三轮（15:00–15:20）—— WebView 根本没被创建成功

### 12.1 用户提供的决定性信息

> 用户双击 EXE 后，弹出提示要求下载 WebView2 运行时，提示「没有运行时环境」。

这条信息把调查方向从「渲染进程冻结」改成了「**WebView2 根本没初始化**」。

### 12.2 按可执行文件路径归因（唯一可靠的判定方式）

```powershell
Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Group-Object ExecutablePath
```

| 采样时刻                  | app 进程                    | WebView2 进程（按路径分组）    |
| --------------------- | ------------------------- | --------------------- |
| 15:08:59              | pid 120320 / 32.2 MB      | `151.0.4129.107` × 12 |
| 15:09:07              | pid 120320 / 32.2 MB      | `151.0.4129.107` × 12 |
| 15:09:15              | 已退出                       | `151.0.4129.107` × 12 |
| 15:12:00 / 15:12:12   | pid 42072，Responding=True | 同上                    |
| 15:11–15:12 密集采样 18 次 | 同上                        | 同上                    |

**结论：全程没有任何一个 WebView2 进程来自 `152.0.4191.62`（当前已安装运行时）。**  
那 12 个来自 `151.0.4129.107`，属于 Windows 自身的 SearchHost / Widgets，与本应用无关。

### 12.3 窗口状态

```
pid=42072  Responding=True                       ← 主线程没有卡死
MainWindowTitle = [Abyssal Reverie · 深海绮梦]     ← 窗口确实被创建出来了
MainWindowHandle = 7604392
child processes = (none)                          ← 零子进程
```

第 3 次采样（约 15:12:23）MainWindowTitle 变为 `com.abyssalreverie.focus-siw`  
（single-instance 插件的隐藏窗口），说明真实窗口在约 22 秒时已不存在。

### 12.4 应用侧零输出

`stdout` / `stderr` 全部为空，即使设置了 `RUST_BACKTRACE=full RUST_LOG=debug`。  
原因见 12.5。

### 12.5 从 `Local State` 还原出的 WebView2 启动参数

路径：`%LOCALAPPDATA%\com.abyssalreverie.focus\EBWebView\Local State`  
字段：`user_experience_metrics.stability.saved_system_profile`（base64，Chromium metrics 系统快照）

解码后可读到：

```
152.0.4191.62-64      zh-CN      Windows NT 10.0.26200     x86_64     GenuineIntel
abyssal-reverie.exe   '1900/01/01:00:00:00!abyssal-reverie.exe"   1.1.0
autoplay-policy  msWebOOUI  msPdfOOUI  msSmartScreenProtection
embedded-browser-webview  embedded-browser-webview-dpi-awareness  lang
mojo-named-platform-channel-pipe
noerrdialogs                      ← ★ 关键
user-data-dir  webview-exe-name  webview-exe-version
```

**`noerrdialogs` 解释了为什么应用侧一条错误都看不到**：该开关会让 Chromium 抑制错误对话框。  
后续排查必须先想办法拿掉它，否则所有错误信息都被吞掉。

同一份 `Local State` 还显示：

```
variations_crash_streak = 1
user_experience_metrics.stability.exited_cleanly = true
user_experience_metrics.stability.system_crash_count = 0
```

→ WebView2 **不是崩溃退出**，而是**干净退出**（这通常是宿主主动释放 controller 的特征）。

### 12.6 三个被推翻的假说（记录，避免复踩）

| 假说                  | 结论  | 推翻依据                                                                                                                                                               |
| ------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 只装了 32 位运行时 → 架构不匹配 | ❌ 错 | `C:\Program Files (x86)\Microsoft\EdgeWebView\Application\152.0.4191.62\msedgewebview2.exe` 的 PE machine = `0x8664`（x64），与 EXE 一致。微软惯例如此，与 Edge 浏览器相同              |
| 注册表 64 位视图缺失 = 注册损坏 | ❌ 错 | `HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients` **整个键都不存在**；而同为 64 位、运行正常的 **Edge Stable(152.0.4191.66) 也只注册在 WOW6432Node**。EdgeUpdate 本身是 32 位程序，全部写 WOW6432Node 属正常 |
| GPU 是元凶             | ❌ 错 | 换 UDF 后 `--disable-gpu` 首次真正生效，结果**更差**：只跑到 `tick1`，连 `dcl`/`load` 都没到                                                                                             |

### 12.7 安装器拒绝安装

```
MicrosoftEdgeWebview2Setup.exe /silent /install
→ installer_exit=40（9 秒即退出）

%TEMP%\MicrosoftEdgeUpdate.log:
  [is machine: 1] needsadmin=prefers
  [Failed to install][0x80040828][安装失败。已为系统安装 Microsoft Edge Webview2 Runtime。]
```

`0x80040828` = 系统级已安装，安装器拒绝重复安装 → **无法用覆盖安装修复**。  
`ModifyPath`（修复入口，尚未执行）：

```
"C:\Program Files (x86)\Microsoft\EdgeUpdate\MicrosoftEdgeUpdate.exe" /install
  appguid={F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}&appname=Microsoft%20Edge%20WebView
  &needsadmin=true&repairtype=windowsonlinerepair /installsource offline
```

### 12.8 本轮新发现的测量陷阱（务必注意）

1. **不能用 `CommandLine` 过滤来区分「我们的 WebView2」和「Windows 的」。**  
   WebView2 的 user-data-dir 是通过 `CoreWebView2Environment` API 传的，**不出现在命令行里**。  
   必须用 `ExecutablePath`（版本号目录）来区分。此前所有基于 CommandLine 的计数均为无效数据。
2. **Git Bash 下 `tasklist /FI` / `taskkill /F` 的 `/` 不会被 MSYS 转换**，会原样传参导致  
   `错误: 无效参数/选项 - '//F'`。必须加 `export MSYS_NO_PATHCONV=1` 后用单斜杠。
3. **PowerShell 工具的 stdout 经常为空**，需 `Set-Content` 写文件再用 Read 读；  
   且 `-Encoding UTF8` 写出的文件可能被判定为二进制，改用 `-Encoding ASCII` 或经 `iconv` 处理。
4. **沙箱限制**：`reg.exe`、`Add-Type`、截屏、bash 内调 `powershell` 均被拦截。

### 12.9 本轮遗留待办

- [ ] 在**沙箱外**（用户手动双击）复现，确认「没有运行时环境」提示的确切文本与触发时机
- [ ] 绕过 `noerrdialogs` 以拿到真正的 WebView2 初始化错误码
- [ ] 若确认为运行时损坏，走卸载 → 重装（卸载串见 12.7 同目录的 `UninstallString`）
- [ ] 应用层兜底：Rust 侧看门狗（见 §11）

---

## 13. 交付状态（本轮结束）

- 生产版 EXE 已重建：`src-tauri/target/release/abyssal-reverie.exe`，**20,902,400 B**
- 干净交付副本：`release/Abyssal Reverie v1.1.0.exe`，三个内嵌资源标记  
  （`ocean-loop` / `ocean-poster` / `focus-complete`）均存在
- `tauri.conf.json` 已还原：`devUrl` = `http://127.0.0.1:1420`
- `git status` 仅剩未跟踪项：`dist-probe/`、`docs/review/`、`release/`

---

## 14. 最终结论（2026-09-05 15:30）—— 真凶是排查工具链自己的沙箱

### 14.1 一句话

**v1.1.0 的代码自始至终没有问题。**  
黑屏 / 白屏 / "渲染进程冻结" / "WebView2 起不来"，**全部是排查者（AI Agent）通过沙箱启动应用造成的**  
—— 沙箱向被启动的进程注入了 `tsbx.dll`，破坏了 Chromium 的 sandbox，WebView2 因此无法存活。  
**绕过沙箱运行，应用完全正常。**

### 14.2 关键证据：进程里被注入了什么 DLL

```powershell
Get-Process -Name abyssal-reverie | Select-Object -ExpandProperty Modules
```

沙箱内启动时的第三方模块：

```
C:\ProgramData\A-Volute\A-Volute.Nahimic\Modules\Scheduled\x64\AudioDevProps2.dll
D:\Project\abyssal-reverie\Abyssal Reverie\src-tauri\target\release\abyssal-reverie.exe
D:\WorkBuddy\resources\app.asar.unpacked\cli\vendor\sandbox\5.4.7\tsbx.dll   ★
```

`tsbx.dll` 是 Agent 工具链（WorkBuddy）的沙箱 DLL。凡是**由 Agent 通过 Bash/PowerShell 工具启动**的进程  
都会被注入它，而**用户手动双击启动**的进程不会。

### 14.3 A/B 对照（决定性）

|                              | 沙箱内启动                       | 沙箱外启动（`dangerouslyDisableSandbox`） |
| ---------------------------- | --------------------------- | ---------------------------------- |
| `tsbx.dll` 注入                | **是**                       | **否（0）**                           |
| WebView2 进程（`152.0.4191.62`） | t=0 出现 4–5 个，**t=1.7 s 归零** | **7 个，t=0 → t=26 s 全部稳定存活**        |
| 页面                           | 黑屏 / 白屏                     | **正常渲染，用户确认可用**                    |

沙箱内采样（节选）：

```
[t=0.0s] app=1  152.0.4191.62 x4  + (root) x1
[t=1.7s] app=1  仅剩 151.0.4129.107 x12      ← 全灭
```

沙箱外采样（节选）：

```
[t=0.0s] app=1  152.0.4191.62 x7
[t=2.6s] app=1  >>> tsbx.dll injected into app process: 0
[t=26.4s] app=1 152.0.4191.62 x7             ← 依然 7 个
```

### 14.4 机理

Chromium 的 sandbox broker 在创建 GPU / 渲染子进程时，需要向 `ntdll.dll` 的函数入口写入拦截跳板  
（interception thunk）。若该处字节已被第三方 DLL 改写，写入失败，报  
`SBOX_ERROR_CANNOT_SETUP_INTERCEPTION_THUNK`，随后  
`GPU process launch failed → GPU process isn't usable. Goodbye.` → 浏览器进程有序退出。

特征与本轮观测**完全吻合**：

- WebView2 进程启动后 1.7–3.1 s 内**干净退出**（`exited_cleanly=true`、`system_crash_count=0`、无 crash dump）
- `--disable-gpu` 反而**更糟**（沙箱路径被绕过一半，渲染管线静默死锁）
- 应用侧**零错误输出**

> 同类公开病例：某 Tauri 项目白屏，最终定位为 MacType / ESET / Listary 的全局注入 DLL 破坏 Chromium sandbox。

### 14.5 由此被推翻的全部结论

| 曾得出的结论                             | 状态                                       |
| ---------------------------------- | ---------------------------------------- |
| "v1.0.0 同样冻结，故非 v1.1.0 回归"         | 结论本身正确，但**实验在沙箱内进行，数据无效**                |
| "渲染进程冻结在 82 ms"                    | **无效数据**（沙箱产物）                           |
| "生产版 WebView2 完全起不来，dev 版可以"       | **假象**。同标准采样后两者一致；此前生产版首次采样在 +6 s，进程早已死掉 |
| "只装了 32 位运行时 / 架构不匹配"              | 错（PE machine = `0x8664`，均为 x64）          |
| "注册表 64 位视图缺失 = 注册损坏"              | 错（Edge 同样只注册在 WOW6432Node，属正常）           |
| "GPU 是元凶"                          | 错                                        |
| "CSP / crossorigin / frontendDist" | 错（与 v1.0.0 逐字节相同）                        |

### 14.6 教训（务必写入流程）

1. **在受限沙箱内诊断"子进程能否存活"类问题，结论一律不可信。**  
   沙箱注入本身就是一类根因。任何涉及 GUI 子进程、驱动、注入的诊断，  
   必须先在**沙箱外**复现一次，再开始归因。
2. **采样起点必须 ≤1 s。** 本轮因为首次采样在 +6 s，凭空制造出"生产版起不来"的假结论，  
   导致后续数小时的排查方向错误。
3. **先看进程加载了哪些非系统 DLL，再谈代码问题。** 这一步成本极低，本应第一个做。
4. 与"已知可用版本"做 diff 是对的（用户的要求），但**diff 不能替代环境归因**。

---

## 15. 待办

- [x] 定位根因：Agent 沙箱 `tsbx.dll` 注入破坏 Chromium sandbox
- [x] 沙箱外验证通过（用户确认可用）
- [x] 重建 v1.1.0 生产版 EXE（`cargo build --release --features custom-protocol`）
- [x] 恢复 `tauri.conf.json`（`devUrl` = `http://127.0.0.1:1420`）
- [ ] **v1.1 真机验收**：按 `docs/ACCEPTANCE_GUIDE.md` 第 H 节（H1–H8）逐条走一遍  
  （注意：必须由**用户手动双击**运行，不能由 Agent 启动）
- [ ] 清理 `dist-probe/`、`EBWebView.bak-*`（共 6 份备份）、`D:/Project/abyssal-reverie/v10-ref` worktree
- [ ] 应用层加固（可选）：`src/` 中目前**没有任何 ErrorBoundary**，可补一个渲染失败兜底
- [ ] `git push` 提交 `5d3659c`（仅本地提交，待授权）
- [x] NSIS 全量安装包：需先从安全中心黑名单移除 `wmic.exe`
