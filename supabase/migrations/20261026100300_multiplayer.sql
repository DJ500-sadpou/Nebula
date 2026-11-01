-- Fase 4 · Multijugador: lobby, órdenes por asiento y papeleta real (PLAN.md §6).
--
-- El esquema de la Fase 1 ya anticipaba esta fase: `matches.status = 'lobby'`,
-- `seats.kind = 'empty'`, `orders`, `turn_proposals` y `turn_votes` ya existen
-- y su RLS ya está dictada en 20261025100100_rls.sql. Aquí solo se añade lo
-- que faltaba y las funciones del flujo:
--
--   · `seats.ready` y `matches.host_seat`: el "listo/no listo" del lobby y
--     quién puede expulsar y arrancar (el asiento 0; si abandona, el siguiente
--     asiento libre es el 0 y el siguiente jugador que entre lo hereda).
--   · `turn_proposals.result_window`: la ventana elegida queda registrada en
--     la propia propuesta cuando se cierra, junto a su estado.
--   · `create_lobby` / `join_lobby` / `leave_seat` / `kick_seat` / `set_ready`:
--     el lobby. `leave_seat` en partida activa convierte el asiento en bot
--     (§2: el abandono no borra los fieles de nadie).
--   · `begin_orders`: arranca la partida con el estado que construye el
--     orquestador (relleno con bots incluido) y programa el temporizador del
--     turno (`turn_ends_at`, §5).
--   · `submit_orders`: órdenes inmutables por asiento y turno; repetir no
--     reescribe.
--   · `open_ballot` / `cast_vote` / `close_ballot`: la papeleta de §5-A.2,
--     secreta hasta el cierre.
--   · `apply_turn` se reemplaza para que cada turno nuevo tenga su
--     temporizador; lo demás queda idéntico.
--
-- Todas las funciones son `security definer`, con `search_path` vacío, y solo
-- `service_role` puede ejecutarlas: el cliente nunca escribe estado
-- (AGENTS.md invariante 3). La legalidad de una propuesta (escalera y techo de
-- guerra) la valida la capa de servidor con el motor antes de llegar aquí.

alter table public.seats add column ready boolean not null default false;
alter table public.matches add column host_seat int not null default 0;
alter table public.turn_proposals add column result_window text
  check (result_window in ('1d', '7d', '30d', '3m', '6m', '1y', '3y'));

-- ------------------------------------------------------------------ --
-- Lobby: crear, unirse, marcharse                                     --
-- ------------------------------------------------------------------ --

