import Link from 'next/link';
import { LobbyScreen } from '@/components/LobbyScreen';
import type { MultiLobbyView } from '@/lib/db/multiplayer';

/**
 * Vista de revisión de la sala de espera (Fase 4) con datos de ejemplo, al
 * estilo de D54: sin base de datos ni sesión, nada se envía. Sirve para revisar
 * la interfaz del lobby mientras Supabase no está configurado.
 */

const VIEW: MultiLobbyView = {
  code: 'REV123',
  phase: 'lobby',
  seatCount: 8,
  hostSeat: 0,
  mySeat: 0,
  allReady: false,
  turnSeconds: 120,
  seats: [
    { seatIdx: 0, kind: 'human', name: 'Anfitriona', ready: true, submitted: false, mine: true, awakened: false },
    { seatIdx: 1, kind: 'human', name: 'Bruma', ready: true, submitted: false, mine: false, awakened: false },
    { seatIdx: 2, kind: 'human', name: 'Cauce', ready: false, submitted: false, mine: false, awakened: false },
    { seatIdx: 3, kind: 'empty', name: '—', ready: false, submitted: false, mine: false, awakened: false },
    { seatIdx: 4, kind: 'empty', name: '—', ready: false, submitted: false, mine: false, awakened: false },
    { seatIdx: 5, kind: 'empty', name: '—', ready: false, submitted: false, mine: false, awakened: false },
    { seatIdx: 6, kind: 'empty', name: '—', ready: false, submitted: false, mine: false, awakened: false },
    { seatIdx: 7, kind: 'empty', name: '—', ready: false, submitted: false, mine: false, awakened: false },
  ],
};

export default function LobbyPreviewPage() {
  return (
    <div className="space-y-6">
      <section className="rounded border border-gold/40 bg-ink-soft px-4 py-3 text-sm">
        <p className="text-xs uppercase tracking-[0.22em] text-gold-soft">Vista de revisión</p>
        <p className="mt-1 text-parchment-dim">
          Sala de ejemplo sin base de datos ni sesión. La sala real se crea desde el panteón con
          Supabase configurado, y quien entre con el código se sienta en el primer asiento libre.
        </p>
        <Link className="mt-2 inline-block text-gold underline-offset-4 hover:underline" href="/">
          Volver
        </Link>
      </section>

      <LobbyScreen view={VIEW} review />
    </div>
  );
}
