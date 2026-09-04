"use client";

import { useAccount } from "@/lib/account";
import { HomeAdmin } from "./home-admin";
import { HomeArbetsledare } from "./home-arbetsledare";
import { BigLink, Empty, Screen, SignOut } from "./ui";

/**
 * One screen per role, showing only what that role can actually do.
 *
 * This is convenience, not protection. A worker who forces their way to
 * /projekt/ny sees an empty form that the database refuses to accept.
 */
export function Home() {
  const { account, loading } = useAccount();

  if (loading) return <Screen title="Laddar…"><span /></Screen>;

  if (!account) {
    return (
      <Screen title="Shift Setter">
        <Empty>Ditt konto är inte aktivt. Kontakta administratören.</Empty>
        <SignOut />
      </Screen>
    );
  }

  // Redesigned per spec Section 7, one role at a time. The roles still on the
  // old list are the ones whose landing page has not been rebuilt yet.
  if (account.role === "admin") return <HomeAdmin />;
  if (account.role === "arbetsledare") return <HomeArbetsledare />;

  const heading = "Arbetare";

  return (
    <Screen title={heading}>
      <div className="flex flex-col gap-3">
        {account.worker_id && (
          <>
            <BigLink href="/mina-pass">Mina pass</BigLink>
            <BigLink href="/min-kalender">Min kalender</BigLink>
            <BigLink href="/acceptera">Acceptera pass</BigLink>
          </>
        )}
      </div>

      <p className="mt-6 text-sm text-neutral-600">
        Inloggad som {account.name ?? account.id.slice(0, 8)}
      </p>
      <SignOut />
    </Screen>
  );
}
