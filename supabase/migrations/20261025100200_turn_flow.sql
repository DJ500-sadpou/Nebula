-- Fase 3 · Flujo de turno de la rebanada de un jugador (PLAN.md §3.2).
--
-- Qué se añade:
--   · Las columnas que el estado del motor necesita para reproducirse (§4): la
--     válvula de barra, la guerra, el techo de paz y el escalón del debuff.
--   · `project_seats`: proyecta el estado del motor sobre seats, seat_state y
--     seat_public. Es absoluta, no incremental, así que aplicarla dos veces
--     deja el mismo resultado.
--   · `create_solo_match`: crea la mesa completa en una sola transacción.
--   · `claim_turn`: el claim atómico de AGENTS.md invariante 5.
--   · `apply_turn`: resuelve el turno de forma idempotente; la clave
--     (match_id, turn) de `turn_resolutions` es el registro y la proyección se
--     puede repetir sin duplicar eventos.
--
-- Todas las funciones son `security definer`, con `search_path` vacío, y solo
-- `service_role` puede ejecutarlas. El cliente no escribe estado.

alter table public.matches add column last_bar_rise_turn int not null default 1;
alter table public.matches add column table_voters int not null default 1
  check (table_voters between 0 and 32);
alter table public.matches add column war jsonb;
alter table public.matches add column window_before_war text
  check (window_before_war in ('1d', '7d', '30d', '3m', '6m', '1y', '3y'));
alter table public.matches add column peace_until_turn int not null default 0;
alter table public.matches add column resolving_since timestamptz;

alter table public.seat_state add column debuff_turns int not null default 0;
alter table public.seat_state add column debuff_from_culture boolean not null default false;
alter table public.seat_state add column debuff_level int not null default 0
  check (debuff_level between 0 and 3);
alter table public.seat_state add column debuff_mission_turn int;
alter table public.seat_state add column created_at_turn int not null default 1;

-- §4 dice fidelidad [0–1,5]; el check original la cortaba en 1. La fidelidad
-- puede superar 1 con templos y fama, así que se corrige aquí.
alter table public.seat_state drop constraint if exists seat_state_fidelity_check;
alter table public.seat_state add constraint seat_state_fidelity_check
  check (fidelity between 0 and 1.5);

create index matches_code_idx on public.matches (code);

-- Un evento público puede señalar a quién le ocurrió (`seat_idx` como sujeto)
-- sin dejar de ser público. El check original lo prohibía y el motor lo usa:
-- «una tormenta barre los sembrados de Nebula» es pública y con sujeto. La
-- visibilidad sigue mandando en la RLS, así que no se filtra nada.
alter table public.turn_events drop constraint if exists turn_events_check;
alter table public.turn_events add constraint turn_events_check check (
  (visibility = 'public' and pair_seat is null)
  or (visibility = 'seat' and seat_idx is not null)
  or (visibility = 'pair' and seat_idx is not null and pair_seat is not null)
);

-- ------------------------------------------------------------------ --
-- Proyección de asientos                                             --
-- ------------------------------------------------------------------ --

