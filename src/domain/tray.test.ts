import { describe, expect, it } from "vitest";
import { formatClock, formatTrayIndicator } from "./tray";
import type { TimerSnapshot } from "./models";

function snapshot(overrides: Partial<TimerSnapshot> = {}): TimerSnapshot {
  return {
    mode: "focus",
    state: "idle",
    activeSessionId: null,
    selectedTaskId: null,
    taskTitleSnapshot: null,
    projectSnapshot: null,
    durationSeconds: 1500,
    remainingSeconds: 1500,
    startedAt: null,
    targetEndAt: null,
    pausedAt: null,
    revision: 1,
    updatedAt: 0,
    ...overrides,
  };
}

describe("formatClock", () => {
  it("zero-pads mm:ss", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(9)).toBe("00:09");
    expect(formatClock(65)).toBe("01:05");
    expect(formatClock(1500)).toBe("25:00");
  });

  it("never goes negative", () => {
    expect(formatClock(-30)).toBe("00:00");
  });

  it("overflows minutes for long sessions", () => {
    expect(formatClock(3600)).toBe("60:00");
  });
});

describe("formatTrayIndicator", () => {
  it("reports idle focus state when no timer", () => {
    const ind = formatTrayIndicator(null, 0);
    expect(ind.tooltip).toBe("Abyssal Reverie · 空闲");
    expect(ind.statusLabel).toBe("Abyssal Reverie · 空闲");
    expect(ind.toggleLabel).toBe("开始专注");
  });

  it("reports idle short-break mode", () => {
    const ind = formatTrayIndicator(snapshot({ mode: "short", state: "idle" }), 0);
    expect(ind.statusLabel).toBe("Abyssal Reverie · 短休");
    expect(ind.toggleLabel).toBe("开始专注");
  });

  it("derives remaining drift-free from targetEndAt while running", () => {
    const now = 1_000_000;
    const ind = formatTrayIndicator(
      snapshot({ state: "running", targetEndAt: now + 5 * 60_000 }),
      now,
    );
    expect(ind.tooltip).toBe("Abyssal Reverie · 专注中 05:00");
    expect(ind.statusLabel).toBe("Abyssal Reverie · 专注中 05:00");
    expect(ind.toggleLabel).toBe("暂停");
  });

  it("clamps expired running timer to 00:00", () => {
    const ind = formatTrayIndicator(
      snapshot({ state: "running", targetEndAt: 1000 }),
      1000 + 60_000,
    );
    expect(ind.statusLabel).toBe("Abyssal Reverie · 专注中 00:00");
  });

  it("labels paused with resume action", () => {
    const ind = formatTrayIndicator(
      snapshot({ state: "paused", remainingSeconds: 623 }),
      0,
    );
    expect(ind.statusLabel).toBe("Abyssal Reverie · 已暂停 10:23");
    expect(ind.toggleLabel).toBe("继续");
  });

  it("labels done state", () => {
    const ind = formatTrayIndicator(snapshot({ state: "done" }), 0);
    expect(ind.statusLabel).toBe("Abyssal Reverie · 已完成");
    expect(ind.toggleLabel).toBe("开始专注");
  });
});
