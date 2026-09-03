export type TaskPriority = 'high' | 'med' | 'low'
export type TimerMode = 'focus' | 'short' | 'long'
export type TimerState = 'idle' | 'running' | 'paused' | 'done'
export type SessionStatus = 'completed' | 'abandoned'

export interface Task {
  id: string
  title: string
  done: boolean
  pomodoroTarget: number
  priority: TaskPriority
  project: string
  sortOrder: number
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

export interface AppSettings {
  focusDurationMinutes: number
  shortBreakMinutes: number
  longBreakMinutes: number
  autoStartBreak: boolean
  soundEnabled: boolean
  notificationEnabled: boolean
  dailyGoal: number
  updatedAt: number
}

export interface TimerSnapshot {
  mode: TimerMode
  state: TimerState
  activeSessionId: string | null
  selectedTaskId: string | null
  taskTitleSnapshot: string | null
  projectSnapshot: string | null
  durationSeconds: number
  remainingSeconds: number
  startedAt: number | null
  targetEndAt: number | null
  pausedAt: number | null
  revision: number
  updatedAt: number
}

export interface TimerSession {
  id: string
  taskId: string | null
  taskTitleSnapshot: string
  projectSnapshot: string
  mode: TimerMode
  status: SessionStatus
  plannedSeconds: number
  focusedSeconds: number
  startedAt: number
  endedAt: number
}

export interface StatisticsDayBoundary {
  date: string
  from: number
  to: number
}

export interface Statistics {
  from: number
  to: number
  focusSessionCount: number
  focusSeconds: number
  dailyGoal: number
  streakDays: number
  bestDay: string | null
  byDay: Array<{ date: string; sessions: number; focusSeconds: number }>
  byProject: Array<{ project: string; sessions: number; focusSeconds: number }>
}

export interface CommandError {
  code: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'CONFLICT' | 'DATABASE_ERROR' | 'INTERNAL_ERROR'
  message: string
}

export interface CreateTaskInput {
  title: string
  pomodoroTarget: number
  priority: TaskPriority
  project: string
}

export interface UpdateTaskInput extends Partial<CreateTaskInput> {
  id: string
  done?: boolean
}

export interface TimerRevisionInput {
  expectedRevision: number
}

export interface StartTimerInput extends TimerRevisionInput {
  mode: TimerMode
  selectedTaskId: string | null
}

export interface SwitchTimerModeInput extends TimerRevisionInput {
  mode: TimerMode
}

export interface CompleteTimerInput extends TimerRevisionInput {
  activeSessionId: string
  recovery?: boolean
}

export interface CompleteTimerResult {
  timer: TimerSnapshot
  session: TimerSession
  statistics: Statistics
  newlyCompleted: boolean
}

export interface SessionQuery {
  limit?: number
  from?: number
  to?: number
}

export interface StatisticsQuery {
  from: number
  to: number
  days: StatisticsDayBoundary[]
}

export interface BootstrapPayload {
  tasks: Task[]
  settings: AppSettings
  timer: TimerSnapshot
  sessions: TimerSession[]
  statistics: Statistics
}

export interface SaveSettingsResult {
  settings: AppSettings
  timer: TimerSnapshot
}
