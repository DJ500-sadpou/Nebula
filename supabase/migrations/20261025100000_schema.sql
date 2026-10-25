-- Fase 1 · Esquema base de "El Mundo Perdido" (PLAN.md §4).
--
-- Decisiones de implementación (DECISIONES.md D39):
--   · Los asientos se identifican por (match_id, seat_idx) en lugar de un uuid
--     propio: el modelo ya usa enteros para winner_seat, vassal_of y
--     at_war_with, así que un único tipo de clave evita joins y comprobaciones
--     duplicadas en RLS.
--   · `turn_events` añade `pair_seat` para que la visibilidad 'pair' (§4.1)
--     sea comprobable sin abrir el payload.
--   · `chronicle` guarda la parte privada en la misma fila; nunca se expone la
--     tabla, solo la vista `chronicle_public` (migración de RLS).

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nick text not null check (char_length(nick) between 2 and 24),
  created_at timestamptz not null default now()
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  status text not null default 'lobby'
    check (status in ('lobby', 'orders', 'resolving', 'finished', 'closed')),
  seed bigint not null,
  turn int not null default 1 check (turn >= 1),
  phase text not null default 'lobby'
    check (phase in ('lobby', 'orders', 'resolution', 'finished', 'closed')),
  resolving boolean not null default false,
  turn_ends_at timestamptz,
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  winner_seat int,
  created_at timestamptz not null default now(),
  closed_at timestamptz,

  -- Escala temporal (§5-A)
  window_id text not null default '1d'
    check (window_id in ('1d', '7d', '30d', '3m', '6m', '1y', '3y')),
  windows_unlocked text[] not null default '{1d}',
  unlock_every int not null default 5 check (unlock_every between 1 and 10),
  fiction_day int not null default 0 check (fiction_day >= 0),
  horizon_years int not null default 30 check (horizon_years > 0),

  -- Barra de época (§5-B)
  era text not null default 'tribal' check (era in ('tribal', 'reinos', 'modernidad')),
  era_progress numeric not null default 0 check (era_progress between 0 and 1),
  era_advanced_turn int,
  window_override jsonb
);

create table public.seats (
  match_id uuid not null references public.matches (id) on delete cascade,
  seat_idx int not null check (seat_idx between 0 and 31),
  kind text not null default 'empty'
    check (kind in ('human', 'bot', 'dormant', 'empty')),
  user_id uuid references public.profiles (id) on delete set null,
  name text not null,
  area_card text,
  domain_card text,
  species text,
  awakened boolean not null default false,
  primary key (match_id, seat_idx)
);

-- Un humano no puede ocupar dos asientos de la misma partida.
create unique index seats_one_human_per_match
  on public.seats (match_id, user_id)
  where user_id is not null;

create table public.seat_state (
  match_id uuid not null,
  seat_idx int not null,
  fe int not null default 0 check (fe >= 0),
  xp int not null default 0 check (xp >= 0),
  divinity int not null default 0 check (divinity between 0 and 20),
  fidelity numeric not null default 0.5 check (fidelity between 0 and 1),
  fame int not null default 0 check (fame >= 0),
  magic int not null default 0 check (magic >= 0),
  essence int not null default 0 check (essence >= 0),
  relics int not null default 0 check (relics >= 0),
  believers int not null default 0 check (believers >= 0),
  techs text[] not null default '{}',
  culture text[] not null default '{}',
  debuff_primitive boolean not null default false,
  research_pct int not null default 100 check (research_pct between 0 and 100),
  buffs jsonb not null default '[]'::jsonb
    check (jsonb_typeof(buffs) = 'array' and jsonb_array_length(buffs) <= 2),
  primary key (match_id, seat_idx),
  foreign key (match_id, seat_idx) references public.seats (match_id, seat_idx) on delete cascade
);

create table public.seat_public (
  match_id uuid not null,
  seat_idx int not null,
  regions int not null default 0 check (regions >= 0),
  divinity_band text not null default 'oculto',
  temples int not null default 0 check (temples >= 0),
  vassal_of int,
  at_war_with int[] not null default '{}',
  primary key (match_id, seat_idx),
  foreign key (match_id, seat_idx) references public.seats (match_id, seat_idx) on delete cascade
);

