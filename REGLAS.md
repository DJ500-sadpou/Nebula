# REGLAS v0.1 — "El Mundo Perdido" (adaptación web)

Especificación del motor. Deriva de *La Civilización Nebula* (arcos 1–5 y 7), del documento
`Teoria_del_Juego_y_Guia_de_Roleo.md` y de la línea de tiempo. Los números son **tuning inicial**:
la Fase 0 los valida con simulación headless antes de escribir interfaz.

Convención: `[N]` = valor numérico ajustable. Todo el texto de juego va en español.

---

## 1. Principios de diseño

1. **Guía indirecta.** El dios no mueve unidades: manda señales, milagros, bendiciones y elegidos.
   Forzar la causalidad es posible pero caro. Es la tensión central de la obra.
2. **Información imperfecta.** Nadie ve la Fe exacta del rival, ni el coste de sus milagros.
   Solo se ve lo que el mundo puede observar.
3. **Texto y opciones.** Sin sprites. Cada turno es un informe narrado + un menú de 3–6 opciones
   con coste visible. La interfaz *es* el juego.
4. **Determinismo.** Mismo seed + mismas órdenes = mismo resultado. Requisito de anti-trampa y de tests.
5. **Nadie se queda esperando.** Asientos vacíos se llenan con IA o duermen. El turno nunca se bloquea.

---

## 2. La mesa: de 4 a 32 asientos

| Tipo de asiento | Cuándo | Comportamiento |
|---|---|---|
| `humano` | Jugador real | Envía órdenes en su turno |
| `bot` | Lobby incompleto | IA de utilidad, juega con las mismas reglas |
| `dormido` | Lobby muy incompleto o abandono | No actúa; deriva, genera eventos y puede "despertar" como dios maligno |
| `vacio` | Sin asignar | Actúa como `dormido` con menor probabilidad de evento |

- Tamaño de partida configurable: **4 a 32 asientos**. Mesa por defecto: **8 asientos**
  (2–3 humanos + 5–6 IA). Los 32 asientos quedan como modo "mundo completo".
- Con 2–3 humanos y `unlockEvery: 5`, una campaña son **~37 turnos** (5–6 semanas en asíncrono a
  1 turno/día); con `3`, ~27; con `2`, ~22. El trienio se alcanza en el turno 31, 19 o 13. Horizonte
  de ficción por defecto: **30 años** (§5-A.9).
- El motor no distingue tipos de asiento: siempre resuelve **N asientos** (el tamaño elegido al crear).
  Con 8 se juega en ~35 min; con 32, en ~90. El techo de 32 es fiel a la novela; la mesa normal es 8.
- Al iniciar, cada asiento roba **1 Área Pequeña** de la baraja de 32 y **1 Dominio Único**.
- Si un humano abandona, su asiento pasa a `bot` en el turno siguiente (nunca se borra: sus fieles siguen).

---

## 3. El dios

| Componente | Regla |
|---|---|
| **Área Pequeña** | 1 de 32, al azar. Define 2 acciones exclusivas y un descuento temático. `Insectos` es la carta maldita (peor ratio histórico). |
| **Dominio Único** | 1 al azar por partida (Guerra, Enfermedad, Cadáver, Magia, Sueños, Silencio, Umbral…). Se **activa a Divinidad 3** y es la identidad del dios. |
| **Especie** | Humano, elfo, orco, gnoll, hombre lagarto, kobold, enano, hada. Modifica rasgos iniciales. |
| **Tribu inicial** | 30 fieles, 1 región, 0 templos, fidelidad [0,55]. |
| **Nombre divino** | Libre, 2–24 caracteres. Es lo único cosmético obligatorio. |

---

## 4. Recursos

| Recurso | Se gana con | Se gasta en | Visible para rivales |
|---|---|---|---|
| **Fe** | Fieles, templos, oraciones, sacrificios, fama | Milagros, bendiciones, creaciones, profecías, trances | No (solo banda) |
| **XP** | Hitos, choques, ruinas, guerras, vasallajes | — (sube Divinidad) | No |
| **Divinidad** (nivel 1–11) | Umbral de XP | — | Banda aproximada |
| **Esencias** | Matar Abominaciones/Demonios | Creaciones | No |
| **Fama** | Estatuas, milagros públicos, leyendas | — (bonus de ingresos, `fama/20`) | Sí |
| **Fidelidad** [0–1,5] | Bienestar, sentido, victorias | — (se degrada con hambre y propaganda) | No |

**Cultura** no es una moneda: es la cuenta de **hitos culturales** de la era (0–12, §5-B.1). Se reclama
con acciones de los canales `obra` o `palabra`, sube fidelidad y fama, y entra en el Índice de
Civilización junto a la tecnología y la población.

### 4.1 Ingreso de Fe

```
ingreso_30d    = 6 × sqrt(10 × fieles) × fidelidad + templos × 10 + round(fama / 20)
ingreso_turno  = max( ingreso_30d × (días_del_turno / 30), 0,20 × ingreso_30d )
ingreso_compas = ingreso_turno / compases_del_turno
```

Ejemplos con fidelidad 0,8 y sin templos:

| Fieles | Ingreso / 30 días |
|---|---|
| 30 | 83 |
| 100 | 152 |
| 1.000 | 480 |
| 10.000 | 1.518 |
| 100.000 | 4.800 |

Dos decisiones de forma, y las dos son deliberadas:

- **Raíz cuadrada.** Un imperio de cien mil fieles no produce mil veces más Fe que una tribu de cien:
  administrar es caro. Sin esa curva, el tope de §4.2 dejaría de importar en cuanto llegaran los reinos.
- **Suelo del 20 % del ingreso mensual.** El diezmo no se detiene porque el mundo tenga prisa. Sin ese
  suelo, un turno de `1d` recaudaría menos de 3 Fe y las cinco primeras vueltas de la escalera (§5-A.2)
  serían injugables.

### 4.2 Tope de Fe: nivel y población

```
tope = tope_base[nivel] × (1 + log10(fieles / 30))
```

| Nivel | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `tope_base` | 100 | 200 | 400 | 700 | 1.200 | 2.000 | 3.500 | 6.000 | 10.000 | 20.000 | 100.000 |

El factor de población es logarítmico: **cada vez que la población se multiplica por diez, el tope
suma el 100 % de la base**. Con Divinidad 5 (base 1.200):

| Fieles | 30 | 300 | 3.000 | 30.000 | 300.000 |
|---|---|---|---|---|---|
| Tope | 1.200 | 2.400 | 3.600 | 4.800 | 6.000 |

Así el techo crece con el pueblo sin explotar, y la Divinidad sigue pesando más: subir de nivel
duplica o triplica el tope; multiplicar por diez la población solo le suma una base.

### 4.3 Umbrales de XP

| Nivel | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|---|---|---|---|
| XP | 30 | 80 | 150 | 250 | 400 | 600 | 900 | 1.300 | 1.800 | 2.500 |

Ganancias: hito de era **+15**, choque de civilizaciones **+10**, ruina explorada **+20**,
guerra ganada **+25**, vasallaje **+50**. Pérdidas: creación muerta **−15**, profecía fallida **−30**,
cada 10 fieles perdidos **−1**.

Las acciones rutinarias dan XP menor, para que el nivel se gane con hitos y no con repetición:
milagro **+1**, investigación **+3**, hito cultural **+3**, templo **+2**, bendición **+2**,
expansión **+3**, creación **+4**, profecía cumplida **+25**. Es tuning de Fase 0: validado para que
una partida de 30 años cierre alrededor de Divinidad 6 (§18).

### 4.4 Crecimiento de los fieles

```
fieles = fieles × (1 + 0,16 × fidelidad × sqrt(días_de_ventana / 30))
```

