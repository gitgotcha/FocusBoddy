import { C } from "../features/shared/palette";

/** Frosted-glass confirmation dialog (spec §11.5: 磨砂玻璃, ocean stays
 *  visible behind it). Rendered at the App shell level. */
export function ConfirmDialog({ open, message, confirmLabel, cancelLabel, onConfirm, onCancel }: {
  open: boolean;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={message}
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, zIndex: 90,
        background: "rgba(2,3,5,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        role="document"
        onClick={e => e.stopPropagation()}
        style={{
          width: "min(360px, 88vw)", padding: "20px 22px",
          borderRadius: 14,
          background: "rgba(8, 13, 18, 0.82)",
          backdropFilter: "blur(22px) saturate(1.05)", WebkitBackdropFilter: "blur(22px) saturate(1.05)",
          border: "1px solid rgba(215,228,230,0.14)",
          boxShadow: "0 18px 48px rgba(2,3,5,0.5)",
          display: "flex", flexDirection: "column", gap: 16,
        }}
      >
        <div style={{ fontSize: 13, lineHeight: 1.6, color: "rgba(235,240,241,0.92)", fontFamily: "var(--font-sans)" }}>
          {message}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} className="btn-action"
            style={{
              padding: "6px 14px", borderRadius: 8, fontSize: 12,
              fontFamily: "var(--font-sans)", cursor: "pointer",
              color: "rgba(195,212,218,0.85)",
              background: "rgba(27,37,44,0.40)",
              border: "1px solid rgba(215,228,230,0.12)",
            }}>
            {cancelLabel ?? "取消"}
          </button>
          <button onClick={onConfirm} autoFocus className="btn-action"
            style={{
              padding: "6px 14px", borderRadius: 8, fontSize: 12,
              fontFamily: "var(--font-sans)", cursor: "pointer",
              color: "#0B1116",
              background: "rgba(186,200,204,0.92)",
              border: "1px solid rgba(215,228,230,0.30)",
              fontWeight: 500,
            }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
