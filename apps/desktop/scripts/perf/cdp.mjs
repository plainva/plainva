/**
 * The few lines of the Chrome DevTools Protocol the measurements need: attach
 * to the app window of a running dev build and evaluate code in it. Plain
 * WebSocket and fetch — a browser-automation library refuses to attach once
 * the app has started its shared worker.
 */
export async function attach(cdp = "http://127.0.0.1:9333") {
  const targets = await (await fetch(`${cdp}/json/list`)).json();
  const target = targets.find((t) => t.type === "page" && /^https?:\/\/(localhost|tauri\.localhost)/.test(t.url));
  if (!target) throw new Error(`no app window found on ${cdp}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("cannot attach to the app window")), { once: true });
  });
  let nextId = 0;
  const waiting = new Map();
  const listeners = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const entry = waiting.get(message.id);
      waiting.delete(message.id);
      if (!entry) return;
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
      return;
    }
    for (const listener of listeners.get(message.method) ?? []) listener(message.params);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      waiting.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const on = (method, listener) => listeners.set(method, [...(listeners.get(method) ?? []), listener]);

  /** Runs `fn(arg)` in the page and returns its (awaited, JSON-serializable) result. */
  const evaluate = async (fn, arg) => {
    const result = await send("Runtime.evaluate", {
      expression: `(${fn.toString()})(${JSON.stringify(arg ?? null)})`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  };

  /** Polls `fn(arg)` in the page until it returns something truthy. */
  const waitFor = async (fn, arg, timeoutMs = 60_000) => {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const value = await evaluate(fn, arg).catch(() => null);
      if (value) return value;
      if (Date.now() > until) throw new Error(`timed out waiting for ${fn.toString().slice(0, 80)}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  };

  await send("Runtime.enable");
  await send("Page.enable");
  return { send, on, evaluate, waitFor, close: () => socket.close() };
}

/** Run inside the page: watches the UI thread while `ms` pass. */
export const watchThreadSource = `async (ms) => {
  let last = performance.now();
  let longestGap = 0;
  let ticks = 0;
  const gaps = [];
  const timer = setInterval(() => {
    const now = performance.now();
    const gap = now - last;
    if (gap > 50) gaps.push(Math.round(gap));
    longestGap = Math.max(longestGap, gap);
    last = now;
    ticks++;
  }, 1);
  // IPC round-trips show up as resource entries of the bridge's own scheme.
  performance.setResourceTimingBufferSize(200000);
  performance.clearResourceTimings();
  const longTasks = [];
  const observer = new PerformanceObserver((list) => longTasks.push(...list.getEntries().map((e) => e.duration)));
  observer.observe({ entryTypes: ["longtask"] });
  await new Promise((r) => setTimeout(r, ms));
  clearInterval(timer);
  longTasks.push(...observer.takeRecords().map((e) => e.duration));
  observer.disconnect();
  return {
    longestGapMs: Math.round(longestGap),
    gapsOver50Ms: gaps,
    blockedMs: Math.round(longTasks.reduce((a, b) => a + b, 0)),
    longTasks: longTasks.length,
    longestTaskMs: Math.round(longTasks.length ? Math.max(...longTasks) : 0),
    timerTicksPerSecond: Math.round((ticks * 1000) / ms),
    ipcRoundTrips: performance.getEntriesByType("resource").filter((e) => e.name.startsWith("ipc:") || e.name.includes("ipc.localhost")).length,
    visibility: document.visibilityState,
  };
}`;
