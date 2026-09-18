"use client";

import { useEffect } from "react";
import { useAccount } from "@/lib/account";
import { registerToken } from "@/lib/push";
import { HomeAdmin } from "./home-admin";
import { HomeArbetsledare } from "./home-arbetsledare";
import { HomeArbetare } from "./home-arbetare";
import { EmptyState, SignOut, SoftScreen } from "./soft";

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

  /**
   * FILE THE HANDSET AGAINST WHOEVER IS SIGNED IN, for all three roles.
   *
   * Here rather than in the login form, because logging in is not the only way
   * to arrive signed in: a restored session goes straight to this screen and
   * never touches /login, and a handset registered only on the password form
   * would stop being addressable the day somebody simply reopened the app.
   * This runs whenever an account becomes known, which is the condition that
   * actually matters.
   *
   * KEYED ON THE ACCOUNT ID so it re-runs when a different person signs in on
   * the same handset. That is the whole point of the table's design -- the row
   * moves to the last signer -- and it only moves if somebody asks it to.
   *
   * It prompts nobody. registerToken() files a token only where permission
   * already stands, so the two roles that are never asked simply do nothing,
   * and so does every browser.
   */
  const accountId = account?.id ?? null;
  useEffect(() => {
    if (!accountId) return;
    void registerToken();
  }, [accountId]);

  if (loading) return <SoftScreen title="Laddar…"><span /></SoftScreen>;

  // No account row, or a paused one: app.current_role() is NULL and every
  // guard in the database denies. There is nothing to draw but the way out.
  if (!account) {
    return (
      <SoftScreen title="Shift Setter">
        <div className="px-4 pt-[2px]">
          <EmptyState headline="Kontot är inte aktivt">
            Kontakta administratören.
          </EmptyState>
          <SignOut />
        </div>
      </SoftScreen>
    );
  }

  if (account.role === "admin") return <HomeAdmin />;
  if (account.role === "arbetsledare") return <HomeArbetsledare />;
  return <HomeArbetare />;
}
