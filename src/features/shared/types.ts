import type { TimerMode } from "../../domain/models";

// ─── Types ────────────────────────────────────────────────────────────────────
export type NavSection = "timer" | "tasks" | "stats" | "settings";

/** A session rendered in the activity list (completed or abandoned). */
export interface SessionLog {
  id: string; time: string; duration: number; task: string;
  mode: TimerMode;
  status: "completed" | "abandoned";
}
