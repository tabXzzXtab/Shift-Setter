"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import {
  C, Card, ChevronRight, EmptyState, Segmented, SoftNotice, SoftScreen, Tag,
} from "@/components/soft";
import { getSupabase } from "@/lib/supabase/client";
import { hhmm, longDayHeading } from "@/lib/dates";
import { pendingSummaries, type PendingSummary } from "@/lib/pending-days";
import { reviewSummaries, type ReviewSummary } from "@/lib/review-days";
import { useAccount } from "@/lib/account";

type Act = { action: string; note: string | null; acted_at: string };

type Row = { worker_name: string; tider: string; hours: number | null };

type Day = {
  key: string;
  project_id: string;
  project_name: string;
  work_date: string;
  vad_vi_gjorde: string;
  stage: string | null;
  route: string | null;
  confirmed_by_name: string | null;
  reviewed_by_name: string | null;
  filed: boolean;
  rows: Row[];
  log: Act[];
};

type View = "att" | "historik";

/** Swedish decimal comma, and no trailing ",0" on a whole number. */
const hh = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r).replace(".", ",");
};

/** How a day was closed, in the words the record actually distinguishes. */
function routeLabel(route: string | null, reviewer: string | null): string {
  if (route === "bristsurvey") return "Bristsurvey — admin rekonstruerade dagen";
  if (reviewer) return "Bekräftad av arbetsledaren, godkänd av admin";
  return "Bekräftad av arbetsledaren";
}

/** 12/700/+1 uppercase, the handoff's day header. */
function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="pb-[2px] text-[12px] font-bold uppercase"
      style={{ letterSpacing: "1px", color: C.text2 }}
    >
      {children}
    </div>
  );
}

/**
 * Bekräftelser -- one day's confirmation, before and after, on one screen.
 *
 * "Att bekräfta" is what is still owed and "Historik" is what is settled. They
 * were two menu entries pointing at two screens, and the leader had to know
 * which of them a given day had already reached in order to look for it. One
 * switch says the same thing without asking.
 *
 * BOTH ROLES GET THE SWITCH, AND THEY ARE NOT THE SAME QUEUE. "Att bekräfta"
 * is whatever is outstanding for the person reading it: for the arbetsledare
 * that is stage 1, the days they stood on and have not yet accounted for; for
 * the admin it is stage 2, the days a leader has already accounted for and the
 * flagged ones nobody could. The admin is never offered a stage 1 day --
 * CLAUDE.md's "the admin cannot make a stage 1 confirmation", invariant 4b --
 * and a queue of days the database would refuse him is not a queue.
 *
 * THE HANDOFF DOES NOT DRAW THIS SCREEN -- it predates the merge, and lists
 * "Bekräftelse historik" as one of the leader's eight. So it is composed from
 * the vocabulary the handoff does define: its segmented control, its cards,
 * its day kicker, its empty state and its status tags. Nothing here invents a
 * value; everything here is a value used somewhere else in the bundle.
 */
function Bekraftelser() {
  const { account, loading } = useAccount();
  const role = account?.role;
  const isLeader = role === "arbetsledare";
  const isAdmin = role === "admin";
  const queue = isLeader || isAdmin;
  const [view, setView] = useState<View>("att");

  if (loading) {
    return (
      <SoftScreen title="Bekräftelser" back="/">
        <div className="px-4 pt-2 text-[15px] font-medium" style={{ color: C.text2 }}>Laddar…</div>
      </SoftScreen>
    );
  }

  const showing: View = queue ? view : "historik";

  return (
    <SoftScreen title="Bekräftelser" back="/">
      {/* Both states always visible, the current one on the white thumb. A
          control that hides the thing it switches to makes people press it to
          find out. */}
      {queue && (
        <div className="px-4 pt-[2px]">
          <Segmented
            label="Visa"
            value={view}
            onChange={setView}
            options={[
              { value: "att", label: "Att bekräfta" },
              { value: "historik", label: "Historik" },
            ]}
          />
        </div>
      )}

      {showing === "att"
        ? (isAdmin ? <AttGranska /> : <AttBekrafta />)
        : <Historik forLeader={isLeader} />}
    </SoftScreen>
  );
}

