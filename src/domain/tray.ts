import type { TimerMode, TimerSnapshot, TimerState } from './models'

/** Payload pushed to Rust via `setTrayIndicator`. Rust paints these strings
 *  verbatim into the tray tooltip and the two dynamic menu labels. */
export interface TrayIndicator {
  tooltip: string
  statusLabel: string
  toggleLabel: string
}

/** Tray menu action broadcast from Rust (`tray-action` event). Mirrors the
 *  `TrayAction` enum on the Rust side, serialized as lowercase. */
export type TrayAction = 'toggle' | 'reset'

/** Payload of the `timer-expired` event from the Rust completion backstop
 *  ticker. Carries just enough for `handleExpire` to call `completeTimer`. */
export interface TimerExpiredPayload {
  activeSessionId: string
  expectedRevision: number
}

const MODE_LABEL: Record<TimerMode, string> = {
  focus: '专注',
  short: '短休',
  long: '长休',
}

/** Zero-padded mm:ss for a seconds count. Hours overflow into the minutes
 *  field (e.g. 75:00), matching the main timer display. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  const sec = s % 60
  const mm = m >= 100 ? String(m) : String(m).padStart(2, '0')
  return `${mm}:${String(sec).padStart(2, '0')}`
}

/**
 * Derives the tray indicator text from an authoritative timer snapshot.
 *
 * Remaining-time derivation mirrors `TimerPanel`: while running it is computed
 * drift-free from `targetEndAt` against `now`, so the tray stays correct across
 * throttling and system sleep without any local accumulation.
 *
 * Pure: no IPC, no side effects — fully unit-testable. The App root calls this
 * once per render and every second while running, then ships the result to Rust.
 */
export function formatTrayIndicator(
  timer: TimerSnapshot | null,
  now: number,
): TrayIndicator {
  if (!timer) {
    return {
      tooltip: 'Abyssal Reverie · 空闲',
      statusLabel: 'Abyssal Reverie · 空闲',
      toggleLabel: '开始专注',
    }
  }

  const state: TimerState = timer.state ?? 'idle'
  const mode = timer.mode ?? 'focus'
  const total = timer.durationSeconds || 0
  const remaining =
    state === 'running' && timer.targetEndAt
      ? Math.max(0, Math.ceil((timer.targetEndAt - now) / 1000))
      : (timer.remainingSeconds ?? total)
  const clock = formatClock(remaining)

  const statusWord =
    state === 'done' ? '已完成'
    : state === 'running' ? '专注中'
    : state === 'paused' ? '已暂停'
    : MODE_LABEL[mode]

  // The disabled status row summarises mode + state + remaining, so a glance at
  // the menu (opened by right-click) tells the whole story.
  const statusLabel =
    state === 'done'
      ? `Abyssal Reverie · 已完成`
      : state === 'idle'
        ? `Abyssal Reverie · ${MODE_LABEL[mode]}`
        : `Abyssal Reverie · ${statusWord} ${clock}`

  const tooltip = statusLabel

  // The toggle item reflects the next sensible action for the current state.
  const toggleLabel =
    state === 'running' ? '暂停'
    : state === 'paused' ? '继续'
    : '开始专注'

  return { tooltip, statusLabel, toggleLabel }
}
