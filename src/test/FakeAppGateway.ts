import { DEFAULT_SETTINGS, durationSecondsForMode, idleTimerForMode } from '../domain/defaults'
import type { AppGateway } from '../services/appGateway'
import type {
  AppSettings,
  BootstrapPayload,
  CompleteTimerInput,
  CompleteTimerResult,
  CreateTaskInput,
  SaveSettingsResult,
  SessionQuery,
  StartTimerInput,
  Statistics,
  StatisticsDayBoundary,
  StatisticsQuery,
  SwitchTimerModeInput,
  Task,
  TimerMode,
  TimerRevisionInput,
  TimerSession,
  TimerSnapshot,
  UpdateTaskInput,
} from '../domain/models'
import type { TrayAction, TrayIndicator, TimerExpiredPayload } from '../domain/tray'

export interface InjectedError {
  code: string
  message: string
}

let sequence = 0
function nextId(prefix: string): string {
  sequence += 1
  return `${prefix}-${Date.now().toString(36)}-${sequence}`
}

/**
 * In-memory `AppGateway` for unit/component tests.
 *
 * Mirrors the action-style timer state machine closely enough to exercise the
 * React layer without a Tauri runtime or SQLite. Use `injectFailure` to make
 * the next call reject with a specific `CommandError`-shaped error, enabling
 * deterministic conflict / not-found / database-error paths.
 */
export class FakeAppGateway implements AppGateway {
  private tasks: Task[] = []
  private settings: AppSettings = { ...DEFAULT_SETTINGS, updatedAt: Date.now() }
  private timer: TimerSnapshot = idleTimerForMode('focus', this.settings)
  private sessions: TimerSession[] = []
  private failures: InjectedError[] = []

  /** Queue an error that the next gateway call will reject with. */
  injectFailure(code: string, message = 'injected failure'): void {
    this.failures.push({ code, message })
  }

  /** Drop all queued failures and reset persisted state. */
  reset(): void {
    this.failures = []
    this.tasks = []
    this.settings = { ...DEFAULT_SETTINGS, updatedAt: Date.now() }
    this.timer = idleTimerForMode('focus', this.settings)
    this.sessions = []
  }

  private takeFailure(): void {
    const failure = this.failures.shift()
    if (failure) {
      const error = new Error(failure.message) as Error & { code?: string }
      error.code = failure.code
      throw error
    }
  }

  private computeStatistics(query: StatisticsQuery): Statistics {
    const from = query.from
    const to = query.to
    const focus = this.sessions.filter(
      (s) => s.mode === 'focus' && s.status === 'completed' && s.startedAt >= from && s.startedAt <= to,
    )
    const focusSeconds = focus.reduce((acc, s) => acc + s.focusedSeconds, 0)

    const byDay = new Map<string, { sessions: number; focusSeconds: number }>()
    for (const boundary of query.days) byDay.set(boundary.date, { sessions: 0, focusSeconds: 0 })
    for (const s of focus) {
      const day = this.dayKeyFor(s.startedAt, query.days)
      if (!day) continue
      const entry = byDay.get(day) ?? { sessions: 0, focusSeconds: 0 }
      entry.sessions += 1
      entry.focusSeconds += s.focusedSeconds
      byDay.set(day, entry)
    }

    const byProjectMap = new Map<string, { sessions: number; focusSeconds: number }>()
    for (const s of focus) {
      const entry = byProjectMap.get(s.projectSnapshot) ?? { sessions: 0, focusSeconds: 0 }
      entry.sessions += 1
      entry.focusSeconds += s.focusedSeconds
      byProjectMap.set(s.projectSnapshot, entry)
    }

    const best = [...byDay.entries()].sort((a, b) => b[1].focusSeconds - a[1].focusSeconds)[0]

    return {
      from,
      to,
      focusSessionCount: focus.length,
      focusSeconds,
      dailyGoal: this.settings.dailyGoal,
      streakDays: 0,
      bestDay: best ? best[0] : null,
      byDay: [...byDay.entries()].map(([date, v]) => ({ date, ...v })),
      byProject: [...byProjectMap.entries()].map(([project, v]) => ({ project, ...v })),
    }
  }

