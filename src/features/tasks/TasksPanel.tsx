import { useState } from "react";
import type { Task, TaskPriority } from "../../domain/models";
import { C, CARD } from "../shared/palette";
import { uid } from "../shared/format";
import { HorizonDivider } from "../timer/GoalRing";

function PriorityPip({ p }: { p: TaskPriority }) {
  const colors: Record<TaskPriority, string> = {
    high: "rgba(190,120,120,0.80)", med: "rgba(170,145,108,0.80)", low: "rgba(158,173,178,0.70)",
  };
  return <span style={{ width: 5, height: 5, borderRadius: "50%", background: colors[p], display: "inline-block", flexShrink: 0 }} />;
}

export function TasksPanel({ tasks, onCreateTask, onToggleTask, onDeleteTask, onCyclePriority }: {
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
                  cursor: "pointer", /* focus rings come from index.css (:focus / :focus-visible) */
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
              display: "flex", alignItems: "center", justifyContent: "center", /* focus rings come from index.css (:focus / :focus-visible) */
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
                    cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
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
                    display:"flex", alignItems:"center", justifyContent:"center",
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
