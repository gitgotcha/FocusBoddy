import type { AppSettings, TimerMode, TimerSnapshot } from './models'

export const DEFAULT_SETTINGS: AppSettings = {
  focusDurationMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  autoStartBreak: false,
  soundEnabled: true,
  notificationEnabled: true,
  dailyGoal: 8,
  updatedAt: 0,
}

export function durationSecondsForMode(mode: TimerMode, settings: AppSettings): number {
  const minutes = mode === 'focus'
    ? settings.focusDurationMinutes
    : mode === 'short'
      ? settings.shortBreakMinutes
      : settings.longBreakMinutes
  return minutes * 60
}

export function idleTimerForMode(mode: TimerMode = 'focus', settings = DEFAULT_SETTINGS): TimerSnapshot {
  const durationSeconds = durationSecondsForMode(mode, settings)
  return {
    mode,
    state: 'idle',
    activeSessionId: null,
    selectedTaskId: null,
    taskTitleSnapshot: null,
    projectSnapshot: null,
    durationSeconds,
    remainingSeconds: durationSeconds,
    startedAt: null,
    targetEndAt: null,
    pausedAt: null,
    revision: 0,
    updatedAt: 0,
  }
}
