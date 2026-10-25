# AGENTS.md — instrucciones para el agente que implementa

Este repositorio contiene **especificación, no código**. Tu trabajo es construir lo que describen
`REGLAS.md` y `PLAN.md`, en el orden de fases de `PLAN.md` §6, sin reinventar las reglas.

## Orden de lectura obligatorio

1. `README.md` — qué es y en qué estado está.
2. `PLAN.md` §3, §4 y §6 — arquitectura, modelo de datos y la fase que vas a hacer.
3. `REGLAS.md` §5, §5-A, §5-B y §8 — turno, ventanas, épocas y orden de resolución.
4. `DECISIONES.md` — por qué está así, y qué se descartó para no volver a proponerlo.
5. El resto de `REGLAS.md` según lo que toques.

No hace falta leer la novela: el contenido que se extrae de ella está mapeado en `DECISIONES.md` §3.

---

## Invariantes: si un cambio rompe uno de estos, el cambio está mal

1. **El motor es puro.** `lib/engine/` no importa Next, Supabase, `fs`, `process.env`, `Date` ni
   `Math.random`. Entra `(estado, órdenes, seed)` y sale `(eventos, estado siguiente)`.
2. **Determinismo.** Toda aleatoriedad pasa por `rng(seed, turno, paso)`. Mismo estado + mismas
   órdenes ⇒ mismo `digest`, byte a byte. Hay un test que lo comprueba y no se puede debilitar.
3. **Servidor autoritativo.** El cliente envía órdenes crudas. Nunca calcula costes, resultados, Fe ni
   aleatoriedad. Las opciones que ve ya vienen valoradas por el servidor.
4. **RLS cerrada.** `seat_state` (Fe, XP, fidelidad exactos) solo la lee `service_role`. Ningún jugador
   puede leer la Fe de otro, ni por REST ni por Realtime. Test de dos cuentas en cada fase.
5. **Idempotencia.** La resolución usa clave `(match_id, turn)` y un claim atómico
   (`UPDATE ... WHERE resolving = false RETURNING *`). Dos clics no resuelven dos veces.
6. **Cero tarjetas.** Ninguna dependencia de servicio puede exigir método de pago. Firebase Spark no
   ejecuta servidor: no es una opción de backend.
7. **Cero LLM en el camino crítico.** La crónica se genera con plantillas. Un LLM, si se activa, es una
   capa de color con fallback obligatorio; una caída suya no puede romper un turno.
8. **La regla se escribe antes que el código.** Si necesitas una regla que no está, se añade a
   `REGLAS.md` y a `DECISIONES.md` en el mismo cambio. No se implementa comportamiento no especificado.
9. **Los números son tuning.** No los cambies a gusto: se validan con la simulación de Fase 0 contra las
   métricas de `REGLAS.md` §18.
10. **Idioma.** Código e identificadores en inglés; textos de interfaz, crónica y documentación en
    español.

---

## Arquitectura y límites

```
app/            UI de texto (server components) y app/api/*, única puerta de mutación.
components/     piezas de UI sin reglas ni acceso a datos.
proxy.ts        refresco de sesión de Supabase (Next 16: sustituye middleware.ts).
lib/engine/     puro y testeable. Nada de red, nada de BD, nada de reloj.
lib/bots/       clientes del motor: reciben estado público, devuelven órdenes legales.
lib/narrator/   plantillas deterministas (+ capa LLM opcional y aislada).
lib/match/      orquestación de la mesa: modo «La peor carta», saneado del plan y cierre.
lib/server/     utilidades de servidor sin datos (comprobación de mismo origen).
lib/db/         env, clientes Supabase, mapeos estado↔filas y repositorio. Solo aquí se habla con la base.
supabase/       config local y migraciones SQL incrementales.
tests/engine/   unitarios + golden por ventana.
tests/narrator/ plantillas y crónica determinista.
tests/db/       entorno, auditoría de RLS, mapeo y flujo de turno en Postgres 17 (PGlite, sin credenciales).
tests/rls/      test real de dos cuentas (script manual, P-03).
```

- **Un solo punto de mutación.** Todas las escrituras de estado pasan por `app/api/*` con `service_role`.
- **El motor no conoce la BD.** Si te encuentras pasando un cliente de Supabase al motor, estás
  equivocado.
