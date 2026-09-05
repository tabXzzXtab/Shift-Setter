"use client";

import { useAccount } from "@/lib/account";
import { HomeAdmin } from "./home-admin";
import { HomeArbetsledare } from "./home-arbetsledare";
import { HomeArbetare } from "./home-arbetare";
import { Empty, Screen, SignOut } from "./ui";

/**
 * One landing page per role, showing only what that role actually does.
 *
 * This is convenience, not protection. A worker who forces their way to
 * /projekt/ny sees an empty form that the database refuses to accept.
 *
 * The role is read from the database on every load rather than from the token
 * (spec Section 6), which is why this renders "Laddar…" first: a role change
 * takes effect on the next load instead of persisting stale until the token
 * expires.
 */
export function Home() {
  const { account, loading } = useAccount();

  if (loading) return <Screen title="Laddar…"><span /></Screen>;

  // No account row, or a paused one: app.current_role() is NULL and every
  // guard in the database denies. There is nothing to draw but the way out.
  if (!account) {
    return (
      <Screen title="Shift Setter">
        <Empty>Ditt konto är inte aktivt. Kontakta administratören.</Empty>
        <SignOut />
      </Screen>
    );
  }

  if (account.role === "admin") return <HomeAdmin />;
  if (account.role === "arbetsledare") return <HomeArbetsledare />;
  return <HomeArbetare />;
}
