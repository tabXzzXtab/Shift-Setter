"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAccount, type Role } from "@/lib/account";
import { getSupabase } from "@/lib/supabase/client";
import { DONE, SEQUENCES, met, type FormKey, type Step } from "@/lib/tour/steps";
import {
  automatedWithoutOptIn, completeTour, createdRows, forgetCreated, rememberCreated, saveStep,
  savedStep, tourComplete, type TourRow,
} from "@/lib/tour/storage";
import { onTourSignal } from "@/lib/tour/signal";
import { resolveTargets, samePath } from "@/lib/tour/targets";
import { TourCard } from "./tour-card";
import { TourBar, TourSpotlight } from "./tour-spotlight";

/** Screens nobody is being shown around: signed out, or not a tenancy's app. */
const OFF_ROUTES = ["/login", "/onboarding", "/super", "/glomt-losenord", "/aterstall-losenord"];

/** How long a nav step waits for its element before it becomes a card. */
const MISSING_AFTER_MS = 8000;

/** How long the "go there" bar waits, so a tap that is already navigating
 *  does not flash it on the way out. */
const OFF_ROUTE_GRACE_MS = 900;

type Run = { accountId: string; role: Role; steps: Step[] };
/** A step's verdict, keyed by its index so a stale one is never read. */
type Gate = { index: number; state: "ok" | "fallback"; text?: string };

type TourApi = {
  /** Whether the current step wants this form filled, and has not yet. */
  wants: (form: FormKey) => boolean;
  started: (form: FormKey) => void;
  finished: (form: FormKey) => void;
  /** Something the tour's own step created -- removed again at "Kom igång". */
  created: (row: TourRow) => void;
};

const TourCtx = createContext<TourApi | null>(null);

export function useTour(): TourApi | null {
  return useContext(TourCtx);
}

/**
 * The first-launch tour: which step, whether it can happen, what to draw.
 *
 * STARTS ONCE PER ACCOUNT PER DEVICE, for an active account whose tour this
 * browser has not seen finish (storage.ts), and never for an operator acting
 * inside somebody else's tenancy -- that is not anybody's first launch, and
 * the database, not this browser, knows whether it is happening.
 *
 * The role is the account row's (lib/account), read from the database on
 * load like everywhere else. The tour is a view on top of the app: it writes
 * nothing, locks nothing, and every step can be skipped.
 */