- **La ventana manda.** En `1d` crece ≈1,8 % por turno, en `30d` ≈7 %, en `1y` ≈37 % y en `3y` el tope
  de multiplicador (1,6). Un trienio es una generación entera: por eso las ventanas largas son la vía
  para poblar y por eso se vota con cuidado.
- **Techo de era.** Los fieles no superan el techo de la era (§5-B.1): 5.000 en tribal, 200.000 en
  reinos, 5 M en modernidad. La dimensión población del Índice de Civilización se mide contra ese
  suelo y ese techo, así que una civilización nunca puede "pasarse" de era por población.
- **Fidelidad por debajo de 0,3: el pueblo se apaga** y pierde el 10 % de fieles por turno. La
  fidelidad es lo que hace crecer al pueblo; sin ella, la civilización se encoge.
- Es la regla que hace que la dimensión **población** sea alcanzable dentro de una partida y no una
  carrera de 30 años. El coeficiente 0,16 es tuning de Fase 0.

---

## 5. El turno (1 turno = 1 ciclo histórico)

Duración objetivo: **~37 turnos** (`unlockEvery: 5`), ~27 con `3` y ~22 con `2`. 2–3 min por turno en
vivo, 12–24 h en asíncrono. La duración ficticia de cada turno es una ventana variable (ver §5-A).

| # | Fase | Quién | Tiempo | Qué pasa |
|---|---|---|---|---|
| 1 | **Recaudación** | Servidor | instantáneo | Ingreso de Fe, mantenimiento, deriva de fidelidad, hambrunas |
| 2 | **Informe privado** | Servidor → jugador | — | Crónica del turno + estado + problema de era |
| 3 | **Intervención** | Jugadores (secreto) | 120 s (60/240/∞) | Se planifica la ventana en sus 8 compases y se envía |
| 4 | **Civilización** | Jugadores | 60 s | Se elige cómo responde el pueblo al problema de era |
| 5 | **Resolución** | Servidor | < 2 s | Orden determinista (ver §8) |
| 6 | **Crónica** | Servidor | — | Texto público + privado, XP, niveles, victoria |

- "Listo" de todos acelera la fase. Temporizador agotado = acción por defecto (`no intervenir` /
  `continuar como está`). **Un jugador desconectado nunca bloquea la partida.**
- Modo asíncrono opcional (`∞`): el turno avanza cuando todos han marcado listo o tras 12 h.
- La **duración ficticia** del turno no es fija: es una ventana temporal que se desbloquea y se vota.
  Ver §5-A.

---

## 5-A. Escala temporal variable (ventanas)

El turno tiene **dos relojes** que no deben confundirse:

| Reloj | Qué mide | Quién lo controla |
|---|---|---|
| **Tiempo real** | Cuánto esperan los jugadores (§5) | Temporizador de la partida (120 s, 12 h, 24 h…) |
| **Tiempo de ficción** | Cuántos días pasan en el mundo | **Ventana** elegida por votación |

### A.1 Las siete ventanas

| id | Días | Nombre | Registro | Qué cabe |
|---|---|---|---|---|
| `1d` | 1 | Día | Escena | Un milagro puntual, un sueño, una escaramuza, una cacería |
| `7d` | 7 | Semana | Escena | Ritual, consejo de ancianos, santuario pequeño, escaramuza |
| `30d` | 30 | Mes | Crisis | Templo, cosecha, plaga, migración corta |
| `3m` | 91 | Estación | Crisis | Campaña militar, muralla, herejía, ruta comercial |
| `6m` | 182 | Semestre | Crisis | Guerra, alianza matrimonial, academia, hambruna |
| `1y` | 365 | Año | Era | Código legal, reforma religiosa, generación de bendiciones |
| `3y` | 1.095 | Trienio | Era | Ciudad, cambio de dinastía, era tecnológica, apostolado |

**Sin peldaño de 9 años.** Motivo: con 2–3 jugadores la escalera ya llega al trienio en el turno ~31,
y añadir un peldaño más alargaba la campaña sin aportar decisiones nuevas. El efecto "generacional"
se consigue con **tres trienios consecutivos** (tres puntos de decisión) en lugar de uno solo, y el
contenido que en la novela vive en el salto de +9 años (apostolado, Más Allá, era industrial) se
re-etiqueta a `3y` o a un hito de varios turnos.

### A.2 Desbloqueo y votación

La escalera se abre **cada 5 turnos** (`unlockEvery`, configurable 2–5):

| Turno | Se desbloquea |
|---|---|
| 1 | `1d` |
| 6 | `7d` |
| 11 | `30d` |
| 16 | `3m` |
| 21 | `6m` |
| 26 | `1y` |
| 31 | `3y` |

Reglas de la votación:

1. Cualquier asiento puede **proponer** una ventana al inicio del turno, entre las ya desbloqueadas
   **y permitidas por el estado del mundo** (A.11: un choque o una guerra recortan las opciones).
2. Se abre una papeleta con las opciones: la ventana actual, la propuesta y "volver a una más corta".
3. **Solo votan los humanos.** Bots y dioses dormidos se abstienen (no deciden el ritmo de la partida).
4. **Mayoría simple** de los votos emitidos. Empate o sin quórum → se mantiene la ventana actual.
5. El resultado se aplica **al turno siguiente**, nunca al que está en curso.
6. Se puede **acortar** la ventana, no solo alargarla. Siempre queda disponible la más corta.
7. Los votos son secretos hasta el cierre de la papeleta; después se publican con la crónica.
8. Si nadie propone, no hay papeleta y todo sigue igual. La votación nunca bloquea el turno.

### A.3 El compás: ocho por turno

La pieza que hace que una ventana de 3 años y una de 1 día se jueguen **con la misma interfaz**:
todo turno se divide en **8 compases**.

| Ventana | Duración de cada compás |
|---|---|
| `1d` | 3 horas |
| `7d` | 21 horas |
| `30d` | 3 días 18 h |
| `3m` | 11 días |
| `6m` | 23 días |
| `1y` | 45 días |
| `3y` | 137 días (4,5 meses) |

- **Paralelo:** en un mismo compás, una acción por **canal**. Hay 4 canales:
  `milagro`, `obra`, `héroe`, `palabra`.
- **Acumulativo:** la misma obra en compases consecutivos (templo → templo → templo).
- Máximo teórico: 8 compases × 4 canales = **32 acciones por turno**. En la práctica, 3–8.
- La UI es idéntica en todas las ventanas: una línea de 8 casillas, no un menú distinto por escala
  (el único buff que la altera es `compas+`, §10-A, que añade una casilla durante 2 turnos).

### A.4 Qué se puede ofrecer en cada ventana

Cada acción, evento y problema de era lleva etiqueta temporal. El menú del turno **filtra**:

| Acción | `minWindow` | Compases | Reactiva |
|---|---|---|---|
| Milagro puntual (señal, sueño, curación) | `1d` | 1 | Sí |
| Escaramuza, rescate, golpe de mano | `1d` | 1 | Sí |
| Ritual, festival, consejo | `7d` | 1 | Sí |
| **Hito cultural** (tótem, rito, canto, leyenda) | `7d` | 2 | No |
| Templo | `30d` | 2 | No |
| Migración, cosecha, plaga | `30d` | 2–3 | No |
| Campaña, muralla, herejía | `3m` | 3 | No |
| Guerra, alianza, academia | `6m` | 4 | No |
| Código legal, reforma religiosa | `1y` | 5 | No |
| Bendición generacional | `1y` | 5–6 | No |
| Ciudad, dinastía, apostolado | `3y` | 6–8 | No |

**Regla dura:** las acciones **reactivas** (batalla, rescate, traición, herejía) solo aparecen en
ventanas de `30d` o menos. En un trienio no puedes responder a una incursión: la resuelve tu
organización, no tú. Esto es lo que impide que la ventana larga sea siempre la mejor jugada.

