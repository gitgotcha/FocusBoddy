import type { TimerMode } from "../../domain/models";
import { C } from "../shared/palette";

export function catmullRomPath(pts: { x: number; y: number }[], tension = 0.38): string {
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

export function TimerArc({ progress, mode, isRunning, isDone }:
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
