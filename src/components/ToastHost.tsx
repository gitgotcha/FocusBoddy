import { useEffect } from "react";

/** Lightweight bottom-center toast (spec §11.3): frosted, low-contrast,
 *  auto-dismisses. Idempotent replays never mount one. */
export function ToastHost({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(onDone, 2800);
    return () => window.clearTimeout(id);
  }, [message, onDone]);

  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="slide-in"
      style={{
        position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)",
        zIndex: 80, maxWidth: "min(520px, 88vw)",
        padding: "9px 16px", borderRadius: 10,
        background: "rgba(8, 13, 18, 0.82)",
        backdropFilter: "blur(20px) saturate(1.05)", WebkitBackdropFilter: "blur(20px) saturate(1.05)",
        border: "1px solid rgba(215,228,230,0.13)",
        boxShadow: "0 10px 30px rgba(2,3,5,0.42)",
        color: "rgba(235,240,241,0.92)", fontSize: 12, lineHeight: 1.5,
        fontFamily: "var(--font-sans)", textAlign: "center",
      }}
    >
      {message}
    </div>
  );
}
