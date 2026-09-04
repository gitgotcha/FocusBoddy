import { C } from "./palette";

export function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div style={{ flex:1, height:2, background:"rgba(215,228,230,0.06)", borderRadius:2, overflow:"hidden" }}>
      <div style={{ width:`${Math.round((value/max)*100)}%`, height:"100%", background:color, borderRadius:2, transition:"width 0.8s cubic-bezier(0.22,1,0.36,1)" }} />
    </div>
  );
}