- **No dupliques reglas en el cliente.** Si la UI necesita un coste, lo pide a la API.

---

## Convenciones

- TypeScript `strict`. Nada de `any` sin un comentario que lo justifique.
- Fe, XP, población y contadores: **enteros**. Nada de floats para dinero.
- El tiempo de ficción es un contador (`fiction_day`), nunca una fecha real. En el motor no existe
  "ahora".
- Tablas en plural y `snake_case`; migraciones incrementales; una migración aplicada no se edita.
- Tests con `vitest`: un archivo por módulo del motor, más *golden tests* de partidas completas.
- Cada fase termina con: tests verdes, `typecheck` limpio y la comprobación manual que indique
  `PLAN.md` §6.

---

## Comandos

```bash
npm ci                 # respeta el lockfile; no actualices dependencias para "arreglar" la instalación
npm run dev            # Next.js en el puerto 3000 (arranca sin claves, en modo revisión)
npm test               # vitest: motor, esquema/RLS (Postgres en memoria) y entorno
npm run typecheck      # tsc --noEmit
npm run build          # build de producción
npm run test:rls       # test real de dos cuentas; sin claves sale con código 2 (pendiente)
npm run sim -- 500 8 5 # simulación de 500 partidas; escribe artifacts/
```

### Nube y local

- En la nube no hay navegador, credenciales ni despliegue: **no intentes** `supabase login`,
  `supabase start` (necesita Docker) ni `vercel deploy`.
- Todo lo que exige cuenta o clave está en `PENDIENTES.md` con un ID. Si una comprobación no se puede
  ejecutar, se anota allí y se dice en el informe; nunca se marca como hecha.
- La app debe arrancar **sin** `.env.local`. Una página que lanza una excepción por falta de claves es
  un bug, no una configuración pendiente.
- Ninguna clave en el código, en la documentación, en un commit ni en el chat. `service_role` nunca
  lleva prefijo `NEXT_PUBLIC_` y solo se lee en scripts o rutas de servidor.

Si tocas un número de tuning o una regla, vuelve a ejecutar la simulación y actualiza los resultados de
`REGLAS.md` §18.1: no dejes esa tabla desactualizada.

Si cambias la resolución de un turno completo, comprueba los **golden tests** de `tests/engine/golden`.
Si sus huellas cambian, es que una regla se movió sin querer: dilo y justifícalo, no regeneres los
valores en silencio.

Supabase: las claves las aporta el usuario en `.env.local` (URL y `anon key` públicas; `service_role`
solo en servidor). **Nunca** escribas una clave en el código, en la documentación ni en un commit, y
nunca expongas `service_role` al navegador.

---

## Qué NO hacer

- No añadas servicios, dependencias ni abstracciones que la tarea no pida.
- No cambies la estructura de datos para "simplificar" sin actualizar `PLAN.md` §4.
- No uses `Math.random`, `Date.now()` ni `crypto.randomUUID()` dentro del motor.
- No muevas lógica al cliente para ahorrar una llamada.
- No desactives ni relajes un test para que pase: si falla, investiga la causa.
- No implementes contenido de Fase 5 antes de que la Fase 3 esté jugable de punta a punta.
- No borres partidas ni datos para "limpiar" el entorno de pruebas del usuario.

---

## Definición de terminado (por fase)

1. Se cumple el criterio de aceptación escrito en `PLAN.md` §6 para esa fase, verificado a mano. En la
   Fase 1, **1A** se verifica en la nube y **1B** queda anotado en `PENDIENTES.md` hasta cerrarse en el
   equipo del usuario.
2. Tests añadidos para la lógica nueva; los existentes siguen verdes.
3. `typecheck` limpio.
4. Si cambió una regla: `REGLAS.md` y `DECISIONES.md` actualizados en el mismo cambio.
5. Si cambió el esquema: migración nueva, no editada, y RLS revisada.

---

## Informe al terminar una fase

Di qué se construyó, qué se verificó y **cómo** se verificó (comando, prueba manual o test), qué quedó
pendiente y qué decisiones tomaste que no estaban en los documentos. Si algo no se pudo comprobar,
dilo explícitamente en lugar de darlo por bueno.