/**
 * The days waiting on the ADMIN at stage 2, flagged first then oldest first.
 *
 * WHICH days is lib/review-days' answer and nobody else's, so this list and
 * Granska Pass cannot disagree, and every row opens the day it names rather
 * than dropping the owner at the head of the queue.
 *
 * A flagged day is called out here rather than only inside: it is the one kind
 * of day where nobody was answerable, so it is the one an owner should be able
 * to pick out of a list without opening anything.
 *
 * The hours shown are the LEADER'S FIGURES, totalled -- what the admin is
 * being asked to approve. A flagged day has none, because nobody stated any,
 * and it says so rather than showing a 0 that would read as a claim that
 * nobody worked.
 */
function AttGranska() {
  const [days, setDays] = useState<ReviewSummary[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const q = await reviewSummaries();
        if (active) setDays(q);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Kunde inte läsa dagarna.");
        setDays([]);
      }
    })();
    return () => { active = false; };
  }, []);

  if (days === undefined) {
    return (
      <div className="px-4 pt-[26px] text-[15px] font-medium" style={{ color: C.text2 }}>
        Laddar…
      </div>
    );
  }

  return (
    <>
      {error && <div className="px-4 pt-[14px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}

      {days.length === 0 ? (
        <div className="px-4 pt-[26px]">
          <EmptyState headline="Inget att godkänna">
            Dagar arbetsledarna bekräftat hamnar här.
          </EmptyState>
        </div>
      ) : (
        days.map((d) => (
          <div key={d.key} className="px-4 pt-[14px]">
            <Link href={`/granska?projekt=${d.project_id}&datum=${d.work_date}`} className="block">
              <Card radius={14} className="hover:bg-[#f6f9ff]">
                <Kicker>{longDayHeading(d.work_date)}</Kicker>
                <div className="flex items-baseline justify-between gap-[10px]">
                  <div className="text-[18px] font-bold" style={{ letterSpacing: "-.4px" }}>
                    {d.project_name}
                  </div>
                  <div className="shrink-0 text-[15px] font-bold" style={{ color: C.accent }}>
                    {d.hours === null ? "—" : `${hh(d.hours)} h`}
                  </div>
                </div>

                {(d.flagged_as || d.came_back) && (
                  <div className="flex flex-wrap gap-[6px] pt-[8px]">
                    {d.flagged_as && (
                      <Tag tone="warn">
                        {d.flagged_as === "ingen_ledare" ? "Utan arbetsledare" : "Arbetare ansvarig"}
                      </Tag>
                    )}
                    {d.came_back && <Tag tone="quiet">Återsänd en gång</Tag>}
                  </div>
                )}

                <div className="mt-[6px] flex items-center justify-between gap-[10px]">
                  <div className="text-[15px] font-medium" style={{ color: C.text2 }}>
                    {d.workers.length > 0 ? d.workers.join(", ") : "Ingen tilldelad"}
                  </div>
                  <ChevronRight />
                </div>
              </Card>
            </Link>
          </div>
        ))
      )}
    </>
  );
}

/**
 * The days still waiting on this leader, oldest first.
 *
 * WHICH days is lib/pending-days' answer and nobody else's, so this list, the
 * landing page's widget and Bekräfta Pass itself cannot disagree. Every row
 * opens that day by name rather than dropping the leader at the top of the
 * queue: a list you can point at and a page that ignores where you pointed
 * would be a worse lie than no list.
 */