create function public.project_seats(p_match uuid, p_state jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seat jsonb;
  v_war jsonb := nullif(p_state -> 'war', 'null'::jsonb);
  v_id int;
begin
  for v_seat in select * from jsonb_array_elements(p_state -> 'seats') loop
    v_id := (v_seat ->> 'id')::int;

    insert into public.seats (match_id, seat_idx, kind, name, area_card, domain_card)
    values (
      p_match,
      v_id,
      case when v_seat ->> 'kind' = 'dormant' then 'dormant' else (v_seat ->> 'kind') end,
      v_seat ->> 'name',
      v_seat ->> 'areaCard',
      v_seat ->> 'domainCard'
    )
    on conflict (match_id, seat_idx) do update
      set kind = excluded.kind,
          name = excluded.name,
          area_card = excluded.area_card,
          domain_card = excluded.domain_card;

    insert into public.seat_state (
      match_id, seat_idx, fe, xp, divinity, fidelity, fame, magic, essence, relics,
      believers, techs, culture, debuff_primitive, debuff_from_culture, debuff_turns,
      debuff_level, debuff_mission_turn, created_at_turn, buffs
    ) values (
      p_match,
      v_id,
      (v_seat ->> 'fe')::int,
      (v_seat ->> 'xp')::int,
      (v_seat ->> 'divinity')::int,
      (v_seat ->> 'fidelity')::numeric,
      (v_seat ->> 'fame')::int,
      (v_seat ->> 'magic')::int,
      (v_seat ->> 'essence')::int,
      (v_seat ->> 'relics')::int,
      (v_seat ->> 'believers')::int,
      array(select jsonb_array_elements_text(v_seat -> 'techs')),
      array(select jsonb_array_elements_text(v_seat -> 'culture')),
      (v_seat ->> 'debuffPrimitive')::boolean,
      (v_seat ->> 'debuffFromCulture')::boolean,
      (v_seat ->> 'debuffTurns')::int,
      (v_seat ->> 'debuffLevel')::int,
      (v_seat ->> 'debuffMissionTurn')::int,
      (v_seat ->> 'createdAtTurn')::int,
      coalesce(v_seat -> 'buffs', '[]'::jsonb)
    )
    on conflict (match_id, seat_idx) do update
      set fe = excluded.fe,
          xp = excluded.xp,
          divinity = excluded.divinity,
          fidelity = excluded.fidelity,
          fame = excluded.fame,
          magic = excluded.magic,
          essence = excluded.essence,
          relics = excluded.relics,
          believers = excluded.believers,
          techs = excluded.techs,
          culture = excluded.culture,
          debuff_primitive = excluded.debuff_primitive,
          debuff_from_culture = excluded.debuff_from_culture,
          debuff_turns = excluded.debuff_turns,
          debuff_level = excluded.debuff_level,
          debuff_mission_turn = excluded.debuff_mission_turn,
          created_at_turn = excluded.created_at_turn,
          buffs = excluded.buffs;

    insert into public.seat_public (
      match_id, seat_idx, regions, divinity_band, temples, vassal_of, at_war_with
    ) values (
      p_match,
      v_id,
      (v_seat ->> 'regions')::int,
      case
        when (v_seat ->> 'divinity')::int <= 3 then 'baja'
        when (v_seat ->> 'divinity')::int <= 7 then 'media'
        else 'alta'
      end,
      (v_seat ->> 'temples')::int,
      (v_seat ->> 'vassalOf')::int,
      case
        when v_war is null then '{}'::int[]
        when (v_war ->> 'a')::int = v_id then array[(v_war ->> 'b')::int]
        when (v_war ->> 'b')::int = v_id then array[(v_war ->> 'a')::int]
        else '{}'::int[]
      end
    )
    on conflict (match_id, seat_idx) do update
      set regions = excluded.regions,
          divinity_band = excluded.divinity_band,
          temples = excluded.temples,
          vassal_of = excluded.vassal_of,
          at_war_with = excluded.at_war_with;
  end loop;

  insert into public.milestones (match_id, key, claimed_by_seat, claimed_turn)
  select p_match, key, value::int, coalesce((p_state ->> 'turn')::int - 1, 1)
  from jsonb_each_text(p_state -> 'milestones')
  on conflict (match_id, key) do nothing;
end;
$$;

revoke all on function public.project_seats(uuid, jsonb) from public;
revoke all on function public.project_seats(uuid, jsonb) from anon, authenticated;
grant execute on function public.project_seats(uuid, jsonb) to service_role;

-- ------------------------------------------------------------------ --
-- Crear la mesa entera                                               --
-- ------------------------------------------------------------------ --

create function public.create_solo_match(
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

-- ------------------------------------------------------------------ --
-- Claim atómico del turno                                            --
-- ------------------------------------------------------------------ --

create function public.claim_turn(p_match uuid, p_turn int)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with claimed as (
    update public.matches
       set resolving = true,
           resolving_since = now()
     where id = p_match
       and turn = p_turn
       and status in ('lobby', 'orders')
       and (
         resolving = false
         or resolving_since is null
         or resolving_since < now() - interval '2 minutes'
       )
    returning 1
  )
  select exists (select 1 from claimed);
$$;

revoke all on function public.claim_turn(uuid, int) from public;
revoke all on function public.claim_turn(uuid, int) from anon, authenticated;
grant execute on function public.claim_turn(uuid, int) to service_role;

create function public.release_turn(p_match uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.matches
     set resolving = false, resolving_since = null
   where id = p_match;
$$;

revoke all on function public.release_turn(uuid) from public;
revoke all on function public.release_turn(uuid) from anon, authenticated;
grant execute on function public.release_turn(uuid) to service_role;

-- ------------------------------------------------------------------ --
-- Aplicar un turno resuelto                                          --
-- ------------------------------------------------------------------ --

create function public.apply_turn(p_match uuid, p_turn int, p_payload jsonb)
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
begin
  insert into public.turn_resolutions (match_id, turn, digest, payload)
  values (p_match, p_turn, p_payload ->> 'digest', jsonb_build_object('state', v_state))
  on conflict (match_id, turn) do nothing;

  v_inserted := found;

  -- Proyección absoluta: repetirla no duplica nada. Los eventos del turno se
  -- reemplazan enteros, así que un reintento tras un fallo converge.
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

  select turn into v_current from public.matches where id = p_match;
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
