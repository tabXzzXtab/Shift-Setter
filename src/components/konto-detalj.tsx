"use client";

import { useEffect, useRef, useState } from "react";
import {
  Avatar, C, Card, PrimaryButton, SectionLabel, SHADOW, SoftField, SoftInput,
  SoftNotice, SoftScreen, SoftSelect,
} from "@/components/soft";
import { getSupabase } from "@/lib/supabase/client";
import { useAccount, type Role } from "@/lib/account";
import { removeAvatar, signAvatar, uploadAvatar } from "@/lib/avatar";
import { fel } from "@/lib/fel";

/**
 * ETT konto, hela vägen -- identity, role, personal details and the face.
 *
 * THIS SCREEN IS THE OLD /konto AND /profil MERGED. They were two pages asking
 * about one person: one held the name, the email and the role, the other held
 * the phone number and the bank account, and the Konton list carried a button
 * to each. That pair of buttons on every row is half of why the list was a
 * wall -- and "open the person, then everything about them is here" is both
 * fewer controls and a truer description of what an account is.
 *
 * Both routes still render it. /konto and /profil are in menus, in back links
 * and in whatever anybody has bookmarked, and a merge that breaks those is a
 * merge that costs more than it saves.
 *
 * WHAT IS NOT HERE: removal. That lives on the Alla Konton row, as the handoff
 * draws it. Two places to delete the same account is one more than there
 * should be.
 *
 * Nothing on this screen is a permission check. worker.name and worker.email
 * are locked against a non-admin by app.tg_worker_self_edit_guard(), the login
 * address lives in auth.users where the browser cannot reach it, profile is
 * self-or-admin in its own policy, and the role selector writes to
 * public.account where the admin policy and app.tg_last_admin_guard() decide
 * what happens. This only declines to draw what nobody could save.
 */

const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  arbetsledare: "Arbetsledare",
  arbetare: "Arbetare",
};

/**
 * The handoff's three titled cards. `flex` is how wide a field sits when two
 * share a line -- 1 : 1.6, because the second of each pair holds the longer
 * value.
 */
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

/** Every text key the profile row holds, flattened out of the cards above. */
const TEXT_KEYS = [
  ...CARDS.flatMap((c) => c.rows.flatMap((r) => r.map(([k]) => k))),
  ...COMPANY.map(([k]) => k),
] as const;

type TextKey = (typeof TEXT_KEYS)[number];
type Form = Partial<Record<TextKey, string>> & { har_foretag: boolean; f_skatt: boolean };

const EMPTY: Form = { har_foretag: false, f_skatt: false };

type Konto = {
  id: string;
  name: string | null;
  email: string | null;
  role: Role;
  active: boolean;
  avatar_path: string | null;
};