### A.5 Economía dentro de la ventana

```
ingreso_turno  = max( ingreso_30d × (días_turno / 30), 0,20 × ingreso_30d )
ingreso_compas = ingreso_turno / 8
```

- El **tope de Fe** (§4.2) no escala con la ventana: limita lo que puedes **acumular al cerrar cada
  compás**, no lo que puedes gastar durante él.
- Ejemplo: 100 fieles, fidelidad 0,8, Divinidad 5 → `ingreso_30d` = 152 y tope = 1.828. Con ventana
  `3y` el turno recauda **5.548 Fe**, unos **694 por compás**: el tope obliga a gastar unas tres veces
  dentro del turno. La ventana larga es un examen de planificación.
- Con ventana `1d` y 30 fieles el turno entero recauda **17 Fe** (suelo del 20 %): el juego es de
  precisión, no de acumulación.

### A.6 La ley de balance: precisión contra alcance

| Ventana | Control | Alcance | Coste |
|---|---|---|---|
| Corta (`1d`–`30d`) | Alto: reaccionas, nombres propios, resultados individuales | Bajo: no construyes civilización | Los compases se gastan en reaccionar |
| Media (`3m`–`6m`) | Medio: una campaña o una obra | Medio: un frente, una obra grande | Un solo proyecto grande por turno |
| Larga (`1y`–`3y`) | Bajo: no reaccionas, todo se agrega | Alto: estructura, tecnología, dinastía | No reaccionas a nada urgente |

Contrapesos de la ventana larga: acciones reactivas bloqueadas, **deriva aleatoria** de fidelidad de
±(días/30) %, y rivales con los mismos 8 compases. Elegir trienio es apostar a que no pasa nada urgente.

### A.7 Registro narrativo

| Ventana | Registro | Cómo se escribe |
|---|---|---|
| `1d`, `7d` | **Escena** | Diálogos con personajes con nombre, el Sumo Sacerdote habla en primera persona |
| `30d`, `3m`, `6m` | **Crisis** | Crónica de un conflicto, tres o cuatro voces |
| `1y`, `3y` | **Era** | Crónica agregada, estadísticas, Aldin comentando el siglo |

Esto es lo que hace que la capa de diálogos tenga sentido: las ventanas cortas **son** la novela visual;
las largas son el libro de historia.

### A.8 Bots, dormidos y votos

- Bots y dormidos **no votan** (A.2.3), pero sí planifican por compases: rellenan con utilidad greedy y
  reservan el último compás para una acción reactiva si la ventana es ≤ `30d`.
- Los dioses dormidos generan un evento **por compás** en ventanas largas (15 % en cortas), de modo que
  un trienio no es un turno vacío.

### A.9 Fin de partida

- Victoria por vasallaje, o
- **Horizonte de ficción** configurable (por defecto **30 años** acumulados) → se cierra por puntuación.
- La puntuación se **normaliza por año de ficción** para que no gane quien jugó más turnos de 1 día.

### A.10 Riesgos de esta mecánica

| Riesgo | Mitigación |
|---|---|
| La escalera tarda 31 turnos en llegar a `3y` | `unlockEvery` configurable; con 2 jugadores, 2–3. Con `2`, el trienio llega en el turno 13 |
| Estancamiento en `1d` (nadie vota alargar) | El mundo escala solo: cadenas de crisis que no se resuelven en un día; y los rivales que sí alargan avanzan |
| Fe desperdiciada en ventanas largas | Planificador por compases y aviso explícito "vas a perder X Fe al cerrar este compás" |
| Papeleta bloqueada o disputada | Empate = mantener; solo humanos; nunca bloquea el turno |
| La ventana larga vuelve inútiles las cortas | Acciones reactivas bloqueadas en `>30d` + deriva + normalización de puntuación |
| Una guerra eterna congela el ritmo en 1–7 días | Desgaste y paz forzada tras N turnos sin avance; el techo se libera al firmar la paz |
| El `1d` forzado del choque llega en mal momento | Es el precio de la fidelidad: el mundo se sobresalta, no elige. Se avisa con un turno de antelación (presagio) |

### A.11 Ventanas forzadas: choques y guerras

La votación no siempre manda. Dos estados del mundo imponen el ritmo:

**1. Choque de civilizaciones → `1d` obligatorio.**
Cuando dos especies de dioses distintos se encuentran por primera vez (§9), el tiempo se detiene para
todos: la ventana pasa a `1d` **automáticamente y sin votación**, durante los **2 primeros días de
ficción** (2 turnos). Al agotarse, se restaura la ventana anterior y se abre papeleta. Un choque nuevo
reinicia el contador.

**2. Guerra → techo de ventana según la etapa del mundo.**

| Etapa del mundo | Cómo se alcanza | Ventanas permitidas mientras haya guerra |
|---|---|---|
| Era tribal — **guerra antigua** | etapa inicial | `1d`, `7d` |
| **Grandes reinos** | barra de la era tribal al 100 % (§5-B.2) | `1d`, `7d`, `30d` |
| **Modernidad** | barra de los grandes reinos al 100 % | `1d`, `7d`, `30d`, `3m` |

Reglas de aplicación:

- El techo **solo restringe, nunca concede**: no abre una ventana que la escalera de A.2 todavía no
  haya desbloqueado.
- Afecta a **toda la mesa** aunque solo dos dioses estén en guerra: la ventana es global.
- La etapa es global, así que **todas las guerras comparten el mismo techo**; no hay conflictos que
  se resuelvan con reglas distintas.
- Se aplica **al inicio del turno siguiente**; nunca cambia el turno en curso.
- Al firmar la paz, la ventana vuelve **automáticamente** a la que había antes de la guerra y se anuncia
  en la crónica ("el mundo respira").
- La etapa **no depende de los turnos**: la marca la barra de época (§5-B.2) y se evalúa al cierre de
  cada turno, de modo que nunca cambia el techo de la ventana a mitad de turno.

**Por qué funciona.** Reproduce el ritmo de la novela: en paz el mundo acelera y se puede pensar en
décadas; con un choque o una guerra todo se vuelve presente y cada día importa. Además rescata las
ventanas cortas en la segunda mitad de la partida, que de otro modo quedarían muertas.

**Ejemplo encadenado.** Turno 24 (modernidad, ventana `3y`) → se descubre un continente y hay choque:
`1d` forzado en los turnos 25 y 26. En el 26 estalla la guerra con los reinos vecinos: siguen
permitidas `1d`/`7d`/`30d`/`3m`. Los jugadores votan `30d` para conducir la campaña. Al firmar la paz
en el turno 31, se restaura automáticamente `3y`.

### A.12 Ventana fija y equivalencia de compases

El estado de la partida lleva **política de ventana**, porque una partida con ritmo fijo tiene que
reproducirse igual al recargarla:

- **`table`** (por defecto): decide la papeleta de A.2, con los recortes de A.11.
- **`fixed`**: la mesa juega siempre la ventana acordada. Ni la votación ni un choque la cambian, y la
  escalera se considera recorrida. No es un modo de juego normal: es el modo de simulación y el de las
  partidas que se pactan antes de empezar.

**Qué significa «equivalencia de compases».** De los trece pasos de §8, solo los pasos 1–5 (cobro del
ingreso y plan de cada compás) se reparten por compás. Se cumple:

- Ejecutar los 8 compases de un turno de una vez y ejecutarlos como **8 sub-turnos de un compás** deja
  el **mismo estado, byte a byte**.
- La suma de los 8 ingresos por compás es el ingreso del turno: el sobrante de la división entra en el
  último compás y no se pierde Fe. Como el Fe se guarda en enteros (§4.1), el cierre de un turno puede
  redondear hacia abajo.
- La rejilla no depende de la ventana: `1d` y `3y` tienen los mismos 8 compases y los mismos 4 canales.
  Solo cambia qué contenido es legal (A.4) y cuánto dura cada compás.