export function TourProvider({ children }: { children: ReactNode }) {
  const { account, loading } = useAccount();
  const pathname = usePathname();
  const router = useRouter();

  const [run, setRun] = useState<Run | null>(null);
  const [index, setIndex] = useState(0);
  const [gate, setGate] = useState<Gate | null>(null);
  const [filled, setFilled] = useState<FormKey[]>([]);
  const [filling, setFilling] = useState<FormKey | null>(null);
  const [offRouteFor, setOffRouteFor] = useState<string | null>(null);

  // ---- starting ------------------------------------------------------------
  useEffect(() => {
    if (loading || !account?.active) return;
    if (run?.accountId === account.id) return;
    if (tourComplete(account.id) || automatedWithoutOptIn()) return;

    let live = true;
    void (async () => {
      const { data } = await getSupabase().rpc("acting_tenant");
      if (!live || (Array.isArray(data) && data.length > 0)) return;
      const steps = SEQUENCES[account.role];
      setIndex(Math.min(savedStep(account.id), steps.length));
      setRun({ accountId: account.id, role: account.role, steps });
    })();
    return () => { live = false; };
  }, [account, loading, run]);

  // Signed out, or somebody else signed in: the tour belongs to the account.
  const active = run && account?.id === run.accountId ? run : null;
  const step = active && index < active.steps.length ? active.steps[index]! : null;
  const done = active !== null && index >= active.steps.length;
  const verdict = gate?.index === index ? gate : null;
  const hidden = OFF_ROUTES.some((r) => samePath(pathname, r) || pathname.startsWith(`${r}/`));
  const onRoute = step !== null && step.type !== "card" && samePath(pathname, step.route);

  const go = useCallback((to: number) => {
    if (!active) return;
    setIndex(to);
    saveStep(active.accountId, to);
    setFilled([]);
    setFilling(null);
  }, [active]);

  const next = useCallback(() => go(index + 1), [go, index]);

  // THE SANDBOX IS EMPTIED ON THE WAY OUT. What the tour's own steps created
  // -- the admin's example project -- goes through the same delete_project the
  // admin would press, so it is soft-deleted like any other (invariant 8) and
  // the database decides whether it may be. Anything it refuses stays listed
  // on this device rather than being forgotten.
  const finish = useCallback(async () => {
    if (!active) return;
    const rows = createdRows(active.accountId);
    const kept: TourRow[] = [];
    for (const row of rows) {
      const { error } = await getSupabase().rpc("delete_project", { p_project: row.id });
      if (error) kept.push(row);
    }
    forgetCreated(active.accountId, kept);
    completeTour(active.accountId);
    setRun(null);
  }, [active]);

  // ---- can this step happen? ------------------------------------------------
  useEffect(() => {
    if (!step || step.type === "card") return;
    let live = true;
    void (async () => {
      if (step.requires && !(await met(step.requires))) {
        if (!live) return;
        if (step.otherwise) setGate({ index, state: "fallback", text: step.otherwise });
        else go(index + 1);
        return;
      }
      if (live) setGate({ index, state: "ok" });
    })();
    return () => { live = false; };
  }, [step, index, go]);

  // ---- a nav step whose element never appears becomes a card ---------------
  useEffect(() => {
    if (!step || step.type !== "nav" || verdict?.state !== "ok" || !onRoute) return;
    const began = Date.now();
    const id = window.setInterval(() => {
      if (resolveTargets(step.targets, step.all).length) {
        window.clearInterval(id);
      } else if (Date.now() - began > MISSING_AFTER_MS) {
        window.clearInterval(id);
        setGate({ index, state: "fallback", text: step.missing });
      }
    }, 300);
    return () => window.clearInterval(id);
  }, [step, index, verdict?.state, onRoute]);

  // ---- what ends a step ------------------------------------------------------
  useEffect(() => {
    if (!step || step.type !== "nav" || step.until !== "tap" || verdict?.state !== "ok") return;
    // Capture phase, and the step moves on without stopping the event: the tap
    // is the person's, and it must still do what it does.
    const onClick = (e: MouseEvent) => {
      const hit = e.target as Node;
      if (resolveTargets(step.targets, step.all).some((el) => el.contains(hit))) go(index + 1);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [step, index, verdict?.state, go]);

  useEffect(() => {
    if (!step || step.type !== "nav" || typeof step.until !== "object" || verdict?.state !== "ok") return;
    if (!samePath(pathname, step.until.route)) return;
    // From a callback rather than the effect body: the router is the outside
    // system here, and the step follows it rather than rendering twice.
    const id = window.setTimeout(() => go(index + 1), 0);
    return () => window.clearTimeout(id);
  }, [step, index, verdict?.state, pathname, go]);

  useEffect(() => {
    if (!step || step.type === "card" || verdict?.state !== "ok") return;
    const until = step.until;
    if (typeof until !== "string" || until === "tap" || until === "next") return;
    return onTourSignal((s) => { if (s === until) go(index + 1); });
  }, [step, index, verdict?.state, go]);

  // ---- off the step's screen --------------------------------------------------
  const routeKey = step && step.type !== "card" && !onRoute ? `${index}|${pathname}` : null;
  useEffect(() => {
    if (!routeKey) return;
    const id = window.setTimeout(() => setOffRouteFor(routeKey), OFF_ROUTE_GRACE_MS);
    return () => window.clearTimeout(id);
  }, [routeKey]);

  // ---- the forms' side of autofill ------------------------------------------
  const api = useMemo<TourApi>(() => ({
    wants: (form) =>
      verdict?.state === "ok" && !filled.includes(form) && (
        (step?.type === "autofill" && step.forms.includes(form)) ||
        (step?.type === "nav" && step.prepare === form)
      ),
    started: (form) => setFilling(form),
    finished: (form) => {
      setFilling((f) => (f === form ? null : f));
      setFilled((f) => (f.includes(form) ? f : [...f, form]));
    },
    // Only while an autofill step is running: a project the admin makes on
    // their own mid-tour is theirs, and must not be swept away at the end.
    created: (row) => { if (active && step?.type === "autofill") rememberCreated(active.accountId, row); },
  }), [step, verdict?.state, filled, active]);

  const lastFilled = filled[filled.length - 1];
  const submitResolve = useCallback((): Element[] => {
    if (step?.type !== "autofill" || !lastFilled) return [];
    const t = step.submit[lastFilled];
    return t ? resolveTargets([t]) : [];
  }, [step, lastFilled]);

  // A SANDBOX STEP'S SUBMIT DOES NOTHING. Its button is ringed to show where
  // the act is, but a press on it is caught before the page sees it: the step
  // ends at Nästa, and nothing real is created.
  const sandboxSubmit = step?.type === "autofill" && step.until === "next" && lastFilled !== undefined;
  useEffect(() => {
    if (!sandboxSubmit) return;
    const onClick = (e: MouseEvent) => {
      const hit = e.target as Node;
      if (submitResolve().some((el) => el.contains(hit))) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [sandboxSubmit, submitResolve]);

  const navResolve = useCallback(
    (): Element[] => (step?.type === "nav" ? resolveTargets(step.targets, step.all) : []),
    [step],
  );

  // ---- drawing ---------------------------------------------------------------
  let overlay: ReactNode = null;
  if (active && !hidden) {
    // A quarter on the first step, never empty; full on the last. Between
    // them the steps share the remaining three quarters evenly.
    const last = Math.max(active.steps.length - 1, 1);
    const progress = 25 + 75 * Math.min(index, last) / last;

    if (done) {
      overlay = <TourCard progress={100} title={DONE.title} line={DONE.line} button={DONE.button} onNext={() => { void finish(); }} />;
    } else if (step?.type === "card") {
      overlay = <TourCard progress={progress} title={step.text} button="Nästa" onNext={next} />;
    } else if (step && verdict?.state === "fallback") {
      overlay = <TourCard progress={progress} title={verdict.text ?? ""} button="Nästa" onNext={next} />;
    } else if (step && verdict?.state === "ok") {
      if (!onRoute) {
        if (offRouteFor === routeKey) {
          overlay = (
            <TourBar
              text={step.type === "nav" ? step.tip : "Nästa steg är ett formulär som fyller i sig självt."}
              action={{ label: "Ta mig dit", onClick: () => router.push(step.route) }}
              onSkip={next}
            />
          );
        }
      } else if (step.type === "nav") {
        overlay = <TourSpotlight key={index} resolve={navResolve} tip={step.tip} onSkip={next} />;
      } else if (filling || !lastFilled) {
        overlay = <TourBar text="Vi fyller i formuläret åt dig. Inget sparas förrän du trycker själv." onSkip={next} />;
      } else {
        overlay = (
          <TourSpotlight
            key={`${index}|${lastFilled}`}
            resolve={submitResolve}
            tip={step.tip[lastFilled] ?? ""}
            onSkip={next}
            action={step.until === "next" ? { label: "Nästa", onClick: next } : undefined}
          />
        );
      }
    }
  }

  return (
    <TourCtx.Provider value={active ? api : null}>
      {children}
      {overlay}
    </TourCtx.Provider>
  );
}