-- Órdenes secretas: planificación por compases (§5-A.3). Inmutables una vez enviadas.
create table public.orders (
  match_id uuid not null,
  seat_idx int not null,
  turn int not null check (turn >= 1),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  submitted_at timestamptz not null default now(),
  primary key (match_id, seat_idx, turn),
  foreign key (match_id, seat_idx) references public.seats (match_id, seat_idx) on delete cascade
);

create table public.turn_proposals (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  turn int not null,
  proposer_seat int not null,
  window_id text not null check (window_id in ('1d', '7d', '30d', '3m', '6m', '1y', '3y')),
  status text not null default 'open'
    check (status in ('open', 'passed', 'rejected', 'tie', 'quorum_failed')),
  opens_at timestamptz not null default now(),
  closes_at timestamptz
);

create table public.turn_votes (
  match_id uuid not null references public.matches (id) on delete cascade,
  proposal_id uuid not null references public.turn_proposals (id) on delete cascade,
  seat_idx int not null,
  choice text not null,
  primary key (proposal_id, seat_idx)
);

create table public.wars (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  attacker_seat int not null,
  defender_seat int not null,
  era text not null check (era in ('tribal', 'reinos', 'modernidad')),
  started_turn int not null,
  ended_turn int,
  result text
);

create table public.pacts (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  seat_a int not null,
  seat_b int not null,
  kind text not null check (kind in ('cultural', 'rezagados', 'defensivo')),
  started_turn int not null,
  ended_turn int
);

create table public.missions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  seat_idx int not null,
  kind text not null,
  target_era text check (target_era in ('tribal', 'reinos', 'modernidad')),
  deadline_turn int not null,
  status text not null default 'open' check (status in ('open', 'done', 'expired'))
);

create table public.milestones (
  match_id uuid not null references public.matches (id) on delete cascade,
  key text not null,
  claimed_by_seat int not null,
  claimed_turn int not null,
  primary key (match_id, key)
);

create table public.turn_resolutions (
  match_id uuid not null references public.matches (id) on delete cascade,
  turn int not null,
  digest text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (match_id, turn)
);

create table public.turn_events (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches (id) on delete cascade,
  turn int not null,
  visibility text not null check (visibility in ('public', 'seat', 'pair')),
  seat_idx int,
  pair_seat int,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  text text not null,
  check (
    (visibility = 'public' and seat_idx is null and pair_seat is null)
    or (visibility = 'seat' and seat_idx is not null)
    or (visibility = 'pair' and seat_idx is not null and pair_seat is not null)
  )
);

create table public.chronicle (
  match_id uuid not null references public.matches (id) on delete cascade,
  turn int not null,
  public_text text not null,
  private jsonb not null default '{}'::jsonb check (jsonb_typeof(private) = 'object'),
  primary key (match_id, turn)
);

create table public.whispers (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  turn int not null,
  from_seat int not null,
  to_seat int not null,
  body text not null check (char_length(body) between 1 and 280),
  created_at timestamptz not null default now(),
  check (from_seat <> to_seat)
);

create index orders_match_turn_idx on public.orders (match_id, turn);
create index turn_events_match_turn_idx on public.turn_events (match_id, turn);
create index turn_events_match_seat_idx on public.turn_events (match_id, seat_idx);
create index whispers_recipient_idx on public.whispers (match_id, to_seat);
create index missions_open_idx on public.missions (match_id, seat_idx) where status = 'open';
create index seats_user_idx on public.seats (user_id) where user_id is not null;

-- Perfil automático para cada usuario de auth (email o anónimo).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_nick text;
  clean_nick text;
begin
  raw_nick := coalesce(new.raw_user_meta_data ->> 'nick', '');
  clean_nick := left(btrim(regexp_replace(raw_nick, '\s+', ' ', 'g')), 24);

  insert into public.profiles (id, nick)
  values (
    new.id,
    case
      when char_length(clean_nick) >= 2 then clean_nick
      else 'Invitado'
    end
  );
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
