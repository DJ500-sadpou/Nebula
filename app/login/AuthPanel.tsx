'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { anonymousLogin, login, register, type AuthState } from './actions';

const INITIAL: AuthState = { error: null };

const INPUT_CLASS =
  'w-full rounded border border-gold/25 bg-ink px-3 py-2 text-parchment placeholder:text-parchment-dim/60 focus:border-gold focus:outline-none';

function SubmitButton({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full cursor-pointer rounded border border-gold bg-gold px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-parchment disabled:cursor-progress disabled:opacity-60"
    >
      {pending ? 'Un momento…' : children}
    </button>
  );
}

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded border border-blood/40 bg-ink px-4 py-3 text-sm text-blood">
      {message}
    </p>
  );
}

export function AuthPanel() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loginState, loginAction] = useActionState(login, INITIAL);
  const [registerState, registerAction] = useActionState(register, INITIAL);
  const [anonymousState, anonymousAction] = useActionState(anonymousLogin, INITIAL);

  return (
    <div className="space-y-7">
      <div role="tablist" aria-label="Forma de entrar" className="flex gap-1 border-b border-gold/20">
        {(
          [
            ['login', 'Entrar'],
            ['register', 'Crear cuenta'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => setMode(value)}
            className={`-mb-px cursor-pointer border-b-2 px-4 py-2 text-sm transition-colors ${
              mode === value
                ? 'border-gold text-gold'
                : 'border-transparent text-parchment-dim hover:text-parchment'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'login' ? (
        <form action={loginAction} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="login-email" className="text-xs uppercase tracking-widest text-gold-soft">
              Correo
            </label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className={INPUT_CLASS}
              placeholder="tu@correo.com"
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="login-password"
              className="text-xs uppercase tracking-widest text-gold-soft"
            >
              Contraseña
            </label>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className={INPUT_CLASS}
            />
          </div>
          <ErrorNote message={loginState.error} />
          <SubmitButton>Entrar</SubmitButton>
        </form>
      ) : (
        <form action={registerAction} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="register-nick"
              className="text-xs uppercase tracking-widest text-gold-soft"
            >
              Nombre de dios
            </label>
            <input
              id="register-nick"
              name="nick"
              type="text"
              autoComplete="nickname"
              required
              minLength={2}
              maxLength={24}
              className={INPUT_CLASS}
              placeholder="Entre 2 y 24 caracteres"
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="register-email"
              className="text-xs uppercase tracking-widest text-gold-soft"
            >
              Correo
            </label>
            <input
              id="register-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className={INPUT_CLASS}
              placeholder="tu@correo.com"
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="register-password"
              className="text-xs uppercase tracking-widest text-gold-soft"
            >
              Contraseña
            </label>
            <input
              id="register-password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className={INPUT_CLASS}
              placeholder="Al menos 8 caracteres"
            />
          </div>
          <ErrorNote message={registerState.error} />
          <SubmitButton>Crear cuenta</SubmitButton>
        </form>
      )}

      <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-parchment-dim">
        <span className="h-px flex-1 bg-gold/20" />
        o
        <span className="h-px flex-1 bg-gold/20" />
      </div>

      <form action={anonymousAction} className="space-y-3">
        <SubmitButton>Entrar como invitado</SubmitButton>
        <p className="text-xs leading-relaxed text-parchment-dim">
          Una sesión anónima no pide correo. En Supabase tiene que estar activada en
          Authentication → Sign In / Providers. Si cierras sesión, ese perfil se pierde.
        </p>
        <ErrorNote message={anonymousState.error} />
      </form>
    </div>
  );
}
