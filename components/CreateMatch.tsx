'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Crea una mesa de «La peor carta» (§19) o una sala multijugador (Fase 4) y
 * entra en ella. La sala devuelve un código de 6 caracteres para invitar.
 */
export function CreateMatch({
  label = 'Empezar «La peor carta»',
  multi = false,
}: {
  label?: string;
  multi?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/match', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(multi ? { mode: 'multi', config: {} } : {}),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          waking?: boolean;
        };
        setError(
          payload.error === 'unconfigured'
            ? 'Falta la configuración del servidor (URL y service_role).'
            : payload.error === 'limit'
              ? 'Ya guías tres mundos a la vez (§21.1): termina o cierra uno antes de abrir otro.'
              : payload.waking
                ? 'El servidor está despertando: pruébalo de nuevo en unos segundos.'
                : `No se pudo crear la mesa (${payload.error ?? response.status}).`,
        );
        return;
      }
      const payload = (await response.json()) as { code: string };
      router.push(`/match/${payload.code}`);
    } catch {
      setError('No se pudo contactar con el servidor.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={create}
        disabled={busy}
        className="cursor-pointer rounded border border-gold bg-gold px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-parchment disabled:cursor-wait disabled:opacity-60"
      >
        {busy
          ? multi
            ? 'Encendiendo la sala…'
            : 'Repartiendo cartas…'
          : label}
      </button>
      {error && <p className="text-sm text-blood">{error}</p>}
    </div>
  );
}
