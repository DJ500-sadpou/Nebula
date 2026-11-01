-- Auditoría · unicidad de la papeleta y carreras del lobby (hallazgos C2/C3/M1).
--
-- Qué corrige:
--   · C2 — Una sola papeleta ABIERTA por turno: índice único parcial sobre
--     (match_id, turn). `open_ballot` era select-then-insert (TOCTOU): dos
--     propuestas casi simultáneas dejaban dos filas «open» y el `maybeSingle()`
--     de la vista de estado devolvía PGRST116 (un 500 que duraba todo el
--     turno). La función se sustituye para devolver la existente si pierde la
--     carrera (A.2.2: una papeleta por turno).
--   · C3 — Carrera sentarse/arrancar: quien se sienta entre la lectura del
--     anfitrión y `begin_orders` queda proyectado como bot con su `user_id`
--     colgado de un asiento que ya no es humano. La proyección no toca
--     `user_id`, así que el jugador quedaba atrapado (no envía órdenes por
--     `bot_seat`, no re-entra por el índice único y `leave_seat` no le
--     limpia). `begin_orders` se sustituye para desengancharlo (§2: el que
--     llega tarde, fuera; sus fieles ya eran del estado que arrancó).
--   · M1 — El guard de §21.1 era check-then-act: dos creaciones o dos
--     asientos simultáneos del mismo jugador podían superar el máximo de 3
--     mesas activas. Las tres funciones que cuentan (`create_solo_match`,
--     `create_lobby`, `join_lobby`) toman ahora un candado consultivo por
--     jugador dentro de la transacción.
--
-- Sin datos previos que rescatar: P-02 aún no se ha aplicado en ningún
-- proyecto (PENDIENTES.md), así que el índice único no puede chocar con
-- duplicados históricos.
--
-- Las funciones siguen siendo `security definer`, con `search_path` vacío, y
-- solo `service_role` puede ejecutarlas.

-- C2: una papeleta abierta por turno, garantizado por la base.
create unique index turn_proposals_one_open_per_turn
  on public.turn_proposals (match_id, turn)
  where status = 'open';

create or replace function public.open_ballot(
  p_match uuid,
  p_turn int,
  p_seat int,
  p_window text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal uuid;
begin
  if not exists (
    select 1 from public.matches
     where id = p_match and phase = 'orders' and turn = p_turn
  ) then
    return null;
  end if;

  select id into v_proposal
    from public.turn_proposals
   where match_id = p_match and turn = p_turn and status = 'open'
   limit 1;

  -- Una papeleta por turno (A.2.2): la segunda propuesta devuelve la abierta.
  if v_proposal is not null then return v_proposal; end if;

  begin
    insert into public.turn_proposals (match_id, turn, proposer_seat, window_id)
    values (p_match, p_turn, p_seat, p_window)
    returning id into v_proposal;

    return v_proposal;
  exception
    -- Perdió la carrera contra otra propuesta del mismo turno: manda la que
    -- ya está abierta (el índice único parcial lo garantiza).
    when unique_violation then
      select id into v_proposal
        from public.turn_proposals
       where match_id = p_match and turn = p_turn and status = 'open'
       limit 1;
      return v_proposal;
  end;
end;
$$;

revoke all on function public.open_ballot(uuid, int, int, text) from public;
revoke all on function public.open_ballot(uuid, int, int, text) from anon, authenticated;
grant execute on function public.open_ballot(uuid, int, int, text) to service_role;

-- C3: begin_orders desengancha al que se sentó demasiado tarde.
create or replace function public.begin_orders(
  p_match uuid,
  p_state jsonb,
  p_turn_seconds int
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seconds int := coalesce(
    case when p_turn_seconds is null or p_turn_seconds <= 0 then 12 * 3600 else p_turn_seconds end,
    120
  );
begin
  if not exists (select 1 from public.matches where id = p_match and phase = 'lobby') then
    raise exception 'La partida % no está en fase de lobby', p_match;
  end if;

  perform public.project_seats(p_match, p_state);

  -- Carrera sentarse/arrancar: la proyección no toca `user_id`, así que quien
  -- entró después de que el anfitrión leyó la sala quedaría colgado de un
  -- asiento que el estado ya cubrió con un bot (§2). Se desengancha: su
  -- asiento ya no es humano y ningún flujo legítimo deja un `user_id` en un
  -- asiento no humano (`leave_seat` lo limpia al convertir).
  update public.seats
     set user_id = null
   where match_id = p_match and user_id is not null and kind <> 'human';

  update public.matches set
    status = 'orders',
    phase = 'orders',
    turn = coalesce((p_state ->> 'turn')::int, 1),
    window_id = coalesce(p_state ->> 'windowId', '1d'),
    windows_unlocked = coalesce(
      array(select jsonb_array_elements_text(p_state -> 'windowsUnlocked')),
      '{1d}'
    ),
    unlock_every = coalesce((p_state ->> 'unlockEvery')::int, 5),
    fiction_day = coalesce((p_state ->> 'fictionDay')::int, 0),
    horizon_years = coalesce((p_state ->> 'horizonYears')::int, 30),
    era = coalesce(p_state ->> 'era', 'tribal'),
    era_progress = coalesce((p_state ->> 'eraBar')::numeric, 0),
    table_voters = coalesce((p_state ->> 'tableVoters')::int, 0),
    turn_ends_at = now() + make_interval(secs => v_seconds)
  where id = p_match;
end;
$$;

revoke all on function public.begin_orders(uuid, jsonb, int) from public;
revoke all on function public.begin_orders(uuid, jsonb, int) from anon, authenticated;
grant execute on function public.begin_orders(uuid, jsonb, int) to service_role;

-- M1: el guard de §21.1, atómico por jugador.
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

  -- §21.1 sin carrera: el candado serializa las creaciones del mismo jugador
  -- para que el conteo y la inserción no se pisen entre dos clics.
  perform pg_advisory_xact_lock(hashtext('active_seats:' || p_human::text));

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

  perform pg_advisory_xact_lock(hashtext('active_seats:' || p_host::text));

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

  perform pg_advisory_xact_lock(hashtext('active_seats:' || p_user::text));

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
