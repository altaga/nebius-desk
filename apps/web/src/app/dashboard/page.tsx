"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { logoutAction } from "@/app/actions/auth";
import { BootSplash } from "@/features/auth/BootSplash";
import { DeskShell } from "@/features/desk/DeskShell";
import { api, markSession } from "@/lib/api";
import { ensureSession, isUnauthorized } from "@/lib/session";
import { clearPlace } from "@/features/desk/place";

export default function DashboardPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const alive = await ensureSession();
      if (cancelled) return;
      if (!alive) {
        markSession(false);
        router.replace("/login");
        return;
      }
      try {
        await api().me();
        if (cancelled) return;
        markSession(true);
        setReady(true);
      } catch (err) {
        if (cancelled) return;
        if (isUnauthorized(err)) {
          markSession(false);
          router.replace("/login");
          return;
        }
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const onLogout = useCallback(() => {
    void logoutAction().then(() => {
      markSession(false);
      clearPlace();
      router.replace("/login");
    });
  }, [router]);

  if (!ready) return <BootSplash />;
  return <DeskShell onLogout={onLogout} />;
}
