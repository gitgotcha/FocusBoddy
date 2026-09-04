import { useState, useEffect, useRef, useCallback } from "react";
import type { AppSettings, ImportPreview, Statistics, Task, TaskPriority, TimerMode, TimerSession, TimerSnapshot } from "./domain/models";
import { DEFAULT_SETTINGS, durationSecondsForMode } from "./domain/defaults";
import { weekBoundaries, weekRange } from "./domain/statistics";
import { formatTrayIndicator } from "./domain/tray";
import { useAppGateway } from "./services/gatewayContext";

// ─── Types ────────────────────────────────────────────────────────────────────
type NavSection = "timer" | "tasks" | "stats" | "settings";

/** A session rendered in the activity list (completed or abandoned). */
interface SessionLog {
  id: string; time: string; duration: number; task: string;
  mode: TimerMode;
  status: "completed" | "abandoned";
}

// ─── Design Tokens ────────────────────────────────────────────────────────────
// Text is vivid & sharp with text shadows to ensure high legibility on transparent frosted glass.
const C = {
  abyss:       "#050709",
  graphite:    "#0A1117",
  stormGray:   "#1B252C",
  silver:      "#B0C0C6",
  moonlight:   "#E2EFEF",
  textPrimary: "#FFFFFF",
  textSec:     "rgba(240, 246, 248, 0.92)",
  textMuted:   "rgba(195, 212, 218, 0.75)",
  hairline:    "rgba(215, 228, 230, 0.10)",
  hairlineStr: "rgba(215, 228, 230, 0.18)",
  // All card/glass backgrounds are very transparent — ocean surrounds everything
  card:        "rgba(8, 13, 18, 0.24)",
  cardBright:  "rgba(10, 15, 20, 0.28)",
  cardDim:     "rgba(5, 9, 13, 0.20)",
  glassClear:  "rgba(8, 13, 18, 0.20)",
  glassTint:   "rgba(14, 22, 30, 0.28)",
} as const;

// Unified transparent glass card — the ocean is always visible behind it
const CARD: React.CSSProperties = {
  background:              C.card,
  backdropFilter:          "blur(18px)",
  WebkitBackdropFilter:    "blur(18px)",
  border:                  `1px solid ${C.hairline}`,
  borderRadius:            16,
  boxShadow:               "inset 0 0.5px 0 rgba(215,228,230,0.04), 0 4px 16px rgba(2,3,5,0.16)",
};

// High-clarity frosted glass recipe for sidebars — ultra transparent, crisp backdrop blur, punchy text contrast
const SIDEBAR_GLASS: React.CSSProperties = {
  background:              "rgba(6, 11, 16, 0.25)",
  backdropFilter:          "blur(32px) saturate(1.1) brightness(0.85)",
  WebkitBackdropFilter:    "blur(32px) saturate(1.1) brightness(0.85)",
};

// ─── Constants ────────────────────────────────────────────────────────────────
// Derived from the shared settings; updated when settings are persisted.
// Until bootstrap loads persisted settings, the defaults are used.
const MODE_LABELS: Record<TimerMode, string> = { focus: "专注", short: "短休", long: "长休" };

// ─── Ocean Video Background ───────────────────────────────────────────────────
function OceanVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    // 0.87× — natural deceleration without artificial slow-motion artifacts
    const applyRate = () => { v.playbackRate = 0.87; };
    applyRate();
    v.addEventListener("loadedmetadata", applyRate);

    const onVisibility = () => {
      if (document.hidden) v.pause();
      else v.play().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisibility);

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) v.pause();
    const onMq = (e: MediaQueryListEvent) => {
      if (e.matches) v.pause(); else v.play().catch(() => {});
    };
    mq.addEventListener("change", onMq);

    return () => {
      v.removeEventListener("loadedmetadata", applyRate);
      document.removeEventListener("visibilitychange", onVisibility);
      mq.removeEventListener("change", onMq);
    };
  }, []);

  return (
    <>
      {/* Single global ocean — fixed to viewport, every UI surface floats above it */}
      <video
        ref={videoRef}
        autoPlay muted loop playsInline
        poster="/media/ocean-poster.jpg"
        style={{
          position: "fixed", inset: 0,
          width: "100vw", height: "100vh",
          objectFit: "cover",
          zIndex: 0, display: "block",
          pointerEvents: "none",
          // D-Log-pressed grade: dark, desaturated, natural contrast
          filter: "brightness(0.52) saturate(0.44) contrast(0.94)",
        }}
      >
        <source src="/media/ocean-loop.mp4" type="video/mp4" />
      </video>

      {/* Single continuous vignette — no section-specific bands */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 1, pointerEvents: "none",
        background: `linear-gradient(
          180deg,
          rgba(5,7,9,0.60) 0%,
          rgba(5,7,9,0.28) 22%,
          rgba(5,7,9,0.16) 46%,
          rgba(5,7,9,0.22) 70%,
          rgba(5,7,9,0.44) 87%,
          rgba(5,7,9,0.58) 100%
        )`,
      }} />

      {/* Radial vignette — corners only */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 1, pointerEvents: "none",
        background: "radial-gradient(ellipse 88% 86% at 50% 48%, transparent 28%, rgba(5,7,9,0.48) 100%)",
      }} />
    </>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function pad(n: number) { return String(n).padStart(2, "0"); }
function formatSeconds(s: number) { return { m: pad(Math.floor(s/60)), s: pad(s%60) }; }
function uid() { return Math.random().toString(36).slice(2,9); }

/** Projects a persisted session onto the activity-list row shape. */
function sessionToLog(session: TimerSession): SessionLog {
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
function isCountedFocus(log: SessionLog): boolean {
  return log.mode === "focus" && log.status === "completed";
}

function chineseDate() {
  const d = new Date();
  const wd = ["周日","周一","周二","周三","周四","周五","周六"];
  return `${d.getMonth()+1}月${d.getDate()}日 · ${wd[d.getDay()]}`;
}

function catmullRomPath(pts: { x: number; y: number }[], tension = 0.38): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i-1)];
    const p1 = pts[i];
    const p2 = pts[i+1];
    const p3 = pts[Math.min(pts.length-1, i+2)];
    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;
    d += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

function HorizonDivider() {
  return (
    <div style={{
      height: 1, flexShrink: 0,
      background: `linear-gradient(90deg, transparent 0%, rgba(215,228,230,0.04) 15%, rgba(215,228,230,0.07) 40%, rgba(215,228,230,0.08) 52%, rgba(215,228,230,0.05) 78%, rgba(215,228,230,0.02) 90%, transparent 100%)`,
    }} />
  );
}

function GoalRing({ progress, size = 36 }: { progress: number; size?: number }) {
  const r = size/2 - 3;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(1, progress));
  return (
    <svg width={size} height={size} style={{ transform:"rotate(-90deg)", flexShrink:0 }}>
      <defs>
        <linearGradient id="goalGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#9EADB2" />
          <stop offset="100%" stopColor="#BAC8CC" />
        </linearGradient>
      </defs>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(215,228,230,0.08)" strokeWidth={2} />
      <circle cx={size/2} cy={size/2} r={r} fill="none"
        stroke="url(#goalGrad)" strokeWidth={2}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition:"stroke-dashoffset 0.9s cubic-bezier(0.22,1,0.36,1)" }}
      />
    </svg>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
