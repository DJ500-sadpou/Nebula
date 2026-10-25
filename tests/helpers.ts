import { MatchState, Seat, createInitialState } from '../lib/engine';

export function makeSeat(over: Partial<Seat> = {}): Seat {
  return {
    id: 0,
    name: 'Nebula',
    kind: 'bot',
    areaCard: 'Mar',
    domainCard: 'Guerra',
    believers: 300,
    fidelity: 0.7,
    fame: 0,
    fe: 100,
    xp: 0,
    divinity: 1,
    temples: 0,
    regions: 1,
    essence: 0,
    relics: 0,
    magic: 0,
    techs: [],
    culture: [],
    buffs: [],
    debuffPrimitive: false,
    debuffTurns: 0,
    debuffFromCulture: false,
    debuffLevel: 0,
    debuffMissionTurn: null,
    vassalOf: null,
    createdAtTurn: 1,
    ...over,
  };
}

export function makeState(seats: Seat[], over: Partial<MatchState> = {}): MatchState {
  const base = createInitialState({ seats: 4, humans: 0, seed: 1, unlockEvery: 5, horizonYears: 30 });
  return { ...base, seats, ...over };
}
