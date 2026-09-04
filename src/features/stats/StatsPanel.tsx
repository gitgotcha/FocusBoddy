import { useEffect, useRef, useState } from "react";
import type { Statistics } from "../../domain/models";
import { DEFAULT_SETTINGS } from "../../domain/defaults";
import { weekBoundaries } from "../../domain/statistics";
import { C, CARD, SIDEBAR_GLASS } from "../shared/palette";
import { GoalRing, HorizonDivider } from "../timer/GoalRing";
import { catmullRomPath } from "../timer/TimerArc";
import { MiniBar } from "../shared/MiniBar";
import { chineseDate } from "../shared/format";
import type { SessionLog } from "../shared/types";

export function StatsPanel({ logs, todayStats, stats, reduceMotion }:
  { logs: SessionLog[]; todayStats: Statistics | null; stats: Statistics | null; reduceMotion: boolean }) {

  // F6: today's minutes and session count come from the authoritative Rust
  // statistics query (strict local day boundaries) — never from the
  // 50-record activity log.
  const todayCount   = todayStats?.focusSessionCount ?? 0;
  const todayMinutes = Math.round((todayStats?.focusSeconds ?? 0) / 60);
  const dailyGoal    = stats?.dailyGoal ?? DEFAULT_SETTINGS.dailyGoal;
  const goalProgress = Math.min(1, todayCount/dailyGoal);

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

  // byTag: frozen tag-name snapshots (v1.1 §11.7 — renames never rewrite
  // historical statistics).
  const tagStats = (stats?.byTag ?? [])
    .slice()
    .sort((a, b) => b.focusSeconds - a.focusSeconds);
  const maxTag = Math.max(1, ...tagStats.map(t => t.sessions));

  // F5: activity list auto-positioning. Display order is oldest-at-top,
  // newest-at-bottom; a newly appended record scrolls into view (smooth, or
  // instant under reduced motion) and flashes a moonlight ring for 1.2s.
  const listRef = useRef<HTMLDivElement>(null);
  const lastNewestRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const [freshId, setFreshId] = useState<string | null>(null);
  const newestId = logs[0]?.id ?? null;
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      lastNewestRef.current = newestId;
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
      return;
    }
    if (newestId && newestId !== lastNewestRef.current) {
      lastNewestRef.current = newestId;
      setFreshId(newestId);
      listRef.current?.scrollTo({
        top: listRef.current.scrollHeight,
        behavior: reduceMotion ? "auto" : "smooth",
      });
      const timer = window.setTimeout(() => setFreshId(null), 1200);
      return () => window.clearTimeout(timer);
    }
    lastNewestRef.current = newestId;
  }, [logs, newestId, reduceMotion]);

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
            <span style={{ fontFamily:"var(--font-display)", fontVariantNumeric:"tabular-nums", fontSize:22, fontWeight:400, color:"#FFFFFF", lineHeight:1, textShadow:"0 1px 6px rgba(0,0,0,0.5)" }}>{todayCount}</span>
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
      <div style={{ padding:"8px 16px" }}>
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
      <div style={{ padding:"8px 16px" }}>
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
      <div ref={listRef} style={{ padding:"8px 16px", flex:1, overflowY:"auto", minHeight:120 }}>
        <div style={{ fontFamily:"var(--font-sans)", fontSize:9, color:C.textMuted, letterSpacing:"0.10em", textTransform:"uppercase", marginBottom:10 }}>专注航线</div>
        {logs.length === 0 ? (
          <div style={{ fontSize:11, color:C.textMuted, fontStyle:"italic", fontFamily:"var(--font-sans)" }}>今日尚无记录</div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column" }}>
            {logs.slice().reverse().map((log, idx, arr) => {
              // Display is oldest-at-top / newest-at-bottom: the NEWEST record
              // is the last rendered row.
              const isNewest = idx === arr.length-1;
              const isLast   = idx === arr.length-1;
              const isFresh  = freshId === log.id;
              return (
                <div key={log.id}
                  className={isFresh && !reduceMotion ? "log-fresh" : ""}
                  style={{ display:"flex", gap:9, alignItems:"flex-start" }}>
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0, width:11 }}>
                    <div style={{ position:"relative", flexShrink:0, marginTop:2 }}>
                      {isNewest && <div style={{ position:"absolute", inset:-3, borderRadius:"50%", border:"0.5px solid rgba(255,255,255,0.4)" }} />}
                      <div style={{ width: isNewest ? 7 : 4, height: isNewest ? 7 : 4, borderRadius:"50%", background: isNewest ? "#FFFFFF" : "rgba(215,228,230,0.40)" }} />
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
                      <span style={{ fontFamily:"var(--font-mono)", fontSize:9, color: isNewest ? "rgba(240,246,248,0.90)" : "rgba(195,212,218,0.55)" }}>{log.time}</span>
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
                    <span style={{ fontSize:10, fontFamily:"var(--font-sans)", lineHeight:1.4, color: isNewest ? "#FFFFFF" : "rgba(220,232,236,0.65)" }}>{log.task}</span>
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
export function StatsPage({ logs, todayStats, stats }:
  { logs: SessionLog[]; todayStats: Statistics | null; stats: Statistics | null }) {

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
          { label:"今日专注", value:todayStats?.focusSessionCount ?? 0, unit:"次",  accent:true },
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
