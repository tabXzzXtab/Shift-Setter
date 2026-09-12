"use client";

import { useState } from "react";
import {
  C, Card, PrimaryButton, SecondaryButton, SoftField, SoftInput, SoftNotice,
  SoftSelect, Tag,
} from "./soft";
import { getSupabase } from "@/lib/supabase/client";
import { fel } from "@/lib/fel";

export type CreatedWorker = { worker_id: string; name: string; email: string };

/** The three the Edge Function accepts. It refuses anything else outright. */
type Role = "arbetare" | "arbetsledare" | "admin";

/**
 * Creating a worker creates their account. The sequence is fixed (spec §3):
 *
 *   1. Name and email.
 *   2. Kopiera Inloggning -- generates the password and copies the block.
 *   3. Only THEN does Tillverka Arbetare become pressable.
 *
 * The copy gates the create deliberately: an account whose credentials nobody
 * holds is an account nobody can use, and the worker has no way to ask. This
 * is the one screen the handoff uses to document the disabled pattern, and the
 * sentence under the two dead buttons is the reason they are dead.
 *
 * The same form serves the roster screen and the Snabb Pass dropdown, because
 * it is the same act: "the same form appears, the same copy-then-create
 * sequence runs, and the admin returns to the shift screen and finishes as
 * though nothing happened."
 *
 * WHAT IS ON SCREEN AND WHAT IS ON THE CLIPBOARD ARE NOT THE SAME SHAPE. The
 * clipboard gets the four-line block, unchanged, because that is what gets
 * pasted into a message. The panel shows the three things somebody reads out
 * over a phone, with the password at 22/800 -- six digits dictated from a
 * 15px line is how a digit gets heard wrong.
 */

/** Six digits: within 6-20 characters, and typeable on a phone keypad. */
function generatePassword(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]!;
  return String(100000 + (n % 900000));
}

/** 12/700 uppercase, the label on every entry in the credentials panel. */
function EntryLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[12px] font-bold uppercase"
      style={{ letterSpacing: ".9px", color: C.text2 }}
    >
      {children}
    </div>
  );
}

