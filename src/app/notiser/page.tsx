"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import { C, EmptyState, SecondaryButton, SoftNotice, SoftScreen } from "@/components/soft";
import { getSupabase } from "@/lib/supabase/client";
import { fel } from "@/lib/fel";
import { svDate } from "@/lib/dates";
import { notisHref, notisText, type NotisRow } from "@/lib/notiser";

/**
 * Notiser -- every notification the reader has, newest first, for all three
 * roles (owner, 2026-10-06). The startsida carries only the bell and its
 * count; this is where the rows are.
 *
 * The pattern is Shopify's and Mindtrip's alerts screens (Mobbin): a small
 * line saying what it concerns and when, with a dot while it is unread, the
 * notification's title in bold, its one sentence under it, and "N olästa"
 * plus Markera alla som lästa at the top. Separate white tiles, the handoff's
 * list (README section 1).
 *
 * Tapping a row marks THAT row read and opens what it is about. Reading is the
 * only write there is: app.tg_notification_only_read refuses anything else,
 * and a read notification stays read.
 */
function Notiser() {
  const router = useRouter();
  const [rows, setRows] = useState<NotisRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data, error: e } = await getSupabase()
        .from("my_notification")
        .select("id, kind, created_at, read_at, work_date, project_name, payload")
        .order("created_at", { ascending: false })
        .limit(200);
      if (!live) return;
      if (e) { setError(fel(e, "Notiserna kunde inte läsas. Ladda om sidan.")); setRows([]); return; }
      setRows((data ?? []) as NotisRow[]);
    })();
    return () => { live = false; };
  }, [reload]);

  const unread = (rows ?? []).filter((r) => !r.read_at).length;

  async function markAll() {
    setBusy(true);
    setError(null);
    const { error: e } = await getSupabase().rpc("mark_notifications_read", {});
    if (e) setError(fel(e, "Notiserna kunde inte markeras som lästa. Försök igen."));
    setBusy(false);
    setReload((n) => n + 1);
  }

  async function open(n: NotisRow) {
    if (!n.read_at) {
      // Marked before leaving, so the count on the bell is right when the
      // reader comes back. A failure here is not worth stopping them for.
      await getSupabase().rpc("mark_notifications_read", { p_ids: [n.id] });
    }
    router.push(notisHref(n));
  }

  return (
    <SoftScreen
      title="Notiser"
      back="/"
      subtitle={rows && rows.length > 0 ? (unread === 0 ? "Allt är läst." : `${unread} olästa`) : undefined}
    >
      {error && <div className="px-4 pt-[6px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}

      {rows === null && (
        <p className="px-4 pt-[6px] text-[15px] font-medium" style={{ color: C.text2 }}>Laddar…</p>
      )}

      {rows !== null && rows.length === 0 && !error && (
        <div className="px-4 pt-[6px]">
          <EmptyState headline="Inga notiser">Här hamnar det som händer med dina pass och dagar.</EmptyState>
        </div>
      )}

      {unread > 0 && (
        <div className="px-4 pt-[6px]">
          <SecondaryButton onClick={markAll} disabled={busy}>
            {busy ? "Markerar…" : "Markera alla som lästa"}
          </SecondaryButton>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <ul className="flex flex-col gap-[8px] px-4 pt-[14px]">
          {rows.map((n) => {
            const { title, body } = notisText(n);
            const fresh = !n.read_at;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  data-notis={n.kind}
                  data-unread={fresh ? "1" : "0"}
                  onClick={() => open(n)}
                  className="press-scale block w-full rounded-[16px] px-[18px] py-[14px] text-left transition-transform duration-[110ms] hover:bg-[#fbfaf8] active:scale-[.985]"
                  style={{ background: C.surface }}
                >
                  <span className="flex items-center gap-[7px] text-[13px] font-medium" style={{ color: C.text2 }}>
                    {fresh && (
                      <span aria-label="Oläst" className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: C.accent }} />
                    )}
                    {svDate(n.created_at)}
                  </span>
                  <span className={`mt-[3px] block text-[17px] ${fresh ? "font-extrabold" : "font-semibold"}`}
                    style={{ letterSpacing: "-.2px" }}>
                    {title}
                  </span>
                  <span className="mt-[2px] block text-[15px]" style={{ color: C.text2, textWrap: "pretty" }}>
                    {body}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </SoftScreen>
  );
}

export default function Page() {
  return (
    <AuthGate>
      <Notiser />
    </AuthGate>
  );
}