El crecimiento de fieles (§4.4), el evento mundial, el choque, la guerra, la barra de época y los hitos
son **por turno, no por compás**. Por eso una ventana `3y` **no** es «ocho turnos de `3m`»: es un turno
largo con ocho compases de decisión.

---

## 5-B. Etapas del mundo: tecnología, población y cultura

La etapa del mundo **no depende de los turnos ni de una votación**: depende del grado de civilización
de la mesa, medido en **tres dimensiones**. Se muestra como una barra creciente de cuatro subetapas.

### B.1 Las tres dimensiones: el Índice de Civilización

Cada civilización tiene un **Índice de Civilización (IC)** de 0 a 1:

```
IC = 0,50 × tecnología + 0,25 × población + 0,25 × cultura
```

| Dimensión | Cómo se mide | 0 | 1 |
|---|---|---|---|
| **Tecnología** | tecnologías de la era / 12 | ninguna | las 12 |
| **Población** | escala logarítmica entre el suelo y el techo de la era | 30 fieles | 5.000 (tribal) · 200.000 (reinos) · 5 M (modernidad) |
| **Cultura** | hitos culturales de la era / 12 | ninguno | los 12 |

La tecnología pesa la mitad porque es el motor de la novela, pero **no decide sola**: una civilización
con doce tecnologías, trescientos fieles y ningún mito fundacional no es una civilización avanzada,
es un taller con bandera. Pesos configurables (50/25/25 por defecto).

**12 tecnologías y 12 hitos culturales por era:**

| Era | Tecnologías |
|---|---|
| **Tribal** | fuego, lanza de piedra, arco, cestería, curtido, cerámica, agricultura, domesticación, red de pesca, tejido, enterramiento, pintura rupestre |
| **Grandes reinos** | escritura, hierro, rueda, arado, moneda, cantería, calendario, papel, brújula, sillería, arco compuesto, contabilidad |
| **Modernidad** | pólvora, imprenta, resorte, química, telar mecánico, electricidad, máquina de vapor, medicina, ferrocarril, fábrica, radio, motor |

| Era | Hitos culturales |
|---|---|
| **Tribal** | mito de origen, rito funerario, tótem, canto, danza, pacto de sangre, altar, calendario lunar, tabú, leyenda del héroe, ofrenda, memoria de los muertos |
| **Grandes reinos** | código legal, templo monumental, epopeya, escuela, teatro, archivo, calendario solar, mecenazgo, universidad, crónica oficial, herejía, fiesta nacional |
| **Modernidad** | periódico, museo, constitución, ópera, novela, censo, escuela pública, propaganda, academia, ideología, cine, estadística |

Ninguna de las dos listas da penalizaciones: tecnología y cultura **solo abren opciones**. La cultura
sube fidelidad y fama, así que también se convierte en Fe.

### B.2 La barra: promedio del IC

```
progreso = min(1, promedio(IC de las civilizaciones activas) / 0,75)
```

- **0,75 es la madurez de era**: el mundo no espera a que todos sean perfectos para cambiar de época,
  sino a que el conjunto esté maduro. Es configurable y es **tuning de Fase 0**: con 0,70 el mundo
  llegaba a la modernidad un turno antes de lo que pide §18; subirlo a 0,75 lleva la barra tribal al
  turno 15,8 y la de reinos al 25,0, las dos dentro de su banda.
- **Todo sube la barra, no solo la tecnología.** Aportes al IC: una tecnología suma `0,50/12`, un
  hito cultural `0,25/12`, y la población su tramo del 0,25. Con 6 civilizaciones, una tecnología
  nueva mueve la barra ≈**1,0 punto** y un hito cultural ≈**0,5**; con 2 civilizaciones, 3,0 y 1,5.
- La barra **solo sube**, nunca baja: es un registro de hasta dónde ha llegado el mundo. Una plaga
  puede hundir tu población, pero no retrocede el reloj de la humanidad.
- **Civilización activa** = asiento con fieles > 0. Cuentan humanos y bots; los dioses dormidos no.
- Al llegar al **100 %** se pasa a la era siguiente **para todos**, incluidas las que se quedaron
  atrás, y la barra se reinicia en 0 con las listas de la era nueva.
- El cambio se anuncia en la crónica y se aplica al **turno siguiente**, igual que el techo de guerra.
- La barra es **pública**, con **dos marcas**: la tuya y la del promedio.

### B.3 Las cuatro subetapas de cada era

| Era | 0–25 % | 25–50 % | 50–75 % | 75–100 % |
|---|---|---|---|---|
| Tribal | **Tribu Antigua** | **Tribu** | **Tribu Avanzada** | **Tribu Tardía** |
| Grandes reinos | **Reinos Nacientes** | **Grandes Reinos** | **Reinos Consolidados** | **Reinos Tardíos** |
| Modernidad | **Modernidad Temprana** | **Modernidad Industrial** | **Modernidad Eléctrica** | **Modernidad Tardía** |

Sirven para dos cosas concretas:

1. **Anticipar el cambio de era.** "Tribu Tardía" avisa de que el suelo se mueve antes de que se mueva.
2. **Ver quién se está quedando atrás**, dimensión por dimensión: la ficha muestra tu tecnología,
   población y cultura contra el promedio, no un único número agregado.

### B.4 Debuff "Civilización primitiva": dos de tres

```
atraso_dim = promedio_dim − propia_dim ≥ 0,25     (una subetapa en esa dimensión)
debuff si  al menos 2 de las 3 dimensiones están atrasadas
```

Se exigen **dos dimensiones**, no una, para que el debuff signifique "civilización incompleta" y no
"vas segundo en investigación". Una civilización puede ir primera en tecnología y aun así caer: si su
pueblo es pequeño y no ha producido cultura, es un taller con bandera.

| Efecto | Valor |
|---|---|
| Ingresos de Fe | **−15 %** |
| Fidelidad | −0,10 por turno |
| Acciones de la era siguiente | Bloqueadas |
| Misiones de recuperación | **+25 % de velocidad** |
| Peso en la tabla de revueltas | +1 |

- La ficha indica **qué dimensión** te está hundiendo, para que la corrección sea informada.
- Se retira cuando quedan menos de dos dimensiones atrasadas.
- **Gracia de 3 turnos** tras cada cambio de era.
- El debuff **nunca elimina**: encarece y bloquea, pero siempre hay salida (B.5 y B.6).

### B.5 Misiones de recuperación

Al activarse el debuff se abre una cadena de misiones, **con al menos una por dimensión**, para que
ningún tipo de atraso se quede sin salida. Caducan a los **5 turnos**; si caduca, el debuff sube −5 %
(hasta −30 %).

| Misión | Dimensión | Canal | Coste | Compases | Requisito | Efecto |
|---|---|---|---|---|---|---|
| **Emisarios al extranjero** | Tecnología | `palabra` | 40 Fe | 2 | contacto con una civ de la era | +1 tecnología |
| **Copiar el oficio** | Tecnología | `palabra` | 60 Fe | 3 | pacto o guerra con una civ avanzada | +1 tecnología, −0,05 fidelidad |
| **Contratar sabios** | Tecnología | `palabra` | 100 Fe | 4 | ninguna | +2 tecnologías, −0,10 fidelidad |
| **Reforma educativa** | Tecnología | `palabra` | 150 Fe | 6 | ventana ≥ `1y` | +3 tecnologías, +10 % de investigación permanente |
| **Tierra prometida** | Población | `héroe` | 60 Fe | 3 | 1 región libre o conquistada | +30 % de fieles |
| **Año de cosechas** | Población | `héroe` | 80 Fe | 4 | ventana ≥ `6m` | +20 % de fieles y +0,10 fidelidad |
| **Mecenazgo** | Cultura | `obra` | 50 Fe | 3 | ninguna | +2 hitos culturales |
| **Reforma religiosa** | Cultura | `obra` | 120 Fe | 5 | ventana ≥ `1y` | +3 hitos culturales, +0,15 fidelidad |

