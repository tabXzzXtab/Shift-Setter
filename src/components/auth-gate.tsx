"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/supabase/auth";

/**
 * Sends signed-out visitors to /login.
 *
 * This is a convenience, not a protection. Anyone can open devtools and render
 * whatever is behind it. What stops them seeing data is Row Level Security in
 * the database -- the browser holds the token and talks to PostgREST directly,
 * so the database is the only real boundary. Never put a check here and treat
 * the data as protected.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-neutral-500">Laddar…</p>
      </div>
    );
  }

  if (!session) return null;

  return <>{children}</>;
}
