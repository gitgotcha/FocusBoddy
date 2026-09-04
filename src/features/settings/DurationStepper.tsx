import { useEffect, useState } from "react";
import { C } from "../shared/palette";

/** Numeric stepper with direct input (v1.1 §11.1): +/- adjust by one, the
 *  middle value is a real input. Enter/blur commits a valid integer within
 *  [min, max]; Escape reverts; invalid input stays visible with an inline
 *  error and is never persisted. No per-keystroke writes. */
export function DurationStepper({ value, onChange, min, max, ariaLabel, errorMessage }: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  ariaLabel?: string;
  /** Overrides the default range message (e.g. 分钟 vs 次). */
  errorMessage?: string;
}) {
  const [text, setText] = useState(() => String(value));
  const [error, setError] = useState<string | null>(null);
  const rangeMessage = errorMessage ?? `请输入 ${min}–${max} 的整数`;

  // External changes (+/- buttons, persisted sync) refresh the field.
  useEffect(() => { setText(String(value)); setError(null); }, [value]);

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) {
      setError(rangeMessage);
      return;
    }
    const parsed = Number(trimmed);
    if (parsed < min || parsed > max) {
      setError(rangeMessage);
      return;
    }
    setError(null);
    if (parsed !== value) onChange(parsed);
  };

  const revert = () => { setText(String(value)); setError(null); };

  const numberBtn = {
    width: 24, height: 24, borderRadius: 6,
    background: C.cardDim, border: `1px solid ${C.hairline}`,
    color: C.textSec, cursor: "pointer", fontSize: 13,
    display: "flex", alignItems: "center", justifyContent: "center",
  } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <button onClick={() => onChange(Math.max(min, value - 1))} className="btn-number"
          aria-label="减少"
          style={numberBtn}>–</button>
        <input
          value={text}
          onChange={e => { setText(e.target.value); setError(null); }}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") commit(text);
            if (e.key === "Escape") revert();
          }}
          inputMode="numeric"
          aria-label={ariaLabel}
          style={{
            width: 34, textAlign: "center",
            fontFamily: "var(--font-mono)", fontSize: 12,
            fontVariantNumeric: "tabular-nums",
            color: C.textPrimary,
            background: "transparent",
            border: "none",
            borderBottom: error ? "1px solid rgba(231,138,138,0.6)" : "1px solid transparent",
            padding: "1px 0", outline: "none",
          }}
        />
        <button onClick={() => onChange(Math.min(max, value + 1))} className="btn-number"
          aria-label="增加"
          style={numberBtn}>+</button>
      </div>
      {error && (
        <div role="alert" style={{
          fontSize: 9, lineHeight: 1.3,
          color: "rgba(231,138,138,0.92)", maxWidth: 170,
          fontFamily: "var(--font-sans)",
        }}>
          {error}
        </div>
      )}
    </div>
  );
}
