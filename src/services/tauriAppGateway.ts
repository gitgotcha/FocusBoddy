import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

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
import type { TrayAction, TrayIndicator, TimerExpiredPayload } from '../domain/tray'

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

  setTrayIndicator(input: TrayIndicator) { return invoke<void>('set_tray_indicator', { input }) }

  // `listen` is async (returns a promise for the unlisten handle); the React
  // effect that registers these expects a synchronous teardown, so we hand it
  // a closure that resolves the handle lazily and unlistens on cleanup.
  subscribeTimerExpired(cb: (payload: TimerExpiredPayload) => void): () => void {
    let unlisten: UnlistenFn | undefined
    let stopped = false
    void listen<TimerExpiredPayload>('timer-expired', e => cb(e.payload))
      .then(fn => { unlisten = stopped ? void fn() : fn })
      .catch(() => undefined)
    return () => { stopped = true; unlisten?.() }
  }

  subscribeTrayAction(cb: (action: TrayAction) => void): () => void {
    let unlisten: UnlistenFn | undefined
    let stopped = false
    void listen<TrayAction>('tray-action', e => cb(e.payload))
      .then(fn => { unlisten = stopped ? void fn() : fn })
      .catch(() => undefined)
    return () => { stopped = true; unlisten?.() }
  }
}
