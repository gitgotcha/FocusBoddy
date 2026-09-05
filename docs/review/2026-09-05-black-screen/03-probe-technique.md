# WebView 无头探针（诊断「页面加载了但 React 没渲染」的通用手法）

当 CDP / 远程调试不可用、又拿不到控制台输出时，用这个手法可以从**进程外部**观察
WebView 内部到底发生了什么。本轮黑屏问题就是靠它定位的。

## 原理

在前端入口（`main.tsx`）顶部注入一段探针，把关键状态通过 `fetch` 回传到一个本地
HTTP 服务器。服务器把每次请求追加到日志文件，我们读日志即可。

关键点：**回传必须能被外部观测**，所以用一个真实的 HTTP 请求，而不是 `console.log`
（后者在拿不到 devtools 时等于没有）。

## 探针服务器

`probe-server.mjs`（Node，监听 `127.0.0.1:9911`）：

```js
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const LOG = path.join(import.meta.dirname, 'probe-log.txt')
fs.writeFileSync(LOG, `--- probe server started ${new Date().toISOString()} ---\n`)

http.createServer((req, res) => {
  fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${req.method} ${req.url}\n`)
  res.writeHead(200, { 'Access-Control-Allow-Origin': '*' })
  res.end('ok')
}).listen(9911, '127.0.0.1')
```

用 `mode: 'no-cors'` 发请求即可，响应内容无所谓，我们只需要请求到达这个事实。

## 探针代码（贴到入口文件顶部，位于 `render()` 之前）

```ts
const PROBE = 'http://127.0.0.1:9911/'
const ping = (tag: string) => {
  try { void fetch(`${PROBE}?t=${encodeURIComponent(tag)}`, { mode: 'no-cors' }) } catch { /* blocked */ }
}

// 1) 最先执行的：证明 bundle 跑起来了
ping('js-start|readyState=' + document.readyState)

// 2) 全局错误钩子：任何未捕获异常都会回传
window.addEventListener('error', e => ping('error:' + (e as ErrorEvent).message))
window.addEventListener('unhandledrejection', () => ping('unhandled-rejection'))

// 3) 生命周期事件
window.addEventListener('DOMContentLoaded', () => ping('dcl'))
window.addEventListener('load', () => ping('load'))
window.addEventListener('pagehide', () => ping('pagehide'))

// 4) 同步快照：页面可见性 / 尺寸 / 背景色 / 焦点
ping('sync|hidden=' + document.hidden + '|vis=' + document.visibilityState +
  '|win=' + window.innerWidth + 'x' + window.innerHeight +
  '|bodyBg=' + getComputedStyle(document.body).backgroundColor +
  '|hasFocus=' + document.hasFocus())

// 5) 微任务：事件循环是否至少转了一圈
void Promise.resolve().then(() => ping('microtask'))

// 6) MessageChannel —— React 18 Scheduler 用的就是这个
//    它若不触发，React 永远无法提交渲染，单凭这一点就能解释白/黑屏
try {
  const mc = new MessageChannel()
  mc.port1.onmessage = () => ping('messagechannel')
  mc.port2.postMessage(1)
} catch { ping('messagechannel-unavailable') }

// 7) requestAnimationFrame —— 只有合成器真正产帧才会触发
requestAnimationFrame(() => ping('raf1'))

// 8) 各种时延的定时器，用来定位「冻结」发生在哪个时间点
setTimeout(() => ping('timeout0'), 0)
setTimeout(() => ping('timeout500'), 500)
setInterval(() => ping('beat'), 1000)

// 9) 用 setTimeout(0) 链轮询 DOM —— 当长延时定时器和 rAF 都被冻结时，
//    这是唯一还能观察到「React 到底提交没有」的手段
let ticks = 0
const tick = () => {
  ticks++
  const root = document.getElementById('root')
  if (ticks === 1 || ticks === 30 || ticks === 150 || ticks === 400) {
    ping(`tick${ticks}|rootKids=${root?.children.length ?? -1}` +
      `|videos=${document.querySelectorAll('video').length}` +
      `|text=${(document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 60)}`)
  }
  if (ticks < 400) setTimeout(tick, 0)
}
setTimeout(tick, 0)
```

在 `render()` 之后再打一个 `ping('mounted')`，用来区分「render 被调用」和
「render 真正提交」。

## 本次实测结果（Abyssal Reverie v1.1.0，黑屏）

```
sync|hidden=false|vis=visible|win=1440x900|bodyBg=rgb(5, 7, 9)|hasFocus=true
microtask          ✓
messagechannel     ✓
timeout0           ✓
js-start|readyState=interactive
mounted
dcl
load
tick1|rootKids=0|videos=0|text=
```

缺失的：

```
timeout500   ✗
beat(1s)     ✗
raf1 / raf2  ✗
tick30/150/400 ✗
```

**结论**：页面可见、有焦点、尺寸正常，JS 执行到 `render()` 之后**立刻被冻结**。
`setTimeout(0)` 只跑了一跳，`requestAnimationFrame` 从未触发，`rootKids=0`
说明 React 一个节点都没提交。所有 WebView 进程 CPU delta = 0，渲染器完全空闲。

## 注意事项

- 资源会被 Tauri 压缩后嵌入，**JS 内容无法从 EXE 里 grep 到**。要确认探针是否入包，
  去 grep `dist/assets/index-*.js`（能 grep 到的是资产映射里的文件名，不是文件内容）。
- 每次改 `tauri.conf.json` 或前端代码后都要重新 `pnpm build` + `cargo build`，
  否则二进制里还是旧的 dist。
- **不要写 `cmd | tail` 再 `&&`** —— 管道会把退出码换成 `tail` 的 0，
  导致前端构建失败时 Cargo 仍然拿旧 dist 重新链接，白等两分钟。
  正确写法：`cmd > /tmp/x.log 2>&1; echo "exit=$?"; tail /tmp/x.log`
- 沙箱有**每轮删除上限 50 项**，Vite 的 `emptyOutDir` 会触发
  `SAFE_DELETE_BULK_CONFIRM_REQUIRED` 而构建失败。绕行：`npx vite build --emptyOutDir false`。
- 正在运行的应用会锁住 EXE，导致链接期 `LNK1104`。重建前必须先关掉应用。
