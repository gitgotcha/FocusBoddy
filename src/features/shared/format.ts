import type { TimerMode, TimerSession } from "../../domain/models";
import type { SessionLog } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────
// Derived from the shared settings; updated when settings are persisted.
// Until bootstrap loads persisted settings, the defaults are used.
export const MODE_LABELS: Record<TimerMode, string> = { focus: "专注", short: "短休", long: "长休" };

export function pad(n: number) { return String(n).padStart(2, "0"); }
export function formatSeconds(s: number) { return { m: pad(Math.floor(s/60)), s: pad(s%60) }; }
export function uid() { return Math.random().toString(36).slice(2,9); }

/** Projects a persisted session onto the activity-list row shape. */
export function sessionToLog(session: TimerSession): SessionLog {
  const at = new Date(session.startedAt);
  return {
    id: session.id,
    time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
    duration: Math.round(session.focusedSeconds / 60),
    task: session.taskTitleSnapshot,
    mode: session.mode,
    status: session.status,
  };
}

/** Only completed focus sessions count toward goals and stats (spec §6). */
export function isCountedFocus(log: SessionLog): boolean {
  return log.mode === "focus" && log.status === "completed";
}

export function chineseDate() {
  const d = new Date();
  const wd = ["周日","周一","周二","周三","周四","周五","周六"];
  return `${d.getMonth()+1}月${d.getDate()}日 · ${wd[d.getDay()]}`;
}
