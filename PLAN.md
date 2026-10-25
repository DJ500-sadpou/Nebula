# PLAN — "El Mundo Perdido": juego web de texto, por turnos, multijugador

Documento de construcción. Acompaña a [`REGLAS.md`](REGLAS.md), que es la especificación jugable.

---

## 0. Resumen ejecutivo

**Qué se construye.** Una app web (Next.js) donde 4–32 personas encarnan dioses en una partida
por turnos, con interfaz de texto y opciones, sin sprites. Los asientos que no ocupan humanos los
cubren bots o "dioses dormidos" que generan eventos, de modo que una mesa de 4 personas se siente
como una de 32.

**Stack.** Next.js en **Vercel Hobby** + **Supabase Free** (Postgres, Auth, Realtime). Neon y Firebase
quedan como apoyo opcional, no en el camino crítico (§2.3).

**Veredicto de tarjeta.** Ninguno de los cuatro exige método de pago para su plan gratuito. Hay tres
condiciones que sí importan: Vercel Hobby prohíbe uso comercial, Supabase pausa proyectos con 7 días
de poca actividad, y Firebase Spark no puede ejecutar código de servidor (por eso no es el backend).

**Esfuerzo.** 9 fases, ~27–36 días de trabajo efectivo. La primera versión jugable de una sola persona
contra bots llega al final de la Fase 3 (~8–12 días). El sistema de ventanas variables (§5-A de
`REGLAS.md`) añade ~3 días: un peldaño de complejidad en el motor y otro en el planificador.

**Perfil de uso (dato del autor).** Proyecto **personal y no comercial**: menos de 150 partidas en toda
la vida del juego, **máximo 10 jugadores**, una convocatoria cada ~3 meses y mesas habituales de 2–3
personas. Esto no cambia la arquitectura, pero sí tres cosas: el plan Hobby de Vercel encaja sin
letra pequeña, la cuota gratuita deja de ser un riesgo y **el único problema operativo real pasa a ser
la pausa por inactividad de Supabase** (ver §5). También fija la mesa por defecto en **8 asientos
(2–3 humanos + 5–6 IA)**: 32 sigue siendo el techo fiel a la novela, no la mesa normal.

---

## 1. Contexto reunido

Leídos: arcos 1, 2, 3, 4, 5 y 7, la línea de tiempo y `Teoria_del_Juego_y_Guia_de_Roleo.md`.
**Falta el Arco 06** (no se entregó); no bloquea: su tramo cae dentro de la guerra total del Arco 4,
que sí está cubierto.

### 1.1 La obra

*La Civilización Nebula* (novela web coreana, 332 capítulos, 2023–2025). Choi Sung-Woon, jugador nº1
de **"El Mundo Perdido"**, un god game de acceso anticipado de 32 jugadores, acepta el "lanzamiento
oficial" y descubre que era la fase de selección de un sistema divino real. La novela cubre más de
tres siglos: de treinta hombres lagarto desterrados a un imperio multi-especie con carrera espacial.

### 1.2 El juego original (según la obra)

- **32 dioses**, cada uno con un **Área Pequeña** al azar (32 cartas; *Insectos* es la peor), un
  **Dominio Único** que se activa a Divinidad 3, y una especie/tribu inicial de 30–50 individuos.
- **Fe** como moneda (fieles, templos y oraciones), **XP** que sube **Divinidad 1–11** y
  amplía el tope de Fe; **Esencias** de Abominaciones para crear criaturas.
- **Guía indirecta**: milagros, bendiciones hereditarias (10 Fe/creyente), creaciones, elegidos,
  trance, encarnación, hierofanía, apóstoles, profecías, Más Allá.
- **Causalidad** como impuesto: usar el mundo contra sí mismo es barato; decirle a alguien qué hacer
  cuesta 100 Fe (1.000 si no es creyente).
- **Información imperfecta**: los rivales no ven tu Fe ni el coste de tus milagros.
- **Choque de civilizaciones** al contactar: anuncia rivales y reparte XP a ambos.
- **Victoria** por vasallaje total; condición oculta de alianza que invalida la victoria si no se
  cumplió una misión secreta.
- **Aldin**, el árbitro con agenda propia, que puede declarar el fin del juego.

### 1.3 Qué copiamos, qué interpretamos, qué dejamos fuera

| Fidelidad | Elemento |
|---|---|
| **Copia literal** | Fe/XP/Divinidad, Áreas, Milagros/Bendiciones/Creaciones, causalidad, información imperfecta, choque de civilizaciones, vasallaje, profecías, crónica narrada, Aldin y el Sistema como voces |
| **Interpretación** | 32 asientos → 4–32 con bots y dioses dormidos; tiempo real de siglos → 8 compases por turno con ventana variable (1 día a 3 años); DM humano → motor determinista; dados d20 del manual de rol → RNG con semilla |
| **Fuera de v1** | Modelado 3D del "Asistente de Creación", sprites, muerte divina permanente, chat de voz, ranking mensual global |
| **Diseño propio** | El catálogo de 32 Áreas no está enumerado en los documentos: se diseña una baraja coherente (Fase 5) |

