import type {
  AppSettings,
  BootstrapPayload,
  CompleteTimerInput,
  CompleteTimerResult,
  CreateTaskInput,
  ExportSummary,
  ImportPreview,
  ImportSummary,
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
  /** Subscribes to the global-shortcut conflict warning (hotkey taken by another
   *  app). The callback receives the conflicting accelerator string. */
  subscribeGlobalShortcutConflict(cb: (shortcut: string) => void): () => void
  /** Whether the app launches at Windows login (autostart plugin state). */
  getAutostart(): Promise<boolean>
  /** Enables/disables launch-at-login; resolves to the resulting state. */
  setAutostart(enabled: boolean): Promise<boolean>
  /** Opens a native Save-As dialog; resolves to the chosen path or null. */
  pickExportPath(suggestedName: string): Promise<string | null>
  /** Opens a native Open dialog (JSON only); resolves to the chosen path or null. */
  pickImportPath(): Promise<string | null>
  /** Writes the full backup bundle as JSON to `path`. */
  exportBackup(path: string): Promise<ExportSummary>
  /** Writes all sessions as a CSV spreadsheet to `path`. */
  exportSessionsCsv(path: string): Promise<ExportSummary>
  /** Reads + validates a backup file without mutating the DB. */
  previewImport(path: string): Promise<ImportPreview>
  /** Replaces tasks/sessions/settings from the backup at `path`. */
  importBackup(path: string): Promise<ImportSummary>
}
