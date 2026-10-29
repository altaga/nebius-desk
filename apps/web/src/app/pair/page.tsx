"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BootSplash } from "@/features/auth/BootSplash";
import { PairingWizard } from "@/features/pairing/PairingWizard";
import { api, markSession } from "@/lib/api";
import { ensureSession, isUnauthorized } from "@/lib/session";

export default function PairPage() {
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

  const onDone = useCallback(() => {
    router.push("/dashboard");
  }, [router]);

  if (!ready) return <BootSplash />;
  return <PairingWizard onDone={onDone} />;
}
