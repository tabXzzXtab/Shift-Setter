"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { colourIndex, projectColour } from "@/lib/project-colour";

/**
 * A project's colour for one month, the same one on every screen showing it.
 *
 * `colourIndex` takes a project's position in a sorted list, so the list has to
 * be the SAME list everywhere or the colour is not the project's -- it is the
 * screen's. A site would read blue in the grid and red on the day you open from
 * it, which makes the colour worse than useless: it says two different sites
 * are the same one.
 *
 * The list is the projects with shifts in that MONTH, not every project that
 * exists. The palette is eight colours and wraps past that, so competing for a
 * slot has to be limited to the projects actually on screen together -- a
 * company with thirty sites would otherwise put two of them on the same colour
 * on the same Tuesday, which is the one failure the colour exists to prevent.
 *
 * Both screens call this rather than deriving the list themselves. A day page
 * reached from the calendar covers a date inside the calendar's month, so they
 * ask the same question and get the same answer by construction, not by two
 * derivations happening to agree.
 *
 * Returns null until the list has loaded, and for a project with no shifts that
 * month. A caller draws nothing rather than drawing the wrong colour and
 * correcting it a moment later.
 */
export function useMonthColour(month: string): (projectId: string) => string | null {
  const [ids, setIds] = useState<string[] | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      // Half-open month window, per invariant 9. `${month}-01` is the first of
      // this month and the same string a month on is the first of the next.
      const [y, m] = month.split("-").map(Number);
      const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

      const { data } = await getSupabase()
        .from("pass")
        .select("project_id")
        .is("deleted_at", null)
        .gte("work_date", `${month}-01`)
        .lt("work_date", next);

      if (!active) return;
      setIds([...new Set((data ?? []).map((p) => p.project_id))]);
    })();
    return () => { active = false; };
  }, [month]);

  return (projectId: string) =>
    ids && ids.includes(projectId) ? projectColour(colourIndex(ids, projectId)) : null;
}