function AttBekrafta() {
  const [waiting, setWaiting] = useState<PendingSummary[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const days = await pendingSummaries();
        if (active) setWaiting(days);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Kunde inte läsa passen.");
        setWaiting([]);
      }
    })();
    return () => { active = false; };
  }, []);

  if (waiting === undefined) {
    return (
      <div className="px-4 pt-[26px] text-[15px] font-medium" style={{ color: C.text2 }}>
        Laddar…
      </div>
    );
  }

  return (
    <>
      {error && <div className="px-4 pt-[14px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}

      {waiting.length === 0 ? (
        <div className="px-4 pt-[26px]">
          <EmptyState headline="Inget väntar på dig">
            Dagar som behöver dig hamnar här.
          </EmptyState>
        </div>
      ) : (
        waiting.map((d) => (
          <div key={d.key} className="px-4 pt-[14px]">
            <Link href={`/bekrafta?projekt=${d.project_id}&datum=${d.work_date}`} className="block">
              <Card radius={14} className="hover:bg-[#f6f9ff]">
                <Kicker>{longDayHeading(d.work_date)}</Kicker>
                <div className="flex items-baseline justify-between gap-[10px]">
                  <div className="text-[18px] font-bold" style={{ letterSpacing: "-.4px" }}>
                    {d.project_name}
                  </div>
                  <div className="shrink-0 text-[15px] font-bold" style={{ color: C.accent }}>
                    {hh(d.hours)} h
                  </div>
                </div>
                <div className="mt-[6px] flex items-center justify-between gap-[10px]">
                  <div className="text-[15px] font-medium" style={{ color: C.text2 }}>
                    {d.workers.length > 0 ? d.workers.join(", ") : "Ingen tilldelad"}
                  </div>
                  <ChevronRight />
                </div>
              </Card>
            </Link>
          </div>
        ))
      )}
    </>
  );
}

/**
 * The readable log of days that are finished with.
 *
 * A day arrives here by either of two routes and can arrive by both: the admin
 * approved it at stage 2, or an Arbetsdagbok was generated over it, which
 * consumes a day whatever stage it had reached.
 *
 * WHAT IS SHOWN IS CURRENT, NOT PRINTED. If the admin edited a day at stage 2
 * after the document was produced, the new figures show here and the PDF does
 * not change -- it is a snapshot of the moment it was made, and regenerating
 * the range is how a corrected document is obtained. The two disagreeing is
 * intended.
 *
 * Admin and arbetsledare both read it. The scoping is the database's:
 * public.day_history answers the same question for both, so a leader and the
 * owner can never be looking at two different versions of the same log.
 *
 * A DAY THE LEADER HAS JUST CONFIRMED IS IN NEITHER VIEW. day_history takes a
 * day once it is finished with -- approved at stage 2 or consumed by a
 * document -- so between the leader's claim and the admin's sign-off the day
 * is out of the leader's queue and not yet in the log. The note says so rather
 * than letting the day appear to have been lost.
 */
