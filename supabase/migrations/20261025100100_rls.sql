-- Fase 1 · RLS y privacidad (PLAN.md §4.1, AGENTS.md invariante 4).
--
-- Regla de oro: el cliente solo puede insertar sus órdenes crudas y susurros;
-- cualquier otra escritura pasa por una ruta de API con service_role.
--
-- `seat_state` no tiene ninguna política: con RLS activa y sin políticas, tanto
-- `anon` como `authenticated` reciben 0 filas (no un error), que es exactamente
-- lo que comprueba el test de dos cuentas. `service_role` se salta RLS.

-- ------------------------------------------------------------------ --
-- Helpers de pertenencia (security definer, sin search_path heredado) --
-- ------------------------------------------------------------------ --

create function public.is_match_participant(p_match uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.seats s
    where s.match_id = p_match
      and s.user_id = auth.uid()
  );
$$;

create function public.my_seat(p_match uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select s.seat_idx
  from public.seats s
  where s.match_id = p_match
    and s.user_id = auth.uid()
  limit 1;
$$;

create function public.match_phase(p_match uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.phase from public.matches m where m.id = p_match;
$$;

create function public.match_turn(p_match uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select m.turn from public.matches m where m.id = p_match;
$$;

revoke all on function public.is_match_participant(uuid) from public;
revoke all on function public.my_seat(uuid) from public;
revoke all on function public.match_phase(uuid) from public;
revoke all on function public.match_turn(uuid) from public;

grant execute on function public.is_match_participant(uuid) to authenticated;
grant execute on function public.my_seat(uuid) to authenticated;
grant execute on function public.match_phase(uuid) to authenticated;
grant execute on function public.match_turn(uuid) to authenticated;

-- ------------------------------------------------------------------ --
-- Tablas                                                              --
-- ------------------------------------------------------------------ --

alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.seats enable row level security;
alter table public.seat_state enable row level security;
alter table public.seat_public enable row level security;
alter table public.orders enable row level security;
alter table public.turn_proposals enable row level security;
alter table public.turn_votes enable row level security;
alter table public.wars enable row level security;
alter table public.pacts enable row level security;
alter table public.missions enable row level security;
alter table public.milestones enable row level security;
alter table public.turn_resolutions enable row level security;
alter table public.turn_events enable row level security;
alter table public.chronicle enable row level security;
alter table public.whispers enable row level security;

-- Perfiles: lectura entre jugadores autenticados; cada uno edita el suyo.
create policy profiles_read on public.profiles
  for select to authenticated
  using (true);

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Partidas y asientos: el lobby se busca por API (service_role), no por REST.
create policy matches_read_participant on public.matches
  for select to authenticated
  using (public.is_match_participant(id));

create policy seats_read_participant on public.seats
  for select to authenticated
  using (public.is_match_participant(match_id));

create policy seat_public_read_participant on public.seat_public
  for select to authenticated
  using (public.is_match_participant(match_id));

-- Órdenes: solo el dueño del asiento, solo en fase de órdenes y turno actual.
-- No hay UPDATE ni DELETE: una orden enviada no se reescribe.
create policy orders_read_own on public.orders
  for select to authenticated
  using (seat_idx = public.my_seat(match_id));

create policy orders_insert_own on public.orders
  for insert to authenticated
  with check (
    seat_idx = public.my_seat(match_id)
    and public.match_phase(match_id) = 'orders'
    and turn = public.match_turn(match_id)
  );

-- Votación: lectura de participantes; el voto propio siempre, los demás
-- solo después de cerrar la papeleta (§5-A.2.7). Escritura, por API.
create policy turn_proposals_read_participant on public.turn_proposals
  for select to authenticated
  using (public.is_match_participant(match_id));

create policy turn_votes_read_after_close on public.turn_votes
  for select to authenticated
  using (
    public.is_match_participant(match_id)
    and (
      seat_idx = public.my_seat(match_id)
      or exists (
        select 1
        from public.turn_proposals p
        where p.id = proposal_id
          and p.status <> 'open'
      )
    )
  );

create policy wars_read_participant on public.wars
  for select to authenticated
  using (public.is_match_participant(match_id));

create policy pacts_read_participant on public.pacts
  for select to authenticated
  using (public.is_match_participant(match_id));

create policy missions_read_participant on public.missions
  for select to authenticated
  using (public.is_match_participant(match_id));

create policy milestones_read_participant on public.milestones
  for select to authenticated
  using (public.is_match_participant(match_id));

create policy turn_resolutions_read_participant on public.turn_resolutions
  for select to authenticated
  using (public.is_match_participant(match_id));

-- Eventos: públicos para la mesa; 'seat' solo para su asiento; 'pair' para los dos.
create policy turn_events_read_visible on public.turn_events
  for select to authenticated
  using (
    public.is_match_participant(match_id)
    and (
      visibility = 'public'
      or (visibility = 'seat' and seat_idx = public.my_seat(match_id))
      or (
        visibility = 'pair'
        and (
          seat_idx = public.my_seat(match_id)
          or pair_seat = public.my_seat(match_id)
        )
      )
    )
  );

-- Crónica: la tabla incluye `private` y no tiene políticas => nadie la lee
-- directamente. Lo público se sirve con esta vista, que filtra por pertenencia.
create view public.chronicle_public
with (security_invoker = false) as
select match_id, turn, public_text
from public.chronicle
where public.is_match_participant(match_id);

revoke all on public.chronicle_public from anon;
grant select on public.chronicle_public to authenticated;

-- Susurros: cada jugador ve los que envía y los que recibe. Escritura, por API.
create policy whispers_read_involved on public.whispers
  for select to authenticated
  using (
    public.is_match_participant(match_id)
    and (
      from_seat = public.my_seat(match_id)
      or to_seat = public.my_seat(match_id)
    )
  );

-- ------------------------------------------------------------------ --
-- Nota deliberada: no hay políticas de INSERT/UPDATE/DELETE en el resto --
-- ------------------------------------------------------------------ --
-- seat_state no aparece a propósito: RLS activa y cero políticas hacen que
-- cualquier lectura devuelva 0 filas y cualquier escritura sea imposible.