---

## 2. Servicios gratuitos: verificación (sin método de pago)

### 2.1 Tabla de hechos

| Servicio | ¿Tarjeta? | Límites del plan gratuito | ¿Sirve de backend? |
|---|---|---|---|
| **Vercel Hobby** | No para Hobby (solo al pasar a Pro) | 100 GB de transferencia/mes, 10 GB de origen, funciones de hasta **300 s**, WebSockets disponibles con Fluid compute, cron **1/día** (±59 min). **Uso comercial prohibido** | Sí: frontend + API routes |
| **Supabase Free** | No (solo en planes de pago) | 500 MB de base de datos, 5 GB de egress, **200 conexiones Realtime** y **2 M mensajes/mes**, 500 k invocaciones de Edge Functions, 50 k MAU. **Se pausa con 7 días de poca actividad** | Sí: Postgres + Auth + Realtime |
| **Neon Free** | **No, explícito** | 1 GB por proyecto, 100 CU-horas/mes, autosuspensión a los **5 min**, 10 ramas, 100 proyectos | Sí como Postgres, pero **sin Realtime** y con arranque en frío |
| **Firebase Spark** | **No, explícito** | Firestore 50 k lecturas / 20 k escrituras al día, 1 GiB; RTDB 100 conexiones, 1 GB, 10 GB/mes; Hosting 10 GB. **Sin Cloud Functions ni Cloud Run sin Blaze** | **No**: no puede ejecutar lógica de servidor |

