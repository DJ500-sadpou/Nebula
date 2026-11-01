-- Fase 7A · Límites del servicio gratuito y retención (PLAN.md §4.2, §6; REGLAS.md §21).
--
-- Qué añade:
--   · `matches.summary` y `matches.pruned_at`: lo que queda de una partida
--     archivada por la regla de retención (REGLAS.md §21.2) — modo, asientos,
--     ganador, turno final y fechas. La mesa y sus `seats` no se tocan, así
--     que el panteón sigue listándola como «Archivada».
--   · `active_seat_count`: cuántas mesas activas (vestíbulo/órdenes/resolución)
--     mantiene un jugador con asiento humano. El guard de §21.1 (máximo 3)
--     vive en SQL, no solo en la API: por REST directo tampoco entra
--     (mismo patrón que D58).
--   · `create_solo_match`, `create_lobby` y `join_lobby` se sustituyen para
--     comprobar ese límite (excepción `too_many_active` en las creaciones,
--     -4 al sentarse en sala ajena) y para disparar la retención: cada mesa
--     nueva barre las terminadas de más de 30 días. Sin planificador dentro
--     del Worker (D57), la única infraestructura que hace falta es que alguien
--     juegue.
--   · `apply_turn` se sustituye (tercera vez, mismo patrón que la Fase 4) para
--     fijar `closed_at` cuando la partida termina: la edad de una terminada
--     se mide desde su cierre real, no desde su creación.
--   · `prune_finished_matches(p_days)`: la política de retención, ejecutable
--     también a mano (`npm run prune`).
--
-- Las funciones siguen siendo `security definer`, con `search_path` vacío, y
-- solo `service_role` puede ejecutarlas.

alter table public.matches add column summary jsonb;
alter table public.matches add column pruned_at timestamptz;

-- Partidas terminadas antes de esta migración: su cierre se toma desde ahora
-- (no hay forma honesta de reconstruir cuándo acabaron, y así ninguna queda
-- archivable de inmediato).
update public.matches
   set closed_at = now()
 where status in ('finished', 'closed')
   and closed_at is null;

-- ------------------------------------------------------------------ --
-- Retención (REGLAS.md §21.2)                                         --
-- ------------------------------------------------------------------ --

create function public.prune_finished_matches(p_days int default 30)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_days int := greatest(coalesce(p_days, 30), 1);
begin
  select array_agg(id) into v_ids
    from public.matches
   where status in ('finished', 'closed')
     and pruned_at is null
     and coalesce(closed_at, created_at) < now() - make_interval(days => v_days);

  if v_ids is null then return 0; end if;

  -- El resumen antes de borrar nada: es lo único que queda de la partida.
  update public.matches m set
    summary = jsonb_build_object(
      'mode', m.config ->> 'mode',
      'seats', (select count(*) from public.seats s where s.match_id = m.id),
      'turns', m.turn,
      'era', m.era,
      'fictionDay', m.fiction_day,
      'winnerSeat', m.winner_seat,
      'winnerName', (
        select s.name from public.seats s
         where s.match_id = m.id and s.seat_idx = m.winner_seat
      ),
      'createdAt', m.created_at,
      'closedAt', coalesce(m.closed_at, now())
    ),
    status = 'closed',
    phase = 'closed',
    closed_at = coalesce(m.closed_at, now()),
    pruned_at = now()
  where m.id = any(v_ids);

  -- El detalle pesado desaparece; la mesa y sus jugadores quedan como resumen.
  delete from public.seat_state     where match_id = any(v_ids);
  delete from public.seat_public    where match_id = any(v_ids);
  delete from public.orders         where match_id = any(v_ids);
  delete from public.turn_proposals where match_id = any(v_ids);
  delete from public.wars           where match_id = any(v_ids);
  delete from public.pacts          where match_id = any(v_ids);
  delete from public.missions       where match_id = any(v_ids);
  delete from public.milestones     where match_id = any(v_ids);
  delete from public.turn_resolutions where match_id = any(v_ids);
  delete from public.turn_events    where match_id = any(v_ids);
  delete from public.chronicle      where match_id = any(v_ids);
  delete from public.whispers       where match_id = any(v_ids);

  return cardinality(v_ids);
end;
$$;

revoke all on function public.prune_finished_matches(int) from public;
revoke all on function public.prune_finished_matches(int) from anon, authenticated;
grant execute on function public.prune_finished_matches(int) to service_role;

-- ------------------------------------------------------------------ --
-- Mesas activas por jugador (REGLAS.md §21.1)                         --
-- ------------------------------------------------------------------ --

create function public.active_seat_count(p_user uuid)
returns int
language sql
security definer
set search_path = ''
as $$
  select count(distinct s.match_id)
    from public.seats s
    join public.matches m on m.id = s.match_id
   where s.user_id = p_user
     and s.kind = 'human'
     and m.status in ('lobby', 'orders', 'resolving');
