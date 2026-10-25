[English](README.md) · [Русский](README.ru.md) · [Español](README.es.md) · **Deutsch** · [Français](README.fr.md) · [Italiano](README.it.md) · [Português](README.pt.md) · [中文](README.zh.md) · [日本語](README.ja.md)

# Promptenhorn

*Ein Matterhorn aus Prompts.* Im Spiel heisst die Welt Claude Alps.

Jeder Claude-Code-Chat wird in Minecraft zu einem Baumeister. Während Claude arbeitet, baut der Baumeister (Steve, Alex, Kai…) ein Haus. Aus den Häusern wächst ein kleines Schweizer Städtchen: zuerst ein Dorf aus Chalets, dann eine Altstadt mit Lauben, Kirche und Hotel, dann moderne Quartiere.

Es kostet keine Tokens: Die Hooks sind einfache lokale Befehle. Sie geben nichts im Chat aus, treffen keine Entscheidungen für Claude und laufen im Hintergrund (`async`), sodass Claude nie auf sie wartet.

![Das Städtchen bei Tag: der Uhrturm, ein Quartierplatz, Altstadthäuser am See. Rechts die Liste der Chat-Baumeister und ihrer Bauten](docs/screenshots/city-day.webp)

<details open><summary><b>Galerie</b></summary>

<table>
<tr><td width="50%"><img src="docs/screenshots/city-night-aerial.webp" alt="Das Städtchen bei Nacht: erleuchtete Fenster, rauchende Kamine"><br><sub>Das Städtchen bei Nacht: erleuchtete Fenster, rauchende Kamine</sub></td><td width="50%"><img src="docs/screenshots/harbour-lighthouse-steamer.webp" alt="Leuchtturm, Hafen und der Seedampfer"><br><sub>Leuchtturm, Hafen und der Seedampfer</sub></td></tr>
<tr><td width="50%"><img src="docs/screenshots/waterfront-cable-car.webp" alt="Das Seequartier und die Seilbahn auf den Gipfel"><br><sub>Das Seequartier und die Seilbahn auf den Gipfel</sub></td><td width="50%"><img src="docs/screenshots/house-facade-builder.webp" alt="Ein fertiges Haus: Blumenkästen, das Chronik-Pult und ein Baumeister-Bot"><br><sub>Ein fertiges Haus: Blumenkästen, das Chronik-Pult und ein Baumeister-Bot</sub></td></tr>
<tr><td width="50%"><img src="docs/screenshots/house-growth-night.webp" alt="Ein Haus wächst zur 3. Stufe, mit Gerüst"><br><sub>Ein Haus wächst zur 3. Stufe, mit Gerüst</sub></td><td width="50%"><img src="docs/screenshots/builder-night.webp" alt="Ein Baumeister pflanzt eine Fichte für die öffentlichen Arbeiten"><br><sub>Ein Baumeister pflanzt eine Fichte für die öffentlichen Arbeiten</sub></td></tr>
<tr><td width="50%"><img src="docs/screenshots/colonists-camp.webp" alt="Kolonisten-Modus: eine Überlebenskolonie mit Garten, Lager und Markt"><br><sub><b>Kolonisten-Modus</b>: eine Überlebenskolonie mit Garten, Lager und Markt</sub></td><td></td></tr>
</table>

</details>

## So funktioniert es

```
Claude Code ──hook──▶ hooks/alps-hook.mjs ──HTTP──▶ bridge/bridge.mjs ──RCON──▶ Minecraft (Paper 1.21.11)
                                                        │
                                                        ├── http://127.0.0.1:7777/     Einstellungsseite
                                                        └── http://127.0.0.1:7777/map  Live-Karte des Städtchens
```

| Ereignis in Claude Code | Was in der Welt passiert |
|---|---|
| Neuer Chat | Ein Baumeister erscheint |
| Deine Nachricht | Der Baumeister bekommt einen Namen (die ersten Wörter deines Prompts) und eine Parzelle |
| Claude bearbeitet Dateien, führt Befehle aus | Der Bau geht weiter (~3 Blöcke/s) plus ein Bonus für jede Aktion |
| Claude beendet seine Antwort | Der Baumeister wartet beim Haus; nach 30 Minuten schläft er ein |
| Haus fertig | Feuerwerk, ein Dorfbewohner zieht ein, der Baumeister geht zur nächsten Parzelle |
| Chat geschlossen | Der Baumeister geht; der nächste Chat stellt ein halbfertiges Haus fertig |

