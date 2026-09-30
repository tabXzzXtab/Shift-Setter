"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import {
  C, Card, EmptyState, SectionLabel, Segmented, SoftField, SoftNotice, SoftScreen, SoftSelect, Tag,
} from "@/components/soft";
import { getSupabase } from "@/lib/supabase/client";
import { useAccount, type Role } from "@/lib/account";
import { fel } from "@/lib/fel";

type Times = {
  screen: string; role: Role; visits: number;
  avg_ms: number | null; median_ms: number | null; p90_ms: number | null; taps: number;
};
type Bin = { x_bin: number; y_bin: number; taps: number };
type Tenant = { id: string; name: string };

const PERIODS = [
  { value: "7", label: "7 dagar" },
  { value: "30", label: "30 dagar" },
  { value: "90", label: "90 dagar" },
] as const;
type Period = (typeof PERIODS)[number]["value"];

const ROLE_WORD: Record<Role, string> = { admin: "Admin", arbetsledare: "Arbetsledare", arbetare: "Arbetare" };
const ROLE_TONE: Record<Role, "deep" | "warn" | "quiet"> = { admin: "deep", arbetsledare: "warn", arbetare: "quiet" };

/** 12 s · 1 min 5 s · 1 h 3 min. A time on screen is read, not computed with. */
function duration(ms: number | null): string {
  if (ms === null) return "–";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/**
 * The period as a window: half-open, and ending a minute ahead so events sent
 * while the page is open fall inside it. Computed where it is fetched, not in
 * render -- "now" is not a value a render may depend on.
 */
function windowFor(period: string) {
  const to = new Date(Date.now() + 60_000);
  const from = new Date(to.getTime() - Number(period) * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Rows shown in the heatmap: three screenfuls, then the rest is counted. */
const MAX_ROWS = 60;

/**
 * Analys -- time on screen and taps, for the people who run ByggKoll.
 *
 * THE BOUNDARY IS THE DATABASE. analytics_screen_times and analytics_taps
 * refuse anybody who is not the operator, and nobody at all can read the raw
 * rows (migration 20260929100000). The notice below for anyone else is the
 * courtesy that explains, exactly as on /super.
 *
 * WHAT IT CAN SAY. Averages per screen per role, and where on a screen people
 * tap. Not who: there is no account on a row to say it with. A company with
 * one admin makes "admin" one person, which is worth remembering when reading
 * a single company's numbers.
 */
function AnalysScreen() {
  const { account, loading } = useAccount();
  const [isSuper, setIsSuper] = useState<boolean | null>(null);
  const [period, setPeriod] = useState<Period>("30");
  const [tenant, setTenant] = useState<string>("");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [times, setTimes] = useState<Times[] | null>(null);
  const [pick, setPick] = useState<string>("");     // "screen|role"
  const [bins, setBins] = useState<Bin[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;
    let live = true;
    void (async () => {
      const { data } = await getSupabase()
        .from("account").select("super_admin").eq("id", account.id).maybeSingle();
      if (live) setIsSuper(Boolean(data?.super_admin));
    })();
    return () => { live = false; };
  }, [account]);

  useEffect(() => {
    if (isSuper !== true) return;
    let live = true;
    void (async () => {
      const { data } = await getSupabase().from("tenant").select("id, name").order("name");
      if (live) setTenants((data ?? []) as Tenant[]);
    })();
    return () => { live = false; };
  }, [isSuper]);

  useEffect(() => {
    if (isSuper !== true) return;
    let live = true;
    void (async () => {
      const w = windowFor(period);
      const { data, error } = await getSupabase().rpc("analytics_screen_times", {
        p_from: w.from, p_to: w.to, p_tenant: tenant || undefined,
      });
      if (!live) return;
      if (error) { setError(fel(error, "Kunde inte läsa analysen. Ladda om sidan.")); setTimes([]); return; }
      setError(null);
      setTimes((data ?? []) as Times[]);
    })();
    return () => { live = false; };
  }, [isSuper, period, tenant]);

  const tapped = (times ?? []).filter((t) => t.taps > 0);
  const chosen = tapped.find((t) => `${t.screen}|${t.role}` === pick) ?? tapped[0] ?? null;

  useEffect(() => {
    if (!chosen) return;
    let live = true;
    void (async () => {
      const w = windowFor(period);
      const { data, error } = await getSupabase().rpc("analytics_taps", {
        p_screen: chosen.screen, p_role: chosen.role,
        p_from: w.from, p_to: w.to, p_tenant: tenant || undefined,
      });
      if (!live) return;
      if (error) { setError(fel(error, "Kunde inte läsa trycken. Ladda om sidan.")); setBins([]); return; }
      setBins((data ?? []) as Bin[]);
    })();
    return () => { live = false; };
    // The screen and role are what matter, not the object's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen?.screen, chosen?.role, period, tenant]);

  if (loading || isSuper === null) {
    return <SoftScreen title="Se användningen" back="/super"><div className="px-4 pt-[14px]" /></SoftScreen>;
  }
  if (!isSuper) {
    return (
      <SoftScreen title="Se användningen" back="/">
        <div className="px-4 pt-[2px]">
          <SoftNotice tone="quiet">Den här sidan är för dem som driver ByggKoll.</SoftNotice>
        </div>
      </SoftScreen>
    );
  }

  const byScreen = new Map<string, Times[]>();
  for (const t of times ?? []) {
    if (!byScreen.has(t.screen)) byScreen.set(t.screen, []);
    byScreen.get(t.screen)!.push(t);
  }

  return (
    <SoftScreen
      title="Se användningen"
      back="/super"
    >
      {error && <div className="px-4 pt-[10px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}

      <div className="flex flex-col gap-[14px] px-4 pt-[14px]">
        <Segmented label="Period" options={[...PERIODS]} value={period} onChange={setPeriod} />
        <SoftField label="Företag">
          <SoftSelect value={tenant} onChange={(e) => setTenant(e.target.value)}>
            <option value="">Alla företag</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </SoftSelect>
        </SoftField>
      </div>

      {/* ---- time on screen ------------------------------------------------ */}
      <div className="px-4 pt-[26px]">
        <SectionLabel>Tid per skärm</SectionLabel>
        {times === null && <p className="px-1 text-[15px] font-medium" style={{ color: C.text2 }}>Laddar…</p>}
        {times !== null && byScreen.size === 0 && (
          <EmptyState headline="Inget än">Inga besök under perioden.</EmptyState>
        )}
        <div className="flex flex-col gap-[10px]">
          {[...byScreen.entries()].map(([screen, rows]) => (
            <Card key={screen} radius={14} pad="px-4 py-[14px]">
              <div data-screen-row={screen} className="pb-2 text-[17px] font-extrabold" style={{ letterSpacing: "-.3px" }}>
                {screen}
              </div>
              <div className="flex flex-col gap-2">
                {rows.map((r) => (
                  <div key={r.role} data-times={`${r.screen}|${r.role}`}
                       className="flex items-center justify-between gap-3">
                    <Tag tone={ROLE_TONE[r.role]}>{ROLE_WORD[r.role]}</Tag>
                    <div className="text-right text-[15px] font-semibold">
                      <span style={{ color: C.accent }}>{duration(r.median_ms)}</span>
                      <span style={{ color: C.text2 }}> median · snitt {duration(r.avg_ms)} · {r.visits} besök</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* ---- taps ------------------------------------------------------------ */}
      <div className="px-4 pt-[26px]">
        <SectionLabel>Tryck</SectionLabel>
        {times !== null && tapped.length === 0 && <EmptyState>Inga tryck under perioden.</EmptyState>}
        {chosen && (
          <div className="flex flex-col gap-[14px]">
            <SoftField label="Skärm och roll">
              <SoftSelect value={`${chosen.screen}|${chosen.role}`} onChange={(e) => setPick(e.target.value)}>
                {tapped.map((t) => (
                  <option key={`${t.screen}|${t.role}`} value={`${t.screen}|${t.role}`}>
                    {t.screen} · {ROLE_WORD[t.role]} · {t.taps} tryck
                  </option>
                ))}
              </SoftSelect>
            </SoftField>
            {bins && <Heatmap bins={bins} />}
          </div>
        )}
      </div>
    </SoftScreen>
  );
}

/**
 * The taps on a phone-width frame: 20 columns across the viewport, rows in
 * twentieths of a screen height going down the page. Deeper blue, more taps.
 * The busiest cells are also listed in words, so the colour is never the only
 * way to read it.
 */
function Heatmap({ bins }: { bins: Bin[] }) {
  const max = Math.max(1, ...bins.map((b) => b.taps));
  const rows = Math.min(MAX_ROWS, Math.max(20, ...bins.map((b) => b.y_bin + 1)));
  const below = bins.filter((b) => b.y_bin >= MAX_ROWS).reduce((n, b) => n + b.taps, 0);
  const cell = new Map(bins.map((b) => [`${b.x_bin}|${b.y_bin}`, b.taps]));
  const top = [...bins].sort((a, b) => b.taps - a.taps).slice(0, 5);
  const total = bins.reduce((n, b) => n + b.taps, 0);

  return (
    <Card radius={14} pad="p-[14px]">
      <div
        role="img"
        aria-label={`Värmekarta över ${total} tryck`}
        data-heatmap={total}
        className="mx-auto grid w-full max-w-[240px] overflow-hidden rounded-[9px]"
        style={{ gridTemplateColumns: "repeat(20, 1fr)", background: C.panel2 }}
      >
        {Array.from({ length: rows * 20 }, (_, i) => {
          const n = cell.get(`${i % 20}|${Math.floor(i / 20)}`) ?? 0;
          return (
            <div
              key={i}
              className="aspect-square"
              title={n ? `${n} tryck` : undefined}
              style={{ background: n ? `rgba(27,44,193,${0.15 + 0.85 * (n / max)})` : "transparent" }}
            />
          );
        })}
      </div>
      <div className="pt-[12px] text-[14px] font-medium" style={{ color: C.text2 }}>
        {total} tryck.{below ? ` ${below} längre ner än tre skärmhöjder visas inte.` : ""}
      </div>
      <ul className="pt-2 text-[15px] font-medium">
        {top.map((b) => (
          <li key={`${b.x_bin}|${b.y_bin}`}>
            {Math.round((b.x_bin + 0.5) * 5)} % in, {Math.round((b.y_bin + 0.5) * 5)} % ner: {b.taps} tryck
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <AnalysScreen />
    </AuthGate>
  );
}
