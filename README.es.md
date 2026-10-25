[English](README.md) · [Русский](README.ru.md) · **Español** · [Deutsch](README.de.md) · [Français](README.fr.md) · [Italiano](README.it.md) · [Português](README.pt.md) · [中文](README.zh.md) · [日本語](README.ja.md)

# Promptenhorn

*Un Matterhorn hecho de prompts.* Dentro del juego, el mundo se llama Claude Alps.

Cada chat de Claude Code se convierte en un constructor en Minecraft. Mientras Claude trabaja, el constructor (Steve, Alex, Kai…) levanta una casa. Las casas van formando un pequeño pueblo suizo: primero una aldea de chalets, luego un casco antiguo con soportales, una iglesia y un hotel, y después barrios modernos.

No cuesta tokens: los hooks son simples comandos locales. No escriben nada en el chat, no toman decisiones por Claude y se ejecutan en segundo plano (`async`), así que Claude nunca tiene que esperarlos.

![El pueblo de día: la torre del reloj, la plaza de un barrio y casas del casco antiguo junto al lago. A la derecha, la lista de constructores de los chats y sus obras](docs/screenshots/city-day.webp)

![De noche: el constructor del chat "some houses are missing rea…" planta un abeto como parte de las obras públicas del barrio](docs/screenshots/builder-night.webp)

## Cómo funciona

```
Claude Code ──hook──▶ hooks/alps-hook.mjs ──HTTP──▶ bridge/bridge.mjs ──RCON──▶ Minecraft (Paper 1.21.11)
                                                        │
                                                        ├── http://127.0.0.1:7777/     página de ajustes
                                                        └── http://127.0.0.1:7777/map  mapa del pueblo en vivo
```

| Evento de Claude Code | Qué pasa en el mundo |
|---|---|
| Nuevo chat | Aparece un constructor |
| Tu mensaje | El constructor recibe un nombre (las primeras palabras de tu prompt) y una parcela |
| Claude edita archivos, ejecuta comandos | La obra avanza (~3 bloques/s) más un extra por cada acción |
| Claude termina su respuesta | El constructor espera junto a la casa; a los 30 minutos se va a dormir |
| Casa terminada | Fuegos artificiales, un aldeano se muda y el constructor se va a la siguiente parcela |
| Chat cerrado | El constructor se marcha; el siguiente chat termina cualquier casa a medio construir |

- Un proyecto (carpeta) = un barrio. El pueblo se sitúa en un valle alpino entre montañas.
- Una barra lateral a la derecha muestra todos los chats activos con su progreso en porcentaje.
- Al entrar en el juego, el chat muestra la lista de barrios (haz clic para teletransportarte) y un enlace a los ajustes.

## Privacidad

El hook reduce cada evento a pequeñas señales y solo envía esas señales al puente: el nombre de la herramienta, el tipo de notificación, "eso fue un test y falló", "eso fue un commit". Los comandos, el contenido de los archivos, la salida de las herramientas y las respuestas de Claude nunca salen del hook. La única excepción son las primeras palabras del primer mensaje: se convierten en el nombre del constructor. El texto del prompt solo se guarda en el libro de crónicas cuando la opción "Texto del prompt en la crónica" está activada (está desactivada en todos los presets).

## Primeros pasos

Necesitas Java 21+ y Node.js 18+.

1. Instala los hooks una sola vez:
   ```
   node install-hooks.mjs
   ```
   El script añade los hooks a `~/.claude/settings.json` y guarda una copia de seguridad al lado. Los demás hooks no se tocan, y volver a ejecutarlo es seguro. Solo los chats nuevos cargan los hooks.
