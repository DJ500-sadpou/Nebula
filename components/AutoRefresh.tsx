'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Refresco lento de respaldo (≥ 30 s). El ritmo fino de la mesa lo lleva
 * Supabase Realtime; esto existe para cuando Realtime no llegue y se respeta
 * el presupuesto de requests del hosting (D55: nada de latidos por segundo).
 */
export function AutoRefresh({ seconds = 30, enabled = true }: { seconds?: number; enabled?: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => router.refresh(), Math.max(15, seconds) * 1000);
    return () => window.clearInterval(timer);
  }, [enabled, router, seconds]);

  return null;
}