export function KontoDetalj({ askedId }: { askedId: string | null }) {
  const { account, reload } = useAccount();
  const target = askedId || account?.id || null;

  const [row, setRow] = useState<Konto | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [face, setFace] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const filePicker = useRef<HTMLInputElement>(null);

  const isAdmin = account?.role === "admin";
  const isSelf = Boolean(target && account && target === account.id);

  useEffect(() => {
    if (!target) return;
    let live = true;
    void (async () => {
      const sb = getSupabase();
      const [{ data: k, error: kErr }, { data: p, error: pErr }] = await Promise.all([
        sb.from("account_directory")
          .select("id, name, email, role, active, avatar_path")
          .eq("id", target).maybeSingle(),
        sb.from("profile").select("*").eq("account_id", target).maybeSingle(),
      ]);

      if (!live) return;
      if (kErr || pErr) {
        setError(fel(kErr ?? pErr, "Kunde inte läsa kontot. Ladda om sidan."));
        setForm(EMPTY);
        return;
      }

      const konto = (k ?? null) as Konto | null;
      setRow(konto);
      setName(konto?.name ?? "");
      setEmail(konto?.email ?? "");
      // A missing profile row is a blank form, not an error: a profile exists
      // the moment somebody first saves one.
      setForm(p ? ({ ...EMPTY, ...p } as Form) : EMPTY);
      setFace(await signAvatar(konto?.avatar_path ?? null));
    })();
    return () => { live = false; };
  }, [target, tick]);

  /**
   * ONE Spara for both halves, because from here they are one screen.
   *
   * The identity goes first and only when it changed: it travels through the
   * update-account Edge Function, which writes auth.users with the
   * service-role key, and a round trip to do nothing is a round trip that can
   * still fail. If it does, the profile below is left untouched -- there is no
   * half-applied save to unpick.
   */
  async function save() {
    if (!form || !target || !row) return;
    setBusy(true); setError(null); setNote(null);
    const sb = getSupabase();

    const identityChanged =
      isAdmin && (name.trim() !== (row.name ?? "") || email.trim() !== (row.email ?? ""));

    if (identityChanged) {
      if (!name.trim() || !email.trim()) {
        setError("Namn och e-post måste vara ifyllda.");
        setBusy(false);
        return;
      }
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-account`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token ?? ""}`,
          },
          body: JSON.stringify({ account_id: target, name: name.trim(), email: email.trim() }),
        },
      );
      const body = await res.json().catch(() => ({ error: "Oväntat svar från servern." }));
      if (!res.ok) {
        setError(fel(body.error, "Kontot kunde inte sparas. Kontakta administratören."));
        setBusy(false);
        return;
      }
    }

    const profileRow: Record<string, string | boolean | null> = { account_id: target };
    for (const k of TEXT_KEYS) {
      const v = (form[k] ?? "").trim();
      profileRow[k] = v === "" ? null : v;
    }
    profileRow.har_foretag = form.har_foretag;
    profileRow.f_skatt = form.har_foretag && form.f_skatt;

    const { error: pErr } = await sb
      .from("profile").upsert(profileRow as never, { onConflict: "account_id" });

    if (pErr) {
      setError(fel(pErr, "Profilen kunde inte sparas. Försök igen, eller kontakta administratören."));
      setBusy(false);
      return;
    }

    setNote("Sparat.");
    setBusy(false);
    if (identityChanged) {
      setTick((t) => t + 1);
      if (isSelf) reload();
    }
  }

  async function pickedFace(file: File | undefined) {
    if (!file || !target || !row) return;
    setBusy(true); setError(null); setNote(null);
    try {
      const path = await uploadAvatar(target, file, row.avatar_path);
      setRow({ ...row, avatar_path: path });
      setFace(await signAvatar(path));
      setNote("Bilden är sparad.");
    } catch (e) {
      setError(fel(e, "Bilden kunde inte sparas. Försök igen."));
    }
    setBusy(false);
  }

  async function clearFace() {
    if (!target || !row) return;
    setBusy(true); setError(null); setNote(null);
    try {
      await removeAvatar(target, row.avatar_path);
      setRow({ ...row, avatar_path: null });
      setFace(null);
      setNote("Bilden är borttagen.");
    } catch (e) {
      setError(fel(e, "Bilden kunde inte tas bort. Försök igen."));
    }
    setBusy(false);
  }

  async function setRole(role: Role) {
    if (!row) return;
    setBusy(true); setError(null); setNote(null);
    const { error } = await getSupabase().from("account").update({ role }).eq("id", row.id);
    if (error) setError(fel(error, "Rollen kunde inte ändras. Kontakta administratören."));
    else setNote(`Rollen ändrad till ${ROLE_LABEL[role]}.`);
    setBusy(false);
    setTick((t) => t + 1);
    if (isSelf) reload();
  }

  async function setActive(active: boolean) {
    if (!row) return;
    setBusy(true); setError(null); setNote(null);
    const { error } = await getSupabase().from("account").update({ active }).eq("id", row.id);
    if (error) {
      setError(fel(error, "Kontot kunde inte pausas eller aktiveras. Kontakta administratören."));
    } else {
      setNote(active
        ? "Kontot är aktivt igen. Kommande pass måste tilldelas på nytt."
        : "Kontot är pausat. Pass som inte har börjat är frisläppta — pågående pass är deras sista.");
    }
    setBusy(false);
    setTick((t) => t + 1);
  }

  const set = (k: TextKey, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const back = isSelf ? "/" : "/installningar";

  if (!row || !form) {
    return (
      <SoftScreen title="Konto" back={back}>
        <p className="px-5 text-[15px] font-medium" style={{ color: C.text2 }}>Laddar…</p>
      </SoftScreen>
    );
  }

  return (
    <SoftScreen title={isSelf ? "Min profil" : "Konto"} back={back}>
      {(error || note || !isSelf) && (
        <div className="flex flex-col gap-[10px] px-4 pb-[10px] pt-[2px]">
          {error && <SoftNotice tone="stop">{error}</SoftNotice>}
          {note && !error && <SoftNotice tone="live">{note}</SoftNotice>}
          {/* WHOSE ROW THIS IS, said out loud. The card below already shows
              their name and their face, but this screen saves a bank account,
              and "I thought I was editing my own" is the mistake worth one
              line of amber. It survives the merge from /profil, where it was
              the only thing standing between the admin and a silent edit to
              the wrong person. */}
          {!isSelf && (
            <SoftNotice tone="warn">
              Du ändrar profilen för <strong>{row.name ?? row.email ?? "detta konto"}</strong>.
            </SoftNotice>
          )}
        </div>
      )}

      {/* WHO THIS IS, and the one control that changes the face. The role is a
          line of text rather than a tag: the pills came off every screen this
          redesign touched, and on a page about exactly one person a coloured
          chip repeating the word above it earns nothing. */}
      <div className="px-4 pt-[2px]">
        <Card radius={16} pad="p-[18px]">
          <div className="flex items-center gap-[14px]">
            <Avatar src={face} name={row.name} email={row.email} size={72} />
            <div className="min-w-0">
              <div className="truncate text-[22px] font-extrabold" style={{ letterSpacing: "-.7px" }}>
                {row.name ?? "Namn saknas"}
              </div>
              <div className="break-all text-[15px] font-medium" style={{ color: C.text2 }}>
                {row.email ?? "—"}
              </div>
              <div className="pt-[2px] text-[13px] font-bold uppercase"
                   style={{ letterSpacing: "1px", color: C.text2 }}>
                {ROLE_LABEL[row.role]}
                {!row.active && " · Pausad"}
              </div>
            </div>
          </div>

          <input
            ref={filePicker}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              void pickedFace(e.target.files?.[0]);
              e.target.value = "";   // the same file twice must still fire
            }}
          />

          <div className="mt-4 flex gap-[10px]">
            <button
              type="button"
              onClick={() => filePicker.current?.click()}
              disabled={busy}
              className="press-scale flex h-12 flex-1 items-center justify-center rounded-[10px] text-[15px] font-bold transition-transform duration-[110ms] hover:bg-[#dbe4f9] active:scale-[.985] disabled:opacity-40"
              style={{ background: C.panel2, color: C.inkHover }}
            >
              {row.avatar_path ? "Byt bild" : "Lägg till bild"}
            </button>
            {row.avatar_path && (
              <button
                type="button"
                onClick={() => void clearFace()}
                disabled={busy}
                className="press-scale flex h-12 items-center justify-center rounded-[10px] px-4 text-[15px] font-bold transition-transform duration-[110ms] hover:bg-[#f6d8dd] active:scale-[.985] disabled:opacity-40"
                style={{ background: C.stopBg, color: C.stopInk }}
              >
                Ta bort bild
              </button>
            )}
          </div>

          {/* Editable for the admin only -- see the header. */}
          {isAdmin && (
            <div className="mt-[18px] flex flex-col gap-[14px]">
              <SoftField label="Namn">
                <SoftInput value={name} onChange={(e) => setName(e.target.value)} />
              </SoftField>
              <SoftField label="E-post" help="Det här är inloggningen.">
                <SoftInput
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </SoftField>
            </div>
          )}
        </Card>
      </div>

      {/* Roll. Its own card because changing what somebody may do is a
          different act from correcting their name, and Spara does not save
          it -- the selector writes on change. */}
      {isAdmin && (
        <div className="px-4 pt-[14px]">
          <Card radius={16} pad="p-[18px]">
            <SoftField label="Roll">
              <SoftSelect
                value={row.role}
                disabled={busy}
                onChange={(e) => void setRole(e.target.value as Role)}
              >
                <option value="arbetare">Arbetare</option>
                <option value="arbetsledare">Arbetsledare</option>
                <option value="admin">Admin</option>
              </SoftSelect>
            </SoftField>
          </Card>
        </div>
      )}

      {CARDS.map((card) => (
        // data-card so a test can ask which card a field is in.
        <div key={card.title} data-card={card.title} className="px-4 pt-[14px]">
          <Card>
            <div className="mb-[14px] text-[12px] font-bold uppercase"
                 style={{ letterSpacing: "1px", color: C.text2 }}>
              {card.title}
            </div>
            <div className="flex flex-col gap-[14px]">
              {card.rows.map((r, i) => (
                <div key={i} className="flex gap-[10px]">
                  {r.map(([k, label, type, flex]) => (
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

      {/* 60px row, 26px box, radius 7, accent when checked. role="checkbox"
          rather than aria-pressed: the handoff draws a checkbox and this
          behaves like one, so a screen reader should say "checkbox, checked". */}
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
                  <SoftInput type={type} value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
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
          <p className="px-2 pt-3 text-center text-[15px] font-medium"
             style={{ color: C.text2, textWrap: "pretty" }}>
            Namn och e-post ändras av administratören.
          </p>
        )}
      </div>

      {/* Pausing is the last thing on the screen and nowhere near Spara. It is
          not an edit to this person's details -- it takes every shift they have
          not started yet off them -- so it sits below everything else with its
          own explanation. Never for yourself: app.tg_last_admin_guard() would
          refuse the last admin anyway, and an owner who pauses themselves by
          reflex has locked themselves out of their own company. */}
      {isAdmin && !isSelf && (
        <div className="px-4 pt-[26px]">
          <SectionLabel>Tillgänglighet</SectionLabel>
          <Card radius={16} pad="p-[18px]">
            <p className="mb-[14px] text-[15px] font-medium"
               style={{ color: C.text2, textWrap: "pretty" }}>
              {row.active
                ? "Ett pausat konto kan inte logga in och får inga nya pass. Pass som inte har börjat frisläpps."
                : "Kontot är pausat. Aktiveras det igen måste kommande pass tilldelas på nytt."}
            </p>
            <button
              type="button"
              onClick={() => void setActive(!row.active)}
              disabled={busy}
              className="press-scale flex h-12 w-full items-center justify-center rounded-[10px] text-[15px] font-bold transition-transform duration-[110ms] active:scale-[.985] disabled:opacity-40"
              style={row.active
                ? { background: C.stopBg, color: C.stopInk }
                : { background: C.panel2, color: C.inkHover }}
            >
              {row.active ? "Pausa kontot" : "Aktivera kontot"}
            </button>
          </Card>
        </div>
      )}
    </SoftScreen>
  );
}
