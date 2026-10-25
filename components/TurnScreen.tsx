import Link from 'next/link';
import { CreateMatch } from '@/components/CreateMatch';
import { TurnPlanner } from '@/components/TurnPlanner';
import { divinityBand } from '@/lib/db/map';
import { capFe } from '@/lib/engine/economy';
import { eraProgress, substageName } from '@/lib/engine/ic';
import { problemView } from '@/lib/engine/problems';
import { ERAS_BY_ID, MatchState, WINDOWS } from '@/lib/engine/types';
import { actionOptions } from '@/lib/match/solo';

export interface TurnChronicleLine {
  turn: number;
  publicText: string;
  privateText: string | null;
}

export interface TurnScreenProps {
  code: string;
  state: MatchState;
  mySeat: number;
  turnLimit: number;
  finished: boolean;
  lastChronicle?: TurnChronicleLine;
  /** `review` desactiva el envío: la vista de ejemplo no escribe en la base. */
  mode?: 'play' | 'review';
}

const BUFF_LABEL: Record<string, string> = {
  'militar+': 'Militar +',
  'cultura+': 'Cultura +',
  'fidelidad+': 'Fidelidad +',
  'esencia+': 'Esencias +',
  'compas+': 'Compás +',
  'fe+': 'Fe +',
};

/**
 * Pantalla de turno de §20: ficha, crónica, problema de era y planificador.
 * No accede a datos: recibe el estado ya cargado y valorado por el servidor.
 */
