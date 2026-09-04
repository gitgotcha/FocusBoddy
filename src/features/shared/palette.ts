// Design tokens shared by every panel (moved verbatim from App.tsx).
// ─── Design Tokens ────────────────────────────────────────────────────────────
// Text is vivid & sharp with text shadows to ensure high legibility on transparent frosted glass.
export const C = {
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
export const CARD: React.CSSProperties = {
  background:              C.card,
  backdropFilter:          "blur(18px)",
  WebkitBackdropFilter:    "blur(18px)",
  border:                  `1px solid ${C.hairline}`,
  borderRadius:            16,
  boxShadow:               "inset 0 0.5px 0 rgba(215,228,230,0.04), 0 4px 16px rgba(2,3,5,0.16)",
};

// High-clarity frosted glass recipe for sidebars — ultra transparent, crisp backdrop blur, punchy text contrast
export const SIDEBAR_GLASS: React.CSSProperties = {
  background:              "rgba(6, 11, 16, 0.25)",
  backdropFilter:          "blur(32px) saturate(1.1) brightness(0.85)",
  WebkitBackdropFilter:    "blur(32px) saturate(1.1) brightness(0.85)",
};