Con dos misiones bien elegidas se cubre una subetapa de cualquier dimensión.

### B.6 Alianzas: las dos salidas del atrasado

**A) Intercambio cultural con una civilización moderna.** Requiere **pacto** y ventana ≥ `3m`.

| | Efecto |
|---|---|
| El atrasado | +1 tecnología cada 2 turnos, +1 hito cultural cada 2 turnos, y el debuff **exige 3 de 3** dimensiones atrasadas |
| El moderno (**desfavorable para él**) | −30 % de su progreso tecnológico y **cultural**; sus tecnologías y hitos quedan copiables |
| Compensación al moderno | +5 fama/turno y **10 % de los ingresos de Fe** del atrasado |

El intercambio es deliberadamente **malo para el moderno** en tempo y bueno en prestigio y bolsillo:
enseñar cuesta, y por eso el atrasado tiene que negociarlo en vez de exigirlo.

**B) Liga de los rezagados.** Un pacto entre civilizaciones atrasadas:
- Misiones de recuperación: **−25 % de coste y −1 compás**.
- Nadie les enseña: no hay tecnologías ni hitos gratis, solo una escalada más barata.

### B.7 Interacción con las ventanas

- El **intercambio cultural** exige ventana ≥ `3m`: es un proyecto, no un gesto.
- La **reforma educativa** y la **reforma religiosa** exigen ≥ `1y`.
- El debuff **no** cambia la ventana; cambia la etapa (A.11) y las acciones disponibles (A.4).
- El cambio de era se aplica al **turno siguiente** al anuncio.

### B.8 Riesgos de esta mecánica

| Riesgo | Mitigación |
|---|---|
| La barra se estanca porque nadie investiga ni cultiva | Los bots reparten entre las tres dimensiones; si pasan **8 turnos sin que la barra suba**, una civilización dormida aporta una tecnología |
| Un jugador acelera la era para hundir a los rivales | Es legítimo y **visible**: la barra es pública. El debuff exige dos dimensiones, así que se sale de él sin ser el más avanzado |
| La población sola empuja la era | Pesa 25 %: puede adelantar el reloj, pero no completarlo sin tecnología y cultura |
| Una plaga hunde la barra | No puede: la barra es un máximo histórico (ratchet) |
| Los dioses dormidos hunden el promedio | No cuentan: solo civilizaciones con fieles > 0 |
| Con 2–3 humanos son los bots quienes empujan la barra | Es deliberado: la era es propiedad del **mundo**, no de la votación |
| La barra se estanca y **un dios dormido** no puede moverla | **Corregido al implementar:** un dormido no cuenta en la media, así que su tecnología no movería la barra; la válvula da la tecnología a la **civilización más atrasada** de las activas, que sí está en la media |

---

## 6. Acciones de intervención

Cada dios planifica la ventana en **8 compases** (§5-A.3): hasta **una acción por canal y compás**
(`milagro`, `obra`, `héroe`, `palabra`). En la práctica son 3–8 acciones por turno, no 32: el Fe y los
requisitos de §5-A.4 hacen el resto.

Los costes de la tabla son **fijos a propósito**. El Fe es la restricción de la primera mitad de la
partida; en la segunda, cuando la economía crece, el cuello de botella se muda a los **compases** (solo
8), a los **requisitos de ventana** (§5-A.4) y a los topes. Por eso no se reescalan los precios con la
población: lo que se vuelve escaso es el tiempo, no el dinero.

| Acción | Coste | Efecto | Notas |
|---|---|---|---|
| **Milagro menor** | 10 | Señal, curación, enjambre, presagio | Descuento del 50 % si es causal |
| **Milagro medio** | 30 | Plaga local, lluvia, seísmo | Descuento si es causal |
| **Milagro mayor** | 60 | Catástrofe regional, epidemia | Solo a partir de Divinidad 3 |
| **Bendición** | 10 × fieles afectados (mín. 5) | Rasgo **heredable** de especie | 1 bendición nueva por turno |
| **Creación** | 40/80/150 + 1/2/3 Esencias | Criatura héroe (nivel 3/6/10) | Muere → −15 XP y −10 Fe |
| **Templo** | 60 | +10 Fe/turno, +fama | Máx. 3 por turno |
| **Sumo Sacerdote** | 25 | Un mortal canaliza tu poder | 1 por partida, puede morir |
| **Control Divino** | 50 + 10/turno | Posees a un fiel: +D3 a sus tiradas | Si el cuerpo muere: −30 Fe |
| **Encarnación** | 120 + 30/turno | Cuerpo propio, poder ×4 en guerra | Divinidad 6+ |
| **Profecía** | Apuesta 20–80 | Anuncia un hecho a N turnos | Ver §12 |
| **Guía directa** | 100 (fiel) / 1.000 (no fiel) | Le dices exactamente qué hacer | La regla de causalidad cobrada |
| **Susurro** | 0 | Mensaje privado a otro dios | 3 por turno, longitud 280 |
| **Silencio** | 0 | No intervenir: +5 Fe, +0,05 fidelidad | Nunca es la peor jugada |

### 6.1 Áreas Pequeñas (baraja de 32)

Cada área da **2 acciones exclusivas** y un descuento. Ejemplos de diseño:

| Área | Pasiva | Acción exclusiva A | Acción exclusiva B |
|---|---|---|---|
| Insectos | Milagros de plaga −40 % | Enjambre (30): acelera cosecha o propaga enfermedad | Criadero (80): +1 Esencia/turno |
| Mar | Sin coste de cruce naval | Sabotear flota (50) | Marea (40): destruye costa |
| Aves | +1 radio de exploración | Reconocimiento total del mapa | Mensajero (20): susurro gratis |
| Minerales | +20 % ingresos | Forja (60): +1 tech | Terremoto (60) |
| Ganado | +fidelidad pasiva | Domesticar (40): +5 fieles/turno | Estampida (30) |
| Magia Demoníaca: X | +1 magia, −10 % Fe | Hechizo (fe variable) | Pacto (60): +2 Esencias, −fidelidad |
| Enfermedad | Plagas no cuestan Fe | Pandemia (80) | Inmunidad (50) |
| Sueños | Los informes rivales filtran una línea | Oráculo (40) | Pesadilla (30): −fidelidad rival |

El catálogo completo (32 áreas × 2 acciones) se escribe en **Fase 5**. Toda área debe tener
al menos dos acciones viables: criterio de aceptación de contenido.

---

## 7. La regla de causalidad

Toda acción se clasifica antes de resolverse:

| Tipo | Multiplicador de coste | Ejemplo |
|---|---|---|
| **Causal** | ×0,5 | Usar langostas para limpiar la hierba y atraer una manada |
| **Neutra** | ×1 | Curar a un fiel |
| **Directa** | ×4 | Mover un río para salvar a un individuo |
| **Sobre no creyente** | ×10 | Cualquier intervención directa sobre quien no te adora |

Guía directa (decirle a alguien exactamente qué hacer) **no se multiplica: se cobra plano**
(100 / 1.000) y deja rastro observable. Es el atajo que la novela castiga.

En la interfaz, cada opción muestra su coste final ya calculado. El jugador nunca hace la cuenta.

---

## 8. Orden de resolución (determinista)

```
1. Recaudación (ingresos, mantenimiento, deriva)
2. Profecías: registro y verificación
3. Bendiciones (cambian la especie)
4. Creaciones (aparecen en el mundo)
5. Milagros (por orden de asiento, luego por coste)
6. Civilización (elección del problema de era)
7. Evento mundial: **una tirada d20 por turno** (seed = hash(seed, turno)); las ventanas largas
   añaden además eventos de dioses dormidos por compás (§17.2)
8. Contactos → Choques → Batallas
9. Ruinas y demonios
10. XP, niveles, topes
11. Hitos globales (§10-A): comprobar y otorgar buffs
12. Comprobación de victoria
13. Crónica
```

