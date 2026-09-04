# 变更日志（Changelog）

## v1.0.0 — 2026-09-04（首个正式版本）

**Abyssal Reverie · 深海绮梦** — 完全离线的 Windows 专注计时器。
Tauri 2.11.5 + React 19 + TypeScript + Rust + SQLite（rusqlite bundled）。

### 核心功能
- **无漂移计时状态机**：剩余时间由 Rust 端 `target_end_at` 墙钟时间戳推导（非逐秒累加），休眠/锁屏/节流自动校正；`revision` 乐观并发防重复触发；`complete_timer` 幂等，完成反馈只触发一次。
- **三段计时**：专注 / 短休 / 长休；切换模式即提交已累积专注时长（completed，计入统计）；「结束本次」为 abandoned 不计入。
- **任务与统计**：任务清单（番茄目标、完成态）、今日目标环、周柱状图、项目分布、连续天数、最佳日；删除任务保留历史（快照 + FK 置空）。
- **海洋视觉**：1080p H.264 无音频循环视频背景（7.7 MB）+ poster 帧兜底；加载失败永不黑屏。

### 系统集成
- **系统托盘 + 后台运行**：关闭窗口即驻留托盘；托盘实时显示剩余时间；开始/暂停/继续/结束/显示窗口全菜单操作；单实例（二次启动聚焦已有窗口）。
- **托盘退出保护（v1.0.0 新增）**：计时中通过托盘「彻底退出」自动冻结剩余时间并恢复为暂停，下次启动由用户手动继续，不悄悄消耗专注时间。
- **开机自启**：默认关闭，设置面板开启（写 Windows 注册表 Run 项，不占数据库）。
- **全局快捷键**：`Ctrl+Alt+Space` 全局开始/暂停；被其它程序占用时启动不崩溃，应用内显示警告横幅，热键降级禁用。

### 数据
- **本地存储**：SQLite 于 `%APPDATA%\abyssal-reverie\`（独立于安装目录，升级/卸载均保留）；WAL + 外键 + CHECK 约束。
- **损坏自愈（v1.0.0 新增）**：启动时 `PRAGMA integrity_check`；损坏库自动重命名为 `.corrupt-<时间戳>` 保留以便人工恢复，应用照常以全新库启动。
- **导入导出（v1.0.0 新增）**：全量备份 JSON（含 schemaVersion 校验，旧版备份可导入）、会话 CSV（RFC-4180）；错误导入全量校验后拒绝，绝不覆盖现有数据。
- **schema 迁移**：`user_version` 驱动，v1→v2 就地升级（reduce_motion 列），数据无损。

### 离线与性能
- 完全离线：无任何外部网络请求（CSP 仅 self/asset:/ipc:）；字体/音效/媒体全部内嵌 exe。
- **「降低动态效果」开关（v1.0.0 新增）**：暂停海洋视频降 CPU/电量；窗口隐藏/最小化/系统 reduce-motion 时自动暂停。
- NSIS 安装器含 WebView2 offlineInstaller，无网环境可安装运行。

### 界面
- 玻璃拟态 + 海洋动态背景统一设计令牌；等宽数字（tabular-nums）不抖动。
- 完整 hover/active/disabled 状态与键盘焦点环（focus-visible）；Toggle 带 ARIA switch 语义。
- 通知与声音可在设置中分别关闭，不影响计时与统计。

### 已知问题
见 `docs/KNOWN_ISSUES.md`。完整回归记录见 `docs/REGRESSION_REPORT.md`。

---

格式参考：[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。
