"use client";

import { useEffect, useRef, useState } from "react";
import {
  C, Card, PrimaryButton, SectionLabel, SoftField, SoftInput, SoftNotice,
  SoftScreen, SoftToast, Switch,
} from "@/components/soft";
import { getSupabase } from "@/lib/supabase/client";
import { useAccount } from "@/lib/account";
import { removeLogo, signLogo, uploadLogo } from "@/lib/branding";
import { fel } from "@/lib/fel";

/**
 * The company's own details, in two places that must not drift apart:
 *
 *   settings  /foretag -- Företaget, after the day it was set up.
 *   setup     /stall-in -- "Ställ in ditt företag", the screen a company's admin
 *             meets before anything else while the three required fields are
 *             missing (src/lib/company-setup.ts). Same fields, same saves; a
 *             welcome instead of a settings page, and no way round it, because
 *             invariant 7 captures these at onboarding.
 *
 * What follows is the settings screen's own account, and holds for both.
 *
 * Företaget -- the company's own details, after the day it was set up.
 *
 * WHY IT EXISTS AT ALL, since a settings screen is easy to mistake for
 * housekeeping: these values print on the Arbetsdagbok. Until tenant_branding
 * they were a constant in src/lib/doc/arbetsdagbok.ts holding Bella Service
 * AB's address, telephone and organisation number, so the second company to
 * generate a document would have printed the first one's identity on it. The
 * document is the product; this is where the part of it that is not a shift
 * comes from.
 *
 * THREE OF THE FIELDS ARE NOT OPTIONAL, and the refusal is not here. Invariant
 * 6 says the Arbetsdagbok cannot generate with any cell empty, and it now
 * reaches the company footer: without address, kontaktperson and telefon the
 * database refuses to generate, in tg_arbetsdagbok_guard. This screen says so
 * before the admin meets it somewhere less helpful, but the guard is the thing
 * that holds -- what is on screen is decoration (CLAUDE.md, Architecture).
 *
 * THE LOGO IS THE ONE THAT MAY BE BLANK. A company without one prints its name
 * where the logo would go. There is deliberately no default: the inlined
 * Bella logo that used to live in src/lib/doc/logo.ts would otherwise appear on
 * every other company's document, which is the bug this whole feature closes.
 */

type Branding = {
  tenant_id: string;
  logo_path: string | null;
  address: string | null;
  contact_name: string | null;
  phone: string | null;
  bankgiro: string | null;
  momsreg_nr: string | null;
  f_skatt: boolean;
};

/** Blank goes to the database as NULL: the CHECKs refuse the empty string. */
const orNull = (s: string) => {
  const t = s.trim();
  return t === "" ? null : t;
};

