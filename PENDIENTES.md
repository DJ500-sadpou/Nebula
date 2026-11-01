# PENDIENTES — lo que solo puede hacerse en tu equipo

El proyecto se construye en la nube, pero hay cosas que **no se pueden verificar sin cuenta,
credenciales o despliegue**: crear el proyecto de Supabase, aplicar migraciones contra una base real,
probar RLS con dos cuentas, publicar en Freebuff Sites o encender el cron. Este archivo es el registro único de
esas tareas, con su ID. `PLAN.md`, `README.md` y el código las citan como `P-xx`.

**Regla:** un pendiente no es un olvido. Si algo no se pudo comprobar, está aquí con lo que falta y
cómo saber que quedó hecho. No se marca ✅ sin evidencia (comando, salida o captura).

---

## Resumen

| ID | Qué falta | Fase | Bloquea | Estado |
|---|---|---|---|---|
| **P-01** | Crear el proyecto de Supabase y rellenar `.env.local` | 1B | Sí: sin claves no hay auth ni datos | ⏳ pendiente |
| **P-02** | Aplicar las migraciones y comprobar RLS en la base | 1B | Sí | ⏳ pendiente |
| **P-03** | Ejecutar el test de dos cuentas (`npm run test:rls`) | 1B | Sí: es el criterio de aceptación de la Fase 1 | ⏳ pendiente |
| **P-04** | Ajustes de Auth: anónimo activo, confirmación desactivada | 1B | Sí: el registro no entra sin esto | ⏳ pendiente |
| **P-05** | Prueba manual de sesión persistente y de dos cuentas en la UI | 1B | Sí | ⏳ pendiente |
| **P-06** | Publicar en Freebuff Sites (secrets + producción) | 1B / 7 | Cierra la Fase 1 | ⏳ pendiente |
| **P-07** | Generar los tipos de la base y quitar los casts manuales | 1B | No: mejora de tipos | ⏳ pendiente |
| **P-08** | Ping diario anti-pausa de Supabase desde el hosting | 7 | No en 1B, sí antes de lanzar | ⏳ pendiente |
| **P-09** | Baraja completa de 32 Áreas Pequeñas | 5 | No: §6.1 solo documenta 8 | ⏳ pendiente |
| **P-10** | Clave de LLM y correo transaccional | 6 | No: la crónica es por plantillas | ⏳ pendiente |
| **P-11** | Supabase local con Docker (`supabase start`), opcional | — | No | ⏳ opcional |
| **P-12** | Jugar «La peor carta» de punta a punta con Supabase real | 3B | Sí: es el criterio de aceptación de la Fase 3 | ⏳ pendiente |
| **P-13** | Partida multijugador real: 4 pestañas, 4 cuentas, 6 turnos | 4B | Sí: es el criterio de aceptación de la Fase 4 | ⏳ pendiente |
| **P-14** | Capa Supabase Realtime sobre la mesa (el respaldo de polling ya va solo) | 4B | No: es mejora de latencia | ⏳ pendiente |
| **P-15** | Aceptación de la Fase 7 en producción: pausa + cron + recuperación + partida de 32 | 7B | Sí: es el criterio de aceptación de la Fase 7 | ⏳ pendiente |

---

## P-01 · Proyecto de Supabase y claves

**Por qué no se hizo en la nube.** Crear el proyecto exige una cuenta de Supabase y un método de
verificación; las claves no pueden pasar por el chat ni escribirse en el repositorio.

**Pasos**

1. Crea un proyecto en <https://supabase.com> con el plan **Free**. Región europea si juegas desde
   Europa. No pide tarjeta.
2. En **Project Settings → API**, copia la **URL** y la **clave pública** (*publishable key*; si tu
   proyecto aún muestra la *anon key* heredada, también vale).
