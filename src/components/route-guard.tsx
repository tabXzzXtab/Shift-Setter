"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAccount, type Role } from "@/lib/account";

/**
 * Sends anybody on a screen that is not theirs back to their own startsida.
 *
 * A COURTESY, NOT A BOUNDARY. RLS decides what anybody can read or write; an
 * arbetare who renders /arbetsdagbok in devtools still gets nothing out of the
 * database. What this stops is a worker following a pasted link or typing an
 * address and landing on a screen whose every control fails -- which reads as
 * a broken app, not as "this is the admin's".
 *
 * ONE TABLE FOR THE WHOLE APP. The screens used to guard themselves one at a
 * time, each in its own way (a redirect on Redigera, a notice on Snabb Pass and
 * Kalender, nothing at all on Arbetsdagbok, Alla Konton or Granska), so a new
 * admin screen was open to everybody until somebody remembered.
 *
 * The role is the DATABASE's (useAccount), never the operator's "agera som"
 * preference: an operator acting as an arbetare is still an admin and must be
 * able to reach /super to leave.
 *
 * Prefix match: "/pass" covers "/pass/ny". A route not listed here is open to
 * every signed-in role -- the startsida, Mina pass, Öppna pass, the day screen,
 * an ärende someone was named on, the own profile.
 */
const ADMIN: Role[] = ["admin"];
const STAFF: Role[] = ["admin", "arbetsledare"];

const RULES: [prefix: string, roles: Role[]][] = [
  // The admin's alone (spec Section 2).
  ["/arbetsdagbok", ADMIN],
  ["/granska", ADMIN],
  ["/snabb", ADMIN],
  ["/installningar", ADMIN],   // Alla Konton
  ["/arbetare/ny", ADMIN],
  ["/projekt/redigera", ADMIN],
  ["/stall-in", ADMIN],
  ["/super", ADMIN],           // and RLS narrows it to super admins
  // Admin and arbetsledare -- the company's schedule, not one worker's.
  ["/kalender", STAFF],
  ["/pass", STAFF],
  ["/projekt", STAFF],
  ["/bekrafta", STAFF],
  ["/historik", STAFF],
  ["/foretag", STAFF],         // a leader may look, and is told who changes it
  ["/dag/ny", STAFF],
  ["/dag/projekt", STAFF],
];

/** Who may open `path`, or null when every signed-in role may. */
export function allowedRoles(path: string): Role[] | null {
  const p = path.length > 1 ? path.replace(/\/+$/, "") : path;
  // Longest prefix first, so "/projekt/redigera" wins over "/projekt".
  const hit = RULES
    .filter(([prefix]) => p === prefix || p.startsWith(prefix + "/"))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return hit ? hit[1] : null;
}

export function RouteGuard({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? "/";
  const router = useRouter();
  const { account, loading } = useAccount();
  const roles = allowedRoles(path);
  const refused = roles !== null && !loading && !(account && roles.includes(account.role));

  useEffect(() => {
    if (refused) router.replace("/");
  }, [refused, router]);

  // Draw nothing on a guarded screen until the role is known, so an arbetare
  // never sees an admin form flash up before being sent home.
  if (roles !== null && (loading || refused)) return null;
  return <>{children}</>;
}
