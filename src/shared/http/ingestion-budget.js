const admittedBudgets = new WeakSet();
export function assertIngestionBudget(budget) {
  if (!admittedBudgets.has(budget)) {
    throw new IngestionError("URL_POLICY", "Invalid ingestion context");
  }
}
const MiB = 1024 * 1024;
export const DEFAULT_LIMITS = Object.freeze({
  bodyBytes: MiB,
  listBytes: 8 * MiB,
  runBytes: 64 * MiB,
  requestMs: 10000,
  dnsMs: 3000,
  connectMs: 5000,
  idleMs: 5000,
  runMs: 600000,
  jobs: 1000,
  pages: 20,
  attempts: 3500,
  retries: 2,
  redirects: 5,
  records: 32,
  headerBytes: 16384,
  urlBytes: 8192,
});
export const LIMIT_CEILINGS = Object.freeze({
  bodyBytes: 4 * MiB,
  listBytes: 16 * MiB,
  runBytes: 256 * MiB,
  requestMs: 60000,
  dnsMs: 5000,
  connectMs: 10000,
  idleMs: 15000,
  runMs: 1800000,
  jobs: 5000,
  pages: 50,
  attempts: 18000,
  retries: 2,
  redirects: 10,
  records: 64,
  headerBytes: 32768,
  urlBytes: 8192,
});

export class IngestionError extends Error {
  constructor(code, message = "Public ingestion stopped") {
    super(message);
    this.name = "IngestionError";
    this.code = code;
    this.doNotRetry = true;
    this.completed = 0;
    this.saved = 0;
    this.jobIds = [];
  }
}
export function isTerminalIngestionError(error) {
  return error instanceof IngestionError || error?.name === "AbortError";
}
/** @param {object} [overrides] @param {Record<string, number>} [trusted] */
export function limitsFor(overrides = {}, trusted = DEFAULT_LIMITS) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new IngestionError("URL_POLICY", "Invalid ingestion limits");
  }
  const result = { ...trusted };
  for (const [key, value] of Object.entries(overrides)) {
    if (
      !(key in trusted) ||
      !Number.isSafeInteger(value) ||
      value < (key === "retries" || key === "redirects" ? 0 : 1) ||
      value > trusted[key] ||
      value > LIMIT_CEILINGS[key]
    ) {
      throw new IngestionError("URL_POLICY", "Invalid ingestion limit");
    }
    result[key] = value;
  }
  return Object.freeze(result);
}

/** @param {{ limits?: object, signal?: AbortSignal, now?: () => number }} [options] */
export function createIngestionBudget({
  limits = {},
  signal,
  now = Date.now,
} = {}) {
  limitsFor(limits, LIMIT_CEILINGS);
  const resolved = limitsFor({ ...DEFAULT_LIMITS, ...limits }, LIMIT_CEILINGS);
  const expires = now() + resolved.runMs;
  const counts = { encoded: 0, decoded: 0, jobs: 0, pages: 0, attempts: 0 };
  const progress = { completed: 0, saved: 0, jobIds: [] };
  function annotate(error) {
    if (error && typeof error === "object")
      Object.assign(error, progress, {
        jobIds: [...progress.jobIds],
      });
    return error;
  }
  function check() {
    if (signal?.aborted)
      throw annotate(new IngestionError("DEADLINE", "Ingestion cancelled"));
    if (now() >= expires)
      throw annotate(new IngestionError("RUN_LIMIT", "Run deadline exceeded"));
  }
  function charge(kind, amount = 1) {
    check();
    const cap =
      kind === "encoded" || kind === "decoded"
        ? resolved.runBytes
        : resolved[kind];
    if (
      !Number.isSafeInteger(amount) ||
      amount < 0 ||
      !Number.isFinite(cap) ||
      counts[kind] + amount > cap
    ) {
      throw annotate(new IngestionError("RUN_LIMIT", "Run limit exceeded"));
    }
    counts[kind] += amount;
  }
  const budget = Object.freeze({
    limits: resolved,
    expires,
    signal,
    now,
    check,
    charge,
    annotate,
    counts,
    progress,
  });
  admittedBudgets.add(budget);
  return budget;
}

// An absolute request owner starts before queueing and ends only after resource cleanup.
export function createRequestOwner(budget, timeoutMs, callerSignal) {
  budget.check();
  const controller = new AbortController();
  const ms = limitsFor(
    {
      requestMs: timeoutMs === undefined ? budget.limits.requestMs : timeoutMs,
    },
    budget.limits,
  ).requestMs;
  const remaining = Math.min(ms, budget.expires - budget.now());
  const stop = () =>
    controller.abort(new IngestionError("DEADLINE", "Ingestion cancelled"));
  const signals = [...new Set([budget.signal, callerSignal].filter(Boolean))];
  for (const signal of signals) {
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  }
  const timer = setTimeout(
    () =>
      controller.abort(
        new IngestionError(
          budget.now() >= budget.expires ? "RUN_LIMIT" : "DEADLINE",
          "Ingestion deadline exceeded",
        ),
      ),
    remaining,
  );
  function check() {
    budget.check();
    if (controller.signal.aborted) throw controller.signal.reason;
  }
  return {
    signal: controller.signal,
    check,
    close() {
      clearTimeout(timer);
      for (const signal of signals) signal.removeEventListener("abort", stop);
    },
  };
}

export function waitOwned(promise, signal, ms, code = "DEADLINE") {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    if (ms !== undefined)
      timer = setTimeout(() => {
        cleanup();
        reject(new IngestionError(code, "Ingestion phase deadline exceeded"));
      }, ms);
    Promise.resolve(promise).then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}
