# DECISIONES.md — registro de decisiones, mapa de la obra y glosario

Por qué el juego es como es, qué se descartó, qué queda abierto y qué significa cada término. Si vas a
cambiar una regla, este es el archivo que hay que leer antes y actualizar después.

---

## 1. Decisiones tomadas

| # | Decisión | Motivo | Alternativa descartada |
|---|---|---|---|
| D1 | Se adapta **"El Mundo Perdido"**, el juego de *La Civilización Nebula* | Es el juego que la novela describe con reglas completas y el que analiza `Teoria_del_Juego_y_Guia_de_Roleo.md` | Inventar un god game propio "inspirado" |
| D2 | **4–32 asientos**; mesa por defecto **8** (2–3 humanos + 5–6 IA) | El uso previsto es de 2–3 personas; los 32 son el techo fiel a la novela, no la mesa normal | Partidas de 32 humanos reales |
| D3 | **Sin sprites.** Texto, opciones y crónica | Pedido explícito; además abarata el arte y centra el juego en las decisiones | Ilustración o pixel art |
| D4 | **Ventana temporal variable votada**: 1d, 7d, 30d, 3m, 6m, 1y, 3y | Reproduce los saltos de tiempo de la novela y deja al jugador elegir entre precisión y alcance | Turnos de duración fija |
| D5 | Se **eliminó el peldaño de 9 años** | Con 2–3 jugadores la escalera ya llega al trienio en el turno ~31; un peldaño más alargaba la campaña sin añadir decisiones | Mantener 9y |
| D6 | **8 compases** por turno y **4 canales** (milagro, obra, héroe, palabra) | Unifica la interfaz en todas las escalas y resuelve "varias cosas en paralelo y acumulativas" | Menú de 1–3 acciones por turno |
| D7 | La escalera de ventanas se abre **cada 5 turnos** (`unlockEvery`, 2–5) | Ritmo predecible y negociable | Desbloqueo por era o por año de ficción |
| D8 | Un **choque de civilizaciones fuerza `1d` durante 2 turnos** | El primer contacto debe sentirse como un sobresalto: el mundo se detiene | Dejar la ventana a votación |
| D9 | En **guerra**, el techo de ventana depende de la etapa: `7d` tribal, `30d` reinos, `3m` modernidad | Rescata las ventanas cortas en la segunda mitad y hace que la guerra se sienta como guerra | Ventana libre también en guerra |
| D10 | La **etapa del mundo** se mide por una **barra de promedio** del Índice de Civilización (tecnología 50 %, población 25 %, cultura 25 %) | Una civilización no es solo su tecnología; y una barra continua avisa antes del cambio | Umbral de mayoría con 1/3 de las tecnologías |
| D11 | **4 subetapas con nombre** por era (Tribu Antigua → Tribu Tardía…) | Señalan cuándo cambia la era y quién se queda atrás | Un único porcentaje sin nombre |
| D12 | El **debuff "civilización primitiva"** exige atraso en **2 de 3 dimensiones** (0,25 cada una) | Evita castigar al que va segundo en investigación y castiga al "taller con bandera" | Atraso por una sola dimensión, o por número fijo de tecnologías |
| D13 | **Misiones de recuperación con al menos una por dimensión** | Ningún tipo de atraso puede quedarse sin salida | Misiones solo tecnológicas |
| D14 | El **intercambio cultural es asimétrico**: el atrasado acelera, el moderno paga tempo y filtra tecnologías | Convierte la ayuda en una decisión política y no en caridad | Intercambio simétrico |
| D15 | **Ingreso con raíz cuadrada** y **suelo del 20 %** del mensual | Con ingreso lineal el tope logarítmico se volvía una trituradora; y sin suelo, los turnos de 1 día eran injugables | Ingreso proporcional a fieles |
| D16 | **Tope de Fe** = base por Divinidad × `(1 + log10(fieles/30))` | Crece con el pueblo sin explotar; la Divinidad sigue pesando más | Tope solo por nivel, o solo por población |
| D17 | Los **botines de Fe** de los hitos son **5 / 7,5 / 10 / 12,5 % del tope**, instantáneos | Se autoescalan con el jugador y no rompen la economía temprana; no ocupan plaza de buff | Cantidades fijas, o 15–30 % del tope |
| D18 | **Hitos globales únicos**, buff de **2 turnos**, **máximo 2 activos** | Premian la iniciativa sin nieve acumulativa | Buffs permanentes o acumulables |
| D19 | **Vercel Hobby + Supabase Free**; Neon solo archivo; Firebase solo FCM | Ninguno pide tarjeta; Supabase aporta Postgres, Auth y Realtime en un solo plan | Firebase como backend |
| D20 | **Crónica por plantillas**; LLM opcional, apagado y con fallback | Las cuotas gratuitas (tipo 20 req/día) no aguantan una llamada por jugador; una caída del LLM no puede romper un turno | Narración generada por LLM |
| D21 | **Bots deterministas** de utilidad, nunca LLM | Una partida de 2 humanos con 6 bots no puede depender de una API externa | Bots con LLM |
| D22 | **Servidor autoritativo y motor puro determinista** | Información oculta y competición: si el cliente calcula, se puede editar | Lógica en el cliente con reglas de Firestore |
| D23 | **Horizonte de 30 años** de ficción y **~37 turnos** | Cabe en una campaña asíncrona de 5–6 semanas a un turno por día | Partidas de 300 años |
| D24 | **Crecimiento de fieles** = `× (1 + 0,16 × fidelidad × √(días/30))`, con techo de era y quiebra por debajo de 0,3 de fidelidad (§4.4) | La regla no existía y la dimensión población del IC era inalcanzable; atar el crecimiento a la ventana hace que votar largo sea poblar, no solo esperar | Crecimiento fijo por turno (una ventana de 1 día y otra de 3 años darían lo mismo) |
| D25 | El **hito cultural** vive en el canal `obra` y se abre en `7d` | En `palabra` competía con la investigación y la cultura no avanzaba nunca en la simulación; §4 admite "obra o palabra" | Dejarlo en `palabra` |
| D26 | Las **8 misiones de recuperación** entran en Fase 0, no en Fase 5 | Sin ellas el debuff no tiene salida y sus métricas de duración son inalcanzables; son regla, no contenido | Posponerlas a Fase 5 |
| D27 | El debuff **escala −15 % → −30 %** si la misión caduca a los 5 turnos | Da urgencia real a la cadena de misiones (§5-B.5) | Debuff fijo en −15 % |
| D28 | Los costes de **investigar** (`11 + 4×techs`) y **hito cultural** (`25`) son tuning de Fase 0 | No están en la tabla de §6, así que se ajustaron sin tocarla; con ellos la barra tribal cierra en el turno 16,3 | Ajustar la tabla de §6 o la fórmula de ingreso |
| D29 | En la simulación **votan 3 humanos**; los bots no votan (§5-A.2.3) | Sin votantes la ventana nunca cambia y una partida de 30 años dura 10.950 turnos | Que los bots voten (rompería A.2.3) |
| D30 | El **humano simulado no envía órdenes el 25 % de los turnos**; los bots siempre | Es la fuente real de divergencia: 8 bots optimizadores idénticos nunca se separan 0,25 y el debuff no existiría | Inatención uniforme en todos (partidas más lentas y divergencia menos realista) |
| D31 | El **debuff por cultura/población** se mide por el **peor eje** (32 %) además de la lectura literal | Cualquier pareja de dimensiones atrasadas incluye cultura o población: la lectura literal daría siempre 100 % y no mide nada | Conformarse con la lectura literal |
| D32 | La **válvula de barra estancada** da la tecnología a la **civilización más atrasada**, no a un dios dormido | Un dormido no cuenta en la media, así que su tecnología no movería la barra: la regla, como estaba escrita, no habría funcionado | Implementarla tal cual escrita |
| D33 | **3 de las 8 áreas de ejemplo** tienen pasiva en Fase 0 (Minerales +20 %, Ganado +fidelidad, Magia Demoníaca −10 % y +1 magia) | Son las únicas de §6.1 con efecto sobre la resolución; el resto necesita acciones exclusivas, que son de Fase 5 | Inventar efectos provisionales para las otras cinco |
| D34 | La guerra solo se declara con **≥2,2× de poder** y con **tregua de 5 turnos**; la batalla es `d20 + poder` contra `10 + poder rival` (§9) | Con vasallaje por simple superioridad de 2× se vasallizaba en el 90 % de las partidas, muy lejos del 60–80 % sin vasallaje de §18 | Vasallaje por superioridad numérica |
| D35 | **XP de las acciones rutinarias reducida** (milagro +1, investigación +3, hito +3, templo +2…) | La Divinidad a los 10 años salía en 7,0 con XP generosa; el objetivo es 5–7 | Subir los umbrales de §4.3 |
| D36 | Los **hitos globales simultáneos** se resuelven por **mérito** (más fieles, luego más tecnologías, luego id menor) | Todos los asientos actúan a la vez y varios pueden cruzar el umbral en el mismo turno; decidirlo por orden de asiento daba sistemáticamente el hito al asiento 0 (7 hitos de media frente a 0,5 de los demás) | Orden de asiento |
| D37 | La **madurez de era** sube de 0,70 a **0,75** (§5-B.2) | Con 0,70 y el desempate por mérito, la modernidad llegaba en el turno 23,1 y §18 exige 24–30; a 0,75 quedan 15,8 y 25,0, ambas bandas cumplidas | Tocar el desempate de hitos o la fórmula del IC |
| D38 | **Next.js 16.4.3, React 19.3.1 y Tailwind 4** en lugar del 15 que citaba el plan | Es la versión estable actual y la que recibe parches; Next 16 renombró `middleware.ts` a `proxy.ts` y el refresco de sesión vive ahí | Fijar Next 15, ya sin soporte |
| D39 | La clave de los asientos es **`(match_id, seat_idx)`**, no un uuid propio | `winner_seat`, `vassal_of` y `at_war_with` ya son enteros; una sola forma de referirse a un asiento simplifica RLS y evita joins | UUID por asiento con claves foráneas dobles |
| D40 | **Toda escritura pasa por `service_role` salvo `orders`**; reclamar un asiento va por la API | Una política de UPDATE en `seats` dejaría al jugador intentar ocupar otro asiento; la API sí comprueba `auth.uid()` y el estado de la partida | Políticas de escritura amplias |
| D41 | **`seat_state` no tiene políticas**: devuelve 0 filas, no un error | Cumple «A no ve la Fe de B» sin revelar siquiera si existe la fila; `service_role` sigue leyendo para calcular la vista | Denegar por GRANT, que devuelve error y filtra la existencia |
| D42 | La crónica privada vive en **`chronicle` (sin políticas)** y lo público en la vista **`chronicle_public`** | RLS no oculta columnas; la vista expone solo `public_text` y filtra por pertenencia | Guardar lo privado en `turn_events` o duplicar tablas |
| D43 | Las páginas verifican la sesión con **`getClaims()`** y el token se refresca en `proxy.ts` | `getSession()` lee la cookie sin validarla; `getClaims()` comprueba la firma. En Next 16 `middleware.ts` ya no se ejecuta | `getSession()` en servidor |
| D44 | Se aceptan **`publishable key` y `anon key`** | Supabase migró los proyectos nuevos a `sb_publishable_…`; aceptar ambas evita que el arranque falle por el nombre de la variable | Exigir solo la anon key heredada |
| D45 | La app **arranca sin claves** y la Fase 1 se parte en **1A (nube) / 1B (tu equipo)** | El desarrollo ocurre en la nube sin credenciales; lo que exige cuenta se anota en `PENDIENTES.md` con ID en vez de fingir que está probado | Bloquear el avance hasta tener Supabase |
| D46 | Las migraciones se ejecutan en **Postgres 17 en memoria (PGlite)** dentro de `npm test` | La RLS es el invariante crítico y la auditoría de texto no demuestra que las políticas funcionen; PGlite aplica el SQL real y permite cambiar de rol sin red ni claves | Esperar a P-03 para probar cualquier política, o confiar solo en expresiones regulares |
| D47 | La **política de ventana** (`table`/`fixed`) y la ventana fija viven en `MatchState`, no solo en la configuración | Una partida de ritmo fijo debe reproducirse igual al recargar o al reanudar; si la política solo existiera en el arranque, al volver a cargar el estado la mesa empezaría a votar | Guardar la política fuera del estado |
| D48 | La **equivalencia de compases** se exige sobre la fase de compases (ingreso y plan), no sobre el turno entero | El crecimiento (§4.4), el evento, la guerra y la época son por turno; exigir que `3y` sea igual a ocho turnos de `3m` obligaría a inventar un «sub-turno» con sus propias tiradas y cambiaría el juego. La fase que sí se reparte se parte en 8 y se prueba byte a byte | Redefinir el motor para que todo sea por compás |
| D49 | El modo `fixed` **ignora choques y techos de guerra** | Es un modo de simulación y de partidas pactadas: si un choque cambiara la ventana, un golden por ventana dejaría de estar fijado y no se podrían comparar ritmos con la misma semilla | Aplicar los recortes también en `fixed`, perdiendo el golden por ventana |
| D50 | En la rebanada de un jugador la ventana se sortea con **un votante simulado**, no con papeleta | La papeleta real (proponer, votar, mayoría, secreto) es Fase 4; sin votante la ventana nunca cambiaría y 12 turnos serían 12 días de ficción. El motor ya modela la mesa simulada y no hubo que tocar reglas | Inventar una papeleta a medias antes de la Fase 4 |
| D51 | **Sin elección de problema de era no hay efecto**, y los bots no eligen hasta la Fase 6 | Así el problema entra en el motor sin mover ninguna partida ya validada (huellas y simulación de Fase 0 intactas) y sin inventar una política de bots a medio hacer. El humano sí elige desde la Fase 3 | Aplicar una opción por defecto a los bots, que habría cambiado el equilibrio de §18 |
| D52 | Crónica **por plantillas** también en la rebanada: 45, no 150 | La Fase 3 pide 40; el resto es contenido de Fase 5. Cero dependencia de un LLM en el camino crítico (§17.3) | Empezar por el LLM y dejar el texto para el final |
| D53 | El estado se guarda **normalizado en columnas** (sin `state jsonb`) y se aplica con una función SQL idempotente | Es la forma de que recargar reproduzca la partida y de que dos clics no resuelvan dos veces: `claim_turn` es atómico y `apply_turn` proyecta de forma absoluta. Un blob JSON habría duplicado la verdad y roto la privacidad por columnas de §4.1 | Guardar el estado entero en una columna y dejar las tablas como caché |
| D54 | **`/preview/turno`** enseña la pantalla con datos del motor y sin base de datos | Sin claves no se puede jugar, pero la fase pide una pantalla y hay que poder revisarla. No escribe ni simula la persistencia: el botón está desactivado y se anuncia como vista de revisión | Dejar la interfaz sin revisar hasta tener Supabase |

