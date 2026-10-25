# PENDIENTES — lo que solo puede hacerse en tu equipo

El proyecto se construye en la nube, pero hay cosas que **no se pueden verificar sin cuenta,
credenciales o despliegue**: crear el proyecto de Supabase, aplicar migraciones contra una base real,
probar RLS con dos cuentas, desplegar en Vercel o encender el cron. Este archivo es el registro único de
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
| **P-06** | Desplegar en Vercel Hobby con sus variables | 1B / 7 | Cierra la Fase 1 | ⏳ pendiente |
| **P-07** | Generar los tipos de la base y quitar los casts manuales | 1B | No: mejora de tipos | ⏳ pendiente |
| **P-08** | Cron diario anti-pausa de Supabase | 7 | No en 1B, sí antes de lanzar | ⏳ pendiente |
| **P-09** | Baraja completa de 32 Áreas Pequeñas | 5 | No: §6.1 solo documenta 8 | ⏳ pendiente |
| **P-10** | Clave de LLM y correo transaccional | 6 | No: la crónica es por plantillas | ⏳ pendiente |
| **P-11** | Supabase local con Docker (`supabase start`), opcional | — | No | ⏳ opcional |
| **P-12** | Jugar «La peor carta» de punta a punta con Supabase real | 3B | Sí: es el criterio de aceptación de la Fase 3 | ⏳ pendiente |

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
SQL. *Lo que sí se comprobó:* las **tres** migraciones (`schema`, `rls` y `turn_flow`) se ejecutaron en
un **Postgres 17 en memoria (PGlite)** dentro de `npm test` (`tests/db/schema.test.ts` y
`tests/db/turn-flow.test.ts`), sin errores de sintaxis, con las políticas respondiendo como se espera
y con `create_solo_match`, `claim_turn` y `apply_turn` funcionando. Falta aplicarlas al Supabase real, que añade Auth, PostgREST y
los roles de plataforma.

**Pasos (CLI)**

```bash
npx supabase login                  # abre el navegador
npx supabase link --project-ref <ref-del-proyecto>
npx supabase db push                # aplica supabase/migrations/*.sql en orden
```

**Pasos (alternativa sin CLI).** Abre **SQL Editor** en el panel y ejecuta, en este orden, el contenido
de `supabase/migrations/20261025100000_schema.sql` y después
`supabase/migrations/20261025100100_rls.sql`.

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
  Vercel cuando despliegues (P-06).

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

## P-06 · Despliegue en Vercel Hobby

**Por qué no se hizo en la nube.** Requiere tu cuenta y autorización para publicar.

1. Sube el repositorio a GitHub (o usa `vercel` CLI) e importa el proyecto en Vercel.
2. Añade las variables de P-01 en **Settings → Environment Variables**. `SUPABASE_SERVICE_ROLE_KEY`
   solo en el entorno de servidor; nunca con prefijo `NEXT_PUBLIC_`.
3. Añade la URL de producción en **Supabase → Authentication → URL Configuration**.
4. Despliega y abre `/`, `/login` y `/api/health`.

**Hecho cuando** `/api/health` responde `200` desde la URL pública y una cuenta real entra y recarga sin
perder la sesión. Recuerda: Vercel Hobby es para uso personal no comercial.

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

## P-08 · Cron anti-pausa

**Por qué no se hizo en la nube.** Depende del despliegue de P-06.

Supabase Free pausa el proyecto tras 7 días sin actividad. El plan lo trata como infraestructura
obligatoria (`PLAN.md` §5):

```json
{
  "crons": [{ "path": "/api/health", "schedule": "0 8 * * *" }]
}
```

`vercel.json` se añadirá en la Fase 7, cuando exista el despliegue. `/api/health` ya está escrito y
responde `503` sin claves, `200` con base alcanzable.

**Hecho cuando** el panel de Vercel muestra la ejecución diaria y el proyecto de Supabase sigue activo
tras una semana sin tráfico.

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

- LLM opcional (Fase 6): clave del proveedor en `.env.local` / secretos de Vercel, nunca en el cliente.
  Si falta, la app debe seguir jugando.
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

## Registro

| Fecha | ID | Resultado | Evidencia |
|---|---|---|---|
| — | — | — | — |