const NAV_ITEMS: { id: NavSection; label: string; icon: React.JSX.Element }[] = [
  {
    id:"timer", label:"计时",
    icon:(
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8.5" r="5.8" stroke="currentColor" strokeWidth="1.2" />
        <path d="M8 5.5V8.5L10 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M6.5 1.5H9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id:"tasks", label:"任务",
    icon:(
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M3 4H13M3 8H10M3 12H8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id:"stats", label:"统计",
    icon:(
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="9" width="3" height="5" rx="0.6" stroke="currentColor" strokeWidth="1.2" />
        <rect x="6.5" y="5" width="3" height="9" rx="0.6" stroke="currentColor" strokeWidth="1.2" />
        <rect x="11" y="2" width="3" height="12" rx="0.6" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    ),
  },
  {
    id:"settings", label:"设置",
    icon:(
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.2" />
        <path d="M8 1.5V3M8 13V14.5M14.5 8H13M3 8H1.5M12.36 3.64L11.3 4.7M4.7 11.3L3.64 12.36M12.36 12.36L11.3 11.3M4.7 4.7L3.64 3.64"
          stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
];

function Sidebar({ active, onNav }: { active: NavSection; onNav: (s: NavSection) => void }) {
  return (
    <aside className="nav-sidebar" style={{
      width: 56, flexShrink: 0, zIndex: 10, position: "relative",
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "14px 0",
      ...SIDEBAR_GLASS,
      borderRight: `1px solid ${C.hairline}`,
      boxShadow: "inset -1px 0 0 rgba(255,255,255,0.025), 6px 0 24px rgba(0,0,0,0.12)",
    }}>
      {/* Logo mark */}
      <div style={{
        width: 28, height: 28, borderRadius: "50%",
        background: "rgba(14, 20, 26, 0.35)",
        border: `0.5px solid rgba(215,228,230,0.14)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: 16,
      }}>
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="2.6" stroke="rgba(226,239,239,0.85)" strokeWidth="1.2" />
          <circle cx="7" cy="7" r="5.5" stroke="rgba(226,239,239,0.22)" strokeWidth="0.8" />
        </svg>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {NAV_ITEMS.map((item) => {
          const isActive = active === item.id;
          return (
            <button key={item.id} onClick={() => onNav(item.id)} title={item.label}
              aria-label={item.label}
              className="nav-btn"
              style={{
                width: 36, height: 36, borderRadius: 10,
                background: isActive ? "rgba(255,255,255,0.12)" : "transparent",
                color: isActive ? "#FFFFFF" : "rgba(220, 232, 236, 0.70)",
                border: `0.5px solid ${isActive ? "rgba(255,255,255,0.22)" : "transparent"}`,
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                outline: "none",
                textShadow: isActive ? "0 1px 4px rgba(0,0,0,0.5)" : "none",
              }}>
              {item.icon}
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: "auto" }}>
        <div style={{
          width: 26, height: 26, borderRadius: "50%",
          background: "rgba(255,255,255,0.08)",
          border: `0.5px solid ${C.hairlineStr}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 9, fontWeight: 600, color: "#FFFFFF", fontFamily: "var(--font-sans)",
          textShadow: "0 1px 3px rgba(0,0,0,0.6)",
        }}>AK</div>
      </div>
    </aside>
  );
}

// ─── Timer Arc ────────────────────────────────────────────────────────────────
function TimerArc({ progress, mode, isRunning, isDone }:
  { progress: number; mode: TimerMode; isRunning: boolean; isDone: boolean }) {

  const SZ = 290; const r = 115; const cx = SZ/2; const cy = SZ/2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - progress);
  const angle = progress * 2 * Math.PI;
  const dotX = cx + r * Math.cos(angle - Math.PI/2);
  const dotY = cy + r * Math.sin(angle - Math.PI/2);

  const gradId = mode === "focus" ? "tgF" : mode === "short" ? "tgS" : "tgL";
  const dotColor = mode === "focus" ? C.moonlight : mode === "short" ? C.silver : "rgba(175,148,158,0.88)";

  return (
    <svg width={SZ} height={SZ} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id="tgF" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#9EADB2" /><stop offset="100%" stopColor="#BAC8CC" />
        </linearGradient>
        <linearGradient id="tgS" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#BAC8CC" /><stop offset="100%" stopColor="rgba(186,200,204,0.42)" />
        </linearGradient>
        <linearGradient id="tgL" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(175,148,158,0.88)" /><stop offset="100%" stopColor="rgba(175,148,158,0.40)" />
        </linearGradient>
        <filter id="arcGlow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3.5" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="dotGlow" x="-200%" y="-200%" width="500%" height="500%">
          <feGaussianBlur stdDeviation="3.5" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      <circle cx={cx} cy={cy} r={r+17} fill="none" stroke="rgba(158,173,178,0.012)" strokeWidth={0.7} />
      <circle cx={cx} cy={cy} r={r+10} fill="none" stroke="rgba(158,173,178,0.020)" strokeWidth={0.7} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(215,228,230,0.06)" strokeWidth={4.5}
        transform={`rotate(-90 ${cx} ${cy})`} />
      <circle cx={cx} cy={cy} r={r-10} fill="none" stroke="rgba(158,173,178,0.016)" strokeWidth={0.6} />
      <circle cx={cx} cy={cy} r={r} fill="none"
        stroke={`url(#${gradId})`} strokeWidth={4.5}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round"
        filter={isRunning ? "url(#arcGlow)" : undefined}
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: "stroke-dashoffset 1s linear" }}
      />
      {progress > 0.03 && (
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke="rgba(235,240,241,0.12)" strokeWidth={1.8}
          strokeDasharray={`${circ*0.05} ${circ*0.95}`}
          strokeDashoffset={offset + circ*0.032}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          opacity={isRunning ? 0.46 : 0.14}
          style={{ transition: "stroke-dashoffset 1s linear, opacity 0.6s" }}
        />
      )}
      {progress > 0.02 && progress < 0.995 && (
        <circle cx={dotX} cy={dotY} r={3.4}
          fill={dotColor} filter="url(#dotGlow)"
          opacity={isRunning ? 0.78 : 0.26}
          style={{ transition: "opacity 0.6s" }}
        />
      )}
      {!isRunning && !isDone && (
        <circle cx={cx} cy={cy} r={r+17} fill="none"
          stroke="rgba(158,173,178,0.04)" strokeWidth={0.8}
          className="timer-pulse" />
      )}
      {isDone && (<>
        <circle cx={cx} cy={cy} r={r+12} fill="none"
          stroke="rgba(158,173,178,0.20)" strokeWidth={1.0}
          className="done-ripple-1" />
        <circle cx={cx} cy={cy} r={r+30} fill="none"
          stroke="rgba(186,200,204,0.09)" strokeWidth={0.7}
          className="done-ripple-2" />
      </>)}
    </svg>
  );
}

// ─── Timer Panel ──────────────────────────────────────────────────────────────
/** Plays the bundled offline completion chime. Non-fatal if it fails. */
function playCompletionSound() {
  try {
    const audio = new Audio("/audio/focus-complete.wav");
    void audio.play().catch(() => undefined);
  } catch { /* ignore */ }
}

/** Shows a desktop notification via the Web Notification API. */
function notifyCompletion(taskTitle: string) {
  try {
    if (typeof Notification === "undefined") return;
    const show = () => { try { new Notification("专注完成", { body: taskTitle }); } catch { /* ignore */ } };
    if (Notification.permission === "granted") show();
    else if (Notification.permission === "default") {
      void Notification.requestPermission().then(p => { if (p === "granted") show(); });
    }
  } catch { /* ignore */ }
}

function TimerPanel({ timer, tasks, onStart, onPause, onResume, onReset, onSwitchMode, onExpire }: {
  timer: TimerSnapshot | null;
  tasks: Task[];
  onStart: (mode: TimerMode, taskId: string | null) => void;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
  onSwitchMode: (mode: TimerMode) => void;
  onExpire: () => void;
}) {
  // Rust owns the timer; this component only renders its snapshot.
  const state = timer?.state ?? "idle";
  const mode  = timer?.mode ?? "focus";
  const total = timer?.durationSeconds ?? DEFAULT_SETTINGS.focusDurationMinutes * 60;

  const [selectedTask, setSelected] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Drift-free display tick: refresh `now` while running; remaining derives
  // from the authoritative targetEndAt, never from an incremented counter.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state !== "running") {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      return;
    }
    intervalRef.current = setInterval(() => setNow(Date.now()), 250);
    return () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } };
  }, [state]);

  const remaining = state === "running" && timer?.targetEndAt
    ? Math.max(0, Math.ceil((timer.targetEndAt - now) / 1000))
    : timer?.remainingSeconds ?? total;
  const progress = total > 0 ? remaining / total : 0;

  // Fire onExpire exactly once per session when the countdown reaches zero.
  const expiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (state === "running" && timer?.activeSessionId && timer.targetEndAt && timer.targetEndAt <= now) {
      if (expiredRef.current !== timer.activeSessionId) {
        expiredRef.current = timer.activeSessionId;
        onExpire();
      }
    }
    if (state === "idle") expiredRef.current = null;
  }, [state, timer, now, onExpire]);

  const handleStart = () => {
    if (state === "paused") onResume();
    else if (state === "idle" || state === "done") onStart(mode, selectedTask);
  };
  const handlePause = () => { if (state === "running") onPause(); };
  const handleReset = () => onReset();
  const switchMode  = (m: TimerMode) => onSwitchMode(m);

  const { m, s } = formatSeconds(remaining);
  const activeTasks = tasks.filter(t => !t.done);

  const statusText = () => {
    if (state === "done")    return "已完成";
    if (state === "idle")    return MODE_LABELS[mode];
    if (state === "running") return "专注中";
    return "已暂停";
  };

  const ctrlBtn: React.CSSProperties = {
    width: 42, height: 42, borderRadius: "50%",
    background: C.glassClear,
    backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
    border: `1px solid ${C.hairline}`,
    color: C.textMuted, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center", outline: "none",
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ position: "relative", zIndex: 2 }}>

      {/* Mode bar */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 22px" }}>
          {(["focus","short","long"] as TimerMode[]).map(md => (
            <button key={md} onClick={() => switchMode(md)} className="btn-mode"
              style={{
                fontFamily: "var(--font-sans)", fontSize: 12,
                fontWeight: mode === md ? 500 : 400,
                padding: "4px 13px", borderRadius: 20,
                border: `0.5px solid ${mode === md ? C.hairlineStr : "transparent"}`,
                background: mode === md ? "rgba(27,37,44,0.38)" : "transparent",
                color: mode === md ? C.moonlight : C.textMuted,
                cursor: "pointer", outline: "none",
              }}>
              {MODE_LABELS[md]}
            </button>
          ))}
          <div style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 10, color: C.textMuted, letterSpacing: "0.05em" }}>
            {timer?.taskTitleSnapshot ?? MODE_LABELS[mode]}
          </div>
        </div>
        <HorizonDivider />
      </div>

      {/* Arc + controls + task selector — centred in the main column */}
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", flex: 1,
        gap: 14, padding: "10px 22px 14px",
        minHeight: 0,
      }}>

        {/* Arc */}
        <div className="su-1 surface-up" style={{ position: "relative", width: 290, height: 290, flexShrink: 0 }}>
          <div style={{
            position: "absolute", width: 310, height: 310, top: -10, left: -10,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(14,22,30,0.14) 0%, transparent 65%)",
            filter: "blur(32px)", pointerEvents: "none",
          }} />
          <TimerArc progress={progress} mode={mode}
            isRunning={state === "running"} isDone={state === "done"} />
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: 5,
          }}>
            <div style={{
              position: "absolute", width: 188, height: 188, borderRadius: "50%",
              background: "radial-gradient(ellipse 55% 42% at 40% 34%, rgba(215,228,230,0.015) 0%, rgba(14,22,30,0.022) 55%, transparent 80%)",
              backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)",
              border: "0.5px solid rgba(215,228,230,0.036)",
              pointerEvents: "none",
            }} />
            <div style={{
              fontFamily: "var(--font-display)", fontVariantNumeric: "tabular-nums",
              fontSize: 60, fontWeight: 300, letterSpacing: "-0.026em", lineHeight: 1,
              color: state === "done" ? C.moonlight : C.textPrimary,
              transition: "color 0.5s",
              textShadow: state === "running" ? "0 0 28px rgba(158,173,178,0.10)" : "none",
              position: "relative", zIndex: 1,
            }}>
              {m}<span className={state === "running" ? "colon-blink" : ""}>:</span>{s}
            </div>
            <div style={{
              fontFamily: "var(--font-sans)", fontSize: 10, letterSpacing: "0.12em",
              color: state === "done" ? "rgba(186,200,204,0.58)" : C.textMuted,
              transition: "color 0.4s", position: "relative", zIndex: 1,
            }}>
              {statusText()}
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="su-2 surface-up" style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={handleReset}
            title={state === "running" || state === "paused" ? "结束本次（不计入统计）" : "重置"}
            aria-label={state === "running" || state === "paused" ? "结束本次（不计入统计）" : "重置计时"}
            className="btn-ctrl" style={ctrlBtn}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 7a5 5 0 1 0 1-3H1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              <path d="M1 4V7H4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {state === "running" ? (
            <button onClick={handlePause} aria-label="暂停计时" className="btn-main"
              style={{
                width: 68, height: 68, borderRadius: "50%",
                background: C.glassTint,
                backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
                border: `1px solid rgba(215,228,230,0.12)`,
                boxShadow: "inset 0 1px 0 rgba(215,228,230,0.07), 0 0 18px rgba(158,173,178,0.06), 0 4px 16px rgba(2,3,5,0.28)",
                color: C.moonlight, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", outline: "none",
              }}>
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                <rect x="4" y="3" width="3.5" height="12" rx="1.2" fill="currentColor" />
                <rect x="10.5" y="3" width="3.5" height="12" rx="1.2" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button onClick={handleStart} aria-label={state === "done" ? "重新开始专注" : "开始专注"} className="btn-main"
              style={{
                width: 68, height: 68, borderRadius: "50%",
                background: state === "done" ? "rgba(27,37,44,0.38)" : "rgba(158,173,178,0.06)",
                backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
                border: `1px solid rgba(215,228,230,0.12)`,
                boxShadow: "inset 0 1px 0 rgba(215,228,230,0.07), 0 0 22px rgba(158,173,178,0.08), 0 4px 16px rgba(2,3,5,0.28)",
                color: C.moonlight, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", outline: "none",
              }}>
              {state === "done" ? (
                <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                  <path d="M3 9a6 6 0 1 0 1.5-4H3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  <path d="M3 5V9H7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                  <path d="M6.5 4L14.5 9L6.5 14V4Z" fill="currentColor" />
                </svg>
              )}
            </button>
          )}

          <button title="切换模式" className="btn-ctrl"
            onClick={() => { const ms = ["focus","short","long"] as TimerMode[]; switchMode(ms[(ms.indexOf(mode)+1)%3]); }}
            style={ctrlBtn}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 7H11M8 4L11 7L8 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* Task selector */}
        <div className="su-3 surface-up" style={{ width: "min(76%, 520px)", minWidth: 280 }}>
          <HorizonDivider />
          <div style={{ paddingTop: 9 }}>
            <div style={{
              fontFamily: "var(--font-sans)", fontSize: 10,
              letterSpacing: "0.10em", color: C.textMuted, marginBottom: 7,
              textTransform: "uppercase",
            }}>当前任务</div>
            {activeTasks.length === 0 ? (
              <div style={{ padding: "9px 12px", ...CARD, color: C.textMuted, fontSize: 11, fontFamily: "var(--font-sans)", fontStyle: "italic" }}>
                暂无任务，前往任务面板添加
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 148, overflowY: "auto" }}>
                {activeTasks.map(task => {
                  const sel = selectedTask === task.id;
                  return (
                    <button key={task.id} onClick={() => setSelected(task.id)}
                      className="task-sel-item"
                      style={{
                        position: "relative", overflow: "hidden",
                        padding: "8px 12px",
                        ...CARD,
                        background: sel ? "rgba(27,37,44,0.40)" : C.cardDim,
                        border: `1px solid ${sel ? C.hairlineStr : C.hairline}`,
                        color: sel ? C.moonlight : C.textSec,
                        fontSize: 12, fontFamily: "var(--font-sans)",
                        textAlign: "left", cursor: "pointer", outline: "none",
                        display: "flex", alignItems: "center", gap: 7,
                      }}>
                      {sel && (
                        <div style={{
                          position: "absolute", left: 0, top: 0, bottom: 0, width: 2,
                          background: `linear-gradient(to bottom, transparent 0%, ${C.silver} 30%, ${C.moonlight} 55%, ${C.silver} 78%, transparent 100%)`,
                        }} />
                      )}
                      {sel && (
                        <svg width="5" height="5" viewBox="0 0 6 6" style={{ flexShrink: 0 }}>
                          <circle cx="3" cy="3" r="2.4" fill={C.silver} className="breathe" />
                        </svg>
                      )}
                      <span style={{ flex: 1, lineHeight: 1.4 }}>{task.title}</span>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: C.textMuted, flexShrink: 0 }}>×{task.pomodoroTarget}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tasks Panel ──────────────────────────────────────────────────────────────
function PriorityPip({ p }: { p: TaskPriority }) {
  const colors: Record<TaskPriority, string> = {
    high: "rgba(190,120,120,0.80)", med: "rgba(170,145,108,0.80)", low: "rgba(158,173,178,0.70)",
  };
  return <span style={{ width: 5, height: 5, borderRadius: "50%", background: colors[p], display: "inline-block", flexShrink: 0 }} />;
}

function TasksPanel({ tasks, onCreateTask, onToggleTask, onDeleteTask, onCyclePriority }: {
  tasks: Task[];
  onCreateTask: (title: string) => Promise<unknown>;
  onToggleTask: (id: string) => Promise<unknown>;
  onDeleteTask: (id: string) => Promise<unknown>;
  onCyclePriority: (id: string) => Promise<unknown>;
}) {

  const [newTitle, setNewTitle] = useState("");
  const [filter, setFilter]    = useState<"all"|"active"|"done">("all");

  const addTask = () => {
    const title = newTitle.trim(); if (!title) return;
    setNewTitle("");
    void onCreateTask(title);
  };
  const toggleTask    = (id: string) => { void onToggleTask(id); };
  const deleteTask    = (id: string) => { void onDeleteTask(id); };
  const cyclePriority = (id: string) => { void onCyclePriority(id); };

  const filtered = tasks.filter(t => filter==="all" ? true : filter==="active" ? !t.done : t.done);
  const fLabels = { all:"全部", active:"进行中", done:"已完成" } as const;

  return (
    <div className="flex flex-col h-full" style={{ position: "relative", zIndex: 2 }}>
      <div style={{ flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 22px" }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: C.textPrimary, fontFamily: "var(--font-sans)" }}>任务</span>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 10, color: C.textMuted,
            background: C.cardDim, border: `1px solid ${C.hairline}`,
            borderRadius: 5, padding: "2px 6px",
          }}>{tasks.filter(t=>!t.done).length}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 3 }}>
            {(["all","active","done"] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} className="btn-filter"
                style={{
                  fontFamily: "var(--font-sans)", fontSize: 11,
                  padding: "3px 9px", borderRadius: 6,
                  border: `0.5px solid ${filter===f ? C.hairlineStr : "transparent"}`,
                  background: filter===f ? "rgba(27,37,44,0.38)" : "transparent",
                  color: filter===f ? C.moonlight : C.textMuted,
                  cursor: "pointer", outline: "none",
                }}>{fLabels[f]}</button>
            ))}
          </div>
        </div>
        <HorizonDivider />
      </div>

      <div style={{ flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 7, padding: "9px 22px" }}>
          <input
            value={newTitle} onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => e.key==="Enter" && addTask()}
            placeholder="添加任务…" className="input-ocean"
            style={{ flex: 1, ...CARD, borderRadius: 10, padding: "8px 12px", fontSize: 12, color: C.textPrimary, fontFamily: "var(--font-sans)" }}
          />
          <button onClick={addTask} className="btn-add"
            style={{
              width: 34, height: 34, borderRadius: 9, flexShrink: 0,
              background: "rgba(27,37,44,0.36)",
              backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
              border: `1px solid ${C.hairlineStr}`,
              color: C.moonlight, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", outline: "none",
            }}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <path d="M7 2V12M2 7H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <HorizonDivider />
      </div>

      <div className="flex-1 overflow-y-auto" style={{ padding: "6px 22px" }}>
        {filtered.length === 0 ? (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100%", gap:8, opacity:0.24, paddingBottom:40 }}>
            <svg width="24" height="24" viewBox="0 0 30 30" fill="none">
              <rect x="3" y="7" width="24" height="2" rx="1" fill={C.silver} />
              <rect x="3" y="14" width="17" height="2" rx="1" fill={C.silver} />
              <rect x="3" y="21" width="11" height="2" rx="1" fill={C.silver} />
            </svg>
            <span style={{ fontSize:11, color:C.textSec, fontFamily:"var(--font-sans)" }}>
              {filter==="done" ? "尚无已完成任务" : "暂无任务"}
            </span>
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:5, paddingTop:7, paddingBottom:7 }}>
            {filtered.map(task => (
              <div key={task.id} className="slide-in task-item"
                style={{ display:"flex", alignItems:"center", gap:9, padding:"9px 12px", ...CARD }}>
                <button onClick={() => toggleTask(task.id)} className="btn-check"
                  aria-label={task.done ? "取消完成" : "标记完成"}
                  style={{
                    width:15, height:15, borderRadius:5, flexShrink:0,
                    border:`1.5px solid ${task.done ? C.silver : "rgba(215,228,230,0.14)"}`,
                    background: task.done ? "rgba(158,173,178,0.10)" : "transparent",
                    cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", outline:"none",
                  }}>
                  {task.done && (
                    <svg width="7" height="7" viewBox="0 0 9 9" fill="none">
                      <path d="M1.5 4.5L3.5 6.5L7.5 2.5" stroke={C.silver} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
                <button onClick={() => cyclePriority(task.id)}
                  aria-label="切换优先级"
                  style={{ background:"none", border:"none", cursor:"pointer", padding:0, display:"flex" }}>
                  <PriorityPip p={task.priority} />
                </button>
                <span style={{
                  flex:1, fontSize:12, fontFamily:"var(--font-sans)", lineHeight:1.4,
                  color: task.done ? "rgba(165,182,188,0.26)" : C.textSec,
                  textDecoration: task.done ? "line-through" : "none",
                  textDecorationColor: "rgba(165,182,188,0.26)",
                  transition: "all 0.22s",
                }}>{task.title}</span>
                <span style={{
                  fontFamily:"var(--font-sans)", fontSize:9, color:C.textMuted,
                  background:"rgba(27,37,44,0.26)", border:`1px solid ${C.hairline}`,
                  padding:"1px 5px", borderRadius:4, flexShrink:0,
                }}>{task.project}</span>
                <span style={{ fontFamily:"var(--font-mono)", fontSize:9, color:C.textMuted }}>×{task.pomodoroTarget}</span>
                <button onClick={() => deleteTask(task.id)} className="btn-delete"
                  aria-label="删除任务"
                  style={{
                    width:20, height:20, borderRadius:4, flexShrink:0,
                    background:"none", border:"1px solid transparent",
                    color:"rgba(215,228,230,0.14)", cursor:"pointer",
                    display:"flex", alignItems:"center", justifyContent:"center", outline:"none",
                  }}>
                  <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                    <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────────────────
function SettingsPanel({ settings, onSaveSettings, onDataChanged }: {
  settings: AppSettings | null;
  onSaveSettings: (settings: AppSettings) => Promise<unknown>;
  onDataChanged: () => void;
}) {
  const gateway = useAppGateway();
  const [draft, setDraft] = useState<AppSettings | null>(settings);
  const [saving, setSaving] = useState(false);

  // Sync from the latest persisted settings when they change externally.
  useEffect(() => { setDraft(settings); }, [settings]);

  // Persist whenever the draft diverges from the persisted copy.
  const persist = useCallback(async (next: AppSettings) => {
    setSaving(true);
    try {
      await onSaveSettings(next);
    } finally {
      setSaving(false);
    }
  }, [onSaveSettings]);

  const update = useCallback((patch: Partial<AppSettings>) => {
    setDraft(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      void persist(next);
      return next;
    });
  }, [persist]);

  // Launch-at-login lives in the autostart plugin / OS registry, not in our
  // SQLite `settings` table, so it is tracked with its own local state.
  const [launchAtLogin, setLaunchAtLogin] = useState<boolean | null>(null);
  useEffect(() => {
    gateway.getAutostart()
      .then(setLaunchAtLogin)
      .catch(() => setLaunchAtLogin(false));
  }, [gateway]);

  const toggleLaunchAtLogin = useCallback((next: boolean) => {
    setLaunchAtLogin(next);
    gateway.setAutostart(next).then(setLaunchAtLogin).catch(() => undefined);
  }, [gateway]);

  // ─── Data export & backup (Item 3) ──────────────────────────────────────────
  const [busy, setBusy] = useState<null | 'backup' | 'csv' | 'import'>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [pendingImportPath, setPendingImportPath] = useState<string | null>(null);

  const errText = (e: unknown) =>
    e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : '操作失败';

  const suggestedBackupName = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    return `abyssal-reverie-backup-${stamp}.json`;
  };

  const handleExportBackup = useCallback(async () => {
    setBusy('backup');
    setStatus(null);
    try {
      const path = await gateway.pickExportPath(suggestedBackupName());
      if (!path) { setBusy(null); return; }
      const summary = await gateway.exportBackup(path);
      setStatus({ ok: true, text: `已导出备份（${summary.tasks} 个任务、${summary.sessions} 条会话，${(summary.bytes / 1024).toFixed(1)} KB）` });
    } catch (e) {
      setStatus({ ok: false, text: errText(e) });
    } finally {
      setBusy(null);
    }
  }, [gateway]);

  const handleExportCsv = useCallback(async () => {
    setBusy('csv');
    setStatus(null);
    try {
      const path = await gateway.pickExportPath('abyssal-reverie-sessions.csv');
      if (!path) { setBusy(null); return; }
      const summary = await gateway.exportSessionsCsv(path);
      setStatus({ ok: true, text: `已导出会话 CSV（${summary.sessions} 条记录）` });
    } catch (e) {
      setStatus({ ok: false, text: errText(e) });
    } finally {
      setBusy(null);
    }
  }, [gateway]);

  const handlePickImport = useCallback(async () => {
    setBusy('import');
    setStatus(null);
    try {
      const path = await gateway.pickImportPath();
      if (!path) { setBusy(null); return; }
      const preview = await gateway.previewImport(path);
      setPendingImportPath(path);
      setImportPreview(preview);
    } catch (e) {
      setStatus({ ok: false, text: errText(e) });
    } finally {
      setBusy(null);
    }
  }, [gateway]);

  const confirmImport = useCallback(async () => {
    if (!pendingImportPath) return;
    const path = pendingImportPath;
    setImportPreview(null);
    setPendingImportPath(null);
    setBusy('import');
    try {
      const summary = await gateway.importBackup(path);
      setStatus({ ok: true, text: `已导入（${summary.tasks} 个任务、${summary.sessions} 条会话），当前数据已覆盖` });
      onDataChanged();
    } catch (e) {
      setStatus({ ok: false, text: errText(e) });
    } finally {
      setBusy(null);
    }
  }, [pendingImportPath, gateway, onDataChanged]);

  const cancelImport = useCallback(() => {
    setImportPreview(null);
    setPendingImportPath(null);
  }, []);

  const Toggle = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
    <button onClick={() => onChange(!value)} className="btn-toggle"
      role="switch" aria-checked={value}
      style={{
        width:34, height:19, borderRadius:10, flexShrink:0,
        background: value ? "rgba(27,37,44,0.50)" : "rgba(8,13,18,0.24)",
        border:`1px solid ${value ? C.hairlineStr : C.hairline}`,
        position:"relative", cursor:"pointer", outline:"none",
      }}>
      <span style={{
        position:"absolute", top:3, left: value ? 16 : 3,
        width:11, height:11, borderRadius:"50%",
        background: value ? C.silver : "rgba(215,228,230,0.18)",
        transition:"all 0.24s cubic-bezier(0.22,1,0.36,1)",
      }} />
    </button>
  );

  const Stepper = ({ value, onChange, min, max }:
    { value: number; onChange: (v: number) => void; min: number; max: number }) => (
    <div style={{ display:"flex", alignItems:"center", gap:5 }}>
      <button onClick={() => onChange(Math.max(min, value-1))} className="btn-number"
        style={{
          width:24, height:24, borderRadius:6,
          background:C.cardDim, border:`1px solid ${C.hairline}`,
          color:C.textSec, cursor:"pointer", fontSize:13,
          display:"flex", alignItems:"center", justifyContent:"center", outline:"none",
        }}>–</button>
      <span style={{ width:30, textAlign:"center", fontFamily:"var(--font-mono)", fontSize:12, fontVariantNumeric:"tabular-nums", color:C.textPrimary }}>{value}</span>
      <button onClick={() => onChange(Math.min(max, value+1))} className="btn-number"
        style={{
          width:24, height:24, borderRadius:6,
          background:C.cardDim, border:`1px solid ${C.hairline}`,
          color:C.textSec, cursor:"pointer", fontSize:13,
          display:"flex", alignItems:"center", justifyContent:"center", outline:"none",
        }}>+</button>
    </div>
  );

  const Section = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div style={{ marginBottom:9 }}>
      <div style={{ fontFamily:"var(--font-sans)", fontSize:9, letterSpacing:"0.13em", color:"rgba(165,182,188,0.40)", padding:"12px 0 6px", textTransform:"uppercase" }}>{label}</div>
      <div style={{ ...CARD, overflow:"hidden" }}>{children}</div>
    </div>
  );

  const Row = ({ label, hint, last, children }: { label:string; hint?:string; last?:boolean; children:React.ReactNode }) => (
    <div style={{
      display:"flex", alignItems:"center", padding:"11px 13px",
      borderBottom: last ? "none" : `0.5px solid rgba(215,228,230,0.05)`,
    }}>
      <div style={{ flex:1 }}>
        <div style={{ fontSize:12, color:C.textSec, fontFamily:"var(--font-sans)" }}>{label}</div>
        {hint && <div style={{ fontSize:10, color:C.textMuted, marginTop:2, fontFamily:"var(--font-sans)" }}>{hint}</div>}
      </div>
      {children}
    </div>
  );

  const ActionButton = ({ label, onClick, disabled, danger }: {
    label: string; onClick: () => void; disabled?: boolean; danger?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled} className="btn-action"
      style={{
        padding:"5px 14px", borderRadius:7, fontSize:11, fontFamily:"var(--font-sans)",
        cursor: disabled ? "default" : "pointer", outline:"none",
        color: danger ? "rgba(231,138,138,0.95)" : C.textPrimary,
        background: danger ? "rgba(231,138,138,0.10)" : C.cardDim,
        border:`1px solid ${danger ? "rgba(231,138,138,0.30)" : C.hairline}`,
        opacity: disabled ? 0.45 : 1,
      }}>{label}</button>
  );

  if (!draft) {
    return (
      <div className="flex flex-col h-full" style={{ position:"relative", zIndex:2 }}>
        <div style={{ flexShrink:0 }}>
          <div style={{ padding:"10px 22px" }}>
            <span style={{ fontSize:13, fontWeight:500, color:C.textPrimary, fontFamily:"var(--font-sans)" }}>设置</span>
          </div>
          <HorizonDivider />
        </div>
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <span style={{ fontSize:11, color:C.textMuted }}>加载中…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ position:"relative", zIndex:2 }}>
      <div style={{ flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", padding:"10px 22px" }}>
          <span style={{ fontSize:13, fontWeight:500, color:C.textPrimary, fontFamily:"var(--font-sans)" }}>设置</span>
          {saving && <span style={{ marginLeft:"auto", fontSize:10, color:C.textMuted, fontFamily:"var(--font-sans)" }}>保存中…</span>}
        </div>
        <HorizonDivider />
      </div>
      <div className="flex-1 overflow-y-auto" style={{ padding:"4px 22px" }}>
        <Section label="时长（分钟）">
          <Row label="专注"><Stepper value={draft.focusDurationMinutes} onChange={v => update({ focusDurationMinutes: v })} min={1} max={180} /></Row>
          <Row label="短休"><Stepper value={draft.shortBreakMinutes} onChange={v => update({ shortBreakMinutes: v })} min={1} max={180} /></Row>
          <Row label="长休" last><Stepper value={draft.longBreakMinutes} onChange={v => update({ longBreakMinutes: v })} min={1} max={180} /></Row>
        </Section>
        <Section label="行为">
          <Row label="自动开始休息" hint="专注结束后自动继续"><Toggle value={draft.autoStartBreak} onChange={v => update({ autoStartBreak: v })} /></Row>
          <Row label="声音提示"><Toggle value={draft.soundEnabled} onChange={v => update({ soundEnabled: v })} /></Row>
          <Row label="桌面通知" last><Toggle value={draft.notificationEnabled} onChange={v => update({ notificationEnabled: v })} /></Row>
        </Section>
        <Section label="目标">
          <Row label="每日专注次数" last><Stepper value={draft.dailyGoal} onChange={v => update({ dailyGoal: v })} min={1} max={50} /></Row>
        </Section>
        <Section label="系统">
          <Row label="开机自动启动" hint="登录 Windows 后于后台自动运行"><Toggle value={launchAtLogin ?? false} onChange={toggleLaunchAtLogin} /></Row>
          <Row label="全局快捷键" hint="Ctrl + Alt + 空格：开始 / 暂停（窗口隐藏时也能用）" last><span style={{ fontFamily:"var(--font-mono)", fontSize:10, color:C.textMuted }}>Ctrl+Alt+Space</span></Row>
        </Section>
        <Section label="数据">
          <Row label="导出备份" hint="保存全部任务、会话与设置为 JSON 文件">
            <ActionButton label={busy === 'backup' ? '导出中…' : '导出'} onClick={handleExportBackup} disabled={busy !== null} />
          </Row>
          <Row label="导出会话" hint="导出全部专注 / 休息记录为 CSV 表格">
            <ActionButton label={busy === 'csv' ? '导出中…' : '导出'} onClick={handleExportCsv} disabled={busy !== null} />
          </Row>
          <Row label="导入备份" hint="从 JSON 备份恢复，将覆盖当前数据" last>
            <ActionButton label={busy === 'import' ? '读取中…' : '导入'} onClick={handlePickImport} disabled={busy !== null} />
          </Row>
          {status && (
            <div style={{
              padding:"9px 13px", fontSize:10, lineHeight:1.5,
              color: status.ok ? "rgba(126,200,180,0.92)" : "rgba(231,138,138,0.95)",
              fontFamily:"var(--font-sans)",
            }}>{status.text}</div>
          )}
        </Section>
        <div style={{ ...CARD, borderRadius:12, padding:"11px 13px", marginBottom:20 }}>
          <div style={{ fontSize:9, color:"rgba(165,182,188,0.34)", marginBottom:4, fontFamily:"var(--font-sans)", letterSpacing:"0.10em", textTransform:"uppercase" }}>关于</div>
          <div style={{ fontSize:12, color:C.textSec, fontFamily:"var(--font-sans)" }}>深海专注 · 桌面计时器</div>
          <div style={{ fontSize:10, color:C.textMuted, marginTop:2, fontFamily:"var(--font-mono)", letterSpacing:"0.04em" }}>v1.0.0 · 2026</div>
        </div>
      </div>
      {importPreview && (
        <div
          onClick={cancelImport}
          style={{
            position:"fixed", inset:0, zIndex:50,
            background:"rgba(4,8,12,0.55)",
            display:"flex", alignItems:"center", justifyContent:"center",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ ...CARD, width:300, padding:16, borderRadius:14 }}
          >
            <div style={{ fontSize:13, color:C.textPrimary, fontFamily:"var(--font-sans)", marginBottom:8 }}>确认导入备份？</div>
            <div style={{ fontSize:11, color:C.textSec, fontFamily:"var(--font-sans)", lineHeight:1.7, marginBottom:14 }}>
              将导入 <b style={{ color:C.textPrimary }}>{importPreview.tasks}</b> 个任务、<b style={{ color:C.textPrimary }}>{importPreview.sessions}</b> 条会话，<br />
              并<b style={{ color:"rgba(231,138,138,0.95)" }}>覆盖当前所有数据</b>（不可撤销）。
            </div>
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <ActionButton label="取消" onClick={cancelImport} />
              <ActionButton label="确认导入" onClick={confirmImport} disabled={busy !== null} danger />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Stats Sidebar — transparent frosted glass, content flat on surface ───────
function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div style={{ flex:1, height:2, background:"rgba(215,228,230,0.06)", borderRadius:2, overflow:"hidden" }}>
      <div style={{ width:`${Math.round((value/max)*100)}%`, height:"100%", background:color, borderRadius:2, transition:"width 0.8s cubic-bezier(0.22,1,0.36,1)" }} />
    </div>
  );
}

function StatsPanel({ logs, sessionCount, stats }:
  { logs: SessionLog[]; sessionCount: number; stats: Statistics | null }) {

  // "时长" counts completed focus sessions only (breaks/abandoned excluded).
  const todayMinutes = logs.filter(isCountedFocus).reduce((s,l) => s+l.duration, 0);
  const dailyGoal    = stats?.dailyGoal ?? DEFAULT_SETTINGS.dailyGoal;
  const goalProgress = Math.min(1, sessionCount/dailyGoal);

  // Real per-day data from the statistics query, aligned Mon..Sun.
  const weekDays = weekBoundaries();
  const dayLabel = ["一","二","三","四","五","六","日"];
  const weekData = weekDays.map((b, i) => {
    const byDay = stats?.byDay.find(d => d.date === b.date);
    return { day: dayLabel[i], sessions: byDay?.sessions ?? 0 };
  });
  const maxBar = Math.max(1, ...weekData.map(d => d.sessions));

  // Real per-project aggregation, descending by focus seconds.
  const projects = (stats?.byProject ?? [])
    .slice()
    .sort((a, b) => b.focusSeconds - a.focusSeconds);
  const maxProject = Math.max(1, ...projects.map(p => p.sessions));

  return (
    <aside className="right-panel" style={{
      // Width: clamp(240px, 18vw, 320px)
      position: "relative", zIndex: 2,
      ...SIDEBAR_GLASS,
      borderLeft: `1px solid ${C.hairline}`,
      boxShadow: "inset 1px 0 0 rgba(255,255,255,0.025), -12px 0 36px rgba(0,0,0,0.12)",
      overflowY: "auto",
      display: "flex", flexDirection: "column",
    }}>

      <div style={{ flexShrink: 0 }}>
        <div style={{ padding:"11px 16px 8px" }}>
          <div style={{ fontSize:12, fontWeight:600, color:"#FFFFFF", fontFamily:"var(--font-sans)", textShadow:"0 1px 4px rgba(0,0,0,0.5)" }}>今日概览</div>
          <div style={{ fontFamily:"var(--font-mono)", fontSize:9, color:C.textMuted, marginTop:2, letterSpacing:"0.03em" }}>{chineseDate()}</div>
        </div>
        <HorizonDivider />
      </div>

      {/* Metrics — directly on glass, no card */}
      <div style={{ padding:"9px 16px", display:"flex", alignItems:"center", gap:10 }}>
        <GoalRing progress={goalProgress} size={36} />
        <div>
          <div style={{ fontFamily:"var(--font-sans)", fontSize:9, color:C.textMuted, letterSpacing:"0.10em", textTransform:"uppercase", marginBottom:3 }}>专注</div>
          <div style={{ display:"flex", alignItems:"baseline", gap:3 }}>
            <span style={{ fontFamily:"var(--font-display)", fontVariantNumeric:"tabular-nums", fontSize:22, fontWeight:400, color:"#FFFFFF", lineHeight:1, textShadow:"0 1px 6px rgba(0,0,0,0.5)" }}>{sessionCount}</span>
            <span style={{ fontFamily:"var(--font-mono)", fontSize:9, color:C.textMuted }}>/ {dailyGoal}</span>
          </div>
        </div>
        <div style={{ marginLeft:"auto" }}>
          <div style={{ fontFamily:"var(--font-sans)", fontSize:9, color:C.textMuted, letterSpacing:"0.10em", textTransform:"uppercase", marginBottom:3 }}>时长</div>
          <div style={{ display:"flex", alignItems:"baseline", gap:2 }}>
            <span style={{ fontFamily:"var(--font-display)", fontVariantNumeric:"tabular-nums", fontSize:22, fontWeight:400, color:"#FFFFFF", lineHeight:1, textShadow:"0 1px 6px rgba(0,0,0,0.5)" }}>{todayMinutes}</span>
            <span style={{ fontFamily:"var(--font-mono)", fontSize:9, color:C.textMuted }}>m</span>
          </div>
        </div>
      </div>
      <HorizonDivider />

      {/* Week bars */}
      <div style={{ padding:"9px 16px" }}>
        <div style={{ fontFamily:"var(--font-sans)", fontSize:9, color:C.textMuted, letterSpacing:"0.10em", textTransform:"uppercase", marginBottom:8 }}>本周</div>
        <div style={{ display:"flex", gap:3, alignItems:"flex-end", height:44 }}>
          {weekData.map((d, i) => {
            const isToday = i===(new Date().getDay()+6)%7;
            const h = Math.max(3, Math.round((d.sessions/maxBar)*36));
            return (
              <div key={d.day} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2, flex:1 }}>
                <div style={{
                  width:"60%", height:h,
                  background: isToday
                    ? `linear-gradient(to top, rgba(226,239,239,0.85), rgba(255,255,255,0.95))`
                    : "rgba(215,228,230,0.18)",
                  borderRadius:2,
                  boxShadow: isToday ? "0 0 8px rgba(255,255,255,0.3)" : "none",
                }} />
                <span style={{ fontFamily:"var(--font-sans)", fontSize:9, fontWeight: isToday ? 600 : 400, color: isToday ? "#FFFFFF" : C.textMuted }}>{d.day}</span>
              </div>
            );
          })}
        </div>
      </div>
      <HorizonDivider />

      {/* Project bars */}
      <div style={{ padding:"9px 16px" }}>
        <div style={{ fontFamily:"var(--font-sans)", fontSize:9, color:C.textMuted, letterSpacing:"0.10em", textTransform:"uppercase", marginBottom:8 }}>项目</div>
        {(projects.length === 0 ? (
          <div style={{ fontSize:11, color:C.textMuted, fontStyle:"italic", fontFamily:"var(--font-sans)" }}>暂无项目数据</div>
        ) : projects.map((p, idx) => {
          const colors = ["rgba(226,239,239,0.85)","rgba(195,212,218,0.75)","rgba(185,160,170,0.75)","rgba(215,228,230,0.45)"];
          return (
          <div key={p.project} style={{ display:"flex", alignItems:"center", gap:7, marginBottom:6 }}>
            <span style={{ fontFamily:"var(--font-sans)", fontSize:9, color:C.textMuted, width:24, flexShrink:0 }}>{p.project}</span>
            <MiniBar value={p.sessions} max={maxProject} color={colors[idx % colors.length]} />
            <span style={{ fontFamily:"var(--font-mono)", fontSize:9, color:C.textMuted, width:10, textAlign:"right", flexShrink:0 }}>{p.sessions}</span>
          </div>
          );
        }))}
      </div>
      <HorizonDivider />

      {/* Session log — 航线 nautical route */}
      <div style={{ padding:"9px 16px", flex:1 }}>
        <div style={{ fontFamily:"var(--font-sans)", fontSize:9, color:C.textMuted, letterSpacing:"0.10em", textTransform:"uppercase", marginBottom:10 }}>专注航线</div>
        {logs.length === 0 ? (
          <div style={{ fontSize:11, color:C.textMuted, fontStyle:"italic", fontFamily:"var(--font-sans)" }}>今日尚无记录</div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column" }}>
            {logs.slice().reverse().map((log, idx, arr) => {
              const isLast  = idx === arr.length-1;
              const isFresh = idx === 0;
              return (
                <div key={log.id} style={{ display:"flex", gap:9, alignItems:"flex-start" }}>
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0, width:11 }}>
                    <div style={{ position:"relative", flexShrink:0, marginTop:2 }}>
                      {isFresh && <div style={{ position:"absolute", inset:-3, borderRadius:"50%", border:"0.5px solid rgba(255,255,255,0.4)" }} />}
                      <div style={{ width: isFresh ? 7 : 4, height: isFresh ? 7 : 4, borderRadius:"50%", background: isFresh ? "#FFFFFF" : "rgba(215,228,230,0.40)" }} />
                    </div>
                    {!isLast && (
                      <div style={{
                        width:1, flex:1, minHeight:14, margin:"3px 0",
                        background:"linear-gradient(to bottom, rgba(215,228,230,0.30) 0%, rgba(215,228,230,0.08) 100%)",
                        maskImage:"repeating-linear-gradient(to bottom, black 0px, black 3px, transparent 3px, transparent 6px)",
                        WebkitMaskImage:"repeating-linear-gradient(to bottom, black 0px, black 3px, transparent 3px, transparent 6px)",
                      }} />
                    )}
                  </div>
                  <div style={{ paddingBottom: isLast ? 0 : 10, flex:1 }}>
                    <div style={{ display:"flex", gap:4, alignItems:"center", marginBottom:2 }}>
                      <span style={{ fontFamily:"var(--font-mono)", fontSize:9, color: isFresh ? "rgba(240,246,248,0.90)" : "rgba(195,212,218,0.55)" }}>{log.time}</span>
                      <span style={{
                        fontFamily:"var(--font-mono)", fontSize:8, color:C.textMuted,
                        background:"rgba(8,13,18,0.35)", borderRadius:3,
                        padding:"1px 4px", border:`1px solid ${C.hairlineStr}`,
                      }}>{log.duration}m</span>
                      {log.status === "abandoned" && (
                        <span style={{
                          fontFamily:"var(--font-sans)", fontSize:8, color:"rgba(195,212,218,0.55)",
                          background:"rgba(8,13,18,0.35)", borderRadius:3,
                          padding:"1px 4px", border:`1px solid ${C.hairline}`,
                        }}>已中止 · 不计入</span>
                      )}
                      {log.mode !== "focus" && log.status === "completed" && (
                        <span style={{
                          fontFamily:"var(--font-sans)", fontSize:8, color:C.textMuted,
                          background:"rgba(8,13,18,0.35)", borderRadius:3,
                          padding:"1px 4px", border:`1px solid ${C.hairline}`,
                        }}>休息</span>
                      )}
                    </div>
                    <span style={{ fontSize:10, fontFamily:"var(--font-sans)", lineHeight:1.4, color: isFresh ? "#FFFFFF" : "rgba(220,232,236,0.65)" }}>{log.task}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

// ─── Week Line Chart ──────────────────────────────────────────────────────────
function WeekLineChart({ data, todayIdx }: { data: Array<{ day: string; sessions: number }>; todayIdx: number }) {
  const svgW = 220, svgH = 60, padX = 8, padTop = 5, padBottom = 7;
  const chartW = svgW - 2*padX;
  const chartH = svgH - padTop - padBottom;
  const maxV = Math.max(1, ...data.map(d => d.sessions));

  const pts = data.map((d, i) => ({
    x: padX + (i/(data.length-1))*chartW,
    y: padTop + chartH - (d.sessions/maxV)*chartH,
  }));

  const line = catmullRomPath(pts);
  const area = `${line} L ${pts[pts.length-1].x.toFixed(2)},${(svgH-padBottom).toFixed(2)} L ${pts[0].x.toFixed(2)},${(svgH-padBottom).toFixed(2)} Z`;

  return (
    <div>
      <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width:"100%", height:60, overflow:"visible" }}>
        <defs>
          <linearGradient id="wkAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#9EADB2" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#9EADB2" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#wkAreaGrad)" />
        <path d={line} fill="none" stroke="rgba(158,173,178,0.36)" strokeWidth="1"
          strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y}
            r={i===todayIdx ? 2.5 : 1.3}
            fill={i===todayIdx ? C.silver : "rgba(158,173,178,0.28)"}
            stroke={i===todayIdx ? "rgba(158,173,178,0.18)" : "none"}
            strokeWidth="1.5"
          />
        ))}
        {todayIdx >= 0 && (
          <text x={pts[todayIdx].x} y={pts[todayIdx].y-4} textAnchor="middle"
            style={{ fontSize:6.5, fill:C.silver, fontFamily:"var(--font-mono)" }}>
            {data[todayIdx].sessions}
          </text>
        )}
      </svg>
      <div style={{ display:"flex", marginTop:3 }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex:1, textAlign:"center", fontFamily:"var(--font-sans)", fontSize:9, color: i===todayIdx ? C.silver : C.textMuted }}>{d.day}</div>
        ))}
      </div>
    </div>
  );
}