---

## 2. Descartado y por qué

- **Firebase Spark como backend.** Sin Blaze no despliega Cloud Functions ni Cloud Run; toda la lógica
  viviría en el navegador y cualquiera podría editarse la Fe desde la consola. Sirve solo para push.
- **Neon en el camino crítico.** Autosuspensión a los 5 minutos y sin Realtime: añade latencia a cada
  turno sin resolver nada que Supabase no resuelva.
- **Magic links.** El SMTP integrado de Supabase tiene un límite de correos por hora muy bajo: el día
  del lanzamiento no entra nadie. Se usa email + contraseña con confirmación desactivada, más login
  anónimo.
- **Umbral de 1/3 con mayoría.** Producía un salto brusco sin señal previa. La barra continua lo
  sustituye.
- **Penalizaciones de las tecnologías de resorte.** Se implementaron y se retiraron: castigaban sin
  crear una decisión interesante. Los nombres ("resorte", "fábrica") quedan como sabor.
- **Muerte divina permanente y vasallaje irreversible de la novela real.** Demasiado castigo para una
  partida de 40 minutos; el vasallaje da una estatua y se puede romper con hechos.
- **Bots que igualan automáticamente las dimensiones.** Un catch-up fuerte en la política borraba
  cualquier divergencia: sin atraso no hay debuff ni decisión de recuperación. Se dejó débil y se
  compensó con la inatención de los humanos (D30).