- Ein Projekt (Ordner) = ein Quartier. Das Städtchen liegt in einem Alpental zwischen den Bergen.
- Eine Seitenleiste rechts listet jeden aktiven Chat mit seinem Fortschritt in Prozent auf.
- Wenn du dem Spiel beitrittst, zeigt der Chat die Liste der Quartiere (anklicken zum Teleportieren) und einen Link zu den Einstellungen.

## Datenschutz

Der Hook reduziert jedes Ereignis auf kleine Signale und schickt nur diese an die Bridge: den Namen des Tools, die Art der Benachrichtigung, "das war ein Test und er ist fehlgeschlagen", "das war ein Commit". Befehle, Dateiinhalte, Tool-Ausgaben und Claudes Antworten verlassen den Hook nie. Die einzige Ausnahme sind die ersten Wörter der ersten Nachricht: Sie werden zum Namen des Baumeisters. Der Prompt-Text landet nur dann im Chronikbuch, wenn die Option "Prompt-Text in der Chronik" eingeschaltet ist (in allen Presets ist sie aus).

## Erste Schritte

Du brauchst Java 21+ und Node.js 18+.

1. Installiere die Hooks einmalig:
   ```
   node install-hooks.mjs
   ```
   Das Skript fügt die Hooks zu `~/.claude/settings.json` hinzu und legt daneben ein Backup an. Andere Hooks bleiben unangetastet, und ein erneuter Aufruf ist unbedenklich. Nur neue Chats übernehmen die Hooks.