- Cada paso lee el estado resultante del anterior. Nada se resuelve "en paralelo".
- RNG: `seed = match.seed`, y en cada paso `rng = mulberry32(hash(match.seed, turno, paso))`.
- La resolución es **idempotente**: si ya existe `turn_resolutions(match_id, turno)`, se devuelve
  el resultado guardado y no se recalcula.

---

## 9. Contacto, choque y guerra

- **Contacto:** dos civilizaciones con regiones adyacentes. Se anuncia públicamente.
- **Choque de civilizaciones:** primer contacto entre especies de dioses distintos → **+10 XP a ambos**
  y una línea en la crónica mundial. Es el detector de rivales de la novela, y **fuerza ventana `1d`
  durante los 2 turnos siguientes** (§5-A.11).
- **Guerra:** mientras haya una guerra activa, el techo de ventana baja según la etapa del mundo
  (§5-A.11): `7d` en la era tribal, `30d` en los grandes reinos, `3m` en la modernidad.
- **Poder militar** = `fieles/10 + tecnología×2 + bendiciones bélicas + héroes`.
  Apóstol ×2 en un frente; Hierofanía ×4 durante un turno (y mantenimiento ruinoso después).
- **Batalla:** `d20 + poder + floor(Divinidad/2)` vs `10 + poder rival`. Ventaja si el atacante
  preparó el terreno (2d20, quedarse el mejor).
- **Vasallaje:** el derrotado entrega su estatua. Sus fieles siguen existiendo; su Fe se reduce al 50 %
  y tributa el 20 % al vencedor. Puede liberarse con hechos puntuables de sus fieles.

---

## 10. Victoria

| Modo | Condición |
|---|---|
| **Estándar** | Vasallar a todos los rivales con territorio |
| **Por puntuación** (por defecto, al alcanzar el horizonte de ficción de §5-A.9) | `vasallos×100 + Divinidad×10 + fieles/10 + tecnologías×5 + reliquias×5 + hitos×10`, normalizado por año de ficción |
| **Alianza oculta** | Todos los dioses humanos aliados ante una amenaza externa y una misión secreta cumplida. Sin la misión, es "victoria amarga": Aldin la invalida |
| **Modo historia "La Caída"** | Tras la victoria: todos pierden los poderes y deben sobrevivir con lo que su civilización construyó |

El **dios dormido** no cuenta como rival a vasallar: si despierta como dios maligno, sí.

---

## 10-A. Hitos globales

Un **hito global** es un logro único de la partida: el primero que lo consigue se lo lleva, se anuncia
en la crónica y recibe un **buff de 2 turnos**. Cumplen tres funciones: premian la iniciativa, avisan
al resto de que alguien está corriendo, y dan un pico de poder corto que no rompe la partida.

### A.1 Reglas

- **Únicos.** Cada hito se otorga una sola vez por partida. El segundo que llega no recibe nada.
- El **buff dura 2 turnos**; el hito, en cambio, queda para siempre como insignia en la ficha y en el
  marcador final (+10 puntos por hito). Los **botines de Fe son instantáneos** y no ocupan plaza de
  los dos buffs activos.
- **Máximo 2 buffs activos.** Un tercero reemplaza al más antiguo. Dos buffs del mismo tipo no se
  acumulan: se refrescan.
- Se comprueban en la contabilidad (§8, paso 11), después de XP y antes de la victoria.
- Se anuncian en la crónica pública con nombre y efecto: *"Nebula ha alcanzado los mil fieles:
  Pueblo numeroso"*.
- **Compartidos.** Algunos hitos premian a dos dioses a la vez (choque, paz, alianza). El hito es
  único, pero el buff se reparte entre los implicados.

### A.2 Vocabulario de buffs

| Buff | Efecto | Duración |
|---|---|---|
| `botin+5` / `botin+7.5` / `botin+10` / `botin+12.5` | **Fe inmediato** = 5 / 7,5 / 10 / 12,5 % de tu **tope de Fe** | instantáneo |
| `fidelidad+` | +0,15 de fidelidad | 2 turnos |
| `militar+` | +25 % de poder militar | 2 turnos |
| `investigacion+` | +50 % de progreso tecnológico | 2 turnos |
| `cultura+` | +1 hito cultural por turno | 2 turnos |
| `compas+` | +1 compás (9 en vez de 8) | 2 turnos |
| `esencia+` | +1 Esencia por turno | 2 turnos |
| `diplomacia+` | +1 susurro y +1 propuesta por turno | 2 turnos |

Los botines de Fe son **porcentaje del tope del jugador**, no una cantidad fija: 5 % de un tope de
211 son 11 Fe; 12,5 % de un tope de 3.600 son 450. La escala es deliberadamente baja (5 a 12,5 %)
porque un botín no debe sustituir una economía: con 20 % un solo hito entregaba casi un turno entero
de ingresos y desequilibraba las primeras eras. Así el hito temprano no rompe nada y el mismo hito,
si llega tarde, sigue siendo útil. El resto de buffs sí duran 2 turnos y compiten por las **dos
plazas** de A.1.

### A.3 Catálogo de hitos

**Población** (primero en alcanzar la cifra):

| Hito | Condición | Buff |
|---|---|---|
| **Pueblo numeroso** | 1.000 fieles | `botin+5` |
| **Nación** | 10.000 fieles | `botin+7.5` |
| **Mundo lleno** | 100.000 fieles | `compas+` |

**Primeras veces** (para quien lo consigue antes):

| Hito | Condición | Buff |
|---|---|---|
| **Casa del dios** | primer templo | `botin+5` |
| **Chispa** | primera tecnología | `investigacion+` |
| **Mito fundacional** | primer hito cultural | `cultura+` |
| **Engendro** | primera creación | `esencia+` |
| **Antiguo** | primera ruina explorada | `investigacion+` |
| **Rutas** | primer cruce de mar | `diplomacia+` |
| **Profeta** | primera profecía cumplida | `botin+5` |
| **Ascenso** | primer dios en Divinidad 5 | `botin+7.5` |
| **Ciudad** | primera ciudad fundada | `botin+10` |
| **Apóstol** | primer Apóstol | `militar+` |
| **Señor de dioses** | primer vasallaje | `botin+12.5` |

**De mesa** (implican a dos o más):

| Hito | Condición | Buff |
|---|---|---|
| **Asombro** | primer choque de civilizaciones | `botin+5` + `fidelidad+` **a ambos** |
| **Primera sangre** | primera guerra ganada | `militar+` **solo al ganador** |
| **Paz** | primera paz firmada | `fidelidad+` **a ambos** |
| **Pacto** | primera alianza | `diplomacia+` **a ambos** |

**De recuperación** (para quien va atrás):

| Hito | Condición | Buff |
|---|---|---|
| **Renacido** | primero en salir del debuff primitivo | `botin+7.5` |
| **Pueblo devoto** | primera civilización con fidelidad ≥ 0,8 | `cultura+` |

### A.4 Por qué no desequilibra

1. Los buffs son **cortos y modestos**: el botín más alto, 12,5 % del tope, son 450 Fe en un tope de
   3.600. No decide una partida; inclina un turno.
2. **Techo de dos buffs activos**, y del mismo tipo se refrescan, no se suman.
3. Los de población son los únicos que escalan con el tiempo y están cortados en tres umbrales
   (1.000 / 10.000 / 100.000); el tercero solo es alcanzable en modernidad.
4. Los **hitos de recuperación** dan algo al que va detrás: el sistema premia la iniciativa, pero no
   abandona al rezagado.
