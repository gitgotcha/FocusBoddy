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
  StatisticsQuery,
  SwitchTimerModeInput,
  Task,
  TimerRevisionInput,
  TimerSession,
  TimerSnapshot,
  UpdateTaskInput,
} from '../domain/models'
import type { TrayAction, TrayIndicator, TimerExpiredPayload } from '../domain/tray'

export interface AppGateway {
  bootstrap(): Promise<BootstrapPayload>
  startTimer(input: StartTimerInput): Promise<TimerSnapshot>
  pauseTimer(input: TimerRevisionInput): Promise<TimerSnapshot>
  resumeTimer(input: TimerRevisionInput): Promise<TimerSnapshot>
  resetTimer(input: TimerRevisionInput): Promise<TimerSnapshot>
  switchTimerMode(input: SwitchTimerModeInput): Promise<TimerSnapshot>
  completeTimer(input: CompleteTimerInput): Promise<CompleteTimerResult>
  createTask(input: CreateTaskInput): Promise<Task>
  updateTask(input: UpdateTaskInput): Promise<Task>
  deleteTask(id: string): Promise<void>
  saveSettings(input: AppSettings): Promise<SaveSettingsResult>
  listSessions(query: SessionQuery): Promise<TimerSession[]>
  getStatistics(query: StatisticsQuery): Promise<Statistics>
  /** Paints the live tooltip + menu labels into the system tray. */
  setTrayIndicator(input: TrayIndicator): Promise<void>
  /** Subscribes to the Rust completion backstop. Returns an unsubscribe. */
  subscribeTimerExpired(cb: (payload: TimerExpiredPayload) => void): () => void
  /** Subscribes to tray menu actions (pause/resume, reset). Returns an unsubscribe. */
  subscribeTrayAction(cb: (action: TrayAction) => void): () => void
}