2. Lege einen Paper-1.21.11-Server unter `server/paper.jar` ab. Das Repository enthält keine Spieldateien: Du lädst den Server selbst herunter und akzeptierst mit dem Start die [Minecraft-EULA](https://aka.ms/MinecraftEULA) (siehe [NOTICE.md](NOTICE.md)).
3. Starte Server und Bridge: Doppelklick auf `start.cmd` (es öffnen sich zwei minimierte Fenster).
4. Wähle in TLauncher die Version **1.21.11** → "Mehrspieler" → Server `localhost`.
5. Arbeite wie gewohnt mit Claude und schau zu, wie das Städtchen wächst. Flieg im Kreativmodus oder mit `/gamemode spectator` herum.

Zum Ausprobieren ohne echte Chats: Bei laufender Bridge `node demo.mjs 3` ausführen.

## Live-Karte

**http://127.0.0.1:7777/map** zeigt das Städtchen direkt im Browser: Parzellen, Quartiere und Baumeister als sich bewegende Punkte, dazu, was jeder Chat gerade tut (bearbeitet, führt Befehle aus, wartet auf deine Erlaubnis, schläft…). Die Schaltflächen "Teleportieren" und "Folgen" bringen dich im Spiel zu einem Baumeister (dafür musst du auf dem Server sein). Die Karte liest nur den Zustand der Bridge: keine Weltdateien, keine Client-Mods. Oben auf der Einstellungsseite gibt es einen Link dorthin.

## Sprache

Standardmässig ist alles, was du in der Welt und auf den Seiten der Bridge siehst, auf Englisch. Die Sprache wechselt live, ohne Neustart: über das Auswahlmenü auf der Einstellungsseite oder im Terminal:

```
node configure.mjs language ru     # en | ru | es | de | fr | it | pt | zh | ja
```

Unterstützt: English, Русский, Español, Deutsch, Français, Italiano, Português, 中文 und 日本語. Der Wert wird in `config.json` als `"language"` gespeichert; jeder Text, der noch keine Übersetzung hat, wird auf Englisch angezeigt. Die Schweizer Ladenschilder an den Gebäuden (z. B. `BAECKEREI`) bleiben absichtlich auf Schweizerdeutsch. Wie die Lokalisierung funktioniert: `docs/i18n.md`.

## Einstellungen: Presets und Funktionen

Öffne **http://127.0.0.1:7777/** (beim Beitreten gibt es im Spielchat auch einen Link "[Einstellungen]"). Änderungen gelten sofort, ohne Neustart, und werden in `config.json` gespeichert (`preset` + `features`).

| Preset | Was eingeschaltet ist |
|---|---|
| Minimal | Baumeister und Häuser, wie in der ersten Version |
| Basis (Standard) | Getestete Funktionen, die keinen Lärm machen |
| Max | Alle getesteten Funktionen |

Zusätzlich zu einem Preset kannst du jede Funktion ein- oder ausschalten. Als "experimentell" markierte Funktionen sind geschrieben, aber in der Welt noch nicht vollständig getestet: Sie gehören zu keinem Preset und lassen sich nur von Hand einschalten. Der Status jeder Funktion steht in `docs/roadmap.md`.

Dasselbe im Terminal:

```
node configure.mjs                 # Preset und alle Funktionen
node configure.mjs basic           # ein Preset wählen (minimal | basic | max)
node configure.mjs tests on        # eine Funktion zusätzlich zum Preset einschalten
node configure.mjs tests reset     # zurück zu dem, was das Preset vorgibt
node configure.mjs language de     # die Sprache ändern
```

Eine laufende Bridge übernimmt Änderungen an `config.json` innerhalb weniger Sekunden.

### Funktionen

| Gruppe | Funktionen |
|---|---|
| Claude bei der Arbeit | Der Baumeister ruft dich (wartet auf Erlaubnis oder eine Antwort: "!", eine Glocke, ein roter Balken), gelber Balken "wartet auf eine Aufgabe", Tests (Funken, eine Fahne, eine Regenwolke), Commit = Glocke, Push = PostAuto, PR = Kantonsfahne, Websuche = Post-Allay, Kompaktierung = Kaffeepause, API-Limit = Gewitter in den Bergen, Planmodus = Architekt |
| Baumeister | Status unter dem Namen, Werkzeug in der Hand, Subagenten als Lehrlinge |
| Städtchen | Echter Tag und echte Nacht, Licht in den Fenstern, Rauch aus dem Kamin, Chat-Ökonomie, **Renovation statt Abriss**, Dorfbewohner nach Beruf, Baugerüste, die Zytglogge schlägt die Stunden |
| Fortschritt | Fortschritte, Hauschronik, Siedlungsrang (Weiler → Dorf → Städtli → Stadt), Franken für Tokens (eine Tafel "Kasse: CHF …"), Matterhorn-Fortschrittsbalken |
| Information | Rathaus (ein Fenster mit allen Baumeistern), Baumeister auf der Ortungsleiste, "während du weg warst" |
| Easter Eggs | Alphorn, wenn ein Haus fertig ist, kleine Details (TNT bei rm -rf, Bauhelm je nach Modell), SBB-Uhren, 1. August und Weihnachten |
| Datenschutz | Prompt-Text in der Chronik (nur manuell) |

Die Hauschronik fügt der Einstellungsseite einen Abschnitt "Stadtchronik" hinzu: jedes Gebäude mit seinem Projekt, seinen Baumeistern und dem Datum, ein Projektfilter, eine Suche und Teleportieren zum Haus.

### Parameter

Auf derselben Seite legst du fest, wie viele Aktionen ein Chat vor seinem eigenen Haus und vor den nächsten Stufen braucht (Chat-Ökonomie), sowie die Baugeschwindigkeit und die Renovationsgeschwindigkeit. Weitere Werte lassen sich in `config.json` einstellen:

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

Chats ohne Projektordner bauen am gemeinsamen Quartier "Alpweide". Standardmässig stehen Dorfbewohner still (`villagerAI: false`), und pro Quartier gibt es höchstens 12: Hundert umherwandernde Dorfbewohner belasten den Server spürbar.

## Renovation statt Abriss

Wenn sich die Gebäudegeneratoren ändern, wird das Städtchen nicht von Grund auf neu gebaut. Die Bridge merkt sich, welche Version jede Parzelle gebaut hat (das Versionsarchiv liegt in `bridge/archive/`), und repariert Häuser per Diff: Sie entfernt, was weggefallen ist, setzt, was neu ist, und lässt übereinstimmende Blöcke in Ruhe.

- Ein halbfertiges Haus wird nach dem neuen Bauplan fertiggestellt.
- Fertige Häuser, Quartierplätze und der Hauptplatz werden von einem Bautrupp repariert: 2 Blöcke/s, solange mindestens ein Chat arbeitet, und dazu kommt jeder wache, freie Baumeister des Quartiers helfen. Die Seitenleiste zeigt eine Zeile wie "Renovation: Chalet 40%", und wenn ein Quartier fertig ist, erscheint eine Nachricht im Chat.
- Laternen, Übergänge zwischen Parzellen und das Pflaster werden separat versioniert und auf dieselbe Weise aktualisiert.

Details für Generator-Autoren: `docs/generator-contract.md`.

## Fortschritte und das Rathaus

Für die Fortschritte und die Schaltfläche "Rathaus" im Pausenmenü installiert die Bridge das Datenpaket `datapack/promptenhorn` selbst in `server/world/datapacks/` und lädt die Datenpakete neu. Die Schaltfläche im Pausenmenü erscheint nach dem nächsten Serverneustart (Dialoge werden nur beim Start geladen); der Link "[Rathaus]" im Chat funktioniert sofort. Aus dem Rathausfenster lässt sich auch die Live-Karte im Browser öffnen.

## Abstimmung auf den Rechner

`node tools/tune.mjs` misst den Rechner (RAM, CPU, was läuft) und – nur lesend – den laufenden Server (TPS, MSPT, Chunks, Entities) und zeigt einen Plan: Java-Speicher und -Flags der Startskripte, `view-distance` / `simulation-distance`, Tick-Einsparungen in Paper/Spigot/Bukkit und die Grenzen der Bridge (`builderBotsMax`, `colonistsMax`, Renovierungstempo, Lebensdichte). Erst mit `--apply` wird etwas geschrieben, jede Datei vorher nach `backups/tune/<Zeit>/` gesichert; danach Server und Bridge neu starten.

```
node tools/tune.mjs            # dry run
node tools/tune.mjs --apply    # write the plan, then restart
```

Richtwerte: 8 GB: `-Xmx1536M`, Sichtweite 6. 16 GB: `-Xmx2560M`, Sichtweite 12, bis zu 4 Live-Bauleute und 3 Kolonisten. 32 GB: `-Xmx4G`, Sichtweite 16. Eigene Werte festhalten: `"tuning": { "lock": ["server.view-distance"] }` in `config.json`. Details (Englisch): [docs/performance.md](docs/performance.md).

## Beenden und Deinstallieren

- Zum Beenden: `stop` im Serverfenster eingeben und das Bridge-Fenster schliessen.
- Läuft die Bridge nicht, sieht der Hook eine veraltete Heartbeat-Datei und beendet sich sofort.
- Zum Entfernen der Hooks: `node install-hooks.mjs --uninstall`.

## Dateien

| Pfad | Was es ist |
|---|---|
| `bridge/bridge.mjs` | Der Daemon: Ereignisse, Sitzungen, Parzellen und Objekte, Bau, Renovation |
| `bridge/features/*.mjs` | Funktionen, die du in den Einstellungen schaltest (Registry und Dispatcher in `index.mjs`) |
| `bridge/settings.mjs`, `bridge/settings-page.mjs` | Presets, Schalter, Parameter; die Einstellungsseite und ihre API |
| `bridge/map-page.mjs` | Live-Karte des Städtchens (`/map`) |
| `bridge/i18n.mjs`, `locales/` | Lokalisierung: `t()` und Textkataloge pro Sprache (`en.json` ist die Quelle) |
| `bridge/generators.mjs`, `bridge/archive/` | Generatorversionen und ihr Archiv |
| `bridge/renovate.mjs` | Renovation per Diff |
| `bridge/fx.mjs` | Effekt-Warteschlange mit einem RCON-Budget pro Tick |
| `bridge/plotmeta.mjs` | Glocken, Kamine, Türen, Fenster, Zifferblätter, die in einem Bauplan gefunden werden |
| `bridge/smallforms.mjs` | Bänke, Bäume, Blumenbeete, Brunnen, der Park, der Aussichtspunkt |
| `bridge/buildings.mjs`, `bridge/blueprint.mjs` | Gebäudegeneratoren (zusammengesetzt aus `.dev/parts`) |
| `hooks/alps-hook.mjs` | Der Claude-Code-Hook |
| `install-hooks.mjs`, `configure.mjs` | Hook-Installer; Einstellungen im Terminal |
| `datapack/` | Datenpaket für Fortschritte und Rathaus (`node datapack/build.mjs` baut es neu) |
| `bots/` | Experiment: echte Mineflayer-Baumeister-Bots (eigenes `package.json`) |
| `docs/` | Generator-Vertrag, Baustandards, Lokalisierung, Roadmap |
| `server/` | Paper 1.21.11: nur localhost, Offline-Modus, friedlich, Kreativmodus |
| `state.json` | Der Zustand des Städtchens |

Um das Städtchen neu zu beginnen: alles stoppen, `server/world*` und `state.json` löschen.

## Lizenz

- [LICENSE](LICENSE) — MIT, © 2026 linkartemy.
- [NOTICE.md](NOTICE.md) — ein unabhängiges Fanprojekt, nicht mit Mojang, Microsoft oder Anthropic verbunden; es werden keine Spieldateien weiterverbreitet, und die Minecraft-EULA akzeptierst du selbst.
