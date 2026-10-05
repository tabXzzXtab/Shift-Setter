"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import { C, ChevronRight, SHADOW, SoftScreen } from "@/components/soft";
import { stockholmToday } from "@/lib/dates";
import { useAccount } from "@/lib/account";

/**
 * The day's +: what to add. A full screen with one question and two answers,
 * nothing else on it.
 *
 * The admin chooses Pass or Ärende. An arbetsledare only reaches this screen
 * on a day that has passed -- ahead of today their + goes straight to the pass
 * form -- and sees Pass alone. On a past day Pass is shown DISABLED WITH THE
 * REASON rather than hidden: a button that is missing only makes people look
 * for it. The database refuses a pass on a past date either way.
 */
function Choice({ date, from }: { date: string; from: string }) {
  const { account } = useAccount();
  const past = date < stockholmToday();
  const isAdmin = account?.role === "admin";
  const back = encodeURIComponent(from);

  const row = (
    label: string, line: string, href: string | null, reason?: string,
  ) => {
    const body = (
      <>
        <span className="min-w-0">
          <span className="block text-[19px] font-extrabold" style={{ letterSpacing: "-.4px" }}>{label}</span>
          <span className="block text-[15px] font-medium" style={{ color: C.text2 }}>{reason ?? line}</span>
        </span>
        {href && <ChevronRight />}
      </>
    );
    const cls = "flex min-h-[84px] items-center justify-between gap-3 rounded-[16px] px-5 py-4";
    return href ? (
      <Link href={href} className={`${cls} hover:bg-[#f4f3f0]`}
            style={{ background: C.surface, boxShadow: SHADOW.group, color: C.ink }}>
        {body}
      </Link>
    ) : (
      <div aria-disabled="true" className={cls}
           style={{ background: C.hairline, color: C.chevron, cursor: "not-allowed" }}>
        {body}
      </div>
    );
  };

  return (
    <SoftScreen title="Lägg till" back={from}>
      <div className="flex flex-col gap-[14px] px-4 pt-[2px]">
        {row(
          "Pass",
          "Folk som behövs på plats den dagen.",
          past ? null : `/pass/ny?datum=${date}&fran=dag`,
          past ? "Kan inte skapa pass på ett passerat datum." : undefined,
        )}
        {isAdmin && row(
          "Ärende",
          "Ett möte, ett besök eller ledighet.",
          `/dag/arende?datum=${date}&fran=${back}`,
        )}
      </div>
    </SoftScreen>
  );
}

function FromUrl() {
  const params = useSearchParams();
  const d = params.get("datum");
  const fran = params.get("fran");
  const date = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : stockholmToday();
  const from = fran && fran.startsWith("/") && !fran.startsWith("//") ? fran : `/dag?datum=${date}`;
  return <Choice date={date} from={from} />;
}

export default function Page() {
  return (
    <AuthGate>
      <Suspense fallback={<SoftScreen title="Lägg till" back="/"><span /></SoftScreen>}>
        <FromUrl />
      </Suspense>
    </AuthGate>
  );
}
