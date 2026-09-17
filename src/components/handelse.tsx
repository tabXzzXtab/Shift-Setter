"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  C, Card, EmptyState, PrimaryButton, SectionLabel, SecondaryButton, SHADOW,
  SoftField, SoftInput, SoftNotice, SoftTextarea, Tag,
} from "./soft";
import { getSupabase } from "@/lib/supabase/client";
import { hhmm } from "@/lib/dates";
import { type Role } from "@/lib/account";
import { CHIP_PALETTE } from "@/lib/project-colour";
import { fel } from "@/lib/fel";

/**
 * Ärenden -- a personal_event, everywhere one is written or drawn.
 *
 * ONE FORM, TWO ENTRY POINTS. The Personlig calendar writes these, and so does
 * Tilldela Ärende on the day page. Two forms against one table is two sets of
 * labels, two defaults for Hela dagen, and a check constraint satisfied in one
 * place and not the other -- so the form, the card and the picker live here and
 * both screens compose them. That was not a hypothetical risk: the two screens
 * were specified with different field names for the same column.
 *
 * WHAT AN ÄRENDE IS NOT is the important half, and it is the migration's first
 * paragraph: this is not shift data and must never become it. The tier walk
 * does not read it, the overlap test does not read it, and the Arbetsdagbok
 * does not read it. An ärende on a day makes nobody unavailable and prints
 * nowhere.
 */

export type Handelse = {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  event_date: string;
  all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  colour: string;
};

/** The columns every read of personal_event asks for, so they cannot diverge. */
export const HANDELSE_COLUMNS =
  "id, owner_id, title, description, event_date, all_day, start_time, end_time, colour";

export type Konto = { id: string; name: string | null; email: string | null; role: Role };

/** Arbetsledare to the top of the viewer picker, then everyone else by name. */
export const RANK = (r: Role) => (r === "arbetsledare" ? 0 : 1);
export const nameFor = (k: Konto) => k.name ?? k.email ?? "Konto";

export const roleLabel = (r: Role) =>
  r === "arbetsledare" ? "Arbetsledare" : r === "admin" ? "Admin" : "Arbetare";

/**
 * Every account the viewer is allowed to name, in picker order.
 *
 * account_directory ends in "where app.is_admin() or a.id = auth.uid()", so an
 * admin gets everyone and anybody else gets exactly one row: themselves. That
 * is why the picker says "inga andra konton" rather than drawing an empty box
 * -- for a non-admin owner the list is genuinely empty once their own row is
 * dropped, and that is the policy working rather than a failed read.
 */
export function useKonton(): Konto[] {
  const [konton, setKonton] = useState<Konto[]>([]);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data } = await getSupabase()
        .from("account_directory")
        .select("id, name, email, role")
        .order("name");
      if (!live) return;
      setKonton(((data ?? []) as Konto[]).filter((k) => k.role !== null));
    })();
    return () => { live = false; };
  }, []);

  return konton;
}

/** The list a picker offers: everybody but the owner, leaders first. */
export function pickableFrom(konton: Konto[], me: string | null): Konto[] {
  return konton
    .filter((k) => k.id !== me)
    .sort((a, b) => RANK(a.role) - RANK(b.role) || nameFor(a).localeCompare(nameFor(b), "sv"));
}

/** When an ärende happens, in the one line a card has for it. */
export function whenLine(e: Handelse): string {
  return e.all_day ? "Hela dagen" : `${hhmm(e.start_time)}–${hhmm(e.end_time)}`;
}

/**
 * One ärende.
 *
 * The delete button is drawn only for the owner. That is a courtesy and not
 * the boundary: personal_event_write is `owner_id = auth.uid()` in both the
 * USING and the WITH CHECK, so a viewer who forces the call deletes nothing.
 */