create function public.create_lobby(
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

create function public.join_lobby(p_match uuid, p_user uuid)
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

create function public.leave_seat(p_match uuid, p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phase text;
begin
  select phase into v_phase from public.matches where id = p_match;
  if not found then return 'not_found'; end if;
  if v_phase = 'lobby' then
    delete from public.seats where match_id = p_match and user_id = p_user;
    return 'left_lobby';
  end if;
  if v_phase = 'orders' then
    -- §2: el humano que abandona pasa a bot; sus fieles siguen y no se borra
    -- nada. Sus órdenes ya enviadas para este turno se respetan.
    update public.seats
       set kind = 'bot', user_id = null
     where match_id = p_match and user_id = p_user and kind = 'human';
    return 'bot_took_over';
  end if;
  return 'not_allowed';
end;
$$;

revoke all on function public.leave_seat(uuid, uuid) from public;
revoke all on function public.leave_seat(uuid, uuid) from anon, authenticated;
grant execute on function public.leave_seat(uuid, uuid) to service_role;

create function public.kick_seat(p_match uuid, p_host uuid, p_seat int)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phase text;
  v_host_seat int;
begin
  select phase, host_seat into v_phase, v_host_seat
    from public.matches where id = p_match;
  if not found then return 'not_found'; end if;
  if v_phase <> 'lobby' then return 'not_lobby'; end if;

  if not exists (
    select 1 from public.seats
     where match_id = p_match and seat_idx = v_host_seat and user_id = p_host
  ) then
    return 'not_host';
  end if;

  delete from public.seats
   where match_id = p_match and seat_idx = p_seat and kind = 'human';
  return 'ok';
end;
$$;

revoke all on function public.kick_seat(uuid, uuid, int) from public;
revoke all on function public.kick_seat(uuid, uuid, int) from anon, authenticated;
grant execute on function public.kick_seat(uuid, uuid, int) to service_role;

create function public.set_ready(p_match uuid, p_user uuid, p_ready boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.matches where id = p_match and phase = 'lobby') then
    return 'not_lobby';
  end if;
  if not exists (select 1 from public.seats where match_id = p_match and user_id = p_user) then
    return 'not_seated';
  end if;
  update public.seats set ready = p_ready
   where match_id = p_match and user_id = p_user;
  return 'ok';
end;
$$;

revoke all on function public.set_ready(uuid, uuid, boolean) from public;
revoke all on function public.set_ready(uuid, uuid, boolean) from anon, authenticated;
grant execute on function public.set_ready(uuid, uuid, boolean) to service_role;

-- ------------------------------------------------------------------ --
-- Arrancar la partida                                                 --
-- ------------------------------------------------------------------ --

create function public.begin_orders(
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

-- ------------------------------------------------------------------ --
-- Órdenes por asiento (inmutables al enviar)                          --
-- ------------------------------------------------------------------ --

create function public.submit_orders(
  p_match uuid,
  p_turn int,
  p_seat int,
  p_payload jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.matches
     where id = p_match and phase = 'orders' and turn = p_turn
  ) then
    return 'not_orders';
  end if;

  -- Solo un asiento humano envía órdenes. El que abandona pasa a bot al
  -- turno siguiente (§2), pero las órdenes que envió antes siguen siendo suyas.
  if not exists (
    select 1 from public.seats
     where match_id = p_match and seat_idx = p_seat and kind = 'human'
  ) then
    return 'not_seated';
  end if;

  insert into public.orders (match_id, seat_idx, turn, payload)
  values (p_match, p_seat, p_turn, p_payload)
  on conflict (match_id, seat_idx, turn) do nothing;

  return case when found then 'stored' else 'exists' end;
end;
$$;

revoke all on function public.submit_orders(uuid, int, int, jsonb) from public;
revoke all on function public.submit_orders(uuid, int, int, jsonb) from anon, authenticated;
grant execute on function public.submit_orders(uuid, int, int, jsonb) to service_role;

-- ------------------------------------------------------------------ --
-- Papeleta de ventana (§5-A.2)                                        --
-- ------------------------------------------------------------------ --

create function public.open_ballot(
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

  insert into public.turn_proposals (match_id, turn, proposer_seat, window_id)
  values (p_match, p_turn, p_seat, p_window)
  returning id into v_proposal;

  return v_proposal;
end;
$$;

revoke all on function public.open_ballot(uuid, int, int, text) from public;
revoke all on function public.open_ballot(uuid, int, int, text) from anon, authenticated;
grant execute on function public.open_ballot(uuid, int, int, text) to service_role;

create function public.cast_vote(
  p_match uuid,
  p_proposal uuid,
  p_seat int,
  p_choice text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.turn_proposals p
      join public.matches m on m.id = p.match_id
     where p.id = p_proposal
       and p.match_id = p_match
       and p.status = 'open'
       and p.turn = m.turn
  ) then
    return 'not_open';
  end if;

  -- Un asiento, un voto; se puede cambiar hasta el cierre (A.2.7: secreto
  -- mientras la papeleta esté abierta).
  insert into public.turn_votes (match_id, proposal_id, seat_idx, choice)
  values (p_match, p_proposal, p_seat, p_choice)
  on conflict (proposal_id, seat_idx) do update set choice = excluded.choice;

  return 'ok';
end;
$$;

revoke all on function public.cast_vote(uuid, uuid, int, text) from public;
revoke all on function public.cast_vote(uuid, uuid, int, text) from anon, authenticated;
grant execute on function public.cast_vote(uuid, uuid, int, text) to service_role;

create function public.close_ballot(
  p_match uuid,
  p_turn int,
  p_status text,
  p_result text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.turn_proposals set
    status = p_status,
    result_window = p_result,
    closes_at = now()
  where match_id = p_match
    and turn = p_turn
    and status = 'open';

  return case when found then 'ok' else 'none' end;
end;
$$;

revoke all on function public.close_ballot(uuid, int, text, text) from public;
revoke all on function public.close_ballot(uuid, int, text, text) from anon, authenticated;
grant execute on function public.close_ballot(uuid, int, text, text) to service_role;

-- ------------------------------------------------------------------ --
-- apply_turn: idéntico al de la Fase 3, con el temporizador del turno  --
-- siguiente (§5). La proyección absoluta no cambia: repetir sigue     --
-- sin duplicar eventos.                                               --
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
