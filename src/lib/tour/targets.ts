import type { Target } from "./steps";

/** The tour's own elements. Never a target, or "Hoppa över" could be one. */
export const TOUR_UI = "data-tour-ui";

const text = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** aria-label when there is one -- an icon button has no text -- else the text. */
function accessibleName(el: Element): string {
  return text(el.getAttribute("aria-label")) || text(el.textContent);
}

function shown(el: Element): boolean {
  if (el.closest(`[${TOUR_UI}]`)) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function one(t: Target): Element[] {
  if ("name" in t) {
    return [...document.querySelectorAll('a, button, [role="button"]')].filter((el) => {
      if (!shown(el)) return false;
      const n = accessibleName(el);
      return typeof t.name === "string" ? n === t.name : t.name.test(n);
    });
  }
  if ("field" in t) {
    // SoftField's label is its first span (a help line and the control follow
    // it inside the same <label>); a label pointing elsewhere by htmlFor is
    // all label. Compared whole, minus a required-asterisk, so "Timmar" is not
    // found by prefix in something longer.
    return [...document.querySelectorAll("label")].flatMap((label) => {
      const raw = label.htmlFor
        ? label.textContent
        : (label.querySelector("span")?.textContent ?? label.textContent);
      const name = text(raw).replace(/\s*\*$/, "");
      if (name !== t.field) return [];
      const control = label.htmlFor
        ? document.getElementById(label.htmlFor)
        : label.querySelector("input, textarea, select");
      return control && shown(control) ? [control] : [];
    });
  }
  if ("css" in t) return [...document.querySelectorAll(t.css)].filter(shown);
  const el = t.find();
  return el && shown(el) ? [el] : [];
}

/**
 * The elements a step points at. `all`: every match of every target. Otherwise
 * the first match of the first target that has one -- targets are listed in
 * order of preference, so a later one is where to look when the first is not
 * on screen yet.
 */
export function resolveTargets(targets: Target[], all = false): Element[] {
  if (all) return targets.flatMap(one);
  for (const t of targets) {
    const found = one(t);
    if (found.length) return [found[0]!];
  }
  return [];
}

/** Trailing slashes differ between a static export and the dev server. */
export const samePath = (a: string, b: string) =>
  (a.replace(/\/+$/, "") || "/") === (b.replace(/\/+$/, "") || "/");
