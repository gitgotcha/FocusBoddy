# Abyssal Reverie 离线 EXE 架构规格

**状态：** 实施唯一事实来源
**目标平台：** Windows 10/11 x64
**桌面容器：** Tauri 2
**前端：** React 19 + TypeScript + Vite
**后端：** Rust + SQLite（rusqlite bundled）
**数据链路：** React UI → TypeScript AppGateway → Tauri IPC → Rust command → SQLite

## 1. 范围与非目标

第一版包含：任务管理、设置、可恢复计时、历史记录、统计、离线媒体、Windows x64 NSIS 安装包、WebView2 离线安装组件。

第一版不包含：登录、注册、云同步、远程后端、自动更新、系统托盘、开机自启、全局快捷键、多窗口、代码签名。

应用不启动本地 HTTP 服务，不监听本地业务端口，不依赖网络下载运行时资源。

## 2. 前端边界

React 组件不得直接导入 `invoke`。生产环境只有 `src/services/tauriAppGateway.ts` 调用 `@tauri-apps/api/core`。测试使用 `FakeAppGateway`。

Rust 是计时状态和持久化数据的权威来源。TypeScript 领域函数仅负责纯计算、展示推导、日历边界计算和恢复决策，不生成持久化 session ID，不直接写 SQLite。

## 3. 领域模型

前后端 JSON 字段使用 camelCase，SQLite 字段使用 snake_case。时间统一使用 UTC epoch milliseconds。

```ts
export type TaskPriority = 'high' | 'med' | 'low';
export type TimerMode = 'focus' | 'short' | 'long';
export type TimerState = 'idle' | 'running' | 'paused' | 'done';
export type SessionStatus = 'completed' | 'abandoned';

export interface TimerSnapshot {
  mode: TimerMode;
  state: TimerState;
  activeSessionId: string | null;
  selectedTaskId: string | null;
  taskTitleSnapshot: string | null;
  projectSnapshot: string | null;
  durationSeconds: number;
  remainingSeconds: number;
  startedAt: number | null;
  targetEndAt: number | null;
  pausedAt: number | null;
  revision: number;
  updatedAt: number;
}

export interface TimerRevisionInput {
  expectedRevision: number;
}

export interface StartTimerInput extends TimerRevisionInput {
  mode: TimerMode;
  selectedTaskId: string | null;
}

export interface SwitchTimerModeInput extends TimerRevisionInput {
  mode: TimerMode;
}

export interface CompleteTimerInput extends TimerRevisionInput {
  activeSessionId: string;
  recovery?: boolean;
}

export interface CompleteTimerResult {
  timer: TimerSnapshot;
  session: TimerSession;
  statistics: Statistics;
  newlyCompleted: boolean;
}

export interface StatisticsDayBoundary {
  date: string;
  from: number;
  to: number;
}

export interface StatisticsQuery {
  from: number;
  to: number;
  days: StatisticsDayBoundary[];
}
```

`streakDays` 定义为截至今天的当前连续天数：今天有 completed focus 则从今天向前计算；今天没有记录则从昨天向前计算；中间缺一天即停止。

固定快照：

- 无任务 focus：`未指定任务` / `通用`
- short：`短休` / `休息`
- long：`长休` / `休息`

## 4. 动作型计时 IPC

公开 Gateway 只提供动作型接口，不提供通用 `saveTimerState()` 或 `abandonTimer()`：

```ts
export interface AppGateway {
  bootstrap(): Promise<BootstrapPayload>;

  startTimer(input: StartTimerInput): Promise<TimerSnapshot>;
  pauseTimer(input: TimerRevisionInput): Promise<TimerSnapshot>;
  resumeTimer(input: TimerRevisionInput): Promise<TimerSnapshot>;
  resetTimer(input: TimerRevisionInput): Promise<TimerSnapshot>;
  switchTimerMode(input: SwitchTimerModeInput): Promise<TimerSnapshot>;
  completeTimer(input: CompleteTimerInput): Promise<CompleteTimerResult>;

  createTask(input: CreateTaskInput): Promise<Task>;
  updateTask(input: UpdateTaskInput): Promise<Task>;
  deleteTask(id: string): Promise<void>;
  saveSettings(input: AppSettings): Promise<SaveSettingsResult>;
  listSessions(query: SessionQuery): Promise<TimerSession[]>;
  getStatistics(query: StatisticsQuery): Promise<Statistics>;
}
```

