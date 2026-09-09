"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import {
  C, Card, PrimaryButton, SectionLabel, SHADOW, SoftField, SoftInput, SoftNotice,
  SoftScreen, Tag,
} from "@/components/soft";
import { getSupabase } from "@/lib/supabase/client";
import { useAccount } from "@/lib/account";

/**
 * Every text field on the form, in the order it is asked for, and now grouped
 * into the handoff's three titled cards -- Kontakt, Utbetalning, Närmast
 * anhörig. The grouping is presentational: the row written to `profile` is the
 * same flat row it always was.
 *
 * `flex` is how wide the field sits when two share a line. The handoff pairs
 * Postnr with Stad and Clearing with Kontonummer at 1 : 1.6, because the second
 * of each pair holds the longer value.
 */
const ALWAYS = [
  ["telefon", "Telefonnummer", "tel"],
  ["adress", "Adress", "text"],
  ["postnummer", "Postnummer", "text"],
  ["stad", "Stad", "text"],
  ["clearingnummer", "Clearingnummer", "text"],
  ["kontonummer", "Kontonummer", "text"],
  ["anhorig_namn", "Närmast anhörig namn", "text"],
  ["anhorig_telefon", "Närmast anhörig telefonnummer", "tel"],
] as const;

/** The handoff's cards, as the fields they hold. */
const CARDS = [
  { title: "Kontakt", rows: [
      [["telefon", "Telefonnummer", "tel", 1]],
      [["adress", "Adress", "text", 1]],
      [["postnummer", "Postnr", "text", 1], ["stad", "Stad", "text", 1.6]],
  ] },
  { title: "Utbetalning", rows: [
      [["clearingnummer", "Clearing", "text", 1], ["kontonummer", "Kontonummer", "text", 1.6]],
  ] },
  { title: "Närmast anhörig", rows: [
      [["anhorig_namn", "Namn", "text", 1]],
      [["anhorig_telefon", "Telefonnummer", "tel", 1]],
  ] },
] as const;

const COMPANY = [
  ["foretagsnamn", "Företagsnamn", "text"],
  ["organisationsnummer", "Organisationsnummer", "text"],
  ["fakturaadress", "Fakturaadress", "text"],
  ["foretag_postnummer", "Postnummer", "text"],
  ["foretag_stad", "Stad", "text"],
  ["lan", "Län", "text"],
  ["bankgiro", "Bankgiro/Plusgiro", "text"],
  ["momsreg", "Momsregistreringsnummer", "text"],
] as const;

type TextKey = (typeof ALWAYS)[number][0] | (typeof COMPANY)[number][0];
type Form = Partial<Record<TextKey, string>> & { har_foretag: boolean; f_skatt: boolean };

const EMPTY: Form = { har_foretag: false, f_skatt: false };

/**
 * Profil -- personal details.
 *
 * Keyed on the account, not the worker: the founding admin has no worker
 * record and still has a phone number and a bank account.
 *
 * Who may read this is decided in the database and it is narrower than
 * everything else in the app -- self or admin, and deliberately NOT an
 * arbetsledare. A leader is staff for everything to do with shifts and nothing
 * to do with a colleague's bank account. An arbetare who reaches
 * /profil?id=<someone else> loads nothing, because the policy filters the row
 * away rather than this screen declining to draw it.
 *
 * Every field is optional. The form is filled in over time, from a phone, by
 * someone who may not have their org number to hand; refusing to save until it
 * is complete is the opposite of "fills in what is missing".
 */