  private dayKeyFor(ts: number, days: StatisticsDayBoundary[]): string | null {
    for (const d of days) {
      if (ts >= d.from && ts <= d.to) return d.date
    }
    return null
  }

  async bootstrap(): Promise<BootstrapPayload> {
    this.takeFailure()
    return {
      tasks: this.tasks,
      settings: this.settings,
      timer: this.timer,
      sessions: this.sessions,
      statistics: this.computeStatistics({ from: 0, to: Date.now(), days: [] }),
    }
  }

  async startTimer(input: StartTimerInput): Promise<TimerSnapshot> {
    this.takeFailure()
    const durationSeconds = durationSecondsForMode(input.mode, this.settings)
    const now = Date.now()
    this.timer = {
      ...this.timer,
      mode: input.mode,
      state: 'running',
      selectedTaskId: input.selectedTaskId,
      durationSeconds,
      remainingSeconds: durationSeconds,
      startedAt: now,
      targetEndAt: now + durationSeconds * 1000,
      pausedAt: null,
      revision: this.timer.revision + 1,
      updatedAt: now,
    }
    return this.timer
  }

  async pauseTimer(input: TimerRevisionInput): Promise<TimerSnapshot> {
    this.takeFailure()
    const now = Date.now()
    this.timer = {
      ...this.timer,
      state: 'paused',
      pausedAt: now,
      revision: this.expectedRevision(input),
      updatedAt: now,
    }
    return this.timer
  }

  async resumeTimer(input: TimerRevisionInput): Promise<TimerSnapshot> {
    this.takeFailure()
    const now = Date.now()
    this.timer = {
      ...this.timer,
      state: 'running',
      pausedAt: null,
      revision: this.expectedRevision(input),
      updatedAt: now,
    }
    return this.timer
  }

  async resetTimer(input: TimerRevisionInput): Promise<TimerSnapshot> {
    this.takeFailure()
    const now = Date.now()
    this.timer = {
      ...idleTimerForMode(this.timer.mode, this.settings),
      revision: this.expectedRevision(input),
      updatedAt: now,
    }
    return this.timer
  }

  async switchTimerMode(input: SwitchTimerModeInput): Promise<TimerSnapshot> {
    this.takeFailure()
    const now = Date.now()

    // Mirrors the Rust machine: switching submits a started session
    // (completed with actual elapsed time) instead of abandoning it.
    const started =
      this.timer.state !== 'idle' && this.timer.activeSessionId && this.timer.startedAt
    if (started) {
      const focusedSeconds = Math.max(
        0,
        this.timer.durationSeconds -
          (this.timer.state === 'running' && this.timer.targetEndAt
            ? Math.max(0, Math.ceil((this.timer.targetEndAt - now) / 1000))
            : this.timer.remainingSeconds),
      )
      this.sessions = [
        ...this.sessions,
        {
          id: this.timer.activeSessionId!,
          taskId: this.timer.selectedTaskId,
          taskTitleSnapshot: this.timer.taskTitleSnapshot ?? '未指定任务',
          projectSnapshot: this.timer.projectSnapshot ?? '通用',
          mode: this.timer.mode,
          status: 'completed',
          plannedSeconds: this.timer.durationSeconds,
          focusedSeconds,
          startedAt: this.timer.startedAt ?? now,
          endedAt: now,
        },
      ]
    }

    this.timer = {
      ...idleTimerForMode(input.mode, this.settings),
      revision: this.expectedRevision(input),
      updatedAt: now,
    }
    return this.timer
  }

