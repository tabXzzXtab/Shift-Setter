"use client";

import { useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  BackArrow, C, Card, ChevronRight, IconButton, PrimaryButton, SHADOW, SoftField,
  SoftInput, SoftNotice, Tag,
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
function Frame({ title, line, children }: { title: string; line: string; children: ReactNode }) {
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
      <div className="px-1 pb-[22px]">
        <h1 className="text-[22px] font-extrabold" style={{ letterSpacing: "-.7px" }}>
          {title}
        </h1>
        <p className="pt-1 text-[15px] font-medium" style={{ color: C.text2, textWrap: "pretty" }}>
          {line}
        </p>
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
    <Frame title="Ange din kod" line="Koden fick du av din kontaktperson på ByggKoll.">
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

      {busy && (
        <p className="pt-[22px] text-center text-[15px] font-medium" style={{ color: C.text2 }}>
          Kontrollerar…
        </p>
      )}
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
    <Frame title="Välj typ av konto" line="Välj rätt typ — det går inte att ändra efteråt.">
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

/**
 * What create-tenant said, as the operator should read it.
 *
 * THE FUNCTION ANSWERS IN SWEDISH, and its sentence is the one worth showing:
 * "Korperation finns redan med det organisationsnumret." is an answer, where
 * "Företaget kunde inte skapas" is a shrug. This used to pass every answer
 * through fel(), which only knows its own table and replaced all of these with
 * the fallback -- so a duplicate org nummer, a used email and a wrong code all
 * read as the same unexplained failure.
 *
 * fel() still gets first look, for the two things it exists for: the 429 key
 * the PIN gate shares, and an English database message from one of the
 * function's undo paths. Anything it does not know is shown exactly as sent.
 */
function answerOf(status: number, error: string | undefined): string {
  const said = (error ?? "").trim();
  if (status === 429) return fel(said, "För många försök. Försök igen om en minut.");
  if (said) return fel(said, said);
  return `Företaget kunde inte skapas (svar ${status}). Försök igen.`;
}

/**
 * Stage three's frame: the handoff's sub-screen header -- the back button, the
 * 22/800 title, one line under it indented to clear the button -- and nothing
 * else above the form. Back returns to the route choice; it is state, not a
 * route, which is why this is not SoftScreen and its Link.
 */
function FormFrame({
  title, line, onBack, children,
}: {
  title: string;
  line: string;
  onBack?: () => void;
  children: ReactNode;
}) {
  return (
    <main
      data-soft-screen={title}
      className="mx-auto min-h-dvh w-full max-w-[390px] pb-[40px]"
      style={{
        background: C.ground,
        color: C.ink,
        fontFamily: "var(--font-inter), system-ui, sans-serif",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <div className="flex items-center gap-3 px-4 pb-[6px] pt-[14px]">
        {onBack && <IconButton label="Tillbaka" onClick={onBack}><BackArrow /></IconButton>}
        <h1 className="min-w-0 flex-1 text-[22px] font-extrabold" style={{ letterSpacing: "-.7px" }}>
          {title}
        </h1>
      </div>
      <p
        className={`pb-1 pr-4 text-[15px] font-medium ${onBack ? "pl-[72px]" : "pl-4"}`}
        style={{ color: C.text2, textWrap: "pretty" }}
      >
        {line}
      </p>
      <div className="px-4 pt-[14px]">{children}</div>
    </main>
  );
}

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

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [made, setMade] = useState<Made | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  /**
   * Asked for only where somebody will be invoiced. A demo and a gift have
   * nobody to send a bill to, and demanding an address for one would be asking
   * the operator to invent it. create-tenant enforces the same rule, so this
   * field appearing and that rule are one decision rather than two that can
   * drift.
   */
  const invoiceRequired = route === "sald";

  /**
   * What stands between the form and Skapa företaget, in the words the screen
   * uses. A tap before the form is complete names these rather than doing
   * nothing -- an org nummer typed without its dash once looked, to the person
   * holding the phone, like a screen with no way forward.
   */
  const missing = [
    company.trim() === "" && "företagets namn",
    !/^\d{6}-\d{4}$/.test(orgNr.trim()) && "organisationsnummer, skrivet som 556677-8899",
    invoiceRequired && !invoice.includes("@") && "fakturamejl",
    adminName.trim() === "" && "administratörens namn",
    !adminEmail.includes("@") && "administratörens e-post",
  ].filter((m): m is string => Boolean(m));
  const ready = missing.length === 0;

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
    if (!password) return;
    try {
      await navigator.clipboard.writeText(credentialBlock(password));
    } catch {
      // A clipboard the browser refused is not a reason to pretend the step
      // did not happen: the password is on screen and can be read off it.
    }
    setCopied(true);
  }

  /**
   * CREATE FIRST, THEN COPY. The password is generated here and sent with the
   * request, and shown only once the company exists -- so what is copied is
   * always a login that works. If the operator leaves without copying it, the
   * admin is not locked out: Glömt lösenord on the login screen resets it by
   * email. That is the trade this order makes against copying first.
   */
  async function create() {
    if (busy) return;
    if (!ready) { setTried(true); return; }
    const pw = generatePassword();
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
            admin: { name: adminName.trim(), email: adminEmail.trim(), password: pw },
          }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as Made & { error?: string };
      if (!res.ok) {
        setError(answerOf(res.status, body.error));
        setBusy(false);
        return;
      }
      setPassword(pw);
      setMade(body);
    } catch {
      setError("Kunde inte nå servern. Försök igen.");
    }
    setBusy(false);
  }

  /* ---- made: the login, and copying it ------------------------------------ */
  if (made && password) {
    return (
      <FormFrame title="Kontot är skapat" line="Kopiera inloggningen nu — den visas bara en gång.">
        <Card radius={16} pad="p-5" shadow={SHADOW.hero}>
          <div className="mb-[14px] flex items-baseline justify-between gap-3">
            <div className="min-w-0 text-[22px] font-extrabold" style={{ letterSpacing: "-.7px" }}>
              {made.name}
            </div>
            <Tag tone={copied ? "live" : route === "demo" ? "warn" : "quiet"}>
              {copied ? "Kopierad" : TYPE_WORD[route]}
            </Tag>
          </div>
          <div className="rounded-[10px] px-4 py-[14px]" style={{ background: C.panel2 }}>
            <div className="text-[15px] font-medium" style={{ color: C.text2 }}>
              {made.admin_email}
            </div>
            <div data-password className="mt-[6px] text-[22px] font-extrabold" style={{ letterSpacing: "1px" }}>
              {password}
            </div>
            {made.expires_at && (
              <div className="mt-[6px] text-[15px] font-bold">
                Provperioden går ut {made.expires_at.slice(0, 10)}
              </div>
            )}
          </div>
        </Card>
        <div className="pt-[22px]">
          <PrimaryButton onClick={() => void copyCredentials()}>
            {copied ? "Kopiera igen" : "Kopiera inloggning"}
          </PrimaryButton>
        </div>
      </FormFrame>
    );
  }

  /* ---- the form ---------------------------------------------------------- */
  return (
    <FormFrame
      title="Skapa företaget"
      line="Kontrollera organisationsnumret — det måste stämma exakt."
      onBack={onBack}
    >
      <Card radius={16} pad="p-5">
        <div className="mb-[14px] text-[19px] font-bold" style={{ letterSpacing: "-.4px" }}>
          Företaget
        </div>
        <div className="mb-[14px]">
          <SoftField label="Namn">
            <SoftInput value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Bygg AB" />
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
              <SoftInput value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="Anna Andersson" />
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

      {/* Both answers sit here, by the button a thumb just pressed, rather
          than at the top of a screen that has scrolled. */}
      <div className="pt-[22px]">
        {tried && !ready && (
          <div className="pb-[14px]">
            <SoftNotice tone="warn">Det här saknas: {missing.join(", ")}.</SoftNotice>
          </div>
        )}
        {error && (
          <div className="pb-[14px]">
            <SoftNotice tone="stop">{error}</SoftNotice>
          </div>
        )}
        {/* Disabled only while the request is out. Incomplete, it stays
            pressable and answers with what is missing -- a disabled button
            swallows the tap and says nothing. */}
        <PrimaryButton onClick={() => void create()} disabled={busy}>
          {busy ? "Skapar…" : "Skapa företaget"}
        </PrimaryButton>
      </div>
    </FormFrame>
  );
}