export function NyArbetareForm({
  allowRoleChoice = true,
  onCreated,
  onCancel,
}: {
  allowRoleChoice?: boolean;
  onCreated: (w: CreatedWorker, credentials: string) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("arbetare");
  const [password, setPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const ready = name.trim() !== "" && email.trim() !== "";

  /** The app's own front door, which is where the worker has to arrive. */
  function loginLink() {
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    return typeof window === "undefined" ? `${base}/` : `${window.location.origin}${base}/`;
  }

  function credentialBlock(pw: string) {
    return `Länk: ${loginLink()}\nNamn: ${name.trim()}\nEmail: ${email.trim()}\nLösenord: ${pw}`;
  }

  async function copyLogin() {
    const pw = password ?? generatePassword();
    setPassword(pw);
    try {
      await navigator.clipboard.writeText(credentialBlock(pw));
    } catch {
      // Clipboard can be refused. The block is on screen regardless, so the
      // admin is never left without it.
    }
    setCopied(true);
  }

  async function create() {
    if (!password) return;
    setSaving(true);
    setError(null);

    const sb = getSupabase();
    const { data: { session } } = await sb.auth.getSession();

    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-account`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password, role }),
      },
    );

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(fel(body.error, "Kontot kunde inte skapas. Kontrollera e-postadressen, eller kontakta administratören."));
      setSaving(false);
      return;
    }

    onCreated(
      { worker_id: body.worker_id, name: name.trim(), email: email.trim() },
      credentialBlock(password),
    );
    setSaving(false);
  }

  return (
    <div>
      {error && <div className="pb-[14px]"><SoftNotice tone="stop">{error}</SoftNotice></div>}

      <Card radius={16} pad="p-[18px]">
        <div className="mb-[14px]">
          <SoftField label="Namn">
            <SoftInput
              placeholder="För- och efternamn"
              value={name}
              onChange={(e) => { setName(e.target.value); setCopied(false); }}
              autoComplete="off"
            />
          </SoftField>
        </div>

        <div className={allowRoleChoice ? "mb-[14px]" : undefined}>
          <SoftField
            label="E-post"
            help="Används för att logga in. Måste inte vara en riktig brevlåda."
          >
            <SoftInput
              type="email"
              placeholder="namn@bolaget.test"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setCopied(false); }}
              autoComplete="off"
            />
          </SoftField>
        </div>

        {allowRoleChoice && (
          <SoftField label="Roll">
            <SoftSelect value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="arbetare">Arbetare</option>
              <option value="arbetsledare">Arbetsledare</option>
              <option value="admin">Admin</option>
            </SoftSelect>
          </SoftField>
        )}

        {/* Said where the decision is made rather than after it, which is this
            design's rule for anything that hands out more than it takes back.
            An admin can do everything on this installation, including making
            and unmaking other admins. */}
        {allowRoleChoice && role === "admin" && (
          <div className="pt-[14px]">
            <SoftNotice tone="warn">
              En admin kan allt: skapa projekt och konton, godkänna dagar och
              ändra andras roller.
            </SoftNotice>
          </div>
        )}
      </Card>

      {/* The credentials, once there are any. */}
      {password && (
        <div className="pt-[14px]">
          <Card radius={16} pad="p-[18px]">
            <div className="mb-3 flex items-center justify-between gap-[10px]">
              <div
                className="text-[12px] font-bold uppercase"
                style={{ letterSpacing: "1px", color: C.text2 }}
              >
                Inloggning
              </div>
              {copied && (
                <Tag tone="live">
                  <svg width="11" height="9" viewBox="0 0 11 9" fill="none" aria-hidden>
                    <path d="M1 4.6 4 7.6 10 1.4" stroke={C.liveInk} strokeWidth="2.2"
                      strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Kopierad
                </Tag>
              )}
            </div>

            <div
              data-credentials
              className="flex flex-col gap-[10px] rounded-[10px] px-4 py-[14px]"
              style={{ background: C.panel2 }}
            >
              <div>
                <EntryLabel>Länk</EntryLabel>
                <div className="break-all text-[15px] font-semibold">{loginLink()}</div>
              </div>
              <div>
                <EntryLabel>E-post</EntryLabel>
                <div className="break-all text-[15px] font-semibold">{email.trim()}</div>
              </div>
              <div>
                <EntryLabel>Lösenord</EntryLabel>
                {/* The one thing on this screen someone reads out loud. */}
                <div
                  data-password
                  className="text-[22px] font-extrabold"
                  style={{ letterSpacing: "1px" }}
                >
                  {password}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={copyLogin}
              className="press-scale mt-3 h-[52px] w-full rounded-[10px] text-[16px] font-bold transition-transform duration-[110ms] hover:bg-[#dbe4f9] active:scale-[.985]"
              style={{ background: C.panel2, color: C.inkHover }}
            >
              Kopiera igen
            </button>
          </Card>
        </div>
      )}

      <div className="pt-5">
        {/* Before there is anything to copy, this is the only live control on
            the screen -- and it is dead too until there is a name and an
            address to put in the block. */}
        {!password && (
          <div className="mb-[10px]">
            <button
              type="button"
              onClick={copyLogin}
              disabled={!ready}
              className="press-scale flex h-14 w-full items-center justify-center rounded-[12px] text-[17px] font-bold transition-transform duration-[110ms] active:scale-[.985]"
              style={{
                letterSpacing: "-.2px",
                background: ready ? C.panel2 : C.hairline,
                color: ready ? C.inkHover : C.chevron,
                cursor: ready ? undefined : "not-allowed",
              }}
            >
              Kopiera inloggning
            </button>
          </div>
        )}

        <PrimaryButton onClick={create} disabled={!copied || saving}>
          {saving ? "Skapar…" : "Tillverka arbetare"}
        </PrimaryButton>

        {!copied && (
          <p
            className="px-1 pt-3 text-[15px] font-medium"
            style={{ color: C.text2, textWrap: "pretty" }}
          >
            Kopiera inloggningen först. Ett konto vars uppgifter ingen har är ett
            konto ingen kan använda.
          </p>
        )}

        {onCancel && (
          <div className="pt-[10px]">
            <SecondaryButton onClick={onCancel}>Avbryt</SecondaryButton>
          </div>
        )}
      </div>
    </div>
  );
}
