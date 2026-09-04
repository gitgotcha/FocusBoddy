# Abyssal Reverie — 发布回归测试报告

> 质量闸门（Item 4）：冻结功能范围，仅修复 P0/P1/P2 缺陷。所有 P0/P1 清零后方可发布。
> 每轮修复后均以真实 Windows EXE 验收（非开发模式）。
> 版本基线：`bf6413b`（Item 3 数据导出与备份）。

## 严重级别定义
- **P0（必须修复）**：计时错误、数据丢失、无法启动 / 退出。
- **P1（发布前修复）**：明显影响使用 —— 托盘失效、界面错位、重复通知。
- **P2（时间允许）**：次要视觉 / 交互问题。

## 严重问题清单（实时）

| 编号 | 轮次 | 级别 | 问题 | 状态 | 修复提交 |
|------|------|------|------|------|----------|
| R1-01 | Round 1 | P0/P1 | 托盘“彻底退出”时若正在计时，未保存剩余时间，下次启动会被后台 ticker 自动完成，悄悄消耗专注时间 | ✅ 已修复 | `6042665` |
| R1-02 | Round 1 | P1 | 全局快捷键被其它程序占用时，`build()` 返回错误导致启动崩溃（`.run().expect()` panic） | ⏳ 待 Round 3 | — |
| R1-03 | Round 4 | P2 | 缺少“降低动态效果”开关；视频在失焦/最小化时未降开销 | ⏳ 待 Round 4 | — |
| R1-04 | Round 4 | P1 | 视频加载失败时可能黑屏，需回退 `ocean-poster` | ⏳ 待 Round 4 | — |
| R1-05 | Round 2 | P1 | 升级/卸载时用户数据保留说明缺失 | ✅ 已说明（见「数据保留」） | `01c3afc` |

---

## Round 1 — 核心计时状态机可靠性（P0/P1）✅

**验收 EXE**：`src-tauri/target/release/abyssal-reverie.exe`（提交 `6042665`）

### 审计结论（既有机制已健壮，本轮无需改动）
- **开始 / 暂停 / 继续 / 重置 / 完成**：`repository.rs` 中状态机以 `revision` 乐观并发 + 事务保护，状态非法转换返回校验错误。
- **快速双击不重复计时**：`start_timer` 仅接受 `Idle/Done`，且校验 `expected_revision`；重复点击因 revision 不匹配返回 `Conflict` → 前端 resync，无重复会话。（测试 `start_rejects_already_running`）
- **切任务处理**：`switch_timer_mode` 将已累积时间作为已完成会话提交（不丢弃），重置为新模式 idle。（测试 `switch_mode_submits_elapsed_time_and_changes_mode`）
- **最小化到托盘继续**：窗口 `CloseRequested` 被 `prevent_close` 拦截并隐藏；后台 1 Hz ticker 线程独立于窗口可见性读取 `target_end_at`，计时持续。
- **锁屏 / 休眠 / 唤醒自动校正**：剩余时间由墙钟时间戳 `target_end_at` 推导，休眠不漂移；过期后 ticker 发出 `timer-expired`，前端调用幂等 `complete_timer`。
- **完成通知只触发一次**：`complete_timer` 幂等（`newlyCompleted` 标志），ticker 经 `last_emitted` 去重；`runComplete` 仅在 `newlyCompleted && !recovery` 时播放声音/通知。（测试 `complete_timer_is_idempotent`）
- **异常退出恢复**：进程被杀 / 系统关机后，DB 仍保留 `Running` + `target_end_at`；下次启动 `bootstrap` 检测到 `state==running && Date.now()>=targetEndAt` 自动补完成（recovery）。
- **长时间无漂移**：剩余时间始终由 `target_end_at - now` 计算，无本地累加器。

### 本轮修复（R1-01，P0/P1）
**问题**：用户通过托盘“彻底退出”时若正在计时，进程直接 `app.exit(0)`；下次启动时定时器仍为 `Running`（且 `target_end_at` 已过期），被后台 ticker 自动完成 —— 专注时间被悄悄消耗。

**修复**：`tray.rs` 的 `ID_QUIT` 分支在退出前调用新增的 `repository::persist_running_as_paused`：
- 若 `timer.state == Running`：剩余时间由 `target_end_at` 漂移无关推导，`state` 置为 `Paused`，清除 `target_end_at`，写入 `paused_at`，`revision + 1`；并 `PRAGMA wal_checkpoint(TRUNCATE)` 确保 WAL 落盘，跨 `app.exit(0)` 持久。
- 非运行态（Idle/Paused/Done）为 no-op，不被改动。
- 下次启动 `bootstrap` 读到 `Paused`，不会触发自动完成；用户主动点击“继续”恢复。
- 恢复后可正常继续→完成，会话沿用原 `active_session_id` 与 `started_at`。（测试 `quit_as_paused_is_resumable_on_next_launch`）

### 测试与构建验证
- `cargo test`：**59 passed**（含 3 个新增 quit-persistence 测试）。
- `tsc --noEmit`：clean。
- `vitest run`：**16 passed**。
- 真实 EXE 已重建（release 优化）。

### 需用户在真实 Windows 环境验证
1. 开始一次专注 → 通过托盘“退出 Abyssal Reverie” → 重新打开 → 计时应为「已暂停」且剩余时间与原先接近，需手动继续。
2. 空闲 / 暂停 / 完成时退出 → 重新打开状态不变。
3. 正常完成、切模式、快速连点开始按钮：无重复会话、无崩溃。

