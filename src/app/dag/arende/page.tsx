"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import { C, SoftNotice, SoftScreen } from "@/components/soft";
import {
  EventCard, HANDELSE_COLUMNS, NyHandelse, pickableFrom, useKonton, type Handelse,
} from "@/components/handelse";
import { getSupabase } from "@/lib/supabase/client";
import { useAccount } from "@/lib/account";
import { fel } from "@/lib/fel";

/**
 * An ärende on its own full screen: a new one (no ?id=) or one tapped on the
 * day's timeline (?id=).
 *
 * NEW: the same NyHandelse form that used to open inline in the middle of the
 * day page, now alone on a screen, with the day set. Saving or cancelling goes
 * back to the day.
 *
 * ONE: the same EventCard the day page listed, with its viewers read back and
 * Ta bort for the owner. RLS decides which ärenden a caller can see at all --
 * the owner's, and the ones they were named on -- so an id somebody may not
 * read simply finds nothing.
 */
function Ny({ date, from }: { date: string; from: string }) {
  const router = useRouter();
  const { account } = useAccount();
  const konton = useKonton();
  const me = account?.id ?? null;
  return (
    <SoftScreen title="Lägg in ett ärende" back={from} subtitle="Välj vilka som ska se det innan du sparar.">
      <div className="px-4 pt-[2px]">
        <NyHandelse
          date={date}
          ownerId={me}
          pickable={pickableFrom(konton, me)}
          onCancel={() => router.push(from)}
          onSaved={() => router.push(from)}
        />
      </div>
    </SoftScreen>
  );
}

function Ett({ id, from }: { id: string; from: string }) {
  const router = useRouter();
  const { account } = useAccount();
  const konton = useKonton();
  const [event, setEvent] = useState<Handelse | null | undefined>(undefined);
  const [viewers, setViewers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const sb = getSupabase();
      const { data, error } = await sb.from("personal_event").select(HANDELSE_COLUMNS).eq("id", id).maybeSingle();
      if (!live) return;
      if (error) { setError(fel(error, "Kunde inte läsa ärendet. Ladda om sidan.")); setEvent(null); return; }
      setEvent((data as Handelse | null) ?? null);
      const { data: vs } = await sb.from("personal_event_viewer").select("account_id").eq("event_id", id);
      if (live) setViewers((vs ?? []).map((v) => v.account_id));
    })();
    return () => { live = false; };
  }, [id]);

  async function remove() {
    setBusy(true); setError(null);
    // Viewer rows go with it: the foreign key is ON DELETE CASCADE.
    const { error } = await getSupabase().from("personal_event").delete().eq("id", id);
    setBusy(false);
    if (error) setError(fel(error, "Ärendet kunde inte tas bort. Ladda om sidan."));
    else router.push(from);
  }

  const nameOf = (a: string) => konton.find((k) => k.id === a)?.name ?? null;

  return (
    <SoftScreen title={event?.title ?? "Ärende"} back={from}>
      <div className="px-4 pt-[2px]">
        {error && <div className="pb-[10px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}
        {event === undefined && <p className="px-1 text-[15px] font-medium" style={{ color: C.text2 }}>Laddar…</p>}
        {event === null && !error && <SoftNotice tone="quiet">Ärendet finns inte längre.</SoftNotice>}
        {event && (
          <EventCard
            event={event}
            mine={event.owner_id === account?.id}
            viewerNames={viewers.map(nameOf).filter((n): n is string => n !== null)}
            viewerCount={viewers.length}
            busy={busy}
            onDelete={() => void remove()}
          />
        )}
      </div>
    </SoftScreen>
  );
}

function FromUrl() {
  const params = useSearchParams();
  const d = params.get("datum");
  const i = params.get("id");
  const fran = params.get("fran");
  const date = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  const id = i && /^[0-9a-f-]{36}$/i.test(i) ? i : null;
  const from = fran && fran.startsWith("/") && !fran.startsWith("//") ? fran : date ? `/dag?datum=${date}` : "/";
  if (id) return <Ett id={id} from={from} />;
  if (date) return <Ny date={date} from={from} />;
  return <SoftScreen title="Ärende" back="/"><span /></SoftScreen>;
}

export default function Page() {
  return (
    <AuthGate>
      <Suspense fallback={<SoftScreen title="Ärende" back="/"><span /></SoftScreen>}>
        <FromUrl />
      </Suspense>
    </AuthGate>
  );
}