- **Medir el Fe sobrante en todas las ventanas.** En ventana media y larga el cuello de botella es el
  compás (§6), no el dinero: medir ahí obligaría a recortar ingresos por diseño, no por desequilibrio.
- **Sprites, modelado 3D, voz, app nativa, ranked público, monetización.** Fuera de alcance de la v1.

---

## 3. Mapa de la obra → contenido

No hace falta leer la novela para implementar; esto indica de dónde sale cada pieza.

| Fuente | Qué aporta al juego |
|---|---|
| **Arco 1** (caps. 1–24) | Era tribal, primeras bendiciones, control divino, creación de criaturas, ruinas, magia demoníaca, choque de civilizaciones |
| **Arco 2** (25–66) | Grandes reinos, profecía contradictoria, automatización, primeros vasallajes, Más Allá |
| **Arco 3** (67–108) | Ascensión y apóstoles, hierofanía, piratas, campañas navales |
| **Arco 4** (109–168) | Guerra total, panteón, engaño, asedios, el poder de reemplazar a un dios |
| **Arco 5** (169–215) | Rubberpunk: industria, ferrocarril, revoluciones, dragones como arma |
| **Arco 6** | **No entregado.** Su tramo cae dentro de la guerra total del Arco 4, que sí está cubierto |
| **Arco 7** | Segunda luna, la Caída y el Salón: material del modo historia "La Caída" |
| **Línea de tiempo** | Saltos de +9, +137, +83 y +27 años: inspiración directa de las ventanas largas y de las eras |
| **Teoría del juego** | Bucle de turno, costes, condiciones de victoria, escenarios listos para jugar |

