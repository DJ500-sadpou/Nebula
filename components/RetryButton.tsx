'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Botón de reintento manual para la página de estado honesta (§21.3). El
 * automático lo lleva `AutoRefresh`; esto es el "hazlo ya" del jugador.
 */
export function RetryButton({ label = 'Reintentar ahora' }: { label?: string }) {
  const router = useRouter();
  const [pressed, setPressed] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        setPressed(true);
        router.refresh();
      }}
      disabled={pressed}
      className="cursor-pointer rounded border border-gold/30 px-4 py-2 text-sm text-parchment-dim transition-colors hover:border-gold hover:text-gold disabled:cursor-wait disabled:opacity-60"
    >
      {pressed ? 'Despertando…' : label}
    </button>
  );
}
