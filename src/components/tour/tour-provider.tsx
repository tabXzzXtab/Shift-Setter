"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAccount, type Role } from "@/lib/account";
import { getSupabase } from "@/lib/supabase/client";
import { SETUP_ROUTE, companySetupNeeded } from "@/lib/company-setup";
import { DONE, SEQUENCES, met, type FormKey, type Step } from "@/lib/tour/steps";
import {
  automatedWithoutOptIn, completeTour, markSeen, requestReplay, saveStep, sessionStep,
  tourComplete,
} from "@/lib/tour/storage";
import { onTourSignal } from "@/lib/tour/signal";
import { resolveTargets, samePath } from "@/lib/tour/targets";
import { TourCard } from "./tour-card";
import { TourRings } from "./tour-spotlight";

/** Screens nobody is being shown around: signed out, or not a tenancy's app. */
const OFF_ROUTES = ["/login", "/onboarding", "/super", "/glomt-losenord", "/aterstall-losenord", SETUP_ROUTE];

/** How long a nav step waits for its element before it becomes a card. */
const MISSING_AFTER_MS = 8000;

type Run = { accountId: string; role: Role; steps: Step[] };
/** A step's verdict, keyed by its index so a stale one is never read. */
type Gate = { index: number; state: "ok" | "fallback"; text?: string };

type TourApi = {
  /** Whether the current step wants this form filled, and has not yet. */
  wants: (form: FormKey) => boolean;
  started: (form: FormKey) => void;
  finished: (form: FormKey) => void;
};

const TourCtx = createContext<TourApi | null>(null);

export function useTour(): TourApi | null {
  return useContext(TourCtx);
}