function Profil({ askedId }: { askedId: string | null }) {
  const { account } = useAccount();
  const target = askedId || account?.id || null;
  const [who, setWho] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const isAdmin = account?.role === "admin";
  const forSomeoneElse = Boolean(target && account && target !== account.id);

  useEffect(() => {
    if (!target) return;
    let live = true;
    void (async () => {
      const sb = getSupabase();
      const [{ data: p, error: pErr }, { data: who }] = await Promise.all([
        sb.from("profile").select("*").eq("account_id", target).maybeSingle(),
        sb.from("account_directory").select("name, email").eq("id", target).maybeSingle(),
      ]);

      if (!live) return;
      if (pErr) { setError(pErr.message); setForm(EMPTY); return; }
      setWho(who?.name ?? who?.email ?? null);
      // A missing row is a blank form, not an error: a profile exists the
      // moment someone first saves one.
      setForm(p ? ({ ...EMPTY, ...p } as Form) : EMPTY);
    })();
    return () => { live = false; };
  }, [target]);

  async function save() {
    if (!form || !target) return;
    setBusy(true); setError(null); setNote(null);

    const row: Record<string, string | boolean | null> = { account_id: target };
    for (const [k] of [...ALWAYS, ...COMPANY]) {
      const v = (form[k] ?? "").trim();
      row[k] = v === "" ? null : v;
    }
    row.har_foretag = form.har_foretag;
    row.f_skatt = form.har_foretag && form.f_skatt;

    const { error } = await getSupabase()
      .from("profile")
      .upsert(row as never, { onConflict: "account_id" });

    if (error) setError(error.message);
    else setNote("Sparat.");
    setBusy(false);
  }

  const set = (k: TextKey, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  if (!form) {
    return (
      <SoftScreen title="Profil" back="/">
        <div className="px-4 pt-2 text-[15px] font-medium" style={{ color: C.text2 }}>
          Laddar…
        </div>
      </SoftScreen>
    );
  }

  return (
    <SoftScreen title="Profil" back={forSomeoneElse ? "/installningar" : "/"}>
      {(error || note || (forSomeoneElse && who)) && (
        <div className="flex flex-col gap-[10px] px-4 pb-1 pt-1">
          {error && <SoftNotice tone="stop">{error}</SoftNotice>}
          {note && <SoftNotice tone="live">{note}</SoftNotice>}
          {forSomeoneElse && who && (
            <SoftNotice tone="warn">
              Du ändrar profilen för <strong>{who}</strong>.
            </SoftNotice>
          )}
        </div>
      )}

      {/* The role tag the handoff puts on this screen for a foreman. It is read
          from the account rather than assumed, so an admin editing somebody
          else's profile still sees whose it is. */}
      {account?.role === "arbetsledare" && (
        <div className="px-4 pt-1"><Tag tone="warn">Arbetsledare</Tag></div>
      )}

      {CARDS.map((card, i) => (
        // data-card so a test can ask which card a field is in. The handoff
        // shortens "Närmast anhörig namn" to "Namn" under a card that already
        // says whose name it is, which means the label alone no longer tells
        // the worker's own name from their next of kin's -- and "the worker
        // cannot edit their own namn" is an assertion worth keeping.
        <div key={card.title} data-card={card.title} className={`px-4 ${i === 0 ? "pt-[2px]" : "pt-[14px]"}`}>
          <Card>
            <div
              className="mb-[14px] text-[12px] font-bold uppercase"
              style={{ letterSpacing: "1px", color: C.text2 }}
            >
              {card.title}
            </div>
            <div className="flex flex-col gap-[14px]">
              {card.rows.map((row, r) => (
                <div key={r} className="flex gap-[10px]">
                  {row.map(([k, label, type, flex]) => (
                    <div key={k} style={{ flex }}>
                      <SoftField label={label}>
                        <SoftInput
                          type={type}
                          inputMode={type === "tel" ? "tel" : undefined}
                          value={form[k] ?? ""}
                          onChange={(e) => set(k, e.target.value)}
                        />
                      </SoftField>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Card>
        </div>
      ))}

      {/* 60px row, 26px box, radius 7, accent when checked.
          role="checkbox", not aria-pressed: the handoff draws a checkbox and
          this behaves like one, so a screen reader should say "checkbox,
          checked" rather than "button, pressed". A native <input> cannot carry
          the drawn box, and a button that lies about what it is would be a
          worse trade than drawing the role by hand. */}
      <div className="px-4 pt-[14px]">
        <button
          type="button"
          role="checkbox"
          onClick={() => setForm((f) => (f ? { ...f, har_foretag: !f.har_foretag } : f))}
          aria-checked={form.har_foretag}
          className="flex h-[60px] w-full items-center justify-between rounded-[14px] px-[18px] hover:bg-[#f6f9ff]"
          style={{ background: C.surface, boxShadow: SHADOW.group }}
        >
          <span className="text-[17px] font-bold" style={{ letterSpacing: "-.2px" }}>
            Har du företag?
          </span>
          <span
            className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px]"
            style={{
              background: form.har_foretag ? C.accent : C.panel2,
              boxShadow: form.har_foretag ? undefined : `inset 0 0 0 1.5px ${C.hairline}`,
            }}
          >
            {form.har_foretag && (
              <svg width="14" height="11" viewBox="0 0 14 11" fill="none" aria-hidden>
                <path d="M1.5 5.6 5 9.2 12.5 1.6" stroke="#ffffff" strokeWidth="2.4"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
        </button>
      </div>

      {/* Hidden until the toggle is on. Nine boxes that do not apply to most
          people are nine chances to give up on the form. */}
      {form.har_foretag && (
        <div className="px-4 pt-[14px]">
          <Card>
            <SectionLabel>Företag</SectionLabel>
            <div className="flex flex-col gap-[14px]">
              {COMPANY.map(([k, label, type]) => (
                <SoftField key={k} label={label}>
                  <SoftInput
                    type={type}
                    value={form[k] ?? ""}
                    onChange={(e) => set(k, e.target.value)}
                  />
                </SoftField>
              ))}
              <button
                type="button"
                role="checkbox"
                onClick={() => setForm((f) => (f ? { ...f, f_skatt: !f.f_skatt } : f))}
                aria-checked={form.f_skatt}
                className="flex h-[52px] w-full items-center justify-between rounded-[10px] px-[14px]"
                style={{ background: C.panel2 }}
              >
                <span className="text-[16px] font-semibold">F-skatt</span>
                <span
                  className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px]"
                  style={{
                    background: form.f_skatt ? C.accent : C.surface,
                    boxShadow: form.f_skatt ? undefined : `inset 0 0 0 1.5px ${C.hairline}`,
                  }}
                >
                  {form.f_skatt && (
                    <svg width="14" height="11" viewBox="0 0 14 11" fill="none" aria-hidden>
                      <path d="M1.5 5.6 5 9.2 12.5 1.6" stroke="#ffffff" strokeWidth="2.4"
                        strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
              </button>
            </div>
          </Card>
        </div>
      )}

      <div className="px-4 pt-6">
        <PrimaryButton onClick={save} disabled={busy}>
          {busy ? "Sparar…" : "Spara"}
        </PrimaryButton>
        {!isAdmin && (
          <p
            className="px-2 pt-3 text-center text-[15px] font-medium"
            style={{ color: C.text2, textWrap: "pretty" }}
          >
            Namn och e-post ändras av administratören.
          </p>
        )}
      </div>
    </SoftScreen>
  );
}

/**
 * The account being looked at arrives as ?id=. useSearchParams needs a Suspense
 * boundary in a statically exported app -- the query string is not known when
 * the page is prerendered, only when a browser opens it.
 */
function ProfilFromUrl() {
  return <Profil askedId={useSearchParams().get("id")} />;
}

export default function Page() {
  return (
    <AuthGate>
      <Suspense fallback={<SoftScreen title="Profil" back="/"><span /></SoftScreen>}>
        <ProfilFromUrl />
      </Suspense>
    </AuthGate>
  );
}
