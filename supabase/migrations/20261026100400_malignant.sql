-- Fase 6 · Dioses dormidos y despertar maligno (PLAN.md §6, REGLAS.md §17.2).
--
-- El esquema de la Fase 1 ya reservó `seats.awakened`; lo que faltaba es que
-- la proyección del estado lo escribiera: un dios dormido que despierta en el
-- motor debe seguir despierto tras recargar la partida. Se sustituye
-- `project_seats` (mismo patrón que `apply_turn` en la Fase 4) para que:
--
--   · el asiento proyecte `awakened` (coalesce a `false`: los estados
--     guardados antes de la Fase 6 no traen el campo);
--   · el resto de la proyección quede idéntica, byte a byte.
--
-- No se toca el check de `seats.kind`: un maligno sigue siendo `dormant` a
-- efectos de economía y crecimiento; solo la marca `awakened` distingue al
-- rival de §10. Tampoco hay nuevas tablas ni columnas: la columna ya existía.

create or replace function public.project_seats(p_match uuid, p_state jsonb)
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

    insert into public.seats (match_id, seat_idx, kind, name, area_card, domain_card, awakened)
    values (
      p_match,
      v_id,
      case when v_seat ->> 'kind' = 'dormant' then 'dormant' else (v_seat ->> 'kind') end,
      v_seat ->> 'name',
      v_seat ->> 'areaCard',
      v_seat ->> 'domainCard',
      coalesce((v_seat ->> 'awakened')::boolean, false)
    )
    on conflict (match_id, seat_idx) do update
      set kind = excluded.kind,
          name = excluded.name,
          area_card = excluded.area_card,
          domain_card = excluded.domain_card,
          awakened = excluded.awakened;

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