2. Coloca un servidor Paper 1.21.11 en `server/paper.jar`. El repositorio no incluye archivos del juego: tú mismo descargas el servidor y, al ejecutarlo, aceptas el [EULA de Minecraft](https://aka.ms/MinecraftEULA) (consulta [NOTICE.md](NOTICE.md)).
3. Inicia el servidor y el puente: haz doble clic en `start.cmd` (se abren dos ventanas minimizadas).
4. En TLauncher elige la versión **1.21.11** → "Multijugador" → servidor `localhost`.
5. Trabaja con Claude como siempre y mira cómo crece el pueblo. Vuela por él en modo creativo o con `/gamemode spectator`.

Para probarlo sin chats reales: con el puente en marcha, ejecuta `node demo.mjs 3`.

## Mapa en vivo

**http://127.0.0.1:7777/map** muestra el pueblo directamente en tu navegador: parcelas, barrios y constructores como puntos en movimiento, junto con lo que está haciendo cada chat en ese momento (editando, ejecutando comandos, esperando tu permiso, durmiendo…). Los botones "Teletransportar" y "Seguir" te llevan hasta un constructor en el juego (tienes que estar en el servidor). El mapa solo lee el estado del puente: nada de archivos del mundo ni mods de cliente. Hay un enlace a él en la parte superior de la página de ajustes.

## Idioma

Por defecto, todo lo que ves en el mundo y en las páginas del puente está en inglés. El idioma se cambia en caliente, sin reiniciar: usa el desplegable de la página de ajustes o la terminal:

```
node configure.mjs language ru     # en | ru | es | de | fr | it | pt | zh | ja
```

Idiomas disponibles: English, Русский, Español, Deutsch, Français, Italiano, Português, 中文 y 日本語. El valor se guarda en `config.json` como `"language"`; cualquier texto que aún no tenga traducción se muestra en inglés. Los letreros de las tiendas suizas en los edificios (p. ej. `BAECKEREI`) se mantienen a propósito en alemán suizo. Cómo funciona la localización: `docs/i18n.md`.

## Ajustes: presets y funciones

Abre **http://127.0.0.1:7777/** (al entrar en el juego también aparece un enlace "[settings]" en el chat). Los cambios se aplican al instante, sin reiniciar, y se guardan en `config.json` (`preset` + `features`).

| Preset | Qué incluye |
|---|---|
| Minimal | Constructores y casas, como en la primera versión |
| Basic (por defecto) | Funciones probadas que no hacen ruido |
| Max | Todas las funciones probadas |

Además del preset, puedes activar o desactivar cualquier función. Las funciones marcadas como "experimental" están escritas pero aún no se han probado a fondo en el mundo: no forman parte de ningún preset y solo se pueden activar a mano. El estado de cada función está en `docs/roadmap.md`.

Lo mismo desde la terminal:

```
node configure.mjs                 # preset y todas las funciones
node configure.mjs basic           # elegir un preset (minimal | basic | max)
node configure.mjs tests on        # activar una función por encima del preset
node configure.mjs tests reset     # volver a lo que dice el preset
node configure.mjs language de     # cambiar el idioma
```

Un puente en marcha detecta los cambios en `config.json` en un par de segundos.

### Funciones

| Grupo | Funciones |
|---|---|
| Claude trabajando | El constructor te llama (cuando espera permiso o una respuesta: "!", una campana, una barra roja), barra amarilla de "esperando una tarea", tests (chispas, una bandera, una nube de lluvia), commit = campana, push = autobús PostAuto, PR = bandera del cantón, búsqueda web = allay cartero, compactación = pausa para el café, límite de la API = tormenta en las montañas, modo plan = arquitecto |
| Constructores | Estado bajo el nombre, herramienta en la mano, aprendices subagentes |
| Pueblo | Día y noche reales, luces en las ventanas, humo en la chimenea, economía de chats, **renovación en lugar de demolición**, aldeanos según su profesión, andamios, el Zytglogge da las horas |
| Progreso | Logros, crónica de la casa, rango del asentamiento (Weiler → Dorf → Städtli → Stadt), francos por tokens (un tablero "Kasse: CHF …"), barra de progreso del Matterhorn |
| Información | Ayuntamiento (una ventana con todos los constructores), constructores en la barra localizadora, "mientras no estabas" |
| Easter eggs | Cuerno alpino al terminar una casa, pequeños detalles (TNT con rm -rf, casco según el modelo), relojes de la SBB, el 1 de agosto y Navidad |
| Privacidad | Texto del prompt en la crónica (solo manual) |

La crónica de la casa añade a la página de ajustes una sección "Crónica del pueblo": cada edificio con su proyecto, sus constructores y la fecha, un filtro por proyecto, búsqueda y teletransporte a la casa.

### Parámetros

En la misma página puedes ajustar cuántas acciones necesita un chat antes de tener su propia casa y antes de las siguientes etapas (economía de chats), la velocidad de construcción y la velocidad de renovación. Otros valores se pueden configurar en `config.json`:

```json
{
  "preset": "basic",
  "features": { "status": true },
  "language": "en",
  "blocksPerSecond": 3,
  "toolBurst": { "Edit": 10, "Write": 12, "Bash": 5, "default": 3 },
  "houseAfterActions": 20,
  "stageActions": [80, 200],
  "idleAfterMinutes": 10,
  "sleepAfterMinutes": 30,
  "retireAfterHours": 72,
  "renovateBlocksPerSecond": 2,
  "maxVillagersPerDistrict": 12,
  "villagerAI": false,
  "scratchDistrictName": "Alpweide"
}
```

Los chats sin carpeta de proyecto construyen el barrio compartido "Alpweide". Por defecto los aldeanos se quedan quietos (`villagerAI: false`) y hay como máximo 12 por barrio: un centenar de aldeanos deambulando supone una carga notable para el servidor.

## Renovación en lugar de demolición

Cuando cambian los generadores de edificios, el pueblo no se reconstruye desde cero. El puente recuerda qué versión construyó cada parcela (el archivo de versiones está en `bridge/archive/`) y repara las casas por diferencias: quita lo que ya no está, coloca lo nuevo y deja en paz los bloques que coinciden.

- Una casa a medio construir se termina con el nuevo plano.
- Las casas terminadas, las plazas de los barrios y la plaza mayor las repara una cuadrilla: 2 bloques/s mientras haya al menos un chat trabajando, y además cualquier constructor despierto y libre del barrio viene a ayudar. La barra lateral muestra una línea como "Renovación: Chalet 40%", y cuando un barrio está listo aparece un mensaje en el chat.
- Las farolas, las juntas entre parcelas y el pavimento tienen versiones propias y se actualizan del mismo modo.

Detalles para autores de generadores: `docs/generator-contract.md`.

## Logros y el ayuntamiento

Para los logros y el botón "Ayuntamiento" del menú de pausa, el puente instala por sí mismo el paquete de datos `datapack/promptenhorn` en `server/world/datapacks/` y recarga los paquetes de datos. El botón del menú de pausa aparece tras el siguiente reinicio del servidor (los diálogos solo se cargan al arrancar); el enlace "[Town hall]" del chat funciona al momento. La ventana del ayuntamiento también puede abrir el mapa en vivo en tu navegador.

## Ajuste al equipo

`node tools/tune.mjs` mide el equipo (RAM, CPU, qué está en marcha) y, solo leyendo, el servidor en marcha (TPS, MSPT, chunks, entidades), y muestra un plan: memoria y flags de Java de los scripts de inicio, `view-distance` / `simulation-distance`, ahorros de ticks en Paper/Spigot/Bukkit y los límites del puente (`builderBotsMax`, `colonistsMax`, velocidad de reforma, densidad de vida). Solo escribe con `--apply`, guardando antes cada archivo en `backups/tune/<hora>/`; luego reinicia el servidor y el puente.

```
node tools/tune.mjs            # dry run
node tools/tune.mjs --apply    # write the plan, then restart
```

Orientación: 8 GB: `-Xmx1536M`, distancia 6. 16 GB: `-Xmx2560M`, distancia 12, hasta 4 constructores reales y 3 colonos. 32 GB: `-Xmx4G`, distancia 16. Para fijar un valor propio: `"tuning": { "lock": ["server.view-distance"] }` en `config.json`. Detalles (en inglés): [docs/performance.md](docs/performance.md).

## Detener y desinstalar

- Para detenerlo: escribe `stop` en la ventana del servidor y cierra la ventana del puente.
- Si el puente no está en marcha, el hook ve un archivo de heartbeat caducado y termina de inmediato.
- Para quitar los hooks: `node install-hooks.mjs --uninstall`.

## Archivos

| Ruta | Qué es |
|---|---|
| `bridge/bridge.mjs` | El daemon: eventos, sesiones, parcelas y objetos, construcción, renovación |
| `bridge/features/*.mjs` | Funciones que se activan en los ajustes (registro y despachador en `index.mjs`) |
| `bridge/settings.mjs`, `bridge/settings-page.mjs` | Presets, interruptores, parámetros; la página de ajustes y su API |
| `bridge/map-page.mjs` | Mapa del pueblo en vivo (`/map`) |
| `bridge/i18n.mjs`, `locales/` | Localización: `t()` y catálogos de textos por idioma (`en.json` es la fuente) |
| `bridge/generators.mjs`, `bridge/archive/` | Versiones de los generadores y su archivo |
| `bridge/renovate.mjs` | Renovación por diferencias |
| `bridge/fx.mjs` | Cola de efectos con un presupuesto de RCON por tick |
| `bridge/plotmeta.mjs` | Campanas, chimeneas, puertas, ventanas y esferas de reloj encontradas en un plano |
| `bridge/smallforms.mjs` | Bancos, árboles, parterres, fuentes, el parque, el mirador |
| `bridge/buildings.mjs`, `bridge/blueprint.mjs` | Generadores de edificios (ensamblados a partir de `.dev/parts`) |
| `hooks/alps-hook.mjs` | El hook de Claude Code |
| `install-hooks.mjs`, `configure.mjs` | Instalador de hooks; ajustes desde la terminal |
| `datapack/` | Paquete de datos de logros y del ayuntamiento (`node datapack/build.mjs` lo vuelve a generar) |
| `bots/` | Experimento: bots constructores reales con Mineflayer (`package.json` aparte) |
| `docs/` | Contrato de generadores, estándares de edificios, localización, hoja de ruta |
| `server/` | Paper 1.21.11: solo localhost, offline-mode, pacífico, creativo |
| `state.json` | El estado del pueblo |

Para empezar el pueblo de cero: detén todo y borra `server/world*` y `state.json`.

## Licencia

- [LICENSE](LICENSE) — MIT, © 2026 linkartemy.
- [NOTICE.md](NOTICE.md) — un proyecto de fans independiente, sin relación con Mojang, Microsoft ni Anthropic; no se redistribuye ningún archivo del juego y el EULA de Minecraft lo aceptas tú mismo.
