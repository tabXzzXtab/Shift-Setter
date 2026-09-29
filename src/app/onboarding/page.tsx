"use client";

import { useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  C, Card, ChevronRight, PrimaryButton, SHADOW, SoftField, SoftInput,
  SoftNotice, Tag,
} from "@/components/soft";
import { fel } from "@/lib/fel";

/**
 * Onboarding -- the PIN gate, and the route chosen behind it.
 *
 * NOT LINKED FROM ANYWHERE. It is reached by typing the path, by whoever is
 * sitting with the customer. That is why it opens on a code rather than on a
 * login: the person using it may not have an account in this app at all, and
 * what is being decided here is which kind of account the customer gets.
 *
 * THE CODE IS CHECKED OFF THE CLIENT, by the verify-pin Edge Function. A
 * static export ships its own source, so a comparison written here would be a
 * comparison printed in the bundle. What comes back is one bit and nothing
 * else -- no token, no session, no role.
 *
 * WHICH MEANS THE GATE IS NOT A BOUNDARY. Stage two is drawn by this component
 * off a piece of state, and state is the caller's to set; anyone willing to
 * open devtools is past it. That is the architecture rather than an oversight
 * -- CLAUDE.md, every restriction that lives in the interface is decorative.
 * SO STAGE THREE DOES NOT RELY ON IT. It sends the code with the request, and
 * create-tenant checks it server side before writing anything -- reaching this
 * screen proves nothing about who got here, and the endpoint is the thing that
 * mints a company. The gate is a convenience that keeps the form away from
 * somebody who mistyped; it is not what protects the write.
 */

const LENGTH = 5;

/** Which of the three the operator picked. Stage three will act on it. */
type Route = "demo" | "sald" | "gava";

export default function OnboardingPage() {
  /**
   * THE CODE IS KEPT, and that is a decision rather than laziness.
   *
   * create-tenant checks it server side -- it has to, because this gate is
   * client state and reaching stage three proves nothing about the person who
   * got there. So the code has to travel with the request that actually makes
   * the company. Holding it in a variable exposes nothing new: the operator
   * typed it into this tab a moment ago, and it never leaves memory.
   */
  const [pin, setPin] = useState<string | null>(null);
  const [route, setRoute] = useState<Route | null>(null);

  if (!pin) return <PinGate onPass={setPin} />;
  if (!route) return <RouteChoice onChoose={setRoute} />;
  return <SignupForm pin={pin} route={route} onBack={() => setRoute(null)} />;
}

/* ---- the frame both stages share ----------------------------------------- */

/**
 * Vertically centred, like the login screen and for the same reason: there is
 * one thing to do here and nothing above it to scroll past.
 */
