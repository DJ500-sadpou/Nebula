import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'El Mundo Perdido',
  description:
    'Juego web de texto, por turnos y multijugador: guía a tu pueblo desde la tribu hasta la modernidad.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-dvh bg-ink text-parchment antialiased">
        <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-5 py-8 sm:px-8">
          <header className="flex items-baseline justify-between gap-4 border-b border-gold/25 pb-4">
            <Link href="/" className="group">
              <p className="text-[0.7rem] uppercase tracking-[0.28em] text-gold-soft">
                La Civilización Nebula
              </p>
              <h1 className="font-display text-2xl text-parchment transition-colors group-hover:text-gold sm:text-3xl">
                El Mundo Perdido
              </h1>
            </Link>
            <nav className="flex gap-5 text-sm text-parchment-dim">
              <Link className="transition-colors hover:text-gold" href="/">
                Inicio
              </Link>
              <Link className="transition-colors hover:text-gold" href="/login">
                Entrar
              </Link>
            </nav>
          </header>

          <main className="flex-1 py-10">{children}</main>

          <footer className="border-t border-gold/20 pt-4 text-xs leading-relaxed text-parchment-dim">
            Fase 3 · rebanada de un jugador: «La peor carta», doce turnos. Sin claves de Supabase la
            aplicación arranca en modo de revisión, a propósito.
          </footer>
        </div>
      </body>
    </html>
  );
}