// ─── Stats Full Page ──────────────────────────────────────────────────────────
function StatsPage({ logs, sessionCount, stats }:
  { logs: SessionLog[]; sessionCount: number; stats: Statistics | null }) {

  const todayIdx = (new Date().getDay()+6)%7;

  const dayLabel = ["一","二","三","四","五","六","日"];
  const weekDays = weekBoundaries();
  const weekData = weekDays.map((b, i) => {
    const byDay = stats?.byDay.find(d => d.date === b.date);
    return { day: dayLabel[i], sessions: byDay?.sessions ?? 0 };
  });

  const dayName = ["周日","周一","周二","周三","周四","周五","周六"];
  const bestDayLabel = stats?.bestDay
    ? (() => {
        const b = weekDays.find(d => d.date === stats.bestDay);
        if (!b) return stats.bestDay;
        const idx = new Date(b.from).getDay();
        return dayName[idx];
      })()
    : "—";

  return (
    <div className="flex flex-col h-full" style={{ overflowY:"auto", position:"relative", zIndex:2 }}>
      <div style={{ flexShrink:0 }}>
        <div style={{ padding:"10px 22px" }}>
          <span style={{ fontSize:13, fontWeight:500, color:C.textPrimary, fontFamily:"var(--font-sans)" }}>统计</span>
        </div>
        <HorizonDivider />
      </div>

      <div style={{ padding:"14px 22px 0", display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(130px, 1fr))", gap:9 }}>
        {[
          { label:"今日专注", value:sessionCount, unit:"次",  accent:true },
          { label:"本周专注", value:stats?.focusSessionCount ?? 0, unit:"次",  accent:false },
          { label:"连续天数", value:stats?.streakDays ?? 0, unit:"天",  accent:false },
          { label:"最佳单日", value:bestDayLabel, unit:"",    accent:false },
        ].map(stat => (
          <div key={stat.label} style={{ padding:"12px 13px", ...CARD, background: stat.accent ? C.cardBright : C.card }}>
            <div style={{ fontFamily:"var(--font-sans)", fontSize:9, color:C.textMuted, letterSpacing:"0.10em", textTransform:"uppercase", marginBottom:7 }}>{stat.label}</div>
            <div style={{ fontFamily:"var(--font-display)", fontVariantNumeric:"tabular-nums", fontSize:22, fontWeight:300, color: stat.accent ? C.moonlight : C.textPrimary, lineHeight:1 }}>{stat.value}</div>
            {stat.unit && <div style={{ fontFamily:"var(--font-sans)", fontSize:9, color:C.textMuted, marginTop:3 }}>{stat.unit}</div>}
          </div>
        ))}
      </div>

      <div style={{ padding:"10px 22px" }}>
        <div style={{ padding:"14px 16px", ...CARD }}>
          <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:12 }}>
            <div style={{ fontFamily:"var(--font-sans)", fontSize:9, color:C.textMuted, letterSpacing:"0.10em", textTransform:"uppercase" }}>本周每日专注</div>
            <div style={{ fontFamily:"var(--font-mono)", fontSize:9, color:C.textMuted }}>均 {(weekData.reduce((a,d)=>a+d.sessions,0)/7).toFixed(1)} 次/天</div>
          </div>
          <WeekLineChart data={weekData} todayIdx={todayIdx} />
        </div>
      </div>

      <div style={{ padding:"0 22px 22px" }}>
        <div style={{ padding:"14px 16px", ...CARD }}>
          <div style={{ fontFamily:"var(--font-sans)", fontSize:9, color:C.textMuted, letterSpacing:"0.10em", textTransform:"uppercase", marginBottom:11 }}>专注记录</div>
          {logs.length === 0 ? (
            <div style={{ fontSize:11, color:C.textMuted, fontStyle:"italic", fontFamily:"var(--font-sans)", padding:"4px 0" }}>完成一次专注后将显示在此</div>
          ) : (
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr>
                  {["时间","任务","时长","状态"].map(h => (
                    <th key={h} style={{ fontFamily:"var(--font-sans)", fontSize:9, color:C.textMuted, letterSpacing:"0.08em", textTransform:"uppercase", textAlign:"left", padding:"0 0 7px", fontWeight:400, borderBottom:`0.5px solid ${C.hairline}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id}>
                    <td style={{ padding:"7px 0", fontFamily:"var(--font-mono)", fontSize:10, color:"rgba(158,173,178,0.62)", borderBottom:`0.5px solid ${C.hairline}` }}>{log.time}</td>
                    <td style={{ padding:"7px 0", fontSize:11, color:C.textSec, fontFamily:"var(--font-sans)", borderBottom:`0.5px solid ${C.hairline}` }}>{log.task}</td>
                    <td style={{ padding:"7px 0", fontFamily:"var(--font-mono)", fontSize:10, color:C.textMuted, borderBottom:`0.5px solid ${C.hairline}` }}>{log.duration}m</td>
                    <td style={{ padding:"7px 0", fontFamily:"var(--font-sans)", fontSize:10, borderBottom:`0.5px solid ${C.hairline}`, color: log.status === "abandoned" ? "rgba(195,212,218,0.45)" : C.textMuted }}>
                      {log.status === "abandoned" ? "已中止 · 不计入" : log.mode === "focus" ? "已完成" : "休息 · 不计入"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────
export default function App() {
  const gateway = useAppGateway();
  const [nav, setNav]     = useState<NavSection>("timer");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs]   = useState<SessionLog[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [weekStats, setWeekStats] = useState<Statistics | null>(null);
  const [timer, setTimer] = useState<TimerSnapshot | null>(null);

  // Ref mirrors so async callbacks always see the latest snapshot without
  // becoming stale closures.
  const timerRef = useRef<TimerSnapshot | null>(null);
  const settingsRef = useRef<AppSettings | null>(null);
  useEffect(() => { timerRef.current = timer; }, [timer]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const activeSettings = settings ?? DEFAULT_SETTINGS;
  const durations = useCallback((mode: TimerMode) => durationSecondsForMode(mode, activeSettings), [activeSettings]);

  const applyTimer = useCallback((snapshot: TimerSnapshot) => {
    timerRef.current = snapshot;
    setTimer(snapshot);
  }, []);

  // Full resync after an unexpected gateway failure (e.g. CONFLICT).
  const resync = useCallback(() => {
    gateway.bootstrap()
      .then(payload => {
        setTasks(payload.tasks);
        setLogs(payload.sessions.map(sessionToLog));
        setSettings(payload.settings);
        applyTimer(payload.timer);
      })
      .catch(() => undefined);
  }, [gateway, applyTimer]);

  const refreshStats = useCallback(() => {
    const { from, to } = weekRange();
    gateway.getStatistics({ from, to, days: weekBoundaries() })
      .then(stats => { setWeekStats(stats); })
      .catch(() => undefined);
  }, [gateway]);

  const runStart = useCallback(async (snapshot: TimerSnapshot, mode: TimerMode, taskId: string | null) => {
    const next = await gateway.startTimer({ mode, selectedTaskId: taskId, expectedRevision: snapshot.revision });
    applyTimer(next);
  }, [gateway, applyTimer]);

  const runComplete = useCallback(async (snapshot: TimerSnapshot, recovery: boolean) => {
    if (!snapshot.activeSessionId) return;
    const result = await gateway.completeTimer({
      activeSessionId: snapshot.activeSessionId,
      expectedRevision: snapshot.revision,
      recovery,
    });
    applyTimer(result.timer);
    setLogs(p => [...p, sessionToLog(result.session)]);

    if (result.newlyCompleted && !recovery) {
      const s = settingsRef.current;
      if (s?.soundEnabled) playCompletionSound();
      if (s?.notificationEnabled) notifyCompletion(result.session.taskTitleSnapshot);
      // Auto-break per spec 4.2: only on a genuinely new focus completion.
      if (s?.autoStartBreak && result.session.mode === "focus") {
        void runStart(result.timer, "short", null).catch(() => undefined);
      }
    }
  }, [gateway, applyTimer, runStart]);

  const handleExpire = useCallback(() => {
    const cur = timerRef.current;
    if (!cur) return;
    runComplete(cur, false).catch(resync);
    refreshStats();
  }, [runComplete, resync, refreshStats]);

  const handleStart = useCallback((mode: TimerMode, taskId: string | null) => {
    const cur = timerRef.current;
    if (!cur) return;
    runStart(cur, mode, taskId).catch(resync);
  }, [runStart, resync]);

  const runRevisionAction = useCallback(async (
    action: "pause" | "resume" | "reset",
  ) => {
    const cur = timerRef.current;
    if (!cur) return;
    if (action === "pause")   applyTimer(await gateway.pauseTimer({ expectedRevision: cur.revision }));
    if (action === "resume")  applyTimer(await gateway.resumeTimer({ expectedRevision: cur.revision }));
    if (action === "reset")   applyTimer(await gateway.resetTimer({ expectedRevision: cur.revision }));
  }, [gateway, applyTimer]);

  // Refresh the activity list from persisted sessions (used after reset and
  // mode switches, both of which write sessions server-side).
  const resyncLogs = useCallback(() => {
    gateway.listSessions({ limit: 50 })
      .then(sessions => { setLogs(sessions.map(sessionToLog)); })
      .catch(() => undefined);
  }, [gateway]);

  const handlePause = useCallback(() => { runRevisionAction("pause").catch(resync); }, [runRevisionAction, resync]);
  const handleResume = useCallback(() => { runRevisionAction("resume").catch(resync); }, [runRevisionAction, resync]);

  // Reset (= end/abandon the session) refreshes both the activity log and the
  // statistics: the abandoned attempt is stored but never counted (spec §6).
  const handleReset = useCallback(() => {
    runRevisionAction("reset")
      .then(() => { resyncLogs(); refreshStats(); })
      .catch(resync);
  }, [runRevisionAction, resyncLogs, refreshStats, resync]);

  // Goal ring / today minutes: completed focus sessions only.
  const countedFocusLogs = logs.filter(isCountedFocus);
  const focusSessionCount = countedFocusLogs.length;

  const handleSwitchMode = useCallback((mode: TimerMode) => {
    const cur = timerRef.current;
    if (!cur) return;
    gateway.switchTimerMode({ mode, expectedRevision: cur.revision })
      .then(applyTimer)
      .then(() => { resyncLogs(); refreshStats(); })
      .catch(resync);
  }, [gateway, applyTimer, resync, resyncLogs, refreshStats]);

  // ─── System tray ──────────────────────────────────────────────────────────
  // The App root owns the tray surface because it has the authoritative timer
  // ref + settings. Remaining is derived drift-free from `targetEndAt`, so the
  // tray stays correct across throttling and system sleep without a local
  // accumulator. Push immediately on any timer change, then every second while
  // running.
  useEffect(() => {
    const push = () => {
      const t = timerRef.current;
      gateway.setTrayIndicator(formatTrayIndicator(t, Date.now())).catch(() => undefined);
    };
    push();
    if (timer?.state !== "running") return;
    const id = setInterval(push, 1000);
    return () => clearInterval(id);
  }, [timer, gateway]);

  // Rust completion backstop → reuse the same idempotent `handleExpire` path.
  useEffect(() => {
    return gateway.subscribeTimerExpired(() => handleExpire());
  }, [gateway, handleExpire]);

  // Tray menu actions route through the existing handlers so the optimistic-
  // concurrency revision flow stays single-sourced.
  useEffect(() => {
    return gateway.subscribeTrayAction(action => {
      const t = timerRef.current;
      if (!t) return;
      if (action === "toggle") {
        if (t.state === "running") handlePause();
        else if (t.state === "paused") handleResume();
      } else if (action === "reset") {
        handleReset();
      }
    });
  }, [gateway, handlePause, handleResume, handleReset]);

  // Load persisted state once, then recover an expired running timer
  // (recovery=true → no auto-break per spec 4.2).
  useEffect(() => {
    let cancelled = false;
    gateway.bootstrap()
      .then(async payload => {
        if (cancelled) return;
        setTasks(payload.tasks);
        setLogs(payload.sessions.map(sessionToLog));
        setSettings(payload.settings);
        applyTimer(payload.timer);
        const t = payload.timer;
        if (t.state === "running" && t.activeSessionId && t.targetEndAt && Date.now() >= t.targetEndAt) {
          await runComplete(t, true).catch(resync);
        }
        refreshStats();
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [gateway, applyTimer, runComplete, resync, refreshStats]);

  const saveSettings = useCallback(async (next: AppSettings) => {
    const result = await gateway.saveSettings(next);
    setSettings(result.settings);
    refreshStats(); // dailyGoal is baked into the statistics payload
  }, [gateway, refreshStats]);

  const createTask = useCallback(async (title: string) => {
    const task = await gateway.createTask({
      title, pomodoroTarget: 1, priority: "med", project: "通用",
    });
    setTasks(p => [...p, task]);
  }, [gateway]);

  const toggleTask = useCallback(async (id: string) => {
    const current = tasks.find(t => t.id === id);
    if (!current) return;
    const updated = await gateway.updateTask({ id, done: !current.done });
    setTasks(p => p.map(t => (t.id === id ? updated : t)));
  }, [gateway, tasks]);

  const deleteTask = useCallback(async (id: string) => {
    await gateway.deleteTask(id);
    setTasks(p => p.filter(t => t.id !== id));
  }, [gateway]);

  const cyclePriority = useCallback(async (id: string) => {
    const cycle: TaskPriority[] = ["low", "med", "high"];
    const current = tasks.find(t => t.id === id);
    if (!current) return;
    const next = cycle[(cycle.indexOf(current.priority) + 1) % cycle.length];
    const updated = await gateway.updateTask({ id, priority: next });
    setTasks(p => p.map(t => (t.id === id ? updated : t)));
  }, [gateway, tasks]);

  const centerContent = (() => {
    switch (nav) {
      case "timer":    return (
        <TimerPanel
          timer={timer}
          tasks={tasks}
          onStart={handleStart}
          onPause={handlePause}
          onResume={handleResume}
          onReset={handleReset}
          onSwitchMode={handleSwitchMode}
          onExpire={handleExpire}
        />
      );
      case "tasks":    return (
        <TasksPanel
          tasks={tasks}
          onCreateTask={createTask}
          onToggleTask={toggleTask}
          onDeleteTask={deleteTask}
          onCyclePriority={cyclePriority}
        />
      );
      case "stats":    return <StatsPage  logs={logs} sessionCount={focusSessionCount} stats={weekStats} />;
      case "settings": return <SettingsPanel settings={settings} onSaveSettings={saveSettings} onDataChanged={() => { resync(); refreshStats(); }} />;
    }
  })();

  const showRight = nav === "timer" || nav === "tasks";

  return (
    <div style={{
      width: "100%", height: "100%", position: "relative",
      background: "#050709", overflow: "hidden",
      display: "flex",
    }}>
      <OceanVideo />

      <Sidebar active={nav} onNav={setNav} />

      {/* Content: main (1fr) + right sidebar (clamp width) on same ocean canvas */}
      <div
        className={`content-area${showRight ? " with-right" : ""}`}
        style={{
          gridTemplateColumns: showRight
            ? "1fr clamp(240px, 18vw, 320px)"
            : "1fr",
        }}
      >
        <main style={{ overflow: "hidden", display: "flex", minWidth: 0 }}>
          <div key={nav} className="panel-enter" style={{ flex: 1, display: "flex", overflow: "hidden", minWidth: 0 }}>
            {centerContent}
          </div>
        </main>

        {showRight && <StatsPanel logs={logs} sessionCount={logs.length} stats={weekStats} />}
      </div>
    </div>
  );
}
