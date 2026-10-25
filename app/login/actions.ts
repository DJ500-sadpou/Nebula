'use server';

import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/db/server';

export interface AuthState {
  error: string | null;
}

/** Mensajes de Supabase que conviene traducir; el resto se muestran tal cual. */
const MESSAGES: Record<string, string> = {
  'Invalid login credentials': 'Correo o contraseña incorrectos.',
  'Email not confirmed':
    'El correo todavía no está confirmado. Desactiva la confirmación en Supabase (Authentication → Sign In / Providers) o confirma el enlace.',
  'Anonymous sign-ins are disabled':
    'El acceso como invitado está desactivado en este proyecto de Supabase. Actívalo en Authentication → Sign In / Providers.',
  'User already registered': 'Ese correo ya tiene una cuenta. Prueba a entrar.',
  'Unable to validate email address: invalid format': 'El correo no tiene un formato válido.',
  'Signups not allowed for this instance':
    'El registro está desactivado en este proyecto de Supabase.',
};

function translate(message: string): string {
  return MESSAGES[message] ?? message;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = field(formData, 'email').toLowerCase();
  const password = field(formData, 'password');

  if (!email || !password) return { error: 'Escribe tu correo y tu contraseña.' };

  const supabase = await createServerSupabase();
  if (!supabase) return { error: 'Supabase no está configurado en este servidor.' };

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: translate(error.message) };

  redirect('/');
}

export async function register(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const nick = field(formData, 'nick');
  const email = field(formData, 'email').toLowerCase();
  const password = field(formData, 'password');

  if (nick.length < 2 || nick.length > 24) {
    return { error: 'El nombre debe tener entre 2 y 24 caracteres.' };
  }
  if (!email) return { error: 'Escribe un correo.' };
  if (password.length < 8) {
    return { error: 'La contraseña debe tener al menos 8 caracteres.' };
  }

  const supabase = await createServerSupabase();
  if (!supabase) return { error: 'Supabase no está configurado en este servidor.' };

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { nick } },
  });
  if (error) return { error: translate(error.message) };

  if (!data.session) {
    return {
      error:
        'Cuenta creada, pero falta confirmar el correo. Desactiva la confirmación en Supabase para entrar directamente.',
    };
  }

  redirect('/');
}

export async function anonymousLogin(_prev: AuthState, _formData: FormData): Promise<AuthState> {
  const supabase = await createServerSupabase();
  if (!supabase) return { error: 'Supabase no está configurado en este servidor.' };

  const { error } = await supabase.auth.signInAnonymously();
  if (error) return { error: translate(error.message) };

  redirect('/');
}