/** Guide: replay the tour from its first step. Always available, running or not. */
const ReplayCtx = createContext<(() => void) | null>(null);
export function useTourReplay(): (() => void) | null {
  return useContext(ReplayCtx);
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
  /**
   * The step whose "Visa mig" was pressed. Every step opens as its own white
   * full screen (TourCard); a step that needs the real app shows it -- with
   * only a ring, or the form filling itself -- once this is its index.
   */
  const [revealed, setRevealed] = useState<number | null>(null);
  /** Bumped by Guide, so the start effect runs again for the same account. */
  const [replays, setReplays] = useState(0);

  // ---- starting ------------------------------------------------------------
  useEffect(() => {
    if (loading || !account?.active) return;
    if (run?.accountId === account.id) return;
    if (automatedWithoutOptIn()) return;
    // Seen already, and not running in this session (a reload mid-tour) or
    // asked for again (Guide): nothing to show.
    const resume = sessionStep(account.id);
    if (tourComplete(account.id) && resume === null) return;

    let live = true;
    void (async () => {
      const { data } = await getSupabase().rpc("acting_tenant");
      if (!live || (Array.isArray(data) && data.length > 0)) return;
      // THE COMPANY FIRST. An admin whose company has no address, contact or
      // phone is sent to Ställ in ditt företag, and the tour waits -- nothing
      // is marked seen -- until it is saved. The effect runs again on the way
      // back from that screen, which is what starts the tour.
      if (await companySetupNeeded(account.id, account.role)) return;
      if (!live) return;
      const steps = SEQUENCES[account.role];
      markSeen(account.id);
      const from = Math.min(resume ?? 0, steps.length);
      saveStep(account.id, from);
      setIndex(from);
      setRun({ accountId: account.id, role: account.role, steps });
    })();
    return () => { live = false; };
    // pathname: coming back from Ställ in ditt företag is what lets it start.
  }, [account, loading, run, replays, pathname]);

  const replay = useCallback(() => {
    if (!account) return;
    requestReplay(account.id);
    setRun(null);
    setGate(null);
    setFilled([]);
    setFilling(null);
    setRevealed(null);
    setReplays((n) => n + 1);
  }, [account]);

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
    setRevealed(null);
  }, [active]);

  const next = useCallback(() => go(index + 1), [go, index]);

  // Nothing to clean up on the way out: the tour writes nothing.
  const finish = useCallback(() => {
    if (!active) return;
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
    if (!step || step.type !== "nav" || verdict?.state !== "ok" || !onRoute || revealed !== index) return;
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
  }, [step, index, verdict?.state, onRoute, revealed]);

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
    if (typeof until !== "string" || until === "tap" || until === "next" || until === "press") return;
    return onTourSignal((s) => { if (s === until) go(index + 1); });
  }, [step, index, verdict?.state, go]);

  // ---- the forms' side of autofill ------------------------------------------
  const api = useMemo<TourApi>(() => ({
    wants: (form) =>
      verdict?.state === "ok" && revealed === index && !filled.includes(form) && (
        (step?.type === "autofill" && step.forms.includes(form)) ||
        (step?.type === "nav" && step.prepare === form)
      ),
    started: (form) => setFilling(form),
    finished: (form) => {
      setFilling((f) => (f === form ? null : f));
      setFilled((f) => (f.includes(form) ? f : [...f, form]));
    },
  }), [step, verdict?.state, filled, revealed, index]);

  const lastFilled = filled[filled.length - 1];
  const submitResolve = useCallback((): Element[] => {
    if (step?.type !== "autofill" || !lastFilled) return [];
    const t = step.submit[lastFilled];
    return t ? resolveTargets([t]) : [];
  }, [step, lastFilled]);

  // ---- THE TOUR IS FRONTEND-ONLY ---------------------------------------------
  // A control that would write is ringed, and every event of a press on it is
  // caught in the capture phase on the document -- above React's root, so no
  // handler of the page ever runs. For a "press" step (and an autofill's
  // submit) the caught press IS the step: the tour moves on. On a "next" step
  // a press on a swallowed control moves it on the same way.
  //
  // It advances on the LAST event of a press -- click for a mouse, touchend
  // for a finger (whose touchstart is cancelled, so no click follows) --
  // because advancing earlier would leave the trailing click to land, uncaught,
  // on the very button the step just caught.
  const catching: { resolve: () => Element[]; advances: boolean } | null =
    verdict?.state !== "ok" || !step ? null
      : step.type === "nav" && step.until === "press"
        ? { resolve: () => resolveTargets(step.targets, step.all), advances: true }
        : step.type === "nav" && step.until === "next" && step.swallow
          // The press that would write is caught, and it is what moves the
          // step on: there is no bar with a Nästa on top of the app any more.
          ? { resolve: () => resolveTargets(step.swallow ?? [], true), advances: true }
          : step.type === "autofill" && lastFilled !== undefined
            ? { resolve: submitResolve, advances: true }
            : null;
  const catchResolve = catching?.resolve;
  const catchAdvances = catching?.advances ?? false;
  useEffect(() => {
    if (!catchResolve) return;
    let done = false;
    const onEvent = (e: Event) => {
      const hit = e.target as Node;
      if (!catchResolve().some((el) => el.contains(hit))) return;
      e.preventDefault();
      e.stopPropagation();
      // A DISABLED control never gets its click (Bekräfta dagen, before the
      // text is in), so a mouse would be stranded on the step. Its pointerup
      // counts instead -- safe there, because no trailing click can follow.
      const disabledHit = e.type === "pointerup" && !!(hit as Element).closest?.(":disabled");
      if (catchAdvances && !done && (e.type === "click" || e.type === "touchend" || disabledHit)) {
        done = true;
        go(index + 1);
      }
    };
    const types = ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "click"];
    for (const t of types) document.addEventListener(t, onEvent, { capture: true, passive: false });
    return () => { for (const t of types) document.removeEventListener(t, onEvent, { capture: true }); };
  }, [catchResolve, catchAdvances, go, index]);

  const navResolve = useCallback(
    (): Element[] => (step?.type === "nav" ? resolveTargets(step.targets, step.all) : []),
    [step],
  );

  // ---- drawing ---------------------------------------------------------------
  //
  // EVERY STEP IS A WHITE FULL SCREEN FIRST (owner, 2026-10-06). One that needs
  // the app says what to do there and offers "Visa mig"; the press takes the
  // person to the step's screen if they are elsewhere and shows the app with
  // only a ring (TourRings) -- or, for an autofill step, the form filling
  // itself and then a ring on the button that would write, which is caught.
  // Nothing is ever drawn on top of the app but the ring.
  let overlay: ReactNode = null;
  if (active && !hidden) {
    // A quarter on the first step, never empty; full on the last. Between
    // them the steps share the remaining three quarters evenly.
    const last = Math.max(active.steps.length - 1, 1);
    const progress = 25 + 75 * Math.min(index, last) / last;
    const shared = { progress, step: Math.min(index + 1, active.steps.length), total: active.steps.length, onClose: finish };

    if (done) {
      overlay = (
        <TourCard
          {...shared} progress={100} step={active.steps.length}
          title={DONE.title} em={DONE.em} line={DONE.line} button={DONE.button} icon="done" onNext={finish}
        />
      );
    } else if (step?.type === "card") {
      overlay = <TourCard {...shared} title={step.text} em={step.em} button="Nästa" onNext={next} onSkip={next} />;
    } else if (step && verdict?.state === "fallback") {
      overlay = <TourCard {...shared} title={verdict.text ?? ""} button="Nästa" onNext={next} onSkip={next} />;
    } else if (step && verdict?.state === "ok") {
      if (revealed !== index || !onRoute) {
        const say = step.type === "nav" ? (step.tip || step.say || "") : step.say;
        overlay = (
          <TourCard
            {...shared}
            title={say}
            em={step.em}
            button="Visa mig"
            icon={step.type === "autofill" ? "fill" : "do"}
            onNext={() => {
              setRevealed(index);
              if (!onRoute) router.push(step.route);
            }}
            onSkip={next}
          />
        );
      } else if (step.type === "nav") {
        overlay = <TourRings key={index} resolve={navResolve} />;
      } else if (!filling && lastFilled) {
        overlay = <TourRings key={`${index}|${lastFilled}`} resolve={submitResolve} />;
      }
    }
  }

  return (
    <ReplayCtx.Provider value={account?.active ? replay : null}>
      <TourCtx.Provider value={active ? api : null}>
        {children}
        {overlay}
      </TourCtx.Provider>
    </ReplayCtx.Provider>
  );
}