---

## 4. Preguntas abiertas

1. **Narración.** ¿Plantillas solas en la v1 (recomendado) o LLM encendido desde el principio, asumiendo
   cuotas gratuitas muy bajas?
2. **Ritmo.** `unlockEvery: 5` es el valor pedido; la simulación de Fase 0 da **41,9 turnos de media**
   con 8 asientos (dentro de 37 ± 6). Con `3` bajaría a ~27 y con `2` a ~22. Recomendado `3` para el
   modo corto; medido, no supuesto, en cuanto haya una simulación con ese parámetro.
3. **El tope en el endgame.** Con Divinidad 11 el tope (100.000 × factor) queda muy por encima de lo que
   la raíz cuadrada permite recaudar: deja de morder y pasa a ser la meta de ahorro del Apóstol. Si se
   quiere que muerda siempre, hay que bajar la base alta o subir la curva de ingreso.
4. **Tamaño de mesa por defecto.** 8 asientos (2–3 humanos) es la propuesta; el techo de 32 sigue ahí
   como modo "mundo completo".
5. **Vasallaje de un dios dormido.** ¿Cuenta como rival para la victoria estándar? Propuesta: no cuenta
   salvo que haya despertado como dios maligno.
6. **Equilibrio de las personalidades de los bots.** Medido con 500 partidas: la expansiva gana el 84 %
   de las que ganan bots (fanática 13 %, maquiavelo 3 %), y dentro de ella la carta *Minerales* (+20 %
   de ingresos) concentra las victorias. Los pesos de personalidad son invento de implementación
   (§17.1 solo da "peso territorio / fieles-fama / profecías"), así que no es una regla mal escrita:
   hay que reequilibrar la política, o rebajar el +20 % de *Minerales* cuando el catálogo de 32 áreas
   pase a Fase 5. **Pendiente antes de jugar contra esos bots.**