function Historik({ forLeader }: { forLeader: boolean }) {
  const [days, setDays] = useState<Day[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void (async () => {
      const sb = getSupabase();

      const { data: history, error: hErr } = await sb
        .from("day_history")
        .select("*")
        .order("work_date", { ascending: false })
        .limit(60);

      if (!active) return;
      if (hErr) { setError(hErr.message); setDays([]); return; }
      if (!history || history.length === 0) { setDays([]); return; }

      const projectIds = [...new Set(history.map((h) => h.project_id!).filter(Boolean))];
      const dates = [...new Set(history.map((h) => h.work_date!).filter(Boolean))];

      // Two coarse filters and an exact match in the browser. PostgREST has no
      // tuple IN, and asking per day would be one round trip per row.
      const { data: passes } = await sb
        .from("pass")
        .select("id, project_id, work_date, start_time, end_time")
        .in("project_id", projectIds)
        .in("work_date", dates);

      const { data: assignments } = await sb
        .from("tilldelning")
        .select("id, pass_id, worker_id, confirmed_hours")
        .in("pass_id", (passes ?? []).map((p) => p.id))
        .is("released_at", null);

      const { data: roster } = await sb.from("worker_roster").select("id, name");

      const { data: log } = await sb
        .from("day_review")
        .select("project_id, work_date, action, note, acted_at")
        .in("project_id", projectIds)
        .in("work_date", dates)
        .order("acted_at");

      if (!active) return;

      const names = new Map((roster ?? []).map((w) => [w.id, w.name ?? ""]));
      const passById = new Map((passes ?? []).map((p) => [p.id, p]));

      setDays(
        history.map((h) => {
          const key = `${h.project_id}|${h.work_date}`;

          const rows: Row[] = (assignments ?? [])
            .filter((a) => {
              const p = passById.get(a.pass_id);
              return p && p.project_id === h.project_id && p.work_date === h.work_date;
            })
            .map((a) => {
              const p = passById.get(a.pass_id)!;
              return {
                worker_name: names.get(a.worker_id) ?? "Okänd",
                tider: `${hhmm(p.start_time)}–${hhmm(p.end_time)}`,
                hours: a.confirmed_hours === null ? null : Number(a.confirmed_hours),
              };
            })
            .sort((a, b) => a.worker_name.localeCompare(b.worker_name, "sv"));

          return {
            key,
            project_id: h.project_id!,
            project_name: h.project_name ?? "Projekt",
            work_date: h.work_date!,
            vad_vi_gjorde: h.vad_vi_gjorde ?? "",
            stage: h.stage,
            route: h.confirmed_via,
            confirmed_by_name: h.confirmed_by_name,
            reviewed_by_name: h.reviewed_by_name,
            filed: h.filed ?? false,
            rows,
            log: (log ?? [])
              .filter((l) => `${l.project_id}|${l.work_date}` === key)
              .map((l) => ({ action: l.action, note: l.note, acted_at: l.acted_at })),
          };
        }),
      );
    })();

    return () => { active = false; };
  }, []);

  if (days === undefined) {
    return (
      <div className="px-4 pt-[26px] text-[15px] font-medium" style={{ color: C.text2 }}>
        Laddar…
      </div>
    );
  }

  return (
    <>
      {error && <div className="px-4 pt-[14px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}

      {forLeader && (
        <div className="px-4 pt-[14px]">
          <div className="px-1 text-[15px] font-medium" style={{ color: C.text2, textWrap: "pretty" }}>
            Dagar du bekräftat visas här när admin har godkänt dem.
          </div>
        </div>
      )}

      {days.length === 0 ? (
        <div className="px-4 pt-[14px]">
          <EmptyState headline="Inga avslutade dagar än">
            Dagar som är klara hamnar här.
          </EmptyState>
        </div>
      ) : (
        days.map((d) => (
          <div key={d.key} className="px-4 pt-[14px]">
            <Card radius={14}>
              <Kicker>{longDayHeading(d.work_date)}</Kicker>
              <div className="flex items-baseline justify-between gap-[10px]">
                <div className="text-[18px] font-bold" style={{ letterSpacing: "-.4px" }}>
                  {d.project_name}
                </div>
                <Tag tone={d.stage === "admin_confirmed" ? "live" : "quiet"}>
                  {d.stage === "admin_confirmed" ? "Godkänd" : "Bekräftad"}
                </Tag>
              </div>

              <div className="mt-[6px] text-[15px] font-medium" style={{ color: C.text2 }}>
                {routeLabel(d.route, d.reviewed_by_name)}
              </div>
              <div className="mt-[2px] text-[14px] font-medium" style={{ color: C.chevron }}>
                {d.confirmed_by_name ?? "—"}
                {d.reviewed_by_name ? ` · godkänd av ${d.reviewed_by_name}` : ""}
                {d.filed ? " · arkiverad i en arbetsdagbok" : ""}
              </div>

              <div className="mt-[14px] rounded-[10px] px-[14px] py-[6px]" style={{ background: C.panel2 }}>
                {d.rows.map((r, i) => (
                  <div
                    key={i}
                    className="flex items-baseline justify-between gap-3 py-[8px]"
                    style={i > 0 ? { boxShadow: `inset 0 1px 0 ${C.hairline}` } : undefined}
                  >
                    <span className="text-[15px] font-semibold">{r.worker_name}</span>
                    <span className="shrink-0 text-[15px] font-medium" style={{ color: C.text2 }}>
                      {r.tider} · {r.hours === null ? "—" : String(r.hours).replace(".", ",")} h
                    </span>
                  </div>
                ))}
              </div>

              {d.vad_vi_gjorde && (
                <p className="mt-[14px] text-[15px] font-medium" style={{ textWrap: "pretty" }}>
                  {d.vad_vi_gjorde}
                </p>
              )}

              {d.log.length > 0 && (
                <div className="mt-[14px] pt-[10px]" style={{ boxShadow: `inset 0 1px 0 ${C.hairline}` }}>
                  {d.log.map((a, i) => (
                    <div key={i} className="text-[14px] font-medium" style={{ color: C.text2 }}>
                      {a.action === "rejected" ? "Underkänd" : "Godkänd"} {a.acted_at.slice(0, 10)}
                      {a.note ? ` — ${a.note}` : ""}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        ))
      )}
    </>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <Bekraftelser />
    </AuthGate>
  );
}
