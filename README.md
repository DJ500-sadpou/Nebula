# El Mundo Perdido — juego web de texto, por turnos, multijugador

Adaptación jugable del juego que aparece en la novela *La Civilización Nebula* (Na, 2023–2025) y en
`Teoria_del_Juego_y_Guia_de_Roleo.md`. Sin sprites: la interfaz **es** texto, opciones y crónica.

Cada jugador es un dios con un **Área Pequeña** al azar que guía a su pueblo desde la tribu hasta la
modernidad. No se mueven unidades: se envían señales, milagros, bendiciones y elegidos, y se paga un
impuesto por forzar la causalidad. Gana quien vasalliza a los demás dioses, o quien más puntúa en el
horizonte de ficción.

> **Estado: Fase 3A completada; 1B y 3B pendientes en tu equipo.** El motor está cerrado y verificado
> (500 partidas, 15/15 métricas de `REGLAS.md` §18, un *golden* por ventana) y existe la rebanada
> jugable de **«La peor carta»**: un humano contra tres bots, doce turnos, problema de era, crónica por
> plantillas y planificador de ocho compases. Como en la nube no hay claves, la app arranca en **modo
> revisión**: sin base real no hay sesión ni datos, pero `/preview/turno` enseña la pantalla con una
> partida de ejemplo generada por el motor. El checklist de lo que solo puede hacerse en tu equipo
> está en [`PENDIENTES.md`](PENDIENTES.md).

---

## Documentos

| Archivo | Qué contiene | Cuándo leerlo |
|---|---|---|
| **`REGLAS.md`** | La especificación jugable completa: 20 secciones numeradas más los anexos 5-A, 5-B y 10-A, con fórmulas, tablas y casos límite | Siempre. Es la fuente de verdad del comportamiento |
| **`PLAN.md`** | Contexto de la obra, verificación de servicios gratuitos, arquitectura, modelo de datos, 9 fases con criterios de aceptación | Antes de escribir código y al empezar cada fase |
| **`PENDIENTES.md`** | Lo que exige cuenta, claves o despliegue: crear Supabase, aplicar migraciones, test de dos cuentas, deploy, cron | Al pausar en la nube y al retomar en tu equipo |
| **`DECISIONES.md`** | Registro de decisiones con su motivo, lo descartado, preguntas abiertas y glosario | Antes de proponer un cambio de diseño |
| **`AGENTS.md`** | Reglas duras para el agente que implementa: invariantes, convenciones, comandos, definición de terminado | Primero, si eres un agente |

---

## Cómo se juega en 60 segundos

1. **Robas un Área Pequeña** (32 cartas; *Insectos* es la maldita) y un Dominio Único que se activa a
   Divinidad 3.
2. Cada turno tiene una **ventana de tiempo ficticio** —1 día, 7 días, 30 días, 3 meses, 6 meses, 1 año
   o 3 años— que la mesa vota y que se desbloquea cada 5 turnos.
3. La ventana se divide en **8 compases**. En cada compás puedes actuar en cuatro canales: milagro,
   obra, héroe y palabra. Paralelo = mismo compás, canales distintos. Acumulativo = compases seguidos.
4. Recaudas **Fe** de tus fieles, lo gastas en milagros, templos, bendiciones y creaciones, y decides
   cómo responde tu pueblo a la **situación** del turno.
5. El mundo tiene una **barra de época** que sube con la tecnología, la población y la cultura de todos.
   Al 100 %, todos cambian de era; quien se queda dos dimensiones atrás recibe el debuff *civilización
   primitiva* y misiones para recuperarse.
6. Los **hitos globales** (primero en 1.000 fieles, primera guerra ganada, primer choque) se los lleva
   uno solo y dan un buff corto o un botín de Fe.

---

## Nube y local

El código, el esquema SQL y todo lo verificable sin credenciales se construye y se prueba en la nube. Lo
que necesita una cuenta, una clave o una publicación se hace en tu equipo y se sigue en
`PENDIENTES.md` con un ID (`P-01`…`P-12`). La aplicación **no se rompe si faltan claves**: muestra el
estado y los pasos en lugar de una traza. Las fases que dependen de la nube están partidas en **A**
(nube, cerrada) y **B** (tu equipo, abierta): hoy, 1A/1B y 3A/3B.

---

## Servicios: todo con plan gratuito sin método de pago

- **Vercel Hobby** — aplicación Next.js y API. *Uso personal no comercial.*
- **Supabase Free** — Postgres, Auth y Realtime. Se pausa a los 7 días sin actividad: el cron diario
  `/api/health` es obligatorio, no opcional.
- **Neon Free** — opcional, solo archivo de partidas cerradas y analítica.
- **Firebase Spark** — opcional, solo notificaciones push. **No puede ser el backend**: sin Blaze no
  despliega Cloud Functions y la lógica quedaría en el cliente.

Detalle y fuentes en `PLAN.md` §2.

---

## Arranque

```bash
npm ci                       # respeta el lockfile
cp .env.example .env.local   # rellena URL y claves (P-01); nunca se versiona
npm run dev                  # http://localhost:3000
npm run typecheck            # tsc --noEmit
npm test                     # 155 tests: motor, crónica, mapeo, esquema/RLS y flujo de turno en Postgres
npm run build                # build de producción
npm run sim -- 500 8 5       # simulación de 500 partidas → artifacts/
```

Sin claves, `/` y `/login` muestran el estado de configuración y `/api/health` responde `503`;
`/preview/turno` enseña la pantalla de turno con datos de ejemplo. Con el proyecto de Supabase
enlazado y las migraciones aplicadas (P-01, P-02), el acceso funciona y el panteón permite empezar
una partida de «La peor carta»; el recorrido completo está en **P-12**. El test real de privacidad es
`npm run test:rls` (P-03): sin claves termina con código 2 y no cuenta como fallo.

La simulación escribe `artifacts/sim-fase0.csv` (una fila por partida) y
`artifacts/sim-fase0-resumen.json` (las métricas de §18).

---

## Aviso sobre los números

Todas las cifras de `REGLAS.md` (costes, ingresos, porcentajes, umbrales) son **tuning de arranque**.
La Fase 0 las valida con 500 partidas simuladas antes de escribir interfaz, usando las métricas de
`REGLAS.md` §18. Si un número no cuadra, se ajusta el número; si una regla no cuadra, se discute la
regla — y entonces se actualiza `REGLAS.md` primero.

---

## Naturaleza del proyecto

Proyecto **personal, no comercial y derivado**: es una interpretación de un juego ficticio descrito en
una novela web. No reproduce texto de la novela ni material gráfico de terceros. La v1 no tiene
sprites, ni modelado 3D, ni voz.
