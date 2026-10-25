import Link from 'next/link';
import { URL_ENV } from '@/lib/db/env';

interface SetupNoticeProps {
  missing: string[];
}

/**
 * Pantalla de "modo sin configurar". La aplicación no debe romperse cuando no
 * hay proyecto de Supabase: en la nube no lo hay, y la Fase 1 se revisa así.
 * No muestra ni pide claves: solo los nombres de las variables que faltan.
 */
export function SetupNotice({ missing }: SetupNoticeProps) {
  return (
    <section className="space-y-8">
      <div className="space-y-4">
        <p className="text-xs uppercase tracking-[0.25em] text-gold-soft">Estado del servidor</p>
        <h2 className="font-display text-3xl leading-tight text-parchment sm:text-4xl">
          El mundo aún no tiene oráculo
        </h2>
        <p className="max-w-prose text-parchment-dim">
          La interfaz arranca sin conexión a Supabase para poder revisarla. El motor, el esquema y
          la seguridad ya están escritos; lo que falta son las claves del proyecto, que se
          configuran en tu equipo y nunca se suben al repositorio.
        </p>
      </div>

      <div className="rounded-lg border border-gold/25 bg-ink-soft p-6">
        <h3 className="font-display text-lg text-gold">Faltan estas variables</h3>
        <ul className="mt-3 space-y-2 text-sm">
          {missing.map((name) => (
            <li key={name} className="flex items-start gap-3">
              <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-blood" />
              <code className="break-all text-parchment">{name}</code>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-parchment-dim">
          Cópialas en <code className="text-parchment">.env.local</code> a partir de{' '}
          <code className="text-parchment">.env.example</code>. La URL pública se lee de{' '}
          <code className="text-parchment">{URL_ENV}</code>.
        </p>
      </div>

      <ol className="space-y-4 text-sm text-parchment-dim">
        <li className="flex gap-4">
          <span className="font-display text-lg text-gold-soft">1</span>
          <p>
            Crea el proyecto en Supabase (plan Free, sin método de pago) y copia la URL y la clave
            pública desde <span className="text-parchment">Project Settings → API</span>.
          </p>
        </li>
        <li className="flex gap-4">
          <span className="font-display text-lg text-gold-soft">2</span>
          <p>
            Aplica las migraciones de <code className="text-parchment">supabase/migrations/</code>{' '}
            con <code className="text-parchment">npx supabase link</code> y{' '}
            <code className="text-parchment">npx supabase db push</code>.
          </p>
        </li>
        <li className="flex gap-4">
          <span className="font-display text-lg text-gold-soft">3</span>
          <p>
            Activa el inicio de sesión anónimo y desactiva la confirmación de correo en{' '}
            <span className="text-parchment">Authentication → Sign In / Providers</span>.
          </p>
        </li>
        <li className="flex gap-4">
          <span className="font-display text-lg text-gold-soft">4</span>
          <p>
            Reinicia <code className="text-parchment">npm run dev</code> y entra en{' '}
            <span className="text-parchment">/login</span>. El checklist completo, con lo que solo
            puede hacerse en tu equipo, está en{' '}
            <code className="text-parchment">PENDIENTES.md</code>.
          </p>
        </li>
      </ol>

      <p className="text-sm text-parchment-dim">
        Mientras tanto puedes revisar la{' '}
        <Link className="text-gold underline-offset-4 hover:underline" href="/preview/turno">
          pantalla de turno con datos de ejemplo
        </Link>
        : el motor genera la partida y no se escribe nada.
      </p>
    </section>
  );
}
