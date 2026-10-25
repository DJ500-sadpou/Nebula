import { redirect } from 'next/navigation';
import { SetupNotice } from '@/components/SetupNotice';
import { currentSession } from '@/lib/db/auth';
import { missingPublicSupabaseEnv, readPublicSupabaseEnv } from '@/lib/db/env';
import { AuthPanel } from './AuthPanel';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (!readPublicSupabaseEnv()) {
    return <SetupNotice missing={missingPublicSupabaseEnv()} />;
  }

  const session = await currentSession();
  if (session) redirect('/');

  return (
    <section className="mx-auto max-w-md space-y-8">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.25em] text-gold-soft">Identidad</p>
        <h2 className="font-display text-3xl text-parchment">Entrar en el mundo</h2>
        <p className="text-sm text-parchment-dim">
          La sesión se guarda en cookies y se verifica en el servidor en cada petición. El perfil de
          dios se crea solo la primera vez.
        </p>
      </div>

      <AuthPanel />
    </section>
  );
}
