import { C } from "../shared/palette";

export function HorizonDivider() {
  return (
    <div style={{
      height: 1, flexShrink: 0,
      background: `linear-gradient(90deg, transparent 0%, rgba(215,228,230,0.04) 15%, rgba(215,228,230,0.07) 40%, rgba(215,228,230,0.08) 52%, rgba(215,228,230,0.05) 78%, rgba(215,228,230,0.02) 90%, transparent 100%)`,
    }} />
  );
}

export function GoalRing({ progress, size = 36 }: { progress: number; size?: number }) {
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
