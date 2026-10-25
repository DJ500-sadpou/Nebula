'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Crea la mesa de «La peor carta» y entra en ella (§19). */
export function CreateMatch({ label = 'Empezar «La peor carta»' }: { label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/match', { method: 'POST' });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setError(
          payload.error === 'unconfigured'
            ? 'Falta la configuración del servidor (URL y service_role).'
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
        {busy ? 'Repartiendo cartas…' : label}
      </button>
      {error && <p className="text-sm text-blood">{error}</p>}
    </div>
  );
}
