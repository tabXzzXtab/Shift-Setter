"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import { Button, Check, Field, Input, Notice, Screen } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { useAccount } from "@/lib/account";

/** Every text field on the form, in the order it is asked for. */
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

  if (!form) return <Screen title="Profil" back="/"><span>Laddar…</span></Screen>;

  return (
    <Screen title="Profil" back={forSomeoneElse ? "/installningar" : "/"}>
      {error && <Notice kind="error">{error}</Notice>}
      {note && <Notice kind="ok">{note}</Notice>}

      {forSomeoneElse && who && (
        <Notice kind="info">Du ändrar profilen för <strong>{who}</strong>.</Notice>
      )}

      {ALWAYS.map(([k, label, type]) => (
        <Field key={k} label={label}>
          <Input
            type={type}
            inputMode={type === "tel" ? "tel" : undefined}
            value={form[k] ?? ""}
            onChange={(e) => set(k, e.target.value)}
          />
        </Field>
      ))}

      <div className="mt-6">
        <Check
          label="Har du företag?"
          checked={form.har_foretag}
          onChange={(v) => setForm((f) => (f ? { ...f, har_foretag: v } : f))}
        />
      </div>

      {/* Hidden until the toggle is on. Nine boxes that do not apply to most
          people are nine chances to give up on the form. */}
      {form.har_foretag && (
        <>
          {COMPANY.map(([k, label, type]) => (
            <Field key={k} label={label}>
              <Input
                type={type}
                value={form[k] ?? ""}
                onChange={(e) => set(k, e.target.value)}
              />
            </Field>
          ))}
          <Check
            label="F-skatt"
            checked={form.f_skatt}
            onChange={(v) => setForm((f) => (f ? { ...f, f_skatt: v } : f))}
          />
        </>
      )}

      <Button onClick={save} disabled={busy}>{busy ? "Sparar…" : "Spara"}</Button>

      {!isAdmin && (
        <p className="mt-4 text-base text-neutral-600">
          Namn och e-post ändras av administratören.
        </p>
      )}
    </Screen>
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
      <Suspense fallback={<Screen title="Profil" back="/"><span>Laddar…</span></Screen>}>
        <ProfilFromUrl />
      </Suspense>
    </AuthGate>
  );
}