---

## 5. Glosario

| Término | Significado |
|---|---|
| **Fe** | Moneda divina. Se recauda de los fieles y se gasta en milagros, obras, bendiciones y creaciones |
| **Tope de Fe** | Máximo acumulable. Depende de la Divinidad y del logaritmo de la población. Limita lo que guardas al cerrar cada compás, no lo que gastas |
| **IC** | Índice de Civilización, 0–1: 0,50 tecnología + 0,25 población + 0,25 cultura |
| **Ventana** | Duración ficticia del turno (1d … 3y), votada por los humanos |
| **Compás** | Cada una de las 8 subdivisiones de un turno. Es la unidad de planificación |
| **Canal** | Tipo de acción que cabe en un compás: milagro, obra, héroe, palabra |
| **Situación** | El problema que el pueblo enfrenta en el turno, con tres opciones. Su registro depende de la ventana (escena, crisis o era) |
| **Etapa** | Tribal, Grandes Reinos o Modernidad. Se alcanza con la barra de época |
| **Subetapa** | Cuarto de la barra, con nombre propio (Tribu Antigua, Reinos Consolidados, Modernidad Eléctrica…) |
| **Barra de época** | Progreso público del mundo: promedio del IC, dividido por 0,75 (madurez de era), con techo en 100 % |
| **Debuff primitivo** | Penalización por estar atrasado en dos de las tres dimensiones del IC |
| **Botín** | Fe inmediato de un hito global, expresado como porcentaje del tope |
| **Hito global** | Logro único de partida; da un buff de 2 turnos o un botín |
| **Área Pequeña** | Carta de especialidad del dios (32 en la baraja; *Insectos* es la maldita) |
| **Dominio Único** | Carta de identidad del dios; se activa a Divinidad 3 |
| **Causalidad** | Regla que encarece forzar el mundo: seguirla abarata, romperla multiplica el coste |
| **Vasallaje** | Someter a un dios rival; su estatua entra en tu panteón |
| **Apóstol / Hierofanía / Más Allá** | Las tres herramientas de fin de partida: héroe inmortal, descenso personal y ultratumba propia |
