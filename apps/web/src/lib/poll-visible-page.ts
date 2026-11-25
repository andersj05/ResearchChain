type Poll = {
  isCurrent: () => boolean;
  schedule: (delayMs: number) => void;
};

/** Runs an observation when visible and invalidates it on a visibility change. */
export function pollVisiblePage(read: (poll: Poll) => Promise<void>) {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function refresh() {
    clearTimeout(timer);
    const request = ++generation;
    if (document.visibilityState !== "visible") return;

    function isCurrent() {
      return request === generation && document.visibilityState === "visible";
    }
    function schedule(delayMs: number) {
      if (isCurrent()) timer = setTimeout(refresh, delayMs);
    }
    void read({ isCurrent, schedule });
  }

  document.addEventListener("visibilitychange", refresh);
  queueMicrotask(() => {
    if (!generation) refresh();
  });
  return () => {
    generation++;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", refresh);
  };
}
