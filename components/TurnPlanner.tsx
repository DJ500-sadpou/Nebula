'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionOptionView } from '@/lib/match/solo';
import type { ProblemView } from '@/lib/engine/problems';

interface TurnPlannerProps {
  code: string;
  options: ActionOptionView[];
  problem: ProblemView;
  fe: number;
  cap: number;
  windowLabel: string;
  /** Turno que el jugador está viendo; el servidor rechaza un envío repetido. */
  turn: number;
  /** La vista de revisión no envía nada: no hay partida detrás. */
  disabled?: boolean;
}

interface PlanItem {
  beat: number;
  channel: string;
  action: string;
}

const CHANNELS = [
  { id: 'milagro', label: 'Milagro' },
  { id: 'obra', label: 'Obra' },
  { id: 'heroe', label: 'Héroe' },
  { id: 'palabra', label: 'Palabra' },
] as const;

const BEATS = [0, 1, 2, 3, 4, 5, 6, 7];

/**
 * Planificador por compases (§5-A.3, §20). El jugador coloca acciones en la
 * línea de 8 casillas; los costes los calcula el servidor y aquí solo se
 * muestran. El plan viaja crudo al servidor, que lo sanea y lo vuelve a valorar.
 */
export function TurnPlanner({
  code,
  options,
  problem,
  fe,
  cap,
  windowLabel,
  turn,
  disabled = false,
}: TurnPlannerProps) {
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [choice, setChoice] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const costOf = (id: string) => options.find((option) => option.id === id)?.cost ?? 0;
  const beatsOf = (id: string) => options.find((option) => option.id === id)?.beats ?? 1;
  const nameOf = (id: string) => options.find((option) => option.id === id)?.name ?? id;

  const totalCost =
    plan.reduce((sum, item) => sum + costOf(item.action), 0) +
    (problem.options.find((option) => option.id === choice)?.cost ?? 0);

  function addAction(actionId: string, channel: string) {
    setError(null);
    const beats = beatsOf(actionId);
    const taken = new Set(plan.filter((item) => item.channel === channel).map((item) => item.beat));
    for (let beat = 0; beat + beats <= BEATS.length; beat += 1) {
      const free = Array.from({ length: beats }, (_, i) => beat + i).every((b) => !taken.has(b));
      if (free) {
        setPlan([...plan, { beat, channel, action: actionId }]);
        return;
      }
    }
    setError('Ese canal no tiene hueco para una acción de esa duración.');
  }

  function removeAt(beat: number, channel: string) {
    setPlan(
      plan.filter((item) => {
        if (item.channel !== channel) return true;
        const span = beatsOf(item.action);
        return !(beat >= item.beat && beat < item.beat + span);
      }),
    );
  }

  function itemAt(beat: number, channel: string): PlanItem | undefined {
    return plan.find(
      (item) => item.channel === channel && beat >= item.beat && beat < item.beat + beatsOf(item.action),
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/match/${code}/turn`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan, problemOption: choice || undefined, turn }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        if (payload.error === 'stale' || payload.error === 'busy') {
          setError('Ese turno ya se cerró en otra pestaña. Actualizando el estado…');
          router.refresh();
          return;
        }
        setError(`No se pudo cerrar el turno (${payload.error ?? response.status}).`);
        return;
      }
      setPlan([]);
      setChoice('');
      router.refresh();
    } catch {
      setError('No se pudo contactar con el servidor.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-gold/25 bg-ink-soft p-5">
        <p className="text-xs uppercase tracking-[0.22em] text-gold-soft">Situación · {problem.title}</p>
        <p className="mt-2 text-sm text-parchment-dim">{problem.text}</p>
        <ul className="mt-4 space-y-2">
          <li>
            <label className="flex cursor-pointer items-start gap-3 rounded border border-transparent px-2 py-1.5 text-sm hover:border-gold/20">
              <input
                type="radio"
                name="problema"
                className="mt-1 accent-[#d4af37]"
                checked={choice === ''}
                onChange={() => setChoice('')}
              />
              <span>
                <span className="text-parchment">Dejar que el pueblo decida</span>{' '}
                <span className="text-parchment-dim">· sin coste ni efecto</span>
              </span>
            </label>
          </li>
          {problem.options.map((option) => (
            <li key={option.id}>
              <label
                className={`flex cursor-pointer items-start gap-3 rounded border px-2 py-1.5 text-sm ${
                  option.affordable
                    ? 'border-transparent hover:border-gold/20'
                    : 'border-transparent opacity-50'
                }`}
              >
                <input
                  type="radio"
                  name="problema"
                  className="mt-1 accent-[#d4af37]"
                  checked={choice === option.id}
                  disabled={!option.affordable}
                  onChange={() => setChoice(option.id)}
                />
                <span>
                  <span className="text-parchment">{option.label}</span>{' '}
                  <span className="text-gold">{option.cost > 0 ? `${option.cost} Fe` : 'gratis'}</span>
                  <span className="mt-0.5 block text-xs text-parchment-dim">{option.detail}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-xl text-parchment">Planifica la ventana</h3>
          <span className="text-xs text-parchment-dim">Ventana actual: {windowLabel}</span>
        </div>

        <div className="overflow-x-auto rounded-lg border border-gold/25 bg-ink-soft">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gold/20 text-[0.65rem] uppercase tracking-widest text-gold-soft">
                <th className="px-3 py-2 text-left font-normal">Compás</th>
                {CHANNELS.map((channel) => (
                  <th key={channel.id} className="px-2 py-2 text-left font-normal">
                    {channel.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {BEATS.map((beat) => (
                <tr key={beat} className="border-b border-gold/10 last:border-0">
                  <th className="px-3 py-1.5 text-left font-normal text-parchment-dim">{beat + 1}</th>
                  {CHANNELS.map((channel) => {
                    const item = itemAt(beat, channel.id);
                    return (
                      <td key={channel.id} className="px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => item && removeAt(beat, channel.id)}
                          aria-label={
                            item
                              ? `Quitar ${nameOf(item.action)} del compás ${beat + 1}`
                              : `Compás ${beat + 1}, canal ${channel.label}, libre`
                          }
                          className={`w-full rounded border px-2 py-1 text-left text-xs transition-colors ${
                            item
                              ? 'border-gold/50 bg-gold/10 text-parchment hover:border-blood'
                              : 'border-gold/15 text-parchment-dim/50'
                          }`}
                        >
                          {item ? nameOf(item.action) : '·'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-3">
          {CHANNELS.map((channel) => {
            const list = options.filter((option) => option.channel === channel.id);
            if (list.length === 0) return null;
            return (
              <div key={channel.id}>
                <p className="text-[0.65rem] uppercase tracking-widest text-gold-soft">
                  {channel.label}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {list.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      disabled={!option.affordable}
                      onClick={() => addAction(option.id, option.channel)}
                      className="rounded border border-gold/30 px-3 py-1.5 text-xs text-parchment transition-colors hover:border-gold hover:text-gold disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {option.name} · {option.cost} Fe
                      {option.beats > 1 && (
                        <span className="ml-1 text-parchment-dim">({option.beats} compases)</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-4 border-t border-gold/20 pt-4">
        <div className="text-sm">
          <p className="text-parchment">
            Coste del turno: <span className="text-gold">{totalCost} Fe</span>
          </p>
          <p className="text-xs text-parchment-dim">
            Tienes {fe} de {cap} de Fe. El servidor vuelve a validar cada acción y cada coste.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {plan.length > 0 && (
            <button
              type="button"
              onClick={() => setPlan([])}
              className="cursor-pointer text-xs text-parchment-dim underline-offset-4 hover:text-gold hover:underline"
            >
              Vaciar plan
            </button>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={busy || disabled}
            className="cursor-pointer rounded border border-gold bg-gold px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-parchment disabled:cursor-wait disabled:opacity-60"
          >
            {disabled ? 'Vista de revisión' : busy ? 'El mundo gira…' : 'Cerrar el turno'}
          </button>
        </div>
      </section>

      {error && (
        <p className="rounded border border-blood/40 bg-ink-soft px-4 py-3 text-sm text-blood">{error}</p>
      )}
    </div>
  );
}
