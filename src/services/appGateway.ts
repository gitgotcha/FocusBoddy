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
}