  async completeTimer(input: CompleteTimerInput): Promise<CompleteTimerResult> {
    this.takeFailure()
    const now = Date.now()
    const focusedSeconds = this.timer.durationSeconds - this.timer.remainingSeconds
    const session: TimerSession = {
      id: input.activeSessionId || nextId('session'),
      taskId: this.timer.selectedTaskId,
      taskTitleSnapshot: this.timer.taskTitleSnapshot ?? '未指定任务',
      projectSnapshot: this.timer.projectSnapshot ?? '通用',
      mode: this.timer.mode,
      status: 'completed',
      plannedSeconds: this.timer.durationSeconds,
      focusedSeconds: focusedSeconds > 0 ? focusedSeconds : this.timer.durationSeconds,
      startedAt: this.timer.startedAt ?? now,
      endedAt: now,
    }
    this.sessions = [...this.sessions, session]
    this.timer = {
      ...idleTimerForMode(this.timer.mode, this.settings),
      revision: this.timer.revision + 1,
      updatedAt: now,
    }
    return {
      timer: this.timer,
      session,
      statistics: this.computeStatistics({ from: 0, to: now, days: [] }),
      newlyCompleted: true,
    }
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    this.takeFailure()
    const now = Date.now()
    const task: Task = {
      id: nextId('task'),
      title: input.title,
      done: false,
      pomodoroTarget: input.pomodoroTarget,
      priority: input.priority,
      project: input.project,
      sortOrder: this.tasks.length,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    }
    this.tasks = [...this.tasks, task]
    return task
  }

  async updateTask(input: UpdateTaskInput): Promise<Task> {
    this.takeFailure()
    const now = Date.now()
    const target = this.tasks.find((t) => t.id === input.id)
    if (!target) {
      const error = new Error('task not found') as Error & { code?: string }
      error.code = 'NOT_FOUND'
      throw error
    }
    const updated: Task = {
      ...target,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.pomodoroTarget !== undefined ? { pomodoroTarget: input.pomodoroTarget } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.project !== undefined ? { project: input.project } : {}),
      ...(input.done !== undefined
        ? { done: input.done, completedAt: input.done ? now : null }
        : {}),
      updatedAt: now,
    }
    this.tasks = this.tasks.map((t) => (t.id === input.id ? updated : t))
    return updated
  }

  async deleteTask(id: string): Promise<void> {
    this.takeFailure()
    this.tasks = this.tasks.filter((t) => t.id !== id)
  }

  async saveSettings(input: AppSettings): Promise<SaveSettingsResult> {
    this.takeFailure()
    const now = Date.now()
    this.settings = { ...input, updatedAt: now }
    const timer: TimerSnapshot =
      this.timer.state === 'idle'
        ? { ...idleTimerForMode(this.timer.mode as TimerMode, this.settings), revision: this.timer.revision, updatedAt: now }
        : this.timer
    return { settings: this.settings, timer }
  }

  async listSessions(query: SessionQuery): Promise<TimerSession[]> {
    this.takeFailure()
    let result = this.sessions
    if (query.from !== undefined) result = result.filter((s) => s.startedAt >= query.from!)
    if (query.to !== undefined) result = result.filter((s) => s.startedAt <= query.to!)
    result = result.slice().sort((a, b) => b.startedAt - a.startedAt)
    if (query.limit !== undefined) result = result.slice(0, query.limit)
    return result
  }

  async getStatistics(query: StatisticsQuery): Promise<Statistics> {
    this.takeFailure()
    return this.computeStatistics(query)
  }

  // --- Tray surface (no-op in tests, but recorded for assertions) ---

  /** Last indicator pushed by the App, useful for component-test assertions. */
  lastTrayIndicator: TrayIndicator | null = null

  async setTrayIndicator(input: TrayIndicator): Promise<void> {
    this.takeFailure()
    this.lastTrayIndicator = input
  }

  subscribeTimerExpired(_cb: (payload: TimerExpiredPayload) => void): () => void {
    // No background ticker in the fake; tests drive completion directly.
    return () => undefined
  }

  subscribeTrayAction(_cb: (action: TrayAction) => void): () => void {
    return () => undefined
  }

  // --- Autostart (in-memory stub for tests) ---

  /** Mirrors the OS registry state for component tests. */
  launchAtLogin = false

  async getAutostart(): Promise<boolean> {
    this.takeFailure()
    return this.launchAtLogin
  }

  async setAutostart(enabled: boolean): Promise<boolean> {
    this.takeFailure()
    this.launchAtLogin = enabled
    return enabled
  }

  private expectedRevision(input: TimerRevisionInput): number {
    // Optimistic concurrency: reject stale writes the same way Rust would.
    if (input.expectedRevision < this.timer.revision) {
      const error = new Error('timer revision conflict') as Error & { code?: string }
      error.code = 'CONFLICT'
      throw error
    }
    return input.expectedRevision
  }
}
