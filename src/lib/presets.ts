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