3. Copia `.env.example` a `.env.local` y rellena:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (o `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
   - `SUPABASE_SERVICE_ROLE_KEY` — **solo servidor**; el test RLS la necesita. No la subas al repo ni
     la pongas en ninguna variable `NEXT_PUBLIC_`.
4. Reinicia `npm run dev`.

**Hecho cuando:** `/` deja de mostrar el aviso de configuración, `/login` enseña el formulario y
`GET /api/health` devuelve `200` con `{"ok":true,"configured":true,...}`.

---

## P-02 · Aplicar las migraciones

**Por qué no se hizo en la nube.** Sin proyecto y sin credenciales no hay base contra la que aplicar
SQL. *Lo que sí se comprobó:* las **siete** migraciones (`schema`, `rls`, `turn_flow`, `multiplayer`,
`malignant`, `limits_retention` y `audit_races`) se ejecutan en un **Postgres 17 en memoria (PGlite)** dentro de
`npm test`
(`tests/db/schema.test.ts`, `tests/db/turn-flow.test.ts`, `tests/db/lobby-flow.test.ts` y
`tests/db/limits.test.ts`), sin
errores de sintaxis, con las políticas respondiendo como se espera y con `create_solo_match`,
`claim_turn`, `apply_turn`, `create_lobby`, `join_lobby`, `begin_orders`, `submit_orders`,
`open_ballot`, `close_ballot`, el límite de mesas activas y la retención
funcionando, además de la proyección de dioses dormidos y del `awakened` de la Fase 6. Falta
aplicarlas al Supabase real, que añade Auth,
PostgREST y los roles de plataforma.

**Pasos (CLI)**

```bash
npx supabase login                  # abre el navegador
npx supabase link --project-ref <ref-del-proyecto>
npx supabase db push                # aplica supabase/migrations/*.sql en orden
```

**Pasos (alternativa sin CLI).** Abre **SQL Editor** en el panel y ejecuta, en este orden, el contenido
de `supabase/migrations/20261025100000_schema.sql` y después
`supabase/migrations/20261025100100_rls.sql` (y así sucesivamente hasta la séptima,
`20261026100600_audit_races.sql`).

**Hecho cuando** esta consulta devuelve 16 filas y todas con `rowsecurity = true`:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
```

Y además:

- `seat_state` no tiene **ninguna** política (`select * from pg_policies where tablename = 'seat_state';`
  devuelve 0 filas).
- `chronicle_public` existe como vista y la tabla `chronicle` no es legible por `authenticated`.

---

## P-03 · Test de dos cuentas

**Por qué no se hizo en la nube.** Necesita dos usuarios reales en un proyecto real y la
`service_role` para montar los datos. El comportamiento de las políticas ya está cubierto en
`npm test` con Postgres en memoria; lo que falta aquí es la capa de Supabase: sesiones JWT reales,
PostgREST y permisos de los roles de plataforma.

**Pasos**

```bash
npm run test:rls
```

- Código **0**: las 10 comprobaciones pasan (A no ve la Fe de B, no lee su orden, no escribe en su
  asiento, no lee la crónica privada…). El script limpia la partida y las dos cuentas al terminar.
- Código **1**: hay un fallo de RLS. No lo ignores ni relajes el test: revisa la política.
- Código **2**: faltan claves; vuelve a P-01.

**Hecho cuando** el script termina con `RLS correcta: 2 cuentas, 10 comprobaciones en verde`.

---

## P-04 · Ajustes de Auth

**Por qué no se hizo en la nube.** Son ajustes del panel del proyecto.

En **Authentication → Sign In / Providers**:

- **Email**: activado, con **Confirm email desactivado** (Fase 1 del plan). Sin esto, el registro crea
  la cuenta pero no la sesión.
- **Anonymous sign-ins**: activado. Sin esto, el botón «Entrar como invitado» devuelve
  *Anonymous sign-ins are disabled* (la app ya traduce el mensaje).
- **URL Configuration → Site URL**: `http://localhost:3000` mientras pruebes en local; la URL de
  Freebuff Sites cuando publiques (P-06).

**Hecho cuando** puedes crear una cuenta y entrar sin confirmar el correo, y el botón de invitado
también entra.

---

## P-05 · Prueba manual de sesión y de dos cuentas

**Por qué no se hizo en la nube.** Hace falta un navegador con cookies reales y dos sesiones.

1. Crea la cuenta A y entra. Recarga la página: sigues dentro y ves tu nick.
2. Cierra la pestaña y vuelve a abrir: la sesión persiste.
3. En una ventana privada, crea la cuenta B. Comprueba que `/` muestra solo las mesas de cada una.
4. Con la consola del navegador, intenta leer `seat_state` con el cliente público de la pestaña A
   (`supabase.from('seat_state').select('*')`): debe devolver `[]`, nunca una fila.
5. Pulsa «Salir» y comprueba que `/` vuelve a la portada pública.

**Hecho cuando** los cinco pasos se comportan así. Anota la fecha y el resultado en este archivo.

---

## P-06 · Publicación en Freebuff Sites

**Por qué no se hizo en la nube.** Requiere tu cuenta y autorización para publicar.

**Ya verificado en la nube (26-10-2026):** el sitio Nebula existe en Freebuff Sites y su *preview*
público sirve la app completa en Cloudflare Workers: `/` y `/preview/turno` en `200`, `/xyz` en `404`
y `/api/health` en modo revisión (`503` con el aviso de claves). El código de servidor ya usa Web Crypto
(en vez de `node:crypto`) para ser compatible con Workers. No hace falta declarar
`@opennextjs/cloudflare` en el repo: el build lo maneja la plataforma.

1. En **Freebuff → Sites → Nebula**, conecta el repositorio `DJ500-sadpou/Nebula` y la rama a publicar.
2. En **Settings → Secrets**, añade las variables de P-01: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (o `NEXT_PUBLIC_SUPABASE_ANON_KEY`) y
   `SUPABASE_SERVICE_ROLE_KEY` (solo servidor, nunca con prefijo `NEXT_PUBLIC_`).
3. Despliega primero a *preview*, revisa logs y rutas críticas (`/`, `/login`, `/match/[code]`,
   `/preview/turno`, `/api/health`) y solo entonces publica a producción.
4. Añade la URL pública en **Supabase → Authentication → URL Configuration** (Site URL y redirect).
5. Vigila el panel de uso: 10.000 requests/día, 100.000/mes, CPU 500 s/día (detalle en `PLAN.md` §2.1).

**Hecho cuando** `/api/health` responde `200` con `"configured":true` desde la URL pública y una
completa una partida real sin perder la sesión al recargar.

---

## P-07 · Tipos generados de la base

**Por qué no se hizo en la nube.** `supabase gen types` necesita el proyecto enlazado.

```bash
npx supabase gen types typescript --project-id <ref> > lib/db/database.types.ts
```

Después, sustituir los tipos escritos a mano (`LobbySeat` en `app/page.tsx`) y el cast de
`lib/db/auth.ts` por `Database`. No bloquea la Fase 1; evita que un cambio de columna pase inadvertido.

**Hecho cuando** `npm run typecheck` sigue limpio sin ningún `as unknown as`.

---

## P-08 · Ping anti-pausa

**Por qué no se hizo en la nube.** Depende del despliegue de P-06.

Supabase Free pausa el proyecto tras 7 días sin actividad. El plan lo trata como infraestructura
obligatoria (`PLAN.md` §5): una petición diaria a `/api/health` (que ya responde `503` sin claves y
`200` con base alcanzable) mantiene el proyecto despierto.

Mecanismos posibles, por orden de preferencia:

1. **Planificador del propio sitio** si Freebuff Sites ofrece *scheduled triggers* de Cloudflare
   Workers en su panel (equivalente al viejo `vercel.json`: `{ "crons": [{ "path": "/api/health",
   "schedule": "0 8 * * *" }] }`).
2. **Un servicio externo gratuito** (p. ej. cron-job.org) que llame a la URL pública de `/api/health`
   una vez al día; no requiere tarjeta ni despliegue.

`vercel.json` ya no aplica: el hosting es Freebuff Sites, no Vercel. Lo que se elija se anota aquí
con su programación y una captura del panel como evidencia.

**Hecho cuando** el mecanismo dispara a diario (captura del planificador o del log) y el proyecto de
Supabase sigue activo tras una semana sin tráfico.

---

## P-09 · Baraja de 32 Áreas Pequeñas

**Por qué no se hizo en la Fase 1.** `REGLAS.md` §6.1 solo documenta **8** áreas de ejemplo y dice
explícitamente que el catálogo completo (32 × 2 acciones) se escribe en la **Fase 5**. Inventar 24
áreas ahora sería contenido no especificado, justo lo que prohíbe el invariante 8 de `AGENTS.md`.

Por eso la migración de la Fase 1 **no siembra** la baraja: `seats.area_card` es texto y se llenará
cuando exista el catálogo. No bloquea nada de la Fase 1.

---

## P-10 · LLM y correo transaccional

**Por qué no se hizo.** No están en el camino crítico: la crónica es por plantillas y el acceso es
email/password + anónimo.

- LLM opcional (Fase 6): clave del proveedor en `.env.local` / secretos del hosting (Freebuff Sites,
  D55), nunca en el cliente. Si falta, la app debe seguir jugando.
- Correo transaccional (recuperación de contraseña, avisos de turno): la Fase 1 no lo necesita. Si más
  adelante se activa la confirmación de correo, hará falta un proveedor SMTP en Supabase.

---

## P-11 · Supabase local con Docker (opcional)

No es necesario para jugar: puedes trabajar contra el proyecto alojado. Si quieres probar migraciones
sin tocar la base real:

```bash
npx supabase start     # requiere Docker
npx supabase db reset  # aplica migraciones desde cero
npx supabase stop
```

En la nube no hay Docker, así que esto nunca se ejecutó aquí.

---

## P-12 · Partida real de «La peor carta» (3B)

**Por qué no se hizo en la nube.** La rebanada de un jugador necesita Auth, PostgREST y una base
real. En la nube se comprobó lo que se puede sin claves: el SQL de creación, claim y aplicación
del turno en Postgres 17 en memoria, el mapeo estado↔filas con huella exacta y el motor con 155
tests. Lo que **no** se ha ejecutado es el navegador contra Supabase.

**Pasos**

1. Termina P-01, P-02 (con la migración `20261025100200_turn_flow.sql`) y P-04.
2. `npm run dev`, entra en `/login` y usa una sesión de invitado o una cuenta de correo.
3. En `/`, pulsa **Empezar «La peor carta»**. Debe crearse la mesa y abrir el turno 1.
4. Juega los doce turnos: coloca acciones en los compases, elige una opción del problema de era y
   pulsa **Cerrar el turno**. La crónica tiene que aparecer al recargar.
5. Recarga la página en mitad de un turno (antes y después de cerrar) y comprueba que el estado no
   se rompe: mismo turno, misma Fe, misma crónica.
6. Abre la mesa en dos pestañas y pulsa **Cerrar el turno** en las dos a la vez: solo una resuelve;
   la otra recibe `busy` y, al recargar, ve el turno nuevo.
7. Al llegar al turno 12, la pantalla de fin de partida debe declarar un ganador.

**Hecho cuando:** los doce turnos se juegan sin tocar la base de datos a mano, recargar no pierde
nada y dos clics simultáneos resuelven una sola vez. Pega la salida o una captura en el registro.

---

## P-13 · Partida multijugador real (4B)

**Por qué no se hizo en la nube.** Hacen falta cuatro sesiones reales, cuatro
pestañas y Supabase con las migraciones de las cuatro fases. En la nube se
verificó el resto: el flujo SQL completo del lobby en Postgres 17 en memoria
(crear sala → unirse → listo → expulsar → arrancar con relleno de bots →
órdenes por asiento → papeleta → resolución → *replay* sin duplicar), la RLS
en vivo por rol (nadie lee órdenes ni votos ajenos) y el motor de la papeleta
con mayoría, empate y quórum.

**Pasos**

1. Termina P-01, P-02 (ahora son **siete** migraciones:
   `20261025100000_schema.sql`, `20261025100100_rls.sql`,
   `20261025100200_turn_flow.sql`, `20261026100300_multiplayer.sql`,
   `20261026100400_malignant.sql`, `20261026100500_limits_retention.sql` y
   `20261026100600_audit_races.sql`) y P-04.
2. `npm run dev` con cuatro sesiones (una normal y tres ventanas privadas).
   En el panteón, una de ellas pulsa **Crear sala con amigos** y comparte el código.
3. Las otras tres se sientan con el código, marcan «listo» y el anfitrión arranca.
   Los asientos libres quedan en bot.
4. Juega 6 turnos: cada humano planifica sus compases y pulsa **Enviar órdenes**.
   Con todos enviados, el turno se resuelve a la primera visita siguiente.
5. En algún turno, propón una ventana (`7d` cuando esté desbloqueada) y vota:
   2 de 3 humanos deben aprobarla y aplicarse **al turno siguiente**.
6. Comprueba que nadie ve la Fe ajena ni las órdenes de otro (consola con
   `supabase.from('orders').select('*')`: solo las propias; `turn_votes` en
   papeleta abierta, idem).
7. Deja vencer el reloj de un turno sin que envíe uno de los cuatro: el turno
   resuelve solo y el ausente juega «no intervenir».
8. Cierra la pestaña de uno y recarga: la sesión y el turno siguen donde estaban.
9. **Fase 6 en vivo:** crea una sala de 12+ asientos, deja que los libres más allá de 8 duerman
   como dioses dormidos y juega hasta ver un «Noche de la traición» o un despertar: la crónica
   tiene que narrar la agenda del maligno y el asiento debe salir «dios maligno» en la mesa.

**Hecho cuando** se cumplen los puntos de aceptación de la Fase 4 (`PLAN.md` §6):
6 turnos sin tocar la base a mano, doble clic simultáneo resuelve una vez, la
papeleta aprobada aplica al turno siguiente y la destronada no. Pega capturas
en el registro de abajo.

---

## P-14 · Capa Supabase Realtime sobre la mesa (4B)

**Por qué no se hizo en la nube.** Realtime necesita el proyecto real; además,
con el presupuesto de requests del hosting el diseño es Realtime-primero
(D55) y la capa de respaldo ya funciona: `AutoRefresh` refresca la mesa cada
30 s y tras cada acción.

**Pasos**

1. Con el proyecto enlazado, activa Realtime para `seats`, `orders`,
   `turn_proposals` y `turn_events` (Database → Replication) o usa el
   broadcast de canales desde el cliente.
2. Suscribe la pantalla de mesa a cambios de `orders` (quién envió) y de
   `matches` (turno nuevo) y refresca al llegar el evento; `AutoRefresh` queda
   como red de seguridad con un intervalo mayor (60 s o manual).
3. Comprueba que la papeleta abierta no filtra votos por Realtime: la RLS de
   `turn_votes` ya impone «solo el propio tras el cierre», pero hay que
   verlo llegar por el canal.

**Hecho cuando** cuatro pestañas ven el turno avanzar casi a la vez sin tocar
el botón de refrescar, y el canal no publica votos ajenos de papeleta abierta.

---

## P-15 · Aceptación de la Fase 7 en producción (7B)

**Por qué no se hizo en la nube.** La Fase 7 se cerró por su parte construible
(7A: límites, retención, despertar y logs, todo verificado con tests en
Postgres 17 en memoria), pero su criterio de aceptación exige producción:
proyecto real, cron real y tráfico real durante una semana. El código ya está:
`/api/health` reintenta y clasifica `waking`, y la UI enseña «El servidor está
despertando» con auto-reintento.

**Pasos**

1. Termina P-06 (publicar en Freebuff Sites) y P-08 (ping diario anti-pausa).
2. **Recuperación tras pausa:** deja pasar 7 días sin tráfico (o pausa el
   proyecto a mano desde el panel de Supabase y desactiva el cron unos días).
   La primera visita debe mostrar «El servidor está despertando», reintentar
   sola y recuperar la mesa sin que parezca un juego roto. Si el proyecto quedó
   pausado de verdad, restaúralo desde el panel (README: paso de restauración)
   y repite.
3. **Cron anti-pausa:** reactiva el ping diario y comprueba que, tras 7 días
   sin jugadores, el proyecto sigue activo en el panel de Supabase
   (P-08 mide lo mismo; aquí se confirma desde la URL pública).
4. **Partida de 32 asientos en producción:** crea una sala de 32 con 2 humanos
   (el relleno de D61 hace el resto) y complétala hasta el final desde la URL
   pública.
5. De paso, prueba los límites nuevos: ten 3 mesas activas y confirma que la
   cuarta se rechaza con el mensaje claro (§21.1). Para ver la ficha de
   archivada sin esperar 30 días, termina una partida y ejecuta
   `npm run prune -- 1` (archiva las terminadas con más de 1 día; el período
   por defecto son 30).

**Hecho cuando** los tres puntos de aceptación de `PLAN.md` §6 (Fase 7) se
cumplen en la URL pública: 7 días sin tráfico + cron ⇒ proyecto activo;
partida de 32 completada; primera petición tras pausa se recupera sola. Pega
las evidencias en el registro de abajo.

---

## Registro

| Fecha | ID | Resultado | Evidencia |
|---|---|---|---|
| — | — | — | — |