Fuentes: [Supabase pricing](https://supabase.com/pricing), [pausing](https://supabase.com/docs/guides/platform/free-project-pausing),
[Neon plans](https://neon.com/docs/introduction/plans), [Vercel Hobby](https://vercel.com/docs/plans/hobby),
[Vercel functions](https://vercel.com/docs/functions/limitations), [Vercel WebSockets](https://vercel.com/docs/functions/websockets),
[Firebase pricing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans),
[Firestore quotas](https://firebase.google.com/docs/firestore/quotas).

### 2.2 Las tres letras pequeñas que sí afectan al proyecto

1. **Vercel Hobby no es comercial.** *No aplica en tu caso:* Hobby está pensado exactamente para
   proyectos personales sin ánimo de lucro. Solo hay que evitar donaciones, anuncios o cobro de
   entradas; si algún día aparecen, se mueve el hosting sin reescribir el motor.
2. **Supabase pausa a los 7 días sin actividad.** Un cron diario de Vercel (`/api/health`) que hace
   una consulta trivial lo mantiene despierto. Está dentro del límite de 1 cron/día. Aun así, la
   primera petición tras una pausa falla: la UI debe reintentar y mostrar "despertando servidor".
3. **El SMTP integrado de Supabase tiene un límite muy bajo de correos por hora.** Con login por
   *magic link* la partida falla el día del lanzamiento. Mitigación: **email + contraseña con
   confirmación desactivada**, más *login anónimo* para entrar a jugar en 5 segundos, más Google
   OAuth opcional. Nada de magic links en v1.

### 2.3 Roles asignados y descartes

```
Navegador
   │  HTTPS + WebSocket (Supabase Realtime)
   ▼
Vercel Hobby ── Next.js App Router
   │            · UI (texto, opciones, crónica)
   │            · API routes = único punto de mutación
   │            · motor de reglas compartido con los bots
   ▼
Supabase Free
   · Postgres + RLS (verdad del juego)
   · Auth (email/password + anónimo)
   · Realtime (difusión de turno y crónica)
   · Storage (nada en v1; crónicas como texto en la BD)

Neon Free  ─── opcional: archivo histórico de partidas cerradas + analítica
Firebase   ─── opcional: solo notificaciones push (FCM), que sí funciona en Spark
```

- **Neon** no está en el camino crítico: su autosuspensión de 5 minutos añadiría latencia a cada
  turno. Se usa, si acaso, como archivo de partidas terminadas y panel de balance (leer, no jugar).
- **Firebase** queda descartado como backend por una razón dura, no de gusto: **Spark no despliega
  Cloud Functions**, así que toda la lógica viviría en el cliente y cualquiera podría editar su Fe
  desde la consola del navegador. En un juego competitivo con información oculta eso es inviable.
  Se reserva para FCM (recordatorio de "es tu turno"), que es gratis sin facturación.

### 2.4 Modo de trabajo: nube primero, local después

El desarrollo ocurre en un entorno en la nube sin navegador ni credenciales. Todo lo que es código,
esquema SQL, pruebas que no tocan la red y revisión con el servidor de desarrollo se hace y se
verifica allí. Lo que exige una cuenta, una clave o una publicación se hace en tu equipo y queda
anotado en [`PENDIENTES.md`](PENDIENTES.md) con un ID.

| Se hace y se verifica en la nube | Requiere tu equipo (`PENDIENTES.md`) |
|---|---|
| Motor puro, bots, simulación y golden tests | Crear el proyecto de Supabase y sus claves (**P-01**) |
| Migraciones SQL, políticas RLS y auditoría estática | Aplicar las migraciones contra la base real (**P-02**) |
| UI de texto, rutas de API, build y servidor de desarrollo | Test de dos cuentas con usuarios reales (**P-03**) |
| Arranque sin configuración (modo revisión) | Ajustes de Auth y prueba manual en navegador (**P-04**, **P-05**) |
| | Despliegue en Vercel y cron anti-pausa (**P-06**, **P-08**) |
| | Tipos generados de la base (**P-07**) |

Tres reglas que se derivan de esto:

1. **La app arranca sin claves.** Ninguna página puede romperse por falta de configuración: muestra el
   estado y los pasos, nunca una traza.
2. **Ninguna clave entra en el repositorio, en el chat ni en el cliente.** `.env.local` no se versiona;
   `service_role` solo se lee en scripts y rutas de servidor.
3. **Un pendiente no se disimula.** Si algo no se pudo comprobar, se marca como pendiente con su ID en
   lugar de darlo por bueno. Por eso la Fase 1 se divide en **1A** (nube, cerrada) y **1B** (tu equipo,
   abierta).

---

## 3. Arquitectura

### 3.1 Principio rector: **el motor es una función pura**

```
lib/engine/   (TypeScript puro, sin red, sin BD, sin Date.now)
   state + orders + seed  →  { events, nextState }
```

- Se ejecuta en el servidor (API route) y en los tests, con el mismo código.
- Los bots son *clientes* del motor: reciben estado público, devuelven órdenes legales.
- El cliente **nunca** calcula costes ni resultados: recibe opciones ya valoradas por el servidor.

Esto da tres cosas gratis: tests deterministas, bots sin trampas y un modo "replay" de una partida
desde su semilla.

### 3.2 Flujo de un turno

```
Jugador A ─┐
Jugador B ─┤  POST /api/match/:id/order   (orden privada, RLS)
Jugador C ─┘            │
                        ▼
              matches.turn_phase = 'resolving'   ← claim atómico
                        │
                        ▼
              engine.resolve(state, orders, seed)
                        │
                        ├─ insert turn_resolutions (idempotente)
                        ├─ insert turn_events (público / por asiento)
                        └─ Realtime broadcast → todos los clientes
```

- **Claim atómico:** `UPDATE matches SET resolving = true WHERE id = $1 AND resolving = false
  RETURNING *`. Quien gane la carrera resuelve; los demás reciben el resultado ya guardado.
  No hace falta cron ni servidor permanente.
- **Disparador:** el cliente que marca "listo" o el que consulta estado cuando el temporizador
  expiró. Si nadie está conectado, el turno se resuelve en la siguiente visita (con el tiempo
  ya vencido). La partida es reanudable por diseño.
- **Idempotencia:** clave primaria `(match_id, turn)`. Reintentos y dobles clics no duplican turnos.

### 3.3 Por qué no otras opciones

| Alternativa | Por qué no |
|---|---|
| Todo en Firebase (Firestore + rules) | Sin Functions, la lógica de resolución vive en el cliente: trampas triviales y RNG manipulable |
| Todo en Vercel | No hay base de datos ni realtime gratis incluidos; habría que añadir un tercero igualmente |
| Todo en Neon | Sin Auth ni Realtime; habría que construir ambos y el arranque en frío castiga cada turno |
| Supabase Edge Functions | Válido (500 k invocaciones), pero duplica el runtime y complica compartir el motor con los tests. Se deja como plan B si Vercel Hobby se queda corto |

---

## 4. Modelo de datos (Supabase / Postgres)

```sql
-- Identidad
profiles        (id uuid pk → auth.users, nick, created_at)

-- Partida
matches         (id uuid pk, code text unique [A-Z0-9]{6}, status, seed bigint, turn int,
                 phase text, resolving bool default false, turn_ends_at timestamptz,
                 config jsonb, winner_seat int null, created_at, closed_at,
                 -- escala temporal (§5-A)
                 window_id text default '1d', windows_unlocked text[] default '{1d}',
                 unlock_every int default 5, fiction_day int default 0, horizon_years int default 30,
                 era text default 'tribal',            -- tribal | reinos | modernidad (§5-B.2)
                 era_progress numeric default 0,       -- barra 0..1 (promedio/12), pública
                 era_advanced_turn int,
                 window_override jsonb)                 -- {window:'1d', until_fiction_day, reason:'clash'}

-- 4..32 asientos. La clave es (match_id, seat_idx): los demás enlaces del modelo
-- (winner_seat, vassal_of, at_war_with) ya son enteros. Único humano por mesa.
seats           (match_id → matches, seat_idx int 0..31, kind text, -- human|bot|dormant|empty
                 user_id uuid null → profiles, name, area_card, domain_card,
                 species, awakened bool,
                 PRIMARY KEY (match_id, seat_idx), UNIQUE (match_id, user_id))

-- Estado privado (Fe, fidelidad, XP exactos): nunca legible por rivales
seat_state      (match_id, seat_idx → seats, fe int, xp int, divinity int, fidelity numeric,
                 fame int, magic int, essence int, relics int, believers int,
                 techs text[],            -- tecnologías concretas, 12 por era (§5-B.1)
                 culture text[],          -- hitos culturales, 12 por era (§5-B.1)
                 debuff_primitive bool,   -- etapa por debajo de la del mundo (§5-B.4)
                 research_pct int default 100,
                 buffs jsonb default '[]',  -- máx. 2 (§10-A)
                 PRIMARY KEY (match_id, seat_idx))

-- Estado público (lo que el mundo ve)
seat_public     (match_id, seat_idx → seats, regions int, divinity_band text,
                 temples int, vassal_of int null, at_war_with int[],
                 PRIMARY KEY (match_id, seat_idx))

-- Órdenes secretas: planificación por compases. Inmutables una vez enviadas.
orders          (match_id, seat_idx → seats, turn, payload jsonb, submitted_at,
                 PRIMARY KEY (match_id, seat_idx, turn))
-- payload = { window:'3y', schedule:[{ beat:0..7, channel:'milagro|obra|heroe|palabra',
--                                     actionId, params }] }

-- Votación de ventana (§5-A.2). Votos secretos hasta cerrar la papeleta.
turn_proposals  (id uuid, match_id, turn, proposer_seat, window_id,
                 status text, -- open|passed|rejected|tie|quorum_failed
                 opens_at, closes_at, UNIQUE (match_id, turn))
turn_votes      (match_id, proposal_id → turn_proposals, seat_idx, choice text,
                 PRIMARY KEY (proposal_id, seat_idx))

-- Guerra: recorta las ventanas permitidas (§5-A.11)
wars            (id, match_id, attacker_seat, defender_seat, era text,
                 started_turn int, ended_turn int null, result text)

-- Alianzas e intercambio cultural (§5-B.6)
pacts           (id, match_id, seat_a, seat_b, kind text,  -- cultural|rezagados|defensivo
                 started_turn int, ended_turn int null)
missions        (id, match_id, seat_idx, kind, target_era, deadline_turn, status text)

-- Hitos globales: únicos por partida (§10-A)
milestones      (match_id, key, claimed_by_seat, claimed_turn int,
                 PRIMARY KEY (match_id, key))

-- Resultado
turn_resolutions(match_id, turn, digest text, payload jsonb, PRIMARY KEY (match_id, turn))
turn_events     (id bigserial, match_id, turn, visibility text, -- public|seat|pair
                 seat_idx int null, pair_seat int null,
                 kind text, payload jsonb, text text)
chronicle       (match_id, turn, public_text text, private jsonb,
                 PRIMARY KEY (match_id, turn))  -- private: {seatIdx: text}; no se sirve nunca

-- Social
whispers        (id, match_id, turn, from_seat, to_seat, body, created_at)
```

### 4.1 RLS: la pieza que no se puede fallar

| Tabla | Política |
|---|---|
| `matches` | Lectura: participantes. Escritura: solo `service_role` |
| `seats` | Lectura: participantes. **Escritura: solo `service_role`**; reclamar un asiento pasa por la API, así el jugador no puede colocarse en otro |
| `seat_state` | **Solo `service_role`**. Ni el dueño lee directamente: recibe un `view` calculado por la API |
| `seat_public` | Lectura: participantes |
| `orders` | Insert/select: solo `auth.uid()` = dueño del asiento y solo en fase `orders`. Sin update |
| `turn_events` | `visibility='public'` a todos; `'seat'` solo a su asiento; `'pair'` a los dos |
| `whispers` | Solo emisor y receptor |
| `chronicle` | Sin políticas: la tabla no se lee nunca. Lo público se sirve con la vista `chronicle_public`, filtrada por pertenencia; `private` solo por API |

> Regla de oro: **toda mutación pasa por una API route con `service_role`** que valida la orden contra
> el motor. El cliente solo puede insertar su orden cruda, nunca resultados ni Fe.

**Test obligatorio de la Fase 1:** dos cuentas reales, A intenta leer `seat_state` de B por REST y por
Realtime → debe devolver 0 filas. Se repite en cada fase.

### 4.2 Retención (por los 500 MB)

- Con tu volumen real la retención **no es necesaria**: 150 partidas × ~1,4 MB ≈ **210 MB**, dentro
  de los 500 MB para siempre. Se deja implementada (partidas `closed` de más de 30 días → solo
  resumen) únicamente por si algún día se abre al público.
- Una partida de 10 asientos × ~37 turnos ≈ **1,4 MB**; de 32 asientos ≈ 4 MB.

---

## 5. Presupuesto de free tier

Cálculo para tu perfil: **≤150 partidas en total, ≤10 asientos (habitual 2–3 humanos + IA), ~4
partidas al año**. Partida de referencia: 10 asientos, ~37 turnos, 8 compases.

| Consumo | Por partida | Tu uso previsto | Límite gratis | Margen |
|---|---|---|---|---|
| Filas escritas | ~2.800 | — | — | — |
| Datos en BD | ~1,4 MB | 210 MB acumulados para siempre | 500 MB | ~2,4× |
| Egress | ~7 MB | ~2,5 MB/mes | 5 GB/mes | >1.000× |
| Mensajes Realtime | ~180 | ~60/mes | 2 M/mes | >10.000× |
| Conexiones Realtime | 3 | 3 | 200 | 66× |
| Invocaciones de API | ~4.800 | ~400/mes | — | irrelevante |

**Conclusión: la cuota gratuita no es un factor.** Ni acercándose al techo de 150 partidas de 10
jugadores se llega al 25 % de la base de datos, y el resto de límites se usan a menos del 0,1 %.
No hace falta *polling* ni plan B por capacidad; Realtime se puede usar siempre.

**El único riesgo real es el inverso: el proyecto estará inactivo casi todo el año.** Con una partida
cada tres meses, Supabase lo pausaría a los 7 días y la primera visita fallaría. Por eso el cron diario
deja de ser un detalle y pasa a ser **infraestructura obligatoria**:

```
Vercel cron (1/día, límite Hobby)  →  GET /api/health  →  select 1 from matches limit 1
```

Si el cron se cae, el juego no arranca hasta restaurar el proyecto a mano desde el panel de Supabase.
Se documenta en el README como paso de recuperación y la UI muestra "servidor despertando" con
reintento, para que el fallo sea comprensible y no parezca un juego roto.

---

## 6. Fases

Cada fase termina con un criterio de aceptación verificable. No se pasa a la siguiente sin él.

### Fase 0 — Especificación y simulación · 1–2 días · ✅ completada
**Objetivo:** congelar las reglas y comprobar que los números producen partidas interesantes.
- `REGLAS.md` v0.1 (ya escrito) → v1.0 tras la simulación.
- Simulador headless: motor mínimo + 8 bots, 500 partidas, salida en CSV.
- Ajustar solo costes/ingresos hasta cumplir las métricas de `REGLAS.md` §18.
- **Aceptación:** curvas estables, ~37 ± 6 turnos con `unlockEvery: 5`, sin "runaway" en más del
  15 % y **ninguna ventana elegida en más del 55 % de los turnos** (si una domina, el balance de §5-A.6
  está roto).
- **Riesgo:** sobreajustar a los bots. Mitigación: 3 personalidades distintas en la simulación.

**Entregado:**

| Qué | Dónde |
|---|---|
| Motor puro (tipos, PRNG, economía, IC, pasivas de área, contenido, resolución, huella) | `lib/engine/` |
| Política de bots con 3 personalidades y ahorro por compás | `lib/bots/policy.ts` |
| Simulador y métricas de §18 | `tools/simulate.ts` |
| 500 partidas, CSV y resumen | `artifacts/sim-fase0.csv`, `artifacts/sim-fase0-resumen.json` |
| 61 tests: unitarios, pureza del motor, golden de partidas completas | `tests/engine/` |

**Resultado:** las 15 métricas de §18 se cumplen; ver §18.1. Verificación: `npm run typecheck`,
`npm test` y `npm run sim -- 500 8 5`.

### Fase 1 — Esqueleto, datos y seguridad · 1–2 días · 1A ✅ / 1B ⏳

**1A — en la nube (✅ completado).** Lo que no necesita cuentas ni credenciales:

- Next.js **16.4.3** + React 19.3.1 + TypeScript estricto + Tailwind 4; `proxy.ts` (Next 16 sustituye
  `middleware.ts`) para refrescar la sesión en cada petición.
- Migraciones `supabase/migrations/`: las 16 tablas de §4, RLS de §4.1, perfil automático al registrarse
  y vista `chronicle_public`.
- Auth email/password + anónimo con Server Actions. El perfil de dios lo crea un trigger, no el cliente.
- UI mínima en español: portada, modo «sin configurar», acceso y lista de mesas leída con RLS.
- `GET /api/health` para el cron anti-pausa.
- **Verificación:** `npm run typecheck`, `npm test` (133 tests: 96 del motor + 37 de esquema, RLS y
  entorno, incluida la aplicación real de las migraciones en Postgres 17 en memoria), `npm run build`
  y servidor de desarrollo con `200` en `/` y `/login`, `503` en `/api/health` sin claves.

**1B — en tu equipo (⏳).** Crear el proyecto (**P-01**), aplicar las migraciones (**P-02**), ajustar
Auth (**P-04**), ejecutar el test de dos cuentas (**P-03**), probar dos sesiones a mano (**P-05**),
generar los tipos (**P-07**) y desplegar (**P-06**).

- **Aceptación (se cierra al terminar 1B):** dos cuentas reales no se ven `seat_state`; la sesión
  persiste al recargar y al cerrar la pestaña; el despliegue público responde y `/login` funciona.
- **Riesgo:** RLS mal escrita. Mitigación: auditoría estática en `npm test` + test de dos cuentas
  (P-03), además de la prueba manual.
- **Nota:** la baraja de 32 áreas **no** se siembra aquí: §6.1 solo documenta 8 y el catálogo completo
  pertenece a la Fase 5 (**P-09**). `seats.area_card` ya existe como texto.

### Fase 2 — Motor de reglas · 3–4 días · ✅ completada
- `lib/engine/`: tipos, PRNG con semilla, economía, acciones, **fase de compases** (ingreso liberado y
  plan con una acción por canal y compás) y resolución de los 13 pasos, época, victoria por vasallaje
  y cierre por horizonte.
- La **política de ventana** (`table`/`fixed`) vive en `MatchState`: una partida de ritmo fijo se
  reproduce igual al reanudarla, y cada ventana se puede simular por separado (§5-A.12).
- **96 tests del motor**: unitarios por módulo, tres partidas completas con huella fija y un *golden*
  por cada una de las 7 ventanas con la misma semilla y la misma mesa.
- **Aceptación (verificada):**
  - mismo seed + mismas órdenes ⇒ mismo `digest` byte a byte: 100 resoluciones del mismo turno y tres
    partidas completas reproducidas.
  - la fase de compases de un turno de `3y` ejecutada de una vez y como **8 sub-turnos de un compás**
    deja el mismo estado, y lo mismo en las siete ventanas.
  - la equivalencia se exige sobre los pasos 1–5 (§8), que son los que se reparten por compás: el
    crecimiento, el evento, la guerra y la época son por turno (§5-A.12, D48).
- **Verificación:** `npm test` (133 tests), `npm run typecheck`, `npm run build` y `npm run sim -- 500 8 5`
  con los mismos resultados de §18.1. El cambio de forma del estado no movió ninguna partida: los textos
  de evento de las tres semillas conservan su huella y los turnos, la era y el ganador son idénticos.
- **Nota:** las tres huellas de partida completa se regeneraron al añadir `windowPolicy` y `fixedWindow`
  a `MatchState`; la huella cubre el estado serializado, no solo la partida. Es un cambio de forma, no
  de reglas.
- **Riesgo:** acoplar el motor a Supabase. Mitigación: `tests/engine/purity.test.ts` falla si
  `lib/engine/` importa framework, BD, reloj o azar global.

### Fase 3 — Vertical slice de un jugador · 3–4 días · 3A ✅ / 3B ⏳

**3A — en la nube (✅ completado).** Lo que no necesita cuentas ni credenciales:

- Modo **«La peor carta»** (§19): 4 asientos (1 humano + 3 bots), 12 turnos, `unlockEvery: 3` y el
  humano con *Insectos*, la peor Área Pequeña.
- **Problema de era** (§15, paso 6 de §8): 6 problemas (2 por era) × 3 opciones con coste y efecto, y
  la elección viaja dentro de la orden. Sin elección no hay efecto, así que los bots no cambian y el
  equilibrio de la Fase 0 se conserva.
- **Crónica determinista** con 45 plantillas y las tres voces de §20 (Sistema, Aldin, Sumo Sacerdote),
  pública y privada por asiento.
- **Persistencia**: mapeo estado↔filas reversible (huella exacta) y migración
  `20261025100200_turn_flow.sql` con `create_solo_match`, `claim_turn`, `release_turn` y `apply_turn`
  idempotente (proyección absoluta; repetir no duplica eventos).
- **API**: `POST /api/match` y `POST /api/match/[code]/turn`, con comprobación de mismo origen y sesión
  verificada. Pantalla completa (ficha, rivales públicos, crónica, problema, planificador de 8
  compases y fin de partida) y **vista de revisión** en `/preview/turno`, que genera la partida con el
  motor y no escribe nada.
- **Verificación:** 155 tests (incluye el flujo SQL completo en Postgres 17 en memoria: crear mesa →
  claim → aplicar → repetir), `npm run typecheck`, `npm run build` y servidor con `/` y
  `/preview/turno` en `200` y `/api/health` en `503` sin claves.
- **Huecos documentados, no disimulados:** los bots no eligen problema de era hasta la Fase 6 (D51);
  la papeleta de ventana se simula con un votante hasta la Fase 4 (D50); el catálogo es de 6 problemas
  y 45 plantillas, el resto es contenido de Fase 5.

**3B — en tu equipo (⏳).** P-12: jugar los doce turnos en el navegador con Supabase configurado,
recargar en mitad de un turno y comprobar que dos clics simultáneos resuelven una sola vez.

- **Aceptación (se cierra al terminar 3B):** una partida entera de principio a fin sin tocar la base
  de datos a mano, y recargar la página en cualquier fase no rompe el estado.
- **Riesgo:** que el texto sea aburrido. Mitigación: 45 plantillas ya en esta fase, no al final.

### Fase 4 — Multijugador · 4–5 días
- Salas con código de 6 caracteres, hasta 32 asientos, relleno automático con bots al iniciar.
- Temporizadores, órdenes secretas, claim atómico, idempotencia, Realtime + *fallback* a polling.
- Reconexión, abandono → bot, expulsión del lobby, listo/no listo.
- **Votación de ventana:** proponer, papeleta con cierre, solo humanos, mayoría, empate = mantener,
  resultado aplicado al turno siguiente y publicado con la crónica.
- **Ventanas forzadas:** un choque de civilizaciones impone `1d` durante 2 turnos sin votación; una
  guerra recorta el techo (`7d` tribal, `30d` reinos, `3m` modernidad) y lo libera al firmar la paz.
- **Aceptación:** 4 pestañas con 4 cuentas juegan 6 turnos; ninguna ve la Fe ajena; pulsar "listo"
  simultáneamente resuelve **una sola vez**; una propuesta de `7d` se aprueba por 2 de 3 humanos y
  entra en el turno siguiente; si empata, se mantiene `1d`; declarada una guerra tribal, la papeleta
  **ya no ofrece `30d`**; un choque fuerza `1d` dos turnos y luego restaura; cerrar el navegador y
  volver retoma el turno.
- **Riesgo:** carrera en la resolución. Mitigación: `UPDATE ... WHERE resolving = false` + PK compuesta.

### Fase 5 — Contenido · 6–8 días
- 32 Áreas con 2 acciones cada una; 16 Dominios Únicos; 20 eventos d20; 12 problemas de era × 3 opciones;
  8 especies; 20 reliquias; **36 tecnologías y 36 hitos culturales** (12 de cada por era);
  **20 hitos globales** con sus buffs; 150 plantillas de crónica; 3 personalidades de bot.
- **Etiqueta temporal en todo:** cada acción, evento y problema lleva `minWindow` y compases (A.4).
  Las reactivas solo se ofrecen en ventanas ≤ `30d`; el contenido del antiguo salto de 9 años se
  re-etiqueta a `3y` o a hito de varios turnos.
- **Aceptación:** ninguna partida repite el mismo problema de era 3 veces; todas las áreas tienen al
  menos 2 acciones elegibles en un turno típico; revisión cruzada contra los arcos 1–7; con 2
  la barra de época llega al 100 % entre los turnos 10–16 (tribal) y 24–30 (reinos); una
  civilización atrasada en **dos dimensiones** sale del debuff con dos misiones de §5-B.5; y un hito
  global se otorga **una sola vez** aunque dos jugadores cumplan la condición en el mismo turno.
- **Riesgo:** inflación de contenido desbalanceado. Mitigación: la simulación de Fase 0 se re-ejecuta
  con el catálogo completo.

### Fase 6 — IA y sustitución · 3–4 días
- Bots de utilidad con 3 personalidades y 2 dificultades; dioses dormidos; despertar maligno;
  sustitución automática de humanos que abandonan.
- **Aceptación:** bot normal gana ≥ 35 % contra bot fácil; una partida de 32 asientos con 2 humanos
  avanza sola hasta el final sin intervención.
- **Riesgo:** bots que juegan todos igual. Mitigación: métricas por personalidad (territorio vs fieles
  vs profecías) deben diferir en ≥ 25 %.

### Fase 7 — Despliegue y límites gratuitos · 2 días
- Cron anti-pausa, política de retención, límite de partidas simultáneas, logs y alerta por email.
- Página de estado honesta ("servidor despertando") y reintentos con backoff.
- **Aceptación:** 7 días sin tráfico + cron ⇒ el proyecto Supabase sigue activo; partida de 32 asientos
  completada en producción; primera petición tras pausa se recupera sola.

### Fase 8 — Modos, pulido y lanzamiento · 4–5 días
- "Profecía Contradictoria" (duelo), "El falso dios" (deducción), "La Caída" (historia).
- Móvil, accesibilidad AA, compartir crónica como texto, tutorial de 3 turnos.
- **Aceptación:** una persona nueva completa el tutorial sin ayuda; la partida se juega entera en móvil.

**Total: ~27–36 días.** Orden pensado para que cada fase deje algo demostrable.

---

## 7. Estructura de carpetas

```
/
├─ app/
│  ├─ layout.tsx  globals.css    cabecera, pie y paleta
│  ├─ page.tsx                   portada / estado / lista de mesas (RLS)
│  ├─ login/                     acceso email, registro y sesión anónima
│  ├─ api/health/route.ts        anti-pausa (cron)
│  └─ match/[code]/page.tsx      mesa de juego            ← Fase 3
├─ components/                   piezas de UI compartidas (aviso de configuración)
├─ proxy.ts                      refresco de sesión (Next 16 sustituye middleware.ts)
├─ lib/
│  ├─ engine/                    puro, sin IO
│  │  ├─ types.ts  rng.ts  economy.ts  ic.ts  digest.ts
│  │  ├─ content.ts  resolve.ts  index.ts
│  │  └─ (victory.ts, narrator/ y bots de Fase 6 cuando toquen)
│  ├─ bots/                      política determinista de las 3 personalidades
│  └─ db/                        env.ts, server.ts, auth.ts, admin.ts (Fase 3)
├─ supabase/
│  ├─ config.toml                auth anónimo, confirmación desactivada
│  └─ migrations/                esquema + RLS + trigger de perfiles
├─ tests/
│  ├─ engine/                    unitarios + golden de partidas completas
│  ├─ db/                        entorno, auditoría de RLS y Postgres 17 en memoria
│  └─ rls/two-accounts.ts        test real de dos cuentas (P-03)
├─ tools/simulate.ts             simulación de Fase 0
├─ artifacts/                    resultados de la simulación
├─ REGLAS.md  PLAN.md  DECISIONES.md  PENDIENTES.md  README.md  AGENTS.md
```

---

## 8. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| La mesa real será de 2–3 humanos, no de 32 | Alto (diseño equivocado) | Mesa por defecto de **8 asientos** (2–3 humanos + 5–6 IA); 32 queda como modo "mundo completo". Los bots y dioses dormidos son el contenido, no un relleno |
| Supabase pausa el proyecto entre partidas | **Alto** (uso esporádico) | Cron diario obligatorio + reintento con "despertando servidor" + paso de restauración manual documentado |
| Vercel Hobby es no comercial | Ninguno | Uso personal sin ánimo de lucro: es el caso de uso previsto del plan |
| Fuga de información por RLS | **Crítico** (rompe el juego) | `seat_state` solo `service_role` + test de dos cuentas en CI |
| LLM gratuito con 20 req/día | Alto si se depende de él | Narración por plantillas por defecto; LLM opcional y con fallback |
| 500 MB de base de datos | Medio | Retención a 30 días + resumen de partidas cerradas |
| Turnos bloqueados por un jugador ausente | Alto | Temporizador + acción por defecto + sustitución por bot |
| Repetición narrativa | Medio | 150 plantillas + variación por seed; revisión en Fase 5 |
| La escalera de ventanas tarda 31 turnos en llegar a `3y` | Medio (campaña larga) | `unlockEvery` configurable (2–5); con 2 jugadores, 2–3; horizonte de ficción de 30 años |
| La ventana larga vuelve inútil la corta | Alto (rompe el balance) | Reactivas bloqueadas en `>30d` + deriva de fidelidad + puntuación normalizada por año de ficción |
| Fe desperdiciada al cerrar compases en ventanas largas | Medio | Aviso previo en el planificador y simulación de saldo por compás |
| Guerra eterna que congela el ritmo en `1d`/`7d` | Medio | Desgaste de guerra y paz forzada tras N turnos sin avance; el techo se libera al firmar la paz |
| La barra de época se estanca y el mundo no cambia de etapa | Alto | Los bots priorizan tecnología; tras 8 turnos sin que la barra suba, una civilización dormida descubre una tecnología |
| El debuff primitivo condena al que se queda atrás | Medio | Topado en −30 %, tres misiones de recuperación y dos vías de alianza con efectos asimétricos |
| Los hitos globales premian siempre al mismo y aceleran su ventaja | Medio | Buffs de 2 turnos, máximo 2 activos, del mismo tipo se refrescan; hitos de recuperación para el rezagado |

---

## 9. Fuera de alcance de la v1

Sprites e ilustraciones (por petición expresa), modelado 3D, voz, app nativa, matchmaking ranked
público, monetización, muerte divina permanente, Panteón y Más Allá jugables, integración con la
novela más allá del texto de ambientación.

---

## 10. Decisiones de alcance (cerradas)

1. **Primer jugable:** «La peor carta», 4–8 asientos, 12 turnos; el modo completo de 32 después. Enseña
   todas las mecánicas en ~30 minutos y deja la Fase 3 como algo demostrable.
2. **Narración:** plantillas deterministas por defecto, LLM opcional y apagado con *fallback* (D20). Una
   caída del proveedor no puede romper un turno.
3. **Hosting:** Vercel Hobby, uso personal no comercial, + Supabase Free (D19).

Estas decisiones ya están reflejadas en las fases; no bloquean nada.

Con las dos respuestas restantes, la Fase 0 arranca escribiendo el motor mínimo y el simulador
de 500 partidas.

---

## 11. Arranque actual

```bash
npm ci                       # respeta el lockfile; no actualiza dependencias
cp .env.example .env.local   # P-01: rellena URL y claves (nunca al repositorio)
npm run dev                  # http://localhost:3000, bind a 0.0.0.0
npm run typecheck            # tsc --noEmit
npm test                     # 133 tests: motor + esquema/RLS/entorno
npm run build                # build de producción
npm run test:rls             # P-03: proyecto real; sin claves sale con código 2
npm run sim -- 500 8 5       # simulación de Fase 0 → artifacts/
```

La aplicación **arranca sin claves** y muestra el estado de configuración con los pasos de P-01. En la
nube, el hostname del preview se inyecta con `NEXT_DEV_ORIGIN` para que Next no rechace el `Host`; no
se escribe en el repositorio porque cambia al restaurar la máquina.