export function EventCard({
  event, mine, viewerNames, viewerCount, busy, onDelete,
}: {
  event: Handelse;
  mine: boolean;
  viewerNames: string[];
  viewerCount: number;
  busy: boolean;
  onDelete: () => void;
}) {
  return (
    <div
      data-handelse={event.id}
      className="rounded-[14px] px-4 pb-[14px] pt-[15px]"
      style={{ background: C.surface, boxShadow: SHADOW.group }}
    >
      <div className="mb-[3px] flex items-baseline justify-between gap-[10px]">
        <div className="flex min-w-0 items-center gap-[10px]">
          {/* The swatch, at the legend's 16px. Never the only carrier -- the
              title says what it is and this only says which colour it wears. */}
          <span
            className="inline-block h-4 w-4 shrink-0 rounded-[5px]"
            style={{ background: event.colour }}
            aria-hidden
          />
          <div className="truncate text-[18px] font-bold" style={{ letterSpacing: "-.4px" }}>
            {event.title}
          </div>
        </div>
        <div className="whitespace-nowrap text-[15px] font-bold" style={{ color: C.text2 }}>
          {whenLine(event)}
        </div>
      </div>

      {event.description && (
        <div className="mt-2 text-[15px] font-medium" style={{ color: C.text2, textWrap: "pretty" }}>
          {event.description}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-[8px]">
        {!mine ? (
          <Tag tone="quiet">Delad med dig</Tag>
        ) : viewerCount === 0 ? (
          <Tag tone="quiet">Bara du</Tag>
        ) : (
          <span className="text-[14px] font-medium" style={{ color: C.text2 }}>
            Delad med{" "}
            {viewerNames.length === viewerCount
              ? viewerNames.join(", ")
              : `${viewerCount} ${viewerCount === 1 ? "person" : "personer"}`}
          </span>
        )}
      </div>

      {mine && (
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="press-scale mt-3 h-[52px] w-full rounded-[12px] text-[16px] font-bold transition-transform duration-[110ms] active:scale-[.985]"
          style={{ background: C.stopBg, color: C.stopInk, cursor: busy ? "not-allowed" : undefined }}
        >
          Ta bort
        </button>
      )}
    </div>
  );
}

/**
 * The form, which is the check constraint written twice.
 *
 * `personal_event_times_match_all_day` says a row is either all-day with NO
 * times, or timed with BOTH times and an end after its start. This form cannot
 * reach a state that violates it: the time fields are not merely hidden when
 * Hela dagen is on, they are submitted as NULL, and Spara stays disabled until
 * whichever of the two shapes is selected is complete. A blank title is
 * refused for the same reason -- `personal_event_title_not_blank` trims before
 * it compares, so this trims before it checks.
 *
 * HELA DAGEN STARTS ON. Most of what goes in here is a day off, a site visit
 * or a week of leave, and the column's `default false` is about what a row
 * means when nobody said -- not about what the person in front of the form
 * most often wants. They still say either way; this only decides which answer
 * costs no taps.
 *
 * The colour cannot be wrong at all: eight swatches, no field to type into,
 * and the eight are the same eight `personal_event_colour_in_palette` lists.
 *
 * None of that is the boundary. The database refuses a bad row whatever the
 * browser sends; this exists so nobody is told no after filling a form in.
 */
export function NyHandelse({
  date, ownerId, pickable, onCancel, onSaved,
}: {
  date: string;
  ownerId: string | null;
  pickable: Konto[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [eventDate, setEventDate] = useState(date);
  const [allDay, setAllDay] = useState(true);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [colour, setColour] = useState<string>(CHIP_PALETTE[0]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleOk = title.trim() !== "";
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(eventDate);
  // Strictly after, exactly as the constraint has it. An ärende cannot cross
  // midnight here the way a night shift can -- `end_time > start_time` compares
  // two times on one date, with no next-day escape hatch.
  const timesOk = allDay ? true : start !== "" && end !== "" && end > start;
  const canSave = titleOk && dateOk && timesOk && !saving && ownerId !== null;

  async function save() {
    if (!canSave || !ownerId) return;
    setSaving(true); setError(null);
    const sb = getSupabase();

    const { data, error } = await sb
      .from("personal_event")
      .insert({
        owner_id: ownerId,
        title: title.trim(),
        description: description.trim() || null,
        event_date: eventDate,
        all_day: allDay,
        // NULL, not the value behind the hidden field. "All day" is a different
        // claim from "a long day", and the constraint keeps the two out of one
        // row.
        start_time: allDay ? null : start,
        end_time: allDay ? null : end,
        colour,
      })
      .select("id")
      .single();

    if (error || !data) {
      setError(fel(error, "Ärendet kunde inte sparas. Ladda om sidan och försök igen."));
      setSaving(false);
      return;
    }

    if (chosen.length > 0) {
      const { error: vErr } = await sb
        .from("personal_event_viewer")
        .insert(chosen.map((account_id) => ({ event_id: data.id, account_id })));
      // The ärende exists either way. Saying which half failed beats one
      // sitting there that nobody was told about.
      if (vErr) {
        setError(
          "Ärendet sparades, men delningen misslyckades: "
          + fel(vErr, "kontakta administratören."),
        );
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    onSaved();
  }

  return (
    <Card>
      <SectionLabel>Tilldela ärende</SectionLabel>

      <div className="flex flex-col gap-[14px]">
        <SoftField label="Titel">
          <SoftInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Platsbesök"
          />
        </SoftField>

        <SoftField label="Beskrivning">
          <SoftTextarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Valfritt."
          />
        </SoftField>

        <SoftField label="Datum">
          <SoftInput type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
        </SoftField>

        <CheckRow label="Hela dagen" checked={allDay} onToggle={() => setAllDay((v) => !v)} />

        {/* Hidden AND nulled. The values stay in state so toggling back
            restores what was typed rather than blanking it; what is submitted
            is decided at save, not by what is on screen. */}
        {!allDay && (
          <div className="flex min-w-0 gap-[10px]">
            <div className="min-w-0 flex-1">
              <SoftField label="Starttid">
                <SoftInput type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              </SoftField>
            </div>
            <div className="min-w-0 flex-1">
              <SoftField label="Sluttid">
                <SoftInput type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
              </SoftField>
            </div>
          </div>
        )}

        {!allDay && !timesOk && start !== "" && end !== "" && (
          <SoftNotice tone="warn">Sluttid måste vara efter starttid.</SoftNotice>
        )}

        <div>
          <FieldLabel>Färg</FieldLabel>
          {/* Eight swatches and no field to type in. The palette is the same
              eight the check constraint lists, so an unacceptable colour is
              not reachable rather than merely refused. */}
          <div role="radiogroup" aria-label="Färg" className="grid grid-cols-4 gap-2">
            {CHIP_PALETTE.map((hex) => {
              const on = hex === colour;
              return (
                <button
                  key={hex}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={hex}
                  data-colour={hex}
                  onClick={() => setColour(hex)}
                  className="press-scale flex h-11 items-center justify-center rounded-[10px] transition-transform duration-[110ms] active:scale-[.985]"
                  style={{
                    background: hex,
                    boxShadow: on ? `inset 0 0 0 3px ${C.surface}, 0 0 0 2px ${C.ink}` : undefined,
                  }}
                >
                  {on && <Check />}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <FieldLabel>Vem kan se detta?</FieldLabel>
          {/* The owner is not in this list and cannot be taken out of it.
              personal_event_select reads "owner_id = auth.uid() OR
              app.sees_personal_event(id)", so whoever writes the ärende sees it
              whatever is ticked here. */}
          <p className="mb-[8px] text-[14px] font-medium" style={{ color: C.text2 }}>
            Du ser alltid dina egna ärenden. Välj vilka andra som också ska se det.
          </p>
          {pickable.length === 0 ? (
            <EmptyState>Inga andra konton att dela med.</EmptyState>
          ) : (
            <div className="flex flex-col gap-[6px]" data-viewer-picker>
              {pickable.map((k) => (
                <CheckRow
                  key={k.id}
                  label={nameFor(k)}
                  tag={roleLabel(k.role)}
                  tone={k.role === "arbetsledare" ? "warn" : "quiet"}
                  checked={chosen.includes(k.id)}
                  onToggle={() =>
                    setChosen((c) => (c.includes(k.id) ? c.filter((x) => x !== k.id) : [...c, k.id]))
                  }
                />
              ))}
            </div>
          )}
        </div>

        {error && <SoftNotice tone="stop">{error}</SoftNotice>}

        <PrimaryButton onClick={() => void save()} disabled={!canSave}>
          {saving ? "Sparar…" : "Spara ärende"}
        </PrimaryButton>
        <SecondaryButton onClick={onCancel}>Avbryt</SecondaryButton>
      </div>
    </Card>
  );
}

/**
 * SoftField's 12/700 uppercase label, for the two groups that are not one
 * input and so cannot sit inside a <label>.
 */
function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span
      className="mb-[6px] block text-[12px] font-bold uppercase"
      style={{ letterSpacing: ".9px", color: C.text2 }}
    >
      {children}
    </span>
  );
}

const Check = () => (
  <svg width="14" height="11" viewBox="0 0 14 11" fill="none" aria-hidden>
    <path d="M1.5 5.6 5 9.2 12.5 1.6" stroke="#ffffff" strokeWidth="2.4"
      strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * The 52px checkbox row, the same object Profil's F-skatt uses.
 *
 * role="checkbox" rather than aria-pressed: the handoff draws a checkbox and
 * this behaves like one, so a screen reader should say "checkbox, checked"
 * rather than "button, pressed".
 */
export function CheckRow({
  label, tag, tone = "quiet", checked, onToggle,
}: {
  label: string;
  tag?: string;
  tone?: "warn" | "quiet";
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className="flex h-[52px] w-full items-center justify-between gap-[10px] rounded-[10px] px-[14px]"
      style={{ background: C.panel2 }}
    >
      <span className="flex min-w-0 items-center gap-[8px]">
        <span className="truncate text-[16px] font-semibold">{label}</span>
        {tag && <Tag tone={tone}>{tag}</Tag>}
      </span>
      <span
        className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px]"
        style={{
          background: checked ? C.accent : C.surface,
          boxShadow: checked ? undefined : `inset 0 0 0 1.5px ${C.hairline}`,
        }}
      >
        {checked && <Check />}
      </span>
    </button>
  );
}