$$;

revoke all on function public.active_seat_count(uuid) from public;
revoke all on function public.active_seat_count(uuid) from anon, authenticated;
grant execute on function public.active_seat_count(uuid) to service_role;

create or replace function public.create_solo_match(
  p_match uuid,
  p_code text,
  p_state jsonb,
  p_config jsonb,
  p_human uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- §21.2: la creación de una mesa barre las terminadas caducadas.
  perform public.prune_finished_matches(30);

  -- §21.1: máximo 3 mesas activas por jugador, también por REST directo.
  if public.active_seat_count(p_human) >= 3 then
    raise exception 'too_many_active'
      using errcode = 'P0001',
            hint = 'Un jugador mantiene como maximo 3 mesas activas (REGLAS.md seccion 21.1)';
  end if;

  insert into public.matches (
    id, code, status, phase, seed, turn, config,
    window_id, windows_unlocked, unlock_every, fiction_day, horizon_years,
    era, era_progress, era_advanced_turn, last_bar_rise_turn, table_voters,
    war, window_before_war, peace_until_turn, window_override, winner_seat
  ) values (
    p_match,
    p_code,
    'orders',
    'orders',
    (p_state ->> 'seed')::bigint,
    (p_state ->> 'turn')::int,
    p_config,
    p_state ->> 'windowId',
    array(select jsonb_array_elements_text(p_state -> 'windowsUnlocked')),
    (p_state ->> 'unlockEvery')::int,
    (p_state ->> 'fictionDay')::int,
    (p_state ->> 'horizonYears')::int,
    p_state ->> 'era',
    (p_state ->> 'eraBar')::numeric,
    (p_state ->> 'eraAdvancedTurn')::int,
    (p_state ->> 'lastBarRiseTurn')::int,
    (p_state ->> 'tableVoters')::int,
    nullif(p_state -> 'war', 'null'::jsonb),
    p_state ->> 'windowBeforeWar',
    (p_state ->> 'peaceUntilTurn')::int,
    nullif(p_state -> 'windowOverride', 'null'::jsonb),
    (p_state ->> 'winnerSeat')::int
  );

  perform public.project_seats(p_match, p_state);

  -- El humano de la rebanada ocupa el asiento 0.
  update public.seats
     set user_id = p_human
   where match_id = p_match and seat_idx = 0;
end;
$$;

revoke all on function public.create_solo_match(uuid, text, jsonb, jsonb, uuid) from public;
revoke all on function public.create_solo_match(uuid, text, jsonb, jsonb, uuid) from anon, authenticated;
grant execute on function public.create_solo_match(uuid, text, jsonb, jsonb, uuid) to service_role;

create or replace function public.create_lobby(
  p_match uuid,
  p_code text,
  p_seed bigint,
  p_config jsonb,
  p_host uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.prune_finished_matches(30);

  if public.active_seat_count(p_host) >= 3 then
    raise exception 'too_many_active'
      using errcode = 'P0001',
            hint = 'Un jugador mantiene como maximo 3 mesas activas (REGLAS.md seccion 21.1)';
  end if;

  insert into public.matches (
    id, code, status, phase, seed, turn, config, host_seat,
    window_id, windows_unlocked, unlock_every, fiction_day, horizon_years
  ) values (
    p_match,
    p_code,
    'lobby',
    'lobby',
    p_seed,
    1,
    p_config,
    0,
    '1d',
    '{1d}',
    coalesce((p_config ->> 'unlockEvery')::int, 5),
    0,
    30
  );

  insert into public.seats (match_id, seat_idx, kind, user_id, name)
  values (
    p_match,
    0,
    'human',
    p_host,
    coalesce((
      select nick from public.profiles where id = p_host
    ), 'Anfitrión')
  );
end;
$$;

revoke all on function public.create_lobby(uuid, text, bigint, jsonb, uuid) from public;
revoke all on function public.create_lobby(uuid, text, bigint, jsonb, uuid) from anon, authenticated;
grant execute on function public.create_lobby(uuid, text, bigint, jsonb, uuid) to service_role;

-- -4 = el jugador ya mantiene 3 mesas activas (§21.1).
create or replace function public.join_lobby(p_match uuid, p_user uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seats int;
  v_phase text;
  v_seat int;
begin
  select phase, coalesce((config ->> 'seats')::int, 8) into v_phase, v_seats
    from public.matches where id = p_match;
  if not found or v_phase <> 'lobby' then return -3; end if;

  if public.active_seat_count(p_user) >= 3 then return -4; end if;

  begin
    insert into public.seats (match_id, seat_idx, kind, user_id, name)
    select p_match, s.idx, 'human', p_user,
           coalesce((select nick from public.profiles where id = p_user), 'Invitado')
      from generate_series(0, v_seats - 1) as s(idx)
     where not exists (
       select 1 from public.seats seat
        where seat.match_id = p_match and seat.seat_idx = s.idx
     )
     order by s.idx
     limit 1
    returning seat_idx into v_seat;

    return coalesce(v_seat, -1);
  exception
    -- Un humano no ocupa dos asientos de la misma partida (índice único).
    when unique_violation then return -2;
  end;
end;
$$;

revoke all on function public.join_lobby(uuid, uuid) from public;
revoke all on function public.join_lobby(uuid, uuid) from anon, authenticated;
grant execute on function public.join_lobby(uuid, uuid) to service_role;

-- ------------------------------------------------------------------ --
-- apply_turn: idéntico al de la Fase 4, fijando closed_at al terminar  --
-- (REGLAS.md §21.2 mide la retención desde el cierre real).           --
-- ------------------------------------------------------------------ --

create or replace function public.apply_turn(p_match uuid, p_turn int, p_payload jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state jsonb := p_payload -> 'state';
  v_event jsonb;
  v_inserted boolean := false;
  v_current int;
  v_turn_seconds int;
begin
  insert into public.turn_resolutions (match_id, turn, digest, payload)
  values (p_match, p_turn, p_payload ->> 'digest', jsonb_build_object('state', v_state))
  on conflict (match_id, turn) do nothing;

  v_inserted := found;

  delete from public.turn_events where match_id = p_match and turn = p_turn;

  for v_event in select * from jsonb_array_elements(coalesce(p_payload -> 'events', '[]'::jsonb)) loop
    insert into public.turn_events (
      match_id, turn, visibility, seat_idx, kind, text, payload
    ) values (
      p_match,
      (v_event ->> 'turn')::int,
      v_event ->> 'visibility',
      (v_event ->> 'seatId')::int,
      v_event ->> 'kind',
      v_event ->> 'text',
      coalesce(v_event -> 'data', '{}'::jsonb)
    );
  end loop;

  insert into public.chronicle (match_id, turn, public_text, private)
  values (
    p_match,
    p_turn,
    coalesce(p_payload -> 'chronicle' ->> 'public', ''),
    coalesce(p_payload -> 'chronicle' -> 'private', '{}'::jsonb)
  )
  on conflict (match_id, turn) do update
  set public_text = excluded.public_text,
      private = excluded.private;

  select turn, coalesce((config ->> 'turnSeconds')::int, 120) into v_current, v_turn_seconds
    from public.matches where id = p_match;
  if v_current is null then
    raise exception 'Partida % inexistente', p_match;
  end if;

  update public.matches set
    turn = (v_state ->> 'turn')::int,
    window_id = v_state ->> 'windowId',
    windows_unlocked = array(select jsonb_array_elements_text(v_state -> 'windowsUnlocked')),
    unlock_every = (v_state ->> 'unlockEvery')::int,
    fiction_day = (v_state ->> 'fictionDay')::int,
    era = v_state ->> 'era',
    era_progress = (v_state ->> 'eraBar')::numeric,
    era_advanced_turn = (v_state ->> 'eraAdvancedTurn')::int,
    last_bar_rise_turn = (v_state ->> 'lastBarRiseTurn')::int,
    table_voters = (v_state ->> 'tableVoters')::int,
    war = nullif(v_state -> 'war', 'null'::jsonb),
    window_before_war = v_state ->> 'windowBeforeWar',
    peace_until_turn = (v_state ->> 'peaceUntilTurn')::int,
    window_override = nullif(v_state -> 'windowOverride', 'null'::jsonb),
    winner_seat = (v_state ->> 'winnerSeat')::int,
    status = case when (v_state ->> 'finished')::boolean then 'finished' else 'orders' end,
    phase = case when (v_state ->> 'finished')::boolean then 'finished' else 'orders' end,
    -- §21.2: la retención corre desde el cierre real de la partida.
    closed_at = case
      when (v_state ->> 'finished')::boolean then coalesce(closed_at, now())
      else null
    end,
    -- §5: el turno nuevo abre con su temporizador; 0 = asíncrono (12 h).
    turn_ends_at = case
      when (v_state ->> 'finished')::boolean then null
      else now() + make_interval(secs => case
        when v_turn_seconds is null or v_turn_seconds <= 0 then 12 * 3600
        else v_turn_seconds
      end)
    end,
    config = config || jsonb_build_object(
      'windowPolicy', v_state ->> 'windowPolicy',
      'fixedWindow', coalesce(v_state -> 'fixedWindow', 'null'::jsonb)
    ),
    resolving = false,
    resolving_since = null
  where id = p_match;

  perform public.project_seats(p_match, v_state);

  return case when v_inserted then 'applied' else 'replayed' end;
end;
$$;

revoke all on function public.apply_turn(uuid, int, jsonb) from public;
revoke all on function public.apply_turn(uuid, int, jsonb) from anon, authenticated;
grant execute on function public.apply_turn(uuid, int, jsonb) to service_role;
