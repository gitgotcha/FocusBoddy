// Completion side effects (moved verbatim from App.tsx).
export function playCompletionSound() {
  try {
    const audio = new Audio("/audio/focus-complete.wav");
    void audio.play().catch(() => undefined);
  } catch { /* ignore */ }
}

/** Shows a desktop notification via the Web Notification API. */
export function notifyCompletion(taskTitle: string) {
  try {
    if (typeof Notification === "undefined") return;
    const show = () => { try { new Notification("专注完成", { body: taskTitle }); } catch { /* ignore */ } };
    if (Notification.permission === "granted") show();
    else if (Notification.permission === "default") {
      void Notification.requestPermission().then(p => { if (p === "granted") show(); });
    }
  } catch { /* ignore */ }
}
