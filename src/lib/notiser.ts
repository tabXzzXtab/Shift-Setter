import { svDate } from "@/lib/dates";

/**
 * What each kind of notification SAYS, and where tapping it goes.
 *
 * The words are spec Section 6b's table -- the settled copy, the one place any
 * of it is written. "[datum]" and "[projektnamn]" are filled from the row:
 * the date as a person writes it (svDate), the project by name, which comes
 * through my_notification because a worker cannot read public.project.
 *
 * A notification that only said "something changed" would make the reader
 * open the app to find out what, which is the thing it was supposed to save.
 */
export type NotisKind =
  | "shift_offered" | "shift_deleted" | "day_unconfirmed" | "day_flagged"
  | "leader_replaced" | "pass_closed" | "snabb_review" | "day_admin_confirmed";

export type NotisRow = {
  id: string;
  kind: NotisKind;
  created_at: string;
  read_at: string | null;
  work_date: string | null;
  project_name: string | null;
  payload: { project_id?: string; work_date?: string } | null;
};

export function notisText(n: NotisRow): { title: string; body: string } {
  const datum = n.work_date ? svDate(n.work_date) : "";
  const projekt = n.project_name ?? "projektet";
  switch (n.kind) {
    case "shift_offered":
      return { title: "Nytt pass", body: `Du har fått ett pass ${datum} på ${projekt}` };
    case "shift_deleted":
      return { title: "Pass inställt", body: `Ditt pass ${datum} på ${projekt} är borttaget` };
    case "day_unconfirmed":
      return { title: "Pass skickat tillbaka", body: `Dagen ${datum} på ${projekt} behöver din bekräftelse igen` };
    case "day_admin_confirmed":
      return { title: "Dag bekräftad", body: `Dagen ${datum} på ${projekt} är bekräftad av admin` };
    case "snabb_review":
      return { title: "Snabb Pass att granska", body: `${datum} på ${projekt} behöver din genomgång` };
    case "leader_replaced":
      return { title: "Du har bytts ut", body: `Du är inte längre arbetsledare för ${datum} på ${projekt}` };
    case "pass_closed":
      return { title: "Pass stängt", body: `Passet ${datum} på ${projekt} har stängts` };
    case "day_flagged":
      return { title: "Dag flaggad", body: `Dagen ${datum} på ${projekt} kräver din uppmärksamhet` };
  }
}

/**
 * The screen a notification is about. A preference, never a permission: the
 * route guard and RLS still decide what opens, and Bekräfta and Granska take
 * ?projekt=&datum= as "this one if it is still waiting".
 */
export function notisHref(n: NotisRow): string {
  const day = n.payload?.project_id && n.work_date
    ? `?projekt=${n.payload.project_id}&datum=${n.work_date}` : "";
  switch (n.kind) {
    case "shift_offered":
    case "shift_deleted":
    case "pass_closed":
    case "leader_replaced":
      return "/mina-pass";
    case "day_unconfirmed":
    case "snabb_review":
      return `/bekrafta${day}`;
    case "day_flagged":
      return `/granska${day}`;
    case "day_admin_confirmed":
      return "/historik";
  }
}
