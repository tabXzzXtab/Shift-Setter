"use client";

import { useEffect, useEffectEvent } from "react";
import type { FormKey } from "@/lib/tour/steps";
import { useTour } from "./tour-provider";

export type Fill = {
  text: string;
  /** Writes into the form's OWN state -- its setter, or its uncontrolled
   *  input's value. Autofill never goes round the form. */
  write: (value: string) => void;
  /** Typed a character at a time. False for what nobody types: a select, a
   *  date, a day on the calendar. */
  typed?: boolean;
  /** Scrolled into view before it is written, so the typing is seen. */
  el?: () => Element | null;
};

const CHAR_MS = 40;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A form's hook into the tour's autofill step.
 *
 * Does nothing unless the tour's current step names this form and has not
 * filled it yet -- so on every ordinary visit it is one context read. When it
 * does run, it writes placeholder values into the form's own state and stops.
 * IT NEVER SUBMITS. The press is the person's; the tour points at the button
 * and waits for the write to succeed (lib/tour/signal).
 *
 * `ready` is the form saying its options have arrived: a project cannot be
 * chosen from a list that has not loaded.
 *
 * Under reduced motion the values arrive at once. The typing is a picture of
 * what the form wants, and a picture that moves is exactly what that setting
 * asks us not to draw.
 */
export function useTourAutofill(form: FormKey, ready: boolean, build: () => Fill[]) {
  const tour = useTour();
  const wanted = tour?.wants(form) ?? false;
  const fills = useEffectEvent(build);
  const started = useEffectEvent(() => tour?.started(form));
  const finished = useEffectEvent(() => tour?.finished(form));

  useEffect(() => {
    if (!wanted || !ready) return;
    let stop = false;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    void (async () => {
      started();
      for (const f of fills()) {
        if (stop) return;
        f.el?.()?.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
        if (still || f.typed === false) {
          f.write(f.text);
          if (!still) await sleep(220);
          continue;
        }
        await sleep(180);
        for (let i = 1; i <= f.text.length; i++) {
          if (stop) return;
          f.write(f.text.slice(0, i));
          await sleep(CHAR_MS);
        }
      }
      if (!stop) finished();
    })();

    return () => { stop = true; };
  }, [wanted, ready]);
}
