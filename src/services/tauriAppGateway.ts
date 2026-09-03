import { invoke } from '@tauri-apps/api/core'

import type { AppGateway } from './appGateway'
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

export class TauriAppGateway implements AppGateway {
  bootstrap() { return invoke<BootstrapPayload>('bootstrap_app') }
  startTimer(input: StartTimerInput) { return invoke<TimerSnapshot>('start_timer', { input }) }
  pauseTimer(input: TimerRevisionInput) { return invoke<TimerSnapshot>('pause_timer', { input }) }
  resumeTimer(input: TimerRevisionInput) { return invoke<TimerSnapshot>('resume_timer', { input }) }
  resetTimer(input: TimerRevisionInput) { return invoke<TimerSnapshot>('reset_timer', { input }) }
  switchTimerMode(input: SwitchTimerModeInput) { return invoke<TimerSnapshot>('switch_timer_mode', { input }) }
  completeTimer(input: CompleteTimerInput) { return invoke<CompleteTimerResult>('complete_timer', { input }) }
  createTask(input: CreateTaskInput) { return invoke<Task>('create_task', { input }) }
  updateTask(input: UpdateTaskInput) { return invoke<Task>('update_task', { input }) }
  deleteTask(id: string) { return invoke<void>('delete_task', { id }) }
  saveSettings(input: AppSettings) { return invoke<SaveSettingsResult>('save_settings', { input }) }
  listSessions(query: SessionQuery) { return invoke<TimerSession[]>('list_sessions', { query }) }
  getStatistics(query: StatisticsQuery) { return invoke<Statistics>('get_statistics', { query }) }
}
