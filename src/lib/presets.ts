/**
 * Lunch/Rast preset values per bolag.
 *
 * STORAGE: localStorage, keyed by tenant_id ("lunch_presets:<uuid>").
 * Per-bolag semantics hold on a single device; a future bolag_settings table
 * migration (supabase/migrations/20261112120000_bolag_settings.sql) is
 * the right long-term home once the network allows applying it.
 *
 * Values are minutes (1–240). Three presets: defaults 15, 30, 45.
 */

export type Presets = [number, number, number];
export const DEFAULT_PRESETS: Presets = [15, 30, 45];

function valid(p: unknown): p is Presets {
  return (
    Array.isArray(p) &&
    p.length === 3 &&
    p.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 240)
  );
}

export function loadPresets(tenantId: string): Presets {
  try {
    const raw = localStorage.getItem(`lunch_presets:${tenantId}`);
    if (raw) {
      const p: unknown = JSON.parse(raw);
      if (valid(p)) return p;
    }
  } catch {
    // localStorage unavailable or corrupt — fall through to defaults.
  }
  return [...DEFAULT_PRESETS];
}

export function savePresets(tenantId: string, presets: Presets): void {
  try {
    localStorage.setItem(`lunch_presets:${tenantId}`, JSON.stringify(presets));
  } catch {
    // localStorage unavailable — a silent no-op is acceptable.
  }
}

/**
 * "Antal arbetare" -- the five counts Skiftfabrik's "Hur många arbetare?" offers,
 * set per bolag in Inställningar like the break presets. Whole numbers
 * 1–MAX_WORKERS, distinct, kept in ascending order. Defaults 1–5.
 */
export type WorkerOptions = [number, number, number, number, number];
export const DEFAULT_WORKER_OPTIONS: WorkerOptions = [1, 2, 3, 4, 5];
/** One card per worker per day is drawn, so the ceiling is what a phone can scroll. */
export const MAX_WORKERS = 30;

function validOptions(p: unknown): p is WorkerOptions {
  return (
    Array.isArray(p) &&
    p.length === 5 &&
    p.every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_WORKERS) &&
    new Set(p).size === 5
  );
}

export function loadWorkerOptions(tenantId: string): WorkerOptions {
  try {
    const raw = localStorage.getItem(`worker_options:${tenantId}`);
    if (raw) {
      const p: unknown = JSON.parse(raw);
      if (validOptions(p)) return [...p].sort((a, b) => a - b) as WorkerOptions;
    }
  } catch {
    // localStorage unavailable or corrupt — fall through to defaults.
  }
  return [...DEFAULT_WORKER_OPTIONS];
}

export function saveWorkerOptions(tenantId: string, options: WorkerOptions): void {
  try {
    localStorage.setItem(`worker_options:${tenantId}`, JSON.stringify(options));
  } catch {
    // localStorage unavailable — a silent no-op is acceptable.
  }
}

/**
 * "Standard antal arbetare" -- the worker count Skiftfabrik starts on, one of
 * the five options above. Same storage and same per-bolag caveat as the
 * presets. null means nobody has chosen one, and Skiftfabrik then starts with
 * none selected.
 */
export function loadDefaultWorkers(tenantId: string): number | null {
  try {
    const n = Number(localStorage.getItem(`default_workers:${tenantId}`));
    if (Number.isInteger(n) && n >= 1 && n <= MAX_WORKERS) return n;
  } catch {
    // localStorage unavailable — no default.
  }
  return null;
}

export function saveDefaultWorkers(tenantId: string, n: number): void {
  try {
    localStorage.setItem(`default_workers:${tenantId}`, String(n));
  } catch {
    // localStorage unavailable — a silent no-op is acceptable.
  }
}

export function clearDefaultWorkers(tenantId: string): void {
  try {
    localStorage.removeItem(`default_workers:${tenantId}`);
  } catch {
    // localStorage unavailable — nothing stored to clear.
  }
}
