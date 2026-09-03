"use client";

import { useAccount } from "@/lib/account";
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

  const heading =
    account.role === "admin" ? "Admin" : account.role === "arbetsledare" ? "Arbetsledare" : "Arbetare";

  return (
    <Screen title={heading}>
      <div className="flex flex-col gap-3">
        {account.role === "admin" && (
          <>
            <BigLink href="/projekt/ny">Nytt projekt</BigLink>
            <BigLink href="/arbetare/ny">Ny arbetare</BigLink>
            <BigLink href="/projekt">Alla projekt</BigLink>
            <BigLink href="/snabb">Snabb Pass</BigLink>
            <BigLink href="/arbetsdagbok">Arbetsdagbok</BigLink>
            <BigLink href="/dag">Öppna dag</BigLink>
          </>
        )}

        {account.role === "arbetsledare" && (
          <>
            <BigLink href="/pass/ny">Skapa pass</BigLink>
            <BigLink href="/snabb">Snabb Pass</BigLink>
            <BigLink href="/dag">Öppna dag</BigLink>
            <BigLink href="/bekrafta">Bekräfta pass</BigLink>
          </>
        )}

        {/* An arbetsledare is also a worker and holds shifts (Section 2), so
            these appear for them too. */}
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
