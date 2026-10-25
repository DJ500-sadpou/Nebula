import { Register } from '../engine/types';

/**
 * Plantillas de crónica (§17.3 de REGLAS.md).
 *
 * Deterministas, sin red y sin LLM: la partida nunca depende de una API. Los
 * slots se rellenan con el resultado estructurado del turno. El catálogo
 * completo son 150 plantillas (Fase 5); estas 45 cubren las tres voces fijas de
 * §20 —el Sistema, Aldin y el Sumo Sacerdote— en las tres escalas narrativas.
 *
 * Regla: una plantilla nunca incluye datos privados de otro asiento. Lo privado
 * se escribe en la crónica privada, que solo lee su dueño.
 */

export type SlotContext = Record<string, string | number>;

/** Aperturas por registro (§5-A.7): escena, crisis o era. */
export const OPENERS: Record<Register, string[]> = {
  escena: [
    'El día {day} del año {year}. En {seat} nadie duerme bien.',
    'Amanece sobre {seat} con el cielo limpio y los altares todavía tibios.',
    'Tres horas de mercado, y en cada puesto se susurra tu nombre.',
    'La lluvia llega tarde a {seat}. El pueblo lo toma como respuesta.',
    'Un niño deja una ofrenda en el umbral y sale corriendo.',
  ],
  crisis: [
    'El mes {month} deja a {seat} con la respiración contenida.',
    'Treinta días de rumores, y ni una sola certeza en {seat}.',
    'Los consejeros se reúnen a puerta cerrada en {seat}.',
    'La cosecha se decide esta semana, y con ella el año entero.',
    'En {seat} se cuentan los días por los tambores del templo.',
  ],
  era: [
    'El mundo cruza un nuevo umbral. En {seat}, {era} ya no basta como respuesta.',
    'Diez años caben en una página de archivo, y esta es de {seat}.',
    'Los cronistas de {seat} fechan este capítulo con piedra y ceniza.',
    'La generación que nació bajo tu culto ya gobierna en {seat}.',
    'El tiempo se mide en dinastías: {seat} acaba de empezar la suya.',
  ],
};

/** Cierres por era: el mundo cambia de tono. */
export const CLOSERS: Record<string, string[]> = {
  tribal: [
    'Los tambores callan. Mañana habrá que decidir otra vez.',
    'El humo del sacrificio sube recto: alguien ha escuchado.',
    'La tribu duerme junto al fuego, y el fuego no responde.',
    'Los ancianos guardan silencio. Es su manera de aprobar.',
  ],
  reinos: [
    'Los escribas anotan la jornada. La historia, por ahora, te pertenece.',
    'Las campanas marcan el final del ciclo. Nadie se atreve a celebrar.',
    'Las murallas aguantan. Eso, en esta era, ya es una victoria.',
    'El reino respira. Los mercaderes vuelven a las rutas.',
  ],
  modernidad: [
    'Los periódicos de la capital titulan con tu nombre. Mañana lo usarán para envolver pescado.',
    'La ciudad enciende sus luces y olvida, por una noche, la pregunta importante.',
    'El telégrafo lleva la noticia más lejos de lo que alcanza tu voz.',
    'El siglo avanza. El que no se adapte será una nota a pie de página.',
  ],
};

/** Aldin, el árbitro: aparece en los momentos que importan. */
export const ALDIN: string[] = [
  'Aldin: «El sistema observa, y no le impresiona la prisa».',
  'Aldin: «Cada milagro es una deuda. Cada deuda tiene su siglo».',
  'Aldin: «Nadie te pidió que fueras justo. Se te pidió que fueras interesante».',
  'Aldin: «Los dioses que sobreviven aprenden a esperar. Tú, de momento, aprendes».',
  'Aldin: «No confundas ser recordado con ser creído».',
  'Aldin: «El mundo no se rompe por tus errores. Se acomoda a ellos».',
];

/** El Sistema: voz neutra, monoespaciada, sin adornos. */
export const SYSTEM: string[] = [
  'Sistema: turno {turn} cerrado. Día de ficción {day}. Ventana {window}.',
  'Sistema: registro actualizado. Era {era}, barra {bar} %.',
  'Sistema: recaudación liquidada. Fe disponible {fe}.',
  'Sistema: {believers} fieles contabilizados en {seat}.',
  'Sistema: los hitos globales se comprueban al cierre. No hay apelación.',
  'Sistema: ninguna intervención directa detectada sobre no creyentes este ciclo.',
];

/** Crónica privada: el Sumo Sacerdote habla en primera persona. */
export const PRIVATE: string[] = [
  'Sumo Sacerdote: «Mi señor, el pueblo ha cumplido. Tenemos {fe} de Fe en las arcas».',
  'Sumo Sacerdote: «{believers} fieles te nombran cada mañana. No todos con la misma fe».',
  'Sumo Sacerdote: «La fidelidad se sostiene en {fidelity}. No preguntéis cómo lo sé».',
  'Sumo Sacerdote: «Los templos de {seat} siguen en pie. Los tuyos, quiero decir».',
  'Sumo Sacerdote: «Alguien ha preguntado por qué no respondisteis. Le he dicho que sí lo hicisteis».',
  'Sumo Sacerdote: «Divinidad {divinity}. El pueblo empieza a notar la diferencia».',
];

export const TEMPLATE_COUNT =
  Object.values(OPENERS).reduce((sum, list) => sum + list.length, 0) +
  Object.values(CLOSERS).reduce((sum, list) => sum + list.length, 0) +
  ALDIN.length +
  SYSTEM.length +
  PRIVATE.length;

/** Rellena los slots; falla si queda alguno sin sustituir. */
export function fillTemplate(template: string, context: SlotContext): string {
  const text = template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = context[key];
    return value === undefined ? whole : String(value);
  });
  const leftover = text.match(/\{(\w+)\}/);
  if (leftover) throw new Error(`Slot sin rellenar en plantilla: ${leftover[0]}`);
  return text;
}