function Frame({ children }: { children: ReactNode }) {
  return (
    <main
      data-soft-screen="Onboarding"
      className="mx-auto flex min-h-dvh w-full max-w-[390px] flex-col justify-center px-4 pb-[60px]"
      style={{
        background: C.ground,
        color: C.ink,
        fontFamily: "var(--font-inter), system-ui, sans-serif",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <div className="px-1 pb-[26px]">
        <div
          className="pb-[6px] text-[12px] font-bold uppercase"
          style={{ letterSpacing: "1px", color: C.text2 }}
        >
          Onboarding
        </div>
        <h1
          className="text-[38px] font-extrabold leading-[1.02]"
          style={{ letterSpacing: "-1.6px" }}
        >
          ByggKoll
        </h1>
      </div>
      {children}
    </main>
  );
}

/* ---- stage 1: the code --------------------------------------------------- */

function PinGate({ onPass }: { onPass: (pin: string) => void }) {
  const [digits, setDigits] = useState<string[]>(() => Array(LENGTH).fill(""));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Counts refusals, and is the digit row's React key.
   *
   * Remounting is what replays the animation: re-adding a class an element
   * already carries does not restart it, so a second wrong code in a row would
   * sit perfectly still -- which reads as "nothing happened", the one thing a
   * refusal must never read as.
   */
  const [refusals, setRefusals] = useState(0);

  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const focus = (i: number) =>
    boxes.current[Math.max(0, Math.min(LENGTH - 1, i))]?.focus();

  /** Back to five empty boxes with the caret in the first. */
  function clear() {
    setDigits(Array(LENGTH).fill(""));
    // After the render that empties them, or the caret lands in a box that is
    // about to be rewritten out from under it.
    requestAnimationFrame(() => focus(0));
  }

  function write(i: number, value: string): string[] {
    const next = [...digits];
    next[i] = value;
    setDigits(next);
    if (error) setError(null);
    return next;
  }

  async function submit(pin: string) {
    setBusy(true);
    setError(null);

    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    let verdict: "ok" | "wrong" | "waiting" | "down";
    /** The Swedish for a refused attempt, resolved from fel.ts. */
    let waited = "";
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/verify-pin`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Nobody is signed in here, so the anon key is the only credential
            // there is -- and it is not what the function checks.
            apikey: anon,
            Authorization: `Bearer ${anon}`,
          },
          body: JSON.stringify({ pin }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        valid?: boolean;
        error?: string;
      };
      if (res.status === 429) {
        // THE WORDING IS NOT WRITTEN HERE. The function sends the English key
        // and fel.ts holds the one Swedish sentence, the same way every other
        // refusal in this app is worded -- so the gate cannot drift into
        // saying "vänta en minut" while the rest of the app says something
        // else for the same kind of answer.
        verdict = "waiting";
        waited = fel(body.error ?? "", "För många försök. Försök igen om en minut.");
      } else if (!res.ok) verdict = "down";
      else verdict = body.valid ? "ok" : "wrong";
    } catch {
      verdict = "down";
    }

    setBusy(false);
    if (verdict === "ok") {
      onPass(pin);
      return;
    }

    // Every refusal empties the row, whatever its reason. A wrong code half
    // corrected is a code somebody retypes wrong the same way.
    setRefusals((n) => n + 1);
    setError(
      verdict === "waiting"
        ? waited
        : verdict === "down"
          ? "Kunde inte nå servern. Försök igen."
          : "Fel kod.",
    );
    clear();
  }

  /** One box took a character. Keep the last digit typed, then move on. */
  function onDigit(i: number, raw: string) {
    const only = raw.replace(/\D/g, "");
    if (!only) {
      // A non-digit, or the box being emptied. Either way it is cleared and
      // nothing advances.
      write(i, "");
      return;
    }
    // The LAST digit, so overtyping a filled box replaces what is in it rather
    // than being dropped by a maxLength that has already been reached.
    const next = write(i, only.slice(-1));
    if (i < LENGTH - 1) focus(i + 1);
    const pin = next.join("");
    // The fifth digit submits. There is no button: a five-box row that is full
    // has nothing left to ask, and a Fortsätt underneath it would only be a
    // second thing to reach for after the last one.
    if (pin.length === LENGTH) void submit(pin);
  }

  function onKey(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      // Backspace in a box that is already empty steps back and clears the one
      // behind it. Without this the caret appears stuck on an empty box.
      e.preventDefault();
      write(i - 1, "");
      focus(i - 1);
      return;
    }
    if (e.key === "ArrowLeft" && i > 0) {
      e.preventDefault();
      focus(i - 1);
    }
    if (e.key === "ArrowRight" && i < LENGTH - 1) {
      e.preventDefault();
      focus(i + 1);
    }
  }

  /** A pasted code fills the whole row, whichever box it was dropped into. */
  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const only = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, LENGTH);
    if (!only) return;
    e.preventDefault();
    setDigits(Array.from({ length: LENGTH }, (_, i) => only[i] ?? ""));
    setError(null);
    if (only.length === LENGTH) void submit(only);
    else requestAnimationFrame(() => focus(only.length));
  }

  return (
    <Frame>
      {error && (
        <div className="pb-[14px]">
          <SoftNotice tone="stop">{error}</SoftNotice>
        </div>
      )}

      <div
        className="p-5"
        style={{ background: C.surface, borderRadius: 16, boxShadow: SHADOW.hero }}
      >
        <div
          className="mb-[6px] text-[12px] font-bold uppercase"
          style={{ letterSpacing: ".9px", color: C.text2 }}
        >
          Kod
        </div>

        <div
          key={refusals}
          className={`flex gap-[10px] ${refusals > 0 ? "animate-shake" : ""}`}
          role="group"
          aria-label={`Kod, ${LENGTH} siffror`}
        >
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                boxes.current[i] = el;
              }}
              value={d}
              onChange={(e) => onDigit(i, e.target.value)}
              onKeyDown={(e) => onKey(i, e)}
              onPaste={onPaste}
              // Select on focus, so a tap into a filled box overwrites it
              // rather than parking a caret beside a digit nothing can be
              // added to.
              onFocus={(e) => e.target.select()}
              disabled={busy}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              aria-label={`Siffra ${i + 1} av ${LENGTH}`}
              className="h-[60px] min-w-0 flex-1 rounded-[10px] border-0 text-center text-[26px] font-extrabold outline-none focus:outline-2"
              style={{
                background: C.panel2,
                color: C.ink,
                letterSpacing: "-.6px",
                outlineColor: C.accent,
              }}
            />
          ))}
        </div>
      </div>

      <p className="pt-[22px] text-center text-[15px] font-medium" style={{ color: C.text2 }}>
        {busy ? "Kontrollerar…" : "Koden får du av ByggKoll."}
      </p>
    </Frame>
  );
}

/* ---- stage 2: which route -------------------------------------------------
    Three ways on, in the order they are offered. The two that are sold or
    trialled get a card each; giving it away is a text button underneath.
    THE WEIGHT IS THE RANKING -- handing the product over for nothing should
    not be as easy to hit as selling it, and on a screen of three equal cards
    it would be.                                                              */

const ROUTES: { key: Route; title: string; body: string }[] = [
  {
    key: "demo",
    title: "Tilldela Demo",
    body:
      "Tilldela ByggKoll till en företagsägare som får tillgång till appen " +
      "med begränsad tillgång av 3 veckor kostnadsfri tillgång",
  },
  {
    key: "sald",
    title: "Sålt ByggKoll",
    body: "Har du sålt ByggKoll och användaren har bekräftat att de ska betala?",
  },
];


function RouteChoice({ onChoose }: { onChoose: (r: Route) => void }) {
  return (
    <Frame>
      {ROUTES.map((r, i) => (
        <button
          key={r.key}
          type="button"
          onClick={() => onChoose(r.key)}
          className={`press-scale block w-full p-[18px] text-left transition-transform duration-[110ms] hover:bg-[#f6f9ff] active:scale-[.985] ${
            i > 0 ? "mt-[14px]" : ""
          }`}
          style={{ background: C.surface, borderRadius: 14, boxShadow: SHADOW.group }}
        >
          <span className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-[19px] font-bold" style={{ letterSpacing: "-.4px" }}>
                {r.title}
              </span>
              <span
                className="mt-[6px] block text-[15px] font-medium"
                style={{ color: C.text2, textWrap: "pretty" }}
              >
                {r.body}
              </span>
            </span>
            <span className="mt-[5px] shrink-0">
              <ChevronRight />
            </span>
          </span>
        </button>
      ))}

      {/* Small, and still a 44px target: "small" is about weight on the page,
          not about the size of the thing a thumb has to hit. */}
      <div className="flex justify-center pt-[18px]">
        <button
          type="button"
          onClick={() => onChoose("gava")}
          className="flex min-h-[44px] items-center px-2 text-[15px] font-semibold underline underline-offset-[3px]"
          style={{ color: C.text2 }}
        >
          Ge Bort ByggKoll
        </button>
      </div>
    </Frame>
  );
}

/* ---- stage 3: the company, and its first admin ----------------------------
    What the three cards were choosing BETWEEN. The route is not asked again
    here -- it was answered by the card that got us in, and asking twice
    invites somebody to answer differently on the screen that writes.        */

/** Six digits: inside create-tenant's 6-20, and typeable on a phone keypad. */
function generatePassword(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]!;
  return String(100000 + (n % 900000));
}

const TYPE_WORD: Record<Route, string> = {
  demo: "Demo",
  sald: "Kund",
  gava: "Gåva",
};

/**
 * The page's word for a route, and the database's. They differ by one word
 * each, and translating HERE keeps the Swedish on the screen and the enum's
 * own vocabulary in the request -- rather than letting either leak into the
 * other and having to be untangled later.
 */
const ROUTE_TO_TYPE: Record<Route, string> = {
  demo: "demo",
  sald: "sold",
  gava: "gift",
};

type Made = {
  tenant_id: string;
  name: string;
  account_type: string;
  expires_at: string | null;
  admin_email: string;
};

function SignupForm({
  pin, route, onBack,
}: {
  pin: string;
  route: Route;
  onBack: () => void;
}) {
  const [company, setCompany] = useState("");
  const [orgNr, setOrgNr] = useState("");
  const [invoice, setInvoice] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");

  const [password, setPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<Made | null>(null);

  /**
   * Asked for only where somebody will be invoiced. A demo and a gift have
   * nobody to send a bill to, and demanding an address for one would be asking
   * the operator to invent it. create-tenant enforces the same rule, so this
   * field appearing and that rule are one decision rather than two that can
   * drift.
   */
  const invoiceRequired = route === "sald";

  /**
   * What stands between the form and Kopiera inloggning, in the words the
   * screen uses. The gate used to be a bare boolean, and a tap on the grey
   * button did nothing at all -- an org nummer typed without its dash looked,
   * to the person holding the phone, like a screen with no way forward.
   */
  const missing = [
    company.trim() === "" && "företagets namn",
    !/^\d{6}-\d{4}$/.test(orgNr.trim()) && "organisationsnummer, skrivet som 556677-8899",
    invoiceRequired && !invoice.includes("@") && "fakturamejl",
    adminName.trim() === "" && "administratörens namn",
    !adminEmail.includes("@") && "administratörens e-post",
  ].filter((m): m is string => Boolean(m));
  const ready = missing.length === 0;
  const [tried, setTried] = useState(false);

  function credentialBlock(pw: string) {
    return [
      `Länk: ${window.location.origin}/login/`,
      `Företag: ${company.trim()}`,
      `Namn: ${adminName.trim()}`,
      `Email: ${adminEmail.trim()}`,
      `Lösenord: ${pw}`,
    ].join("\n");
  }

  async function copyCredentials() {
    const pw = password ?? generatePassword();
    setPassword(pw);
    try {
      await navigator.clipboard.writeText(credentialBlock(pw));
    } catch {
      // A clipboard the browser refused is not a reason to pretend the step
      // did not happen: the password is on screen and can be read off it.
    }
    setCopied(true);
  }

  async function create() {
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-tenant`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: anon,
            Authorization: `Bearer ${anon}`,
          },
          body: JSON.stringify({
            pin,
            route: ROUTE_TO_TYPE[route],
            company: {
              name: company.trim(),
              org_nr: orgNr.trim(),
              invoice_email: invoice.trim() || undefined,
            },
            admin: { name: adminName.trim(), email: adminEmail.trim(), password },
          }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as Made & { error?: string };
      if (!res.ok) {
        // create-tenant answers in Swedish for everything a person can fix,
        // and in fel.ts's key for the one refusal it shares with the gate.
        setError(fel(body.error ?? "", "Företaget kunde inte skapas. Försök igen."));
        setBusy(false);
        return;
      }
      setMade(body);
    } catch {
      setError("Kunde inte nå servern. Försök igen.");
    }
    setBusy(false);
  }

  /* ---- done -------------------------------------------------------------- */
  if (made) {
    return (
      <Frame>
        <div className="pb-[14px]">
          <SoftNotice tone="live" headline="Företaget är skapat">
            {made.name} loggar in med uppgifterna du kopierade.
          </SoftNotice>
        </div>

        <Card radius={16} pad="p-5" shadow={SHADOW.hero}>
          <div className="mb-[14px] flex items-baseline justify-between gap-3">
            <div className="min-w-0 text-[22px] font-extrabold" style={{ letterSpacing: "-.7px" }}>
              {made.name}
            </div>
            <Tag tone={route === "demo" ? "warn" : "live"}>{TYPE_WORD[route]}</Tag>
          </div>
          <div className="rounded-[10px] px-4 py-[14px]" style={{ background: C.panel2 }}>
            <div className="text-[15px] font-medium" style={{ color: C.text2 }}>
              {made.admin_email}
            </div>
            {made.expires_at && (
              <div className="mt-[6px] text-[15px] font-bold">
                Provperioden går ut {made.expires_at.slice(0, 10)}
              </div>
            )}
          </div>
        </Card>

        <p className="pt-[22px] text-center text-[15px] font-medium" style={{ color: C.text2 }}>
          Lösenordet visas inte igen.
        </p>
      </Frame>
    );
  }

  /* ---- the form ---------------------------------------------------------- */
  return (
    <Frame>
      <div className="flex items-baseline justify-between px-1 pb-[10px]">
        <div
          className="text-[12px] font-bold uppercase"
          style={{ letterSpacing: "1px", color: C.text2 }}
        >
          {TYPE_WORD[route]}
        </div>
        <button
          type="button"
          onClick={onBack}
          className="flex min-h-[44px] items-center px-2 text-[15px] font-semibold"
          style={{ color: C.accent }}
        >
          Byt
        </button>
      </div>

      {error && (
        <div className="pb-[14px]">
          <SoftNotice tone="stop">{error}</SoftNotice>
        </div>
      )}

      <Card radius={16} pad="p-5">
        <div className="mb-[14px] text-[19px] font-bold" style={{ letterSpacing: "-.4px" }}>
          Företaget
        </div>
        <div className="mb-[14px]">
          <SoftField label="Namn">
            <SoftInput
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Bygg AB"
            />
          </SoftField>
        </div>
        <div className={invoiceRequired ? "mb-[14px]" : ""}>
          <SoftField label="Organisationsnummer" help="Skrivs som 556677-8899.">
            <SoftInput
              value={orgNr}
              onChange={(e) => setOrgNr(e.target.value)}
              placeholder="556677-8899"
              inputMode="numeric"
            />
          </SoftField>
        </div>
        {invoiceRequired && (
          <SoftField label="Fakturamejl">
            <SoftInput
              type="email"
              value={invoice}
              onChange={(e) => setInvoice(e.target.value)}
              placeholder="faktura@bolaget.se"
            />
          </SoftField>
        )}
      </Card>

      <div className="pt-[14px]">
        <Card radius={16} pad="p-5">
          <div className="mb-[14px] text-[19px] font-bold" style={{ letterSpacing: "-.4px" }}>
            Administratören
          </div>
          <div className="mb-[14px]">
            <SoftField label="Namn">
              <SoftInput
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                placeholder="Anna Andersson"
              />
            </SoftField>
          </div>
          <SoftField label="E-post" help="Det här blir inloggningen.">
            <SoftInput
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="anna@bolaget.se"
            />
          </SoftField>
        </Card>
      </div>

      {/* The credentials, on Ny arbetare's terms and for its reason: the
          password is generated in the browser and stored nowhere readable, so
          a company created before anybody copied it is a company nobody can
          sign into. */}
      {password && (
        <div className="pt-[14px]">
          <Card radius={16} pad="p-5">
            <div className="mb-[14px] flex items-baseline justify-between gap-3">
              <div className="text-[19px] font-bold" style={{ letterSpacing: "-.4px" }}>
                Inloggning
              </div>
              {copied && <Tag tone="live">Kopierad</Tag>}
            </div>
            <div className="rounded-[10px] px-4 py-[14px]" style={{ background: C.panel2 }}>
              <div className="text-[15px] font-medium" style={{ color: C.text2 }}>
                {adminEmail.trim()}
              </div>
              <div
                data-password
                className="mt-[6px] text-[22px] font-extrabold"
                style={{ letterSpacing: "1px" }}
              >
                {password}
              </div>
            </div>
            <div className="pt-[14px]">
              <button
                type="button"
                onClick={() => void copyCredentials()}
                className="press-scale flex h-[60px] w-full items-center justify-center rounded-[12px] text-[17px] font-bold transition-transform duration-[110ms] hover:bg-[#dbe4f9] active:scale-[.985]"
                style={{ background: C.panel2, color: C.ink, letterSpacing: "-.2px" }}
              >
                Kopiera igen
              </button>
            </div>
          </Card>
        </div>
      )}

      <div className="pt-[22px]">
        {!password ? (
          <>
            {/* NOT the `disabled` attribute, for the reason Ny arbetare gives:
                a disabled button swallows the click, so the screen cannot
                answer and what the operator meets is a control that does
                nothing at all. This one is always clickable -- and now it
                ANSWERS: a tap before the form is complete says what is
                missing, here by the thumb rather than at the top of the
                screen, and the list shrinks as the fields are filled. */}
            {tried && !ready && (
              <div className="pb-[14px]">
                <SoftNotice tone="warn">
                  Det här saknas: {missing.join(", ")}.
                </SoftNotice>
              </div>
            )}
            <button
              type="button"
              onClick={() => { if (ready) void copyCredentials(); else setTried(true); }}
              className="press-scale h-16 w-full rounded-[12px] text-[20px] font-extrabold transition-[transform,background] duration-150 active:scale-[.985]"
              style={{
                letterSpacing: "-.4px",
                background: ready ? C.accent : C.hairline,
                color: ready ? C.surface : C.chevron,
                boxShadow: ready ? SHADOW.action : undefined,
                cursor: ready ? "pointer" : "not-allowed",
              }}
            >
              Kopiera inloggning
            </button>
            <p
              className="pt-[14px] text-center text-[15px] font-medium"
              style={{ color: C.text2, textWrap: "pretty" }}
            >
              Lösenordet finns bara här. Kopiera det innan du skapar företaget —
              annars kan ingen logga in.
            </p>
          </>
        ) : (
          <PrimaryButton onClick={() => void create()} disabled={busy}>
            {busy ? "Skapar…" : "Skapa företaget"}
          </PrimaryButton>
        )}
      </div>
    </Frame>
  );
}