export function TurnScreen({
  code,
  state,
  mySeat,
  turnLimit,
  finished,
  lastChronicle,
  mode = 'play',
}: TurnScreenProps) {
  const seat = state.seats.find((item) => item.id === mySeat);
  if (!seat) {
    return (
      <section className="space-y-4">
        <p className="text-parchment-dim">Tu asiento ya no existe en esta mesa.</p>
        <Link className="text-sm text-gold underline-offset-4 hover:underline" href="/">
          Volver al panteón
        </Link>
      </section>
    );
  }

  const winner = state.seats.find((item) => item.id === state.winnerSeat);
  const rivals = state.seats.filter((item) => item.id !== seat.id);

  return (
    <div className="space-y-8">
      <GameHeader state={state} code={code} turnLimit={turnLimit} finished={finished} />

      {finished ? (
        <section className="space-y-4 rounded-lg border border-gold/40 bg-ink-soft p-6">
          <p className="text-xs uppercase tracking-[0.25em] text-gold-soft">Fin de la partida</p>
          <h2 className="font-display text-3xl text-parchment">
            {winner
              ? state.winnerSeat === seat.id
                ? 'El mundo recuerda tu nombre'
                : `El mundo recuerda a ${winner.name}`
              : 'Nadie será recordado'}
          </h2>
          <p className="max-w-prose text-sm text-parchment-dim">
            {state.winnerSeat === seat.id
              ? 'Has cerrado el ciclo de iniciación por delante de los demás dioses. La crónica guarda el resto.'
              : winner
                ? `${winner.name} cierra el ciclo por delante del resto. La crónica guarda el resto.`
                : 'El ciclo se cierra sin un vencedor claro.'}
          </p>
          {lastChronicle && (
            <div className="space-y-2 border-t border-gold/20 pt-4">
              <p className="text-xs uppercase tracking-widest text-gold-soft">
                Crónica del turno {lastChronicle.turn}
              </p>
              <p className="whitespace-pre-line text-sm leading-relaxed text-parchment">
                {lastChronicle.publicText}
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-4 pt-2">
            {mode === 'play' ? (
              <CreateMatch label="Jugar otra iniciación" />
            ) : (
              <span className="text-sm text-parchment-dim">Vista de revisión, sin envío.</span>
            )}
            <Link className="text-sm text-gold underline-offset-4 hover:underline" href="/">
              Volver al panteón
            </Link>
          </div>
        </section>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2">
            <article className="rounded-lg border border-gold/25 bg-ink-soft p-5">
              <p className="text-xs uppercase tracking-[0.22em] text-gold-soft">Tu dios</p>
              <h3 className="mt-1 font-display text-2xl text-parchment">{seat.name}</h3>
              <p className="text-sm text-parchment-dim">
                {seat.areaCard} · Dominio {seat.domainCard}
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Stat label="Divinidad" value={`${seat.divinity}`} />
                <Stat label="Fe" value={`${seat.fe} / ${capFe(seat)}`} />
                <Stat label="Fieles" value={`${seat.believers}`} />
                <Stat label="Fidelidad" value={seat.fidelity.toFixed(2).replace('.', ',')} />
                <Stat label="Templos" value={`${seat.temples}`} />
                <Stat label="Regiones" value={`${seat.regions}`} />
                <Stat label="Tecnología" value={`${seat.techs.length} / 12`} />
                <Stat label="Cultura" value={`${seat.culture.length} / 12`} />
              </dl>
              {seat.buffs.length > 0 && (
                <p className="mt-3 text-xs text-gold-soft">
                  Buffs:{' '}
                  {seat.buffs
                    .map(
                      (buff) =>
                        `${BUFF_LABEL[buff.type] ?? buff.type} (${buff.untilTurn - state.turn + 1})`,
                    )
                    .join(' · ')}
                </p>
              )}
              {seat.debuffPrimitive && (
                <p className="mt-3 rounded border border-blood/40 px-3 py-2 text-xs text-blood">
                  Civilización primitiva: el pueblo nota el atraso. La barra de época te lo está
                  cobrando.
                </p>
              )}
            </article>

            <article className="rounded-lg border border-gold/25 bg-ink-soft p-5">
              <p className="text-xs uppercase tracking-[0.22em] text-gold-soft">Los otros dioses</p>
              <ul className="mt-3 divide-y divide-gold/15">
                {rivals.map((rival) => (
                  <li
                    key={rival.id}
                    className="flex items-baseline justify-between gap-3 py-2 text-sm"
                  >
                    <div>
                      <p className="text-parchment">{rival.name}</p>
                      <p className="text-xs text-parchment-dim">
                        {rival.areaCard} · {rival.regions} regiones · {rival.temples} templos
                        {rival.vassalOf !== null && ' · vasallo'}
                      </p>
                    </div>
                    <span className="text-xs uppercase tracking-widest text-gold-soft">
                      Divinidad {divinityBand(rival.divinity)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-parchment-dim">
                Solo se publica lo que la mesa puede ver: ni Fe ni fidelidad ajena.
              </p>
            </article>
          </section>

          <section className="space-y-3">
            <h3 className="font-display text-xl text-parchment">
              {lastChronicle ? `Crónica del turno ${lastChronicle.turn}` : 'El mundo espera'}
            </h3>
            <div className="space-y-4 rounded-lg border border-gold/25 bg-ink-soft p-5">
              <p className="whitespace-pre-line text-sm leading-relaxed text-parchment">
                {lastChronicle?.publicText ??
                  'Nadie ha escrito todavía la primera página. Tu pueblo mira al cielo y espera una señal: elige tus compases y cierra el turno.'}
              </p>
              {lastChronicle?.privateText && (
                <div className="border-t border-gold/20 pt-3">
                  <p className="text-xs uppercase tracking-widest text-gold-soft">Solo para ti</p>
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-parchment-dim">
                    {lastChronicle.privateText}
                  </p>
                </div>
              )}
            </div>
          </section>

          <TurnPlanner
            code={code}
            options={actionOptions(state, seat.id)}
            problem={problemView(state, seat)}
            fe={seat.fe}
            cap={capFe(seat)}
            windowLabel={WINDOWS[state.windowId].label}
            turn={state.turn}
            disabled={mode === 'review'}
          />
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-widest text-gold-soft">{label}</dt>
      <dd className="text-parchment">{value}</dd>
    </div>
  );
}

function GameHeader({
  state,
  code,
  turnLimit,
  finished,
}: {
  state: MatchState;
  code: string;
  turnLimit: number;
  finished: boolean;
}) {
  const era = ERAS_BY_ID[state.era];
  const progress = Math.round(eraProgress(state) * 100);
  const turn = Math.min(state.turn, turnLimit);

  return (
    <header className="space-y-3 border-b border-gold/25 pb-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-gold-soft">
            Mesa {code} · modo «La peor carta»
          </p>
          <h2 className="mt-1 font-display text-3xl text-parchment">
            Turno {turn} <span className="text-parchment-dim">de {turnLimit}</span>
          </h2>
        </div>
        <div className="text-right text-xs text-parchment-dim">
          <p>
            {era.name} · {substageName(state.era, eraProgress(state))}
          </p>
          <p>
            Ventana {WINDOWS[state.windowId].label} · día de ficción {state.fictionDay}
          </p>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between text-xs text-parchment-dim">
          <span>Barra de época</span>
          <span>{finished ? 'cerrada' : `${progress} %`}</span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-line" role="presentation">
          <div
            className="h-full rounded-full bg-gold transition-[width]"
            style={{ width: `${Math.max(2, Math.min(100, progress))}%` }}
          />
        </div>
      </div>
    </header>
  );
}