---

## 数据保留说明（R1-05，已澄清）
- 用户数据（`abyssal-reverie.sqlite` + 会话/任务/设置）位于 Tauri `app_data_dir`，即
  `C:\Users\<用户>\AppData\Roaming\abyssal-reverie\`，**独立于安装目录**。
- **升级**：NSIS 就地升级只替换安装目录内的文件，不动 `appData` → 数据保留。
- **卸载**：Tauri NSIS 默认**不删除** `appData`（位于 Roaming，非安装路径）→ 用户数据保留；如需彻底清除，需手动删除上述目录。
- 因此「升级/卸载数据保留」默认满足，仅作说明，不额外实现。

## Round 2 — 本地数据可靠性（P0/P1）✅
**验收 EXE**：`src-tauri/target/release/abyssal-reverie.exe`（提交 `01c3afc`）

### 本轮修复
- **R1（corrupt DB → P0 无法启动）**：`db::open_at` 改用 `try_open_at` + `PRAGMA integrity_check` 健康检查。若打开/迁移/播种失败，或 DB 不健康，则将文件及其 `-wal`/`-shm` 兄弟重命名为 `.corrupt-<timestamp>`（保留以便人工用 `sqlite3 .recover` 抢救），并在原路径创建全新数据库。应用**始终能启动**，损坏数据不被静默丢弃。
- **错误导入不覆盖（P1）**：`import_data` 在事务内先 `validate_import` 全量校验，任一字段非法即返回 `ValidationError` 且事务回滚，现有任务/会话/设置**原样保留**。新增测试 `import_rejects_a_bad_backup_and_leaves_existing_data_intact` 断言被拒导入（超长标题）后既有数据不变。

### 审计结论（既有机制已健壮，无需改动）
- **CRUD 持久化**：任务增改删、设置保存、会话在 complete/reset/switch 时写入，均有事务 + 校验。
- **重启恢复**：`bootstrap` 读取 DB；`Running` 且过期 → 自动补完成（recovery）；`Paused` → 保持（Round 1）。
- **每任务唯一会话**：每次 `start_timer` 生成新 `active_session_id`（UUID）；`complete_timer` 用 `ON CONFLICT(id) DO NOTHING` 幂等；无重复会话。
- **删除任务保留历史**：`sessions.task_id` 外键 `ON DELETE SET NULL`，删除任务后会话行与快照（`task_title_snapshot`/`project_snapshot`）保留。（测试 `deleting_a_task_preserves_its_session_with_a_null_task_id`）
- **空库**：`user_version=0` 自动建表 v1 + 播种默认设置/空闲计时器。（测试 `empty_database_is_created_and_seeded_on_first_open`）
- **旧版本**：导出备份 `schema_version` 高于当前（`EXPORT_SCHEMA_VERSION=1`）被 `validate_import` 拒绝；内部 DB `user_version` 高于 `LATEST_SCHEMA_VERSION` 时 `run_migrations` 视为已迁移（向前兼容，当前无 schema 变更，冻结范围内不做降级路径——列为已知限制）。
- **schemaVersion 校验**：DB `user_version` 迁移 + 备份 `schema_version` 双重校验。

### 测试与构建验证
- `cargo test`：**62 passed**（含新增 corrupt-recovery、empty-DB-create、bad-import-intact）。
- `tsc --noEmit`：clean；`vitest run`：**16 passed**；真实 EXE 已重建。

### 需用户在真实 Windows 环境验证
1. 正常使用数日后，确认任务/会话/设置跨重启保留。
2. 删除某任务后，统计页该项目历史仍计（快照保留）。
3. （可选）将 `appData\abyssal-reverie.sqlite` 替换为乱码文件后启动 → 应用应正常启动，且乱码文件被重命名为 `.corrupt-<时间戳>` 保留。

## Round 3 — 桌面生命周期（P1）⏳ 规划中
- 关闭→托盘；托盘退出→真实退出；双击 EXE 单实例；打包后托盘图标/菜单；开机自启默认关闭；**全局快捷键冲突优雅降级（R1-02）**；设置持久；通知关闭仍完成。

## Round 4 — 离线资源与性能（P1/P2）⏳ 规划中
- 无外部网络请求；媒体全本地；**视频失败回退 poster（R1-04）**；中文/空格安装路径；视频不误打包进 asar；~3s 启动；低空闲 CPU；失焦/最小化降视频开销；**“降低动态效果”开关（R1-03）**。

## Round 5 — UI 与交互一致性（P2）⏳ 规划中
- 间距/比例统一；玻璃质感统一；海洋背景全屏无接缝；缩放不溢出；动态背景对比度；hover/focus/active/disabled；等宽数字不抖动；100–200% DPI；键盘可操作。

## Round 6 — 最终安装包回归 + 交付物 ⏳ 规划中
- Win10/11；全新/覆盖/卸载/重装；1366×768–2K；单/双显示器；在线/离线；中文/空格/非系统盘；开始菜单/桌面/自启启动；连续/托盘/休眠/异常。
- 交付物：正式 NSIS 安装 EXE + 可选便携版 + 版本号与变更日志 + 本回归报告 + 已知问题清单 + 安装包 SHA-256。