对应 Rust commands：

- `bootstrap_app`
- `start_timer`
- `pause_timer`
- `resume_timer`
- `reset_timer`
- `switch_timer_mode`
- `complete_timer`
- `create_task`
- `update_task`
- `delete_task`
- `save_settings`
- `list_sessions`
- `get_statistics`

### 4.1 原子状态转换

- `start_timer`：Rust 在一个 transaction 中校验状态、读取任务、复制快照、生成 UUID v4、计算 `target_end_at`、写 running state、revision 加一。
- `pause_timer`：只允许 running → paused；按 `target_end_at` 计算 remaining，清除 target end，revision 加一。
- `resume_timer`：只允许 paused → running；按 remaining 生成新的 `target_end_at`，revision 加一。
- `reset_timer`：在单一 transaction 中，如 session 已开始则写一条 abandoned session，然后回到当前 mode 的 idle。
- `switch_timer_mode`：在单一 transaction 中，如 session 已开始则写一条 abandoned session，切换 mode 并回到 idle。
- 未真正开始的 idle timer 不生成 abandoned session。
- 所有动作带 `expectedRevision`；事务内条件更新影响行数为零时返回 `CONFLICT`。

### 4.2 完成幂等

`complete_timer` 必须先按 `activeSessionId` 查询：

1. 已存在 completed session：直接返回原 session、done timer 和统计，`newlyCompleted = false`，不能先要求 timer 仍为 running。
2. 已存在 abandoned session：返回 `CONFLICT`，不能改写为 completed。
3. 不存在：校验 timer state、active session、revision 和完成/到期条件。
4. 使用 `INSERT INTO ... ON CONFLICT(id) DO NOTHING`，只将相同 session ID 作为幂等冲突。
5. 在同一 transaction 中把 timer 置为 done、remaining 置零、revision 加一。
6. 首次插入返回 `newlyCompleted = true`。

自动休息只在：

```ts
result.newlyCompleted &&
settings.autoStartBreak &&
result.session.mode === 'focus' &&
!input.recovery
```

应用重启时恢复过期 focus，即使该次完成是首次写入，也不自动开启休息。

## 5. SQLite v1

首次运行只插入默认设置和 idle timer state，不插入示例任务、示例 session 或伪造统计。v1 新数据库直接使用最终 schema，不执行 ALTER TABLE。

`timer_state` 必须包含：

- `revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0)`
- `task_title_snapshot TEXT`
- `project_snapshot TEXT`
- `active_session_id TEXT`
- `selected_task_id TEXT`
- `duration_seconds INTEGER NOT NULL CHECK(duration_seconds > 0)`
- `remaining_seconds INTEGER NOT NULL CHECK(remaining_seconds >= 0)`
- `started_at INTEGER`
- `target_end_at INTEGER`
- `paused_at INTEGER`
- `updated_at INTEGER NOT NULL`

running/paused/done 的 session 必须使用启动时快照；任务后续改名或删除不得改变历史快照。任务删除通过 `ON DELETE SET NULL` 保留 session 行。

SQLite 启动启用：

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

## 6. 统计

前端按系统本地时区计算总范围和每日边界 `days`，将 `date`、`from`、`to` 原样传给 Rust。Rust 校验日期有序、不重叠、每段 `from < to` 且位于总范围内；不得根据两个总边界自行猜测 DST 日桶。

统计只计入 `mode = 'focus' AND status = 'completed'`。短休、长休、abandoned 不计入专注次数、专注时长、streak 或项目统计。

## 7. 离线与安装

所有运行时资源来自安装包：

- `public/media/ocean-loop.mp4`
- `public/media/ocean-poster.jpg`（按实际 JPEG MIME 使用）
- `public/audio/focus-complete.wav`（按实际 WAV MIME 使用）
- `public/fonts/inter-latin.woff2`
- `public/fonts/dm-mono-latin.woff2`

资源来源和许可证记录在 `THIRD_PARTY_NOTICES.md`。生产构建无 source map。离线扫描只检查可能触发网络的资源加载语句。

NSIS 使用 `webviewInstallMode: { "type": "offlineInstaller" }`，只生成 Windows x64 安装包。