5. El buff es **público**: el rival ve que estás en racha y puede esperar dos turnos. La información
   es parte del juego, no un detalle de interfaz.

### A.5 Ejemplo

Nebula llega a 1.000 fieles en el turno 9 y gana *Pueblo numeroso*: 5 % de su tope, unos 11 Fe si su
tope es 211, ingresados en el acto. En ese mismo turno reclama su primer hito cultural y gana *Mito
fundacional* (`cultura+`), que sí ocupa una de las dos plazas de buff. Si en el turno 10 gana *Chispa*,
tendrá dos activos; un tercero reemplazaría al más antiguo.

---

## 11. Ruinas, demonios y esencias

- **Ruina Antigua**: se descubre al explorar. Tipos: Conocimiento Antiguo (+tech), Conocimiento de
  Rango (+XP), Misterios (+magia), Ruina Demoníaca (peligro: magia + penalización de Fe), Única (reliquia).
- Explorar cuesta 1 turno de un héroe y da **+20 XP**. Hay un 30 % de que la ruina sea demoníaca.
- **Abominación / Demonio**: nivel 6–12. Matarlo da **Esencias** (1–3), que son el único ingrediente
  de las creaciones grandes. Siempre es una decisión: XP y esencia contra bajas de fieles.
- **Magia demoníaca**: sube el carril de Magia pero penaliza la Fe (−10 % por punto). Subyugarla
  bajo tu Divinidad (como hace Lakrak con Pzzt) convierte la penalización en ingreso: es el
  "build" avanzado del juego.

---

## 12. Profecías

1. Eliges un hecho verificable y un plazo `N` (2–4 turnos).
2. Apuestas entre el **5 % y el 20 % de tu tope de Fe**: escala sola con tu progreso, igual que los
   botines de §10-A.
3. Si se cumple: recuperas el doble y **+25 XP**.
4. Si falla: pierdes la apuesta y **−30 XP**.
5. **Profecía Contradictoria**: dos dioses profetizan resultados incompatibles sobre el mismo objeto.
   El sistema obliga a penalizar a uno. Es el modo duelo de 2 jugadores.

---

## 13. Fin de partida: Más Allá, Apóstol, Hierofanía

| Herramienta | Requisito | Efecto |
|---|---|---|
| **Apóstol** | Héroe nivel 21+, fama alta, **100.000 Fe** (el tope completo de Divinidad 11) | Héroe inmortal, ×2 poder militar, puede partir a un dios |
| **Hierofanía** | Divinidad 8+, **5.000 Fe** | Desciendes en persona: ×4 poder un turno; mantenerla cuesta **1.000 Fe/turno**; morir = vasallaje |
| **Más Allá** | Divinidad 11, 1 Esencia de demonio, 50 muertes de fieles | Ultratumba propia: los muertos enseñan en sueños (+Fe, +tech); decisivo en el desempate |

Ninguna de las tres entra en la v1 jugable; son contenido de Fase 5/8 y se anuncian en la interfaz
como "hitos bloqueados" para que el jugador vea el horizonte.

---

## 14. Eventos aleatorios (d20)

Una sola tirada **por turno** (no por compás), `d20`:

| d20 | Evento |
|---|---|
| 1–3 | Nada (el mundo respira) |
| 4 | Sequía: −fidelidad, −fieles si no hay respuesta |
| 5 | Bestia local: Abominación nivel 6 cerca |
| 6 | Ruina visible en una región vecina |
| 7 | Contacto con especie desconocida |
| 8 | Motín interno: la fidelidad cae 0,15 |
| 9 | Avance tecnológico espontáneo (+1 tech) |
| 10 | Profeta rival: roba 5 fieles |
| 11 | Migración: +8 fieles si la fidelidad > 0,7 |
| 12 | Traición de un héroe (pierdes su bonus 2 turnos) |
| 13 | Noche de la traición: un dios dormido despierta |
| 14 | Ruina demoníaca: magia tentadora |
| 15 | Choque de civilizaciones forzado |
| 16 | Milagro ajeno observado: +1 línea de inteligencia |
| 17 | Hambruna: −10 fieles si no hay causalidad |
| 18 | Reliquia hallada (+1 reliquia) |
| 19 | Dios maligno ataca un asentamiento |
| 20 | **Hierofanía fallida de un rival**: lo ves vulnerable un turno |

---

## 15. Problemas de era (fase Civilización)

Cada turno, cada dios recibe **un problema** con 3 opciones. La opción no es gratis: cada una
cuesta Fe o fidelidad, y ninguna es claramente óptima.

Ejemplo (era tribal):
> **Sequía.** Los pozos bajan. Tu pueblo mira al cielo.
> - **A. Cavar más hondo** — 0 Fe. +fidelidad corta, −10 fieles el próximo turno.
> - **B. Migrar al norte** — 20 Fe. Pierdes 1 región, +15 fieles potenciales.
> - **C. Sacrificio** — 0 Fe, −8 fieles. +40 Fe y +fama. (Riesgo: "corrompe con miedo".)

Catálogo: 12 problemas × 3 opciones en Fase 5. Regla: toda opción debe ser elegible por al menos
un arquetipo de dios.

---

## 16. Información pública vs privada

| Dato | Público | Privado |
|---|---|---|
| Especie, nombre, regiones | Sí | — |
| Fama | Sí | — |
| Etapa, subetapa y barra de época | Sí | — |
| Hitos globales y buffs activos | Sí | — |
| Divinidad | Banda (Baja 1–3 / Media 4–7 / Alta 8–11) | Nivel exacto |
| Fe | No | Sí |
| Fidelidad | No | Sí |
| Órdenes del turno | Solo si producen efecto observable | Sí |
| Susurros | No | Solo emisor y receptor |

Esto se implementa en la base de datos, no en el cliente (ver `PLAN.md` §4).

---

## 17. IA

### 17.1 Bots (asientos faltantes)
- **Utilidad** sobre el conjunto de acciones legales: `valor = (ΔFe esperado × w1) + (Δfieles × w2)
  + (Δpoder × w3) + (progreso de objetivo × w4) − riesgo`.
- **3 personalidades:** Expansivo (peso territorio), Fanático (peso fieles/fama), Maquiavelo (peso
  profecías, susurros y sabotaje).
- **2 dificultades:** Normal (ve solo información pública + su estado) y Corrupto (ve bandas rivales;
  nunca datos exactos — sigue siendo honesto con el servidor).
- Un bot **debe** poder jugar sin LLM. Cero dependencia de API externa para que la partida no se rompa.

### 17.2 Dioses dormidos (los "sucesos aleatorios")
- No envían órdenes. Cada turno hay 15 % de que generen un evento del §14 sobre el mundo.
- Desde el turno 6, 10 % por turno de **despertar** como dios maligno con agenda scripted
  (atacar al líder, corromper una civilización, abrir una ruina demoníaca).
- Esto es lo que mantiene viva una mesa de 32 asientos con 4 humanos: el mundo sigue actuando.

### 17.3 Narrador
- **Por defecto: plantillas deterministas.** 150 plantillas con slots (`{pueblo}`, `{héroe}`,
  `{catástrofe}`) que se rellenan con el resultado estructurado. Testeable, gratis, instantáneo.
- **Opcional: capa LLM** para dar color a la crónica. Feature flag apagado por defecto.
  - Proveedor: Gemini free o Mistral free (documentados sin tarjeta).
  - Límite duro: 1 llamada por turno **por partida**, no por jugador. Cuotas gratuitas tipo
    20 req/día hacen inviable una llamada por jugador.
  - Salida JSON validada; si falla o hay 429, se usa la plantilla. La partida nunca depende del LLM.

---

## 18. Tuning inicial y su validación (Fase 0)

Criterios que debe cumplir la simulación headless antes de tocar interfaz:

| Métrica | Objetivo |
|---|---|
| Divinidad media al año de ficción 10 | entre 5 y 7 |
| Partidas con "runaway" (un dios > 2× el segundo) | < 15 % |
| Partidas sin vasallaje al horizonte (30 años) | 60–80 % (la puntuación decide) |
| Compases rellenos por turno | ≥ 3 de 8 |
| Fe sobrante en ventana **corta** (`1d`–`30d`) | < 40 % del tope |
| Duración media | ~37 ± 6 turnos con `unlockEvery: 5` |
| Ventanas elegidas | ninguna > 55 % de los turnos; cada una ≥ 5 % |
| Barra tribal al 100 % | entre los turnos 10 y 16 |
| Barra de reinos al 100 % | entre los turnos 24 y 30 |
| Barra estancada | nunca más de 6 turnos seguidos sin subir |
| Debuff primitivo | duración media ≤ 5 turnos y ninguna racha > 8 |
| Debuff por cultura o población (no solo tecnología) | ≥ 25 % de los casos |
| Barra movida por más de una dimensión | ≥ 60 % de los turnos con avance |

Si no se cumple, se ajusta **solo** la tabla de costes/ingresos, no las reglas.

**Cómo se mide cada métrica** (lo importante no es el número, sino que no se pueda jugar con él):

- **Fe sobrante por clase de ventana.** Se mide en ventanas cortas (`1d`–`30d`, §5-A.6), que es donde
  el Fe debe apretar. En media y larga el cuello de botella es el compás, no el dinero (§6): ahí el Fe
  sobra **por diseño** y no se mide.
- **Debuff: duración por episodio.** Un episodio es la racha consecutiva de turnos que un asiento
  concreto pasa debilitado; se promedian todos los episodios terminados y se toma la mayor racha
  observada, incluidas las que siguen abiertas al cerrar la partida.
- **Debuff por cultura o población.** La lectura literal (dos de tres dimensiones) es siempre cierta:
  cualquier pareja de dimensiones atrasadas incluye cultura o población, así que daría 100 % por
  tautología. Por eso se mide además la versión que sí dice algo: en qué % de los casos la **peor**
  dimensión es la cultura o la población y no la tecnología.
- **Barra estancada.** No cuenta la barra ya saturada al 100 % en la última era, que es el final de la
  partida, no un bloqueo.
- **Reparto de ventanas y duración** se miden sobre la mesa de referencia: 8 asientos con **3 humanos**
  (los bots no votan, §5-A.2.3) y una papeleta con mayoría simple.

### 18.1 Resultado de la Fase 0

Simulación de **500 partidas**, 8 asientos, 3 humanos + 5 bots, `unlockEvery: 5`, horizonte de 30 años.
Salida en `artifacts/sim-fase0.csv` y resumen en `artifacts/sim-fase0-resumen.json`.

| Métrica | Objetivo | Medido |
|---|---|---|
| Divinidad media al año 10 | 5–7 | **5,90** |
| Runaway | < 15 % | **0,0 %** |
| Partidas sin vasallaje | 60–80 % | **75,4 %** |
| Compases por turno | ≥ 3 | **7,24** |
| Fe sobrante en ventana corta | < 40 % | **31,2 %** |
| Duración media | 31–43 turnos | **41,9** |
| Ventana dominante | ≤ 55 % | **34,0 %** |
| Ventana menos usada | ≥ 5 % | **12,3 %** |
| Barra tribal al 100 % | turnos 10–16 | **15,8** |
| Barra de reinos al 100 % | turnos 24–30 | **25,0** |
| Barra estancada | ≤ 6 turnos | **2** |
| Debuff: duración media | ≤ 5 turnos | **1,30** |
| Debuff: peor racha | ≤ 8 turnos | **6** |
| Debuff cuyo peor eje es cultura o población | ≥ 25 % | **56,6 %** |
| Barra movida por más de una dimensión | ≥ 60 % | **80,1 %** |

Las 15 métricas se cumplen. Las más ajustadas son las **dos bandas de época**: la barra tribal cierra en
el 15,8 de un máximo de 16 y la de reinos en 25,0 de un mínimo de 24. Si un cambio posterior mueve una
de ellas fuera de banda, ese cambio hay que justificarlo. Los números que se movieron para llegar aquí:
costes de investigación (§6 no se tocó), el coeficiente de crecimiento de §4.4, el coste de los hitos
culturales y la madurez de era de §5-B.2.

**Hallazgo abierto, fuera de §18:** con la política actual de bots, la personalidad **expansiva** gana
el 84 % de las partidas simuladas (fanático 13 %, maquiavelo 3 %) y la carta *Minerales* concentra las
victorias dentro de esa personalidad. No es un criterio de aceptación de esta fase —los pesos de las
personalidades son invento de implementación, no regla—, pero hay que resolverlo antes de que los
humanos jueguen contra esos bots: ver `DECISIONES.md` §4.

---

## 19. Modos

| Modo | Jugadores | Turnos | Estado |
|---|---|---|---|
| **La peor carta** (iniciación) | 4–8 | 12 (`unlockEvery: 3`) | **v1** |
| **El Mundo Perdido** (partida completa) | 4–32 | ~37 (`unlockEvery: 5`) | v1 |
| **Profecía Contradictoria** (duelo) | 2 | 8 (ventana fija `30d`) | Fase 8 |
| **El falso dios** (deducción) | 5–8 | ~20 | Fase 8 |
| **La Caída** (historia) | 4–8 | 8 (`1y` fija, sin poderes divinos) | Fase 8 |

Los turnos son turnos jugados; la ventana ficticia de cada uno sigue la escalera de §5-A.

---

## 20. Interfaz de texto (wireframe)

```
┌────────────────────────────────────────────────────────────────────┐
│ TURNO 9 · TRIBU AVANZADA · ▓▓▓▓▓▓░░░░ 62 % · ⏱ 01:32    [ LISTO ]  │
├────────────────┬────────────────────────────────┬──────────────────┤
│ TU DIOS        │  CRÓNICA DEL TURNO             │  PLANIFICA       │
│ Escarabajo     │                                │  C1 C2 C3 … C8   │
│ Divinidad 2    │  «La sequía aprieta…»          │  ▢  ▣  ▢    ▢    │
│ Fe 38 / 211    │                                │                  │
│ Fieles 34      │  Aldin: "El sistema observa."  │  milagro    10   │
│ Tecnología ▓░░ │                                │  obra       60   │
│ Población  ▓░░ │  ── SITUACIÓN ──               │  héroe       —   │
│ Cultura    ▓░░ │  ( A ) Cavar más hondo · 0 Fe  │  palabra    20   │
│ Buff: militar+ │  ( B ) Migrar al norte · 20 Fe │                  │
│ (2 turnos)     │  ( C ) Sacrificio · 0 Fe       │Mundo 62% · Tú 47%│
└────────────────┴────────────────────────────────┴──────────────────┘
```

- **Diálogos:** tres voces fijas — el **Sistema** (neutro, tipografía monoespaciada),
  **Aldin** (el árbitro, en cursiva, aparece en momentos clave) y tu **Sumo Sacerdote**
  (primera persona, informa de lo que el pueblo cree). Es la capa "de diálogos" pedida.
- **Barra de época** arriba, con la marca del mundo y la tuya, y el nombre de la subetapa: es el reloj
  de la partida y la señal de quién se está quedando atrás.
- **Planificador en 8 compases**, no un menú de tres botones: la ventana se dibuja como una línea de
  casillas con canales, y el coste final aparece ya calculado por compás.
- **Buffs activos** visibles en la ficha con su cuenta atrás de turnos.
- Móvil: una sola columna, crónica arriba, acciones en hoja inferior.
- Accesibilidad: contraste AA, tamaño de texto ajustable, sin animaciones obligatorias,
  toda acción alcanzable por teclado.
