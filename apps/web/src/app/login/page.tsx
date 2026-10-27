"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BootSplash } from "@/features/auth/BootSplash";
import { LoginScreen } from "@/features/auth/LoginScreen";
import { api, markSession } from "@/lib/api";
import { ensureSession } from "@/lib/session";

export default function LoginPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const alive = await ensureSession();
      if (cancelled) return;
      if (!alive) {
        setReady(true);
        return;
      }
      try {
        await api().me();
        if (cancelled) return;
        markSession(true);
        router.replace("/dashboard");
      } catch {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!ready) return <BootSplash />;
  return <LoginScreen onAuthed={() => router.push("/dashboard")} />;
}
