"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppBar, type MenuItem } from "./app-bar";
import { ActionLink, Empty, Landing, Notice } from "./ui";
import { getSupabase } from "@/lib/supabase/client";

type Row = {
  project_id: string;
  name: string;
  site_address: string;
  hours: number;
};

/**
 * The admin's landing page: three buttons, then the list.
 *
 * The list is the work. Those three sit above it because creating is the only
 * thing an owner does that a list cannot show him (spec Section 7).
 *
 * The Arbetsdagbok is not here and not in the menu. It lives inside the
 * project, because a document is about one project over one range and a button
 * on the landing page would have to ask which before it could do anything.
 */
const MENU: MenuItem[] = [
  { href: "/kalender", label: "Kalender" },
  { href: "/projekt", label: "Alla Projekt" },
  { href: "/pass", label: "Alla Pass" },
  { href: "/installningar", label: "Inställningar" },
];

/** Swedish decimal comma, and no trailing ",0" on a whole number. */
const hours = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r).replace(".", ",");
};

export function HomeAdmin() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      // The hours are summed in the database. Adding them here would mean
      // shipping every assignment in the company to a phone to total them.
      const { data, error } = await getSupabase()
        .from("project_hours")
        .select("project_id, name, site_address, hours")
        .order("name");

      if (!active) return;
      if (error) { setError(error.message); setRows([]); return; }
      setRows((data ?? []) as Row[]);
    })();
    return () => { active = false; };
  }, []);

  return (
    <Landing>
      <AppBar title="Admin" menu={MENU} />

      <div className="mb-8 flex flex-col gap-3">
        <ActionLink href="/projekt/ny">Nytt Projekt</ActionLink>
        <ActionLink href="/pass/ny">Skapa Pass</ActionLink>
        <ActionLink href="/snabb">Snabb Pass</ActionLink>
      </div>

      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide">Alla Projekt</h2>

      {error && <Notice kind="error">{error}</Notice>}
      {rows === null && <p className="text-base">Laddar…</p>}
      {rows !== null && rows.length === 0 && <Empty>Inga projekt än.</Empty>}

      <div className="flex flex-col gap-3">
        {(rows ?? []).map((p) => (
          <Link
            key={p.project_id}
            href={`/arbetsdagbok?projekt=${p.project_id}`}
            className="block border-2 border-black p-4"
          >
            <p className="text-xl font-bold">{p.name}</p>
            <p className="text-base">{p.site_address}</p>
            <p className="mt-2 text-base font-bold">{hours(p.hours)} h</p>
          </Link>
        ))}
      </div>
    </Landing>
  );
}