export function CompanyForm({
  mode, onDone,
}: {
  mode: "settings" | "setup";
  /** Setup only: the three required fields are saved; go on to the app. */
  onDone?: () => void;
}) {
  const setup = mode === "setup";
  const { account, loading: accountLoading } = useAccount();
  const isAdmin = account?.role === "admin";

  const [row, setRow] = useState<Branding | null>(null);
  const [companyName, setCompanyName] = useState<string>("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [form, setForm] = useState({
    address: "", contact_name: "", phone: "", bankgiro: "", momsreg_nr: "",
    f_skatt: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [tried, setTried] = useState(false);
  const filePicker = useRef<HTMLInputElement>(null);

  /**
   * Whether anything has been typed since the last read.
   *
   * THE LOAD MUST NOT OVERWRITE AN EDIT. The effect below fills the form from
   * the row, and it is asynchronous -- so on a slow connection it can land
   * after somebody has started typing and quietly put the stored values back
   * under their hands. The save then writes what was on screen a moment ago
   * and reports success, which is the worst version of the bug: nothing looks
   * wrong. Found by the walkthrough, which fills the fields faster than the
   * fetch returns and so hits every time what a person would hit rarely.
   *
   * Cleared after a save, because the re-read that follows one is meant to
   * replace the form -- that is the point of it.
   */
  const dirty = useRef(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const sb = getSupabase();

      // ONE TENANCY, OR NONE. An operator who has not entered a client sees
      // every company's row, and picking the first would put somebody else's
      // address on this screen under this company's name. Narrowing is the
      // banner's job, not a LIMIT 1 here.
      const [{ data: brand, error: bErr }, { data: tenants }] = await Promise.all([
        sb.from("tenant_branding").select("*"),
        sb.from("tenant").select("id, name"),
      ]);
      if (!live) return;

      if (bErr) {
        setError(fel(bErr, "Kunde inte läsa företagets uppgifter. Ladda om sidan."));
        return;
      }
      if ((tenants?.length ?? 0) !== 1) {
        setError(
          "Du står inte i ett enskilt företag. Gå in i ett företag först, så visas dess uppgifter här.",
        );
        return;
      }

      setCompanyName(tenants![0].name);
      const b = (brand ?? [])[0] as Branding | undefined;
      if (b) {
        setRow(b);
        if (!dirty.current) {
          setForm({
            address: b.address ?? "",
            contact_name: b.contact_name ?? "",
            phone: b.phone ?? "",
            bankgiro: b.bankgiro ?? "",
            momsreg_nr: b.momsreg_nr ?? "",
            f_skatt: b.f_skatt,
          });
        }
        setLogoUrl(await signLogo(b.logo_path));
      } else {
        // No row yet is an ordinary state, not an error: a company that has
        // never opened this screen has none, and saving makes the first one.
        setRow({
          tenant_id: tenants![0].id, logo_path: null, address: null,
          contact_name: null, phone: null, bankgiro: null, momsreg_nr: null,
          // OFF until the company says so: "Godkänd för F-skatt" is a claim
          // printed on a legal document, not a default. The column agrees.
          f_skatt: false,
        });
      }
    })();
    return () => { live = false; };
  }, [tick]);

  const missing = [
    form.address.trim() === "" ? "adress" : null,
    form.contact_name.trim() === "" ? "kontaktperson" : null,
    form.phone.trim() === "" ? "telefonnummer" : null,
  ].filter(Boolean) as string[];

  async function save() {
    if (!row) return;
    // Setup cannot be left with the three missing -- saying so beside the
    // button rather than letting the database refuse the document later.
    if (setup && missing.length) { setTried(true); return; }
    setBusy(true); setError(null); setNote(null);

    const { error: err } = await getSupabase()
      .from("tenant_branding")
      .upsert({
        tenant_id: row.tenant_id,
        address: orNull(form.address),
        contact_name: orNull(form.contact_name),
        phone: orNull(form.phone),
        bankgiro: orNull(form.bankgiro),
        momsreg_nr: orNull(form.momsreg_nr),
        f_skatt: form.f_skatt,
      }, { onConflict: "tenant_id" });

    setBusy(false);
    if (err) {
      setError(fel(err, "Uppgifterna kunde inte sparas. Kontakta administratören."));
      return;
    }
    dirty.current = false;
    if (setup) { onDone?.(); return; }
    setNote("Företagets uppgifter är sparade.");
    setTick((n) => n + 1);
  }

  async function pickLogo(file: File | undefined) {
    if (!file || !row) return;
    setBusy(true); setError(null); setNote(null);
    try {
      await uploadLogo(row.tenant_id, file);
      setNote("Logotypen är sparad.");
      setTick((n) => n + 1);
    } catch (e) {
      setError(fel(e, "Logotypen kunde inte sparas. Försök igen."));
    } finally {
      setBusy(false);
      if (filePicker.current) filePicker.current.value = "";
    }
  }

  async function dropLogo() {
    if (!row) return;
    setBusy(true); setError(null); setNote(null);
    try {
      await removeLogo(row.tenant_id, row.logo_path);
      setNote("Logotypen är borttagen. Företagets namn står i dess ställe.");
      setTick((n) => n + 1);
    } catch (e) {
      setError(fel(e, "Logotypen kunde inte tas bort. Försök igen."));
    } finally {
      setBusy(false);
    }
  }

  // Setup: a welcome, title and one line, and nowhere to go back to.
  const title = setup ? "Ställ in ditt företag" : "Företaget";
  const back = setup ? undefined : "/";
  const subtitle = setup ? "Det här trycks på er arbetsdagbok." : companyName || undefined;

  if (accountLoading) {
    return <SoftScreen title={title} back={back}><div /></SoftScreen>;
  }

  return (
    <SoftScreen title={title} back={back} subtitle={subtitle}>
      {!setup && error && <SoftNotice tone="stop">{error}</SoftNotice>}

      {/* The database decides this, not the screen -- an arbetsledare reaching
          the address bar gets a read-only form here and a refusal from RLS
          underneath it. Saying who changes them is the useful half. */}
      {!isAdmin && (
        <SoftNotice tone="quiet">
          Företagets uppgifter ändras av administratören.
        </SoftNotice>
      )}

      {!setup && isAdmin && missing.length > 0 && (
        <SoftNotice tone="warn" headline="Arbetsdagboken kan inte skapas än">
          {`Fyll i ${missing.join(", ")}. Utan dem går dokumentet inte att skapa.`}
        </SoftNotice>
      )}

      <SectionLabel>Logotyp</SectionLabel>
      <Card>
        <div className="flex items-center gap-4">
          <div
            data-logo-slot={row?.logo_path ? "image" : "name"}
            className="flex h-[72px] w-[120px] shrink-0 items-center justify-center overflow-hidden rounded-[10px]"
            style={{ background: C.panel2 }}
          >
            {logoUrl
              /* eslint-disable-next-line @next/next/no-img-element */
              ? <img src={logoUrl} alt="Företagets logotyp"
                     className="max-h-full max-w-full object-contain" />
              : <span className="px-2 text-center text-[13px] font-bold" style={{ color: C.text2 }}>
                  {companyName}
                </span>}
          </div>
          <div className="min-w-0 flex-1 text-[14px]" style={{ color: C.text2 }}>
            {row?.logo_path
              ? "Logotypen trycks överst på arbetsdagboken."
              : "Utan logotyp trycks företagets namn överst på arbetsdagboken."}
          </div>
        </div>

        {isAdmin && (
          <div className="flex gap-3 pt-4">
            <input
              ref={filePicker} type="file" accept="image/*" className="hidden"
              aria-label="Välj logotyp"
              onChange={(e) => void pickLogo(e.target.files?.[0])}
            />
            <PrimaryButton onClick={() => filePicker.current?.click()} disabled={busy}>
              {row?.logo_path ? "Byt logotyp" : "Ladda upp logotyp"}
            </PrimaryButton>
            {row?.logo_path && (
              <button
                type="button" onClick={() => void dropLogo()} disabled={busy}
                className="press-scale h-[44px] rounded-[10px] px-4 text-[15px] font-bold"
                style={{ background: C.panel2, color: C.ink }}
              >
                Ta bort
              </button>
            )}
          </div>
        )}
      </Card>

      <SectionLabel>Uppgifter på arbetsdagboken</SectionLabel>
      <Card>
        <SoftField label="Adress" help="Postadressen som trycks i dokumentets fot.">
          <SoftInput
            value={form.address} disabled={!isAdmin || busy}
            onChange={(e) => { dirty.current = true; setForm((f) => ({ ...f, address: e.target.value })); }}
          />
        </SoftField>
        <SoftField label="Kontaktperson">
          <SoftInput
            value={form.contact_name} disabled={!isAdmin || busy}
            onChange={(e) => { dirty.current = true; setForm((f) => ({ ...f, contact_name: e.target.value })); }}
          />
        </SoftField>
        <SoftField label="Telefonnummer">
          <SoftInput
            type="tel" value={form.phone} disabled={!isAdmin || busy}
            onChange={(e) => { dirty.current = true; setForm((f) => ({ ...f, phone: e.target.value })); }}
          />
        </SoftField>
      </Card>

      {/* Below the three the document demands, because these two may be blank
          and the ones above may not. The grouping is the rule, visible. */}
      <SectionLabel>Frivilligt</SectionLabel>
      <Card>
        <SoftField label="Bankgiro">
          <SoftInput
            value={form.bankgiro} disabled={!isAdmin || busy}
            onChange={(e) => { dirty.current = true; setForm((f) => ({ ...f, bankgiro: e.target.value })); }}
          />
        </SoftField>
        <SoftField label="Momsregistreringsnummer">
          <SoftInput
            value={form.momsreg_nr} disabled={!isAdmin || busy}
            onChange={(e) => { dirty.current = true; setForm((f) => ({ ...f, momsreg_nr: e.target.value })); }}
          />
        </SoftField>
        {/* The footer prints "Godkänd för F-skatt" only while this is on. A
            switch, like the same question on Profil: it is a setting that is
            on or off, not an item ticked off a list. */}
        <div className="flex h-[52px] w-full items-center justify-between">
          <span className="text-[16px] font-semibold">Godkänd för F-skatt</span>
          <Switch
            label="Godkänd för F-skatt"
            checked={form.f_skatt}
            disabled={!isAdmin || busy}
            onChange={(v) => { dirty.current = true; setForm((f) => ({ ...f, f_skatt: v })); }}
          />
        </div>
      </Card>

      {isAdmin && (
        <div className="pt-1">
          {/* Setup answers here, by the thumb: what is missing, or what failed. */}
          {setup && tried && missing.length > 0 && (
            <div className="pb-[14px]">
              <SoftNotice tone="warn">{`Det här saknas: ${missing.join(", ")}.`}</SoftNotice>
            </div>
          )}
          {setup && error && <div className="pb-[14px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}
          <PrimaryButton onClick={() => void save()} disabled={busy || !row}>
            {busy ? "Sparar…" : setup ? "Spara och fortsätt" : "Spara"}
          </PrimaryButton>
        </div>
      )}

      <SoftToast message={note} onDone={() => setNote(null)} />
    </SoftScreen>
  );
}
