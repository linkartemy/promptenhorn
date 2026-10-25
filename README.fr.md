[English](README.md) · [Русский](README.ru.md) · [Español](README.es.md) · [Deutsch](README.de.md) · **Français** · [Italiano](README.it.md) · [Português](README.pt.md) · [中文](README.zh.md) · [日本語](README.ja.md)

# Promptenhorn

*Un Cervin bâti à partir de prompts.* Dans le jeu, le monde s'appelle Claude Alps.

Chaque chat Claude Code devient un bâtisseur dans Minecraft. Pendant que Claude travaille, le bâtisseur (Steve, Alex, Kai…) construit une maison. Les maisons forment peu à peu une petite ville suisse : d'abord un village de chalets, puis une vieille ville avec des arcades, une église et un hôtel, puis des quartiers modernes.

Cela ne coûte aucun token : les hooks sont de simples commandes locales. Ils n'affichent rien dans le chat, ne prennent aucune décision à la place de Claude et tournent en arrière-plan (`async`), si bien que Claude ne les attend jamais.

![La ville de jour : la tour de l'horloge, une place de quartier, des maisons de la vieille ville au bord du lac. À droite, la liste des bâtisseurs des chats et de leurs constructions](docs/screenshots/city-day.webp)

<details open><summary><b>Galerie</b></summary>

<table>
<tr><td width="50%"><img src="docs/screenshots/city-night-aerial.webp" alt="La ville la nuit : fenêtres éclairées et cheminées qui fument"><br><sub>La ville la nuit : fenêtres éclairées et cheminées qui fument</sub></td><td width="50%"><img src="docs/screenshots/harbour-lighthouse-steamer.webp" alt="Phare, port et le vapeur du lac"><br><sub>Phare, port et le vapeur du lac</sub></td></tr>
<tr><td width="50%"><img src="docs/screenshots/waterfront-cable-car.webp" alt="Le quartier du lac et le téléphérique vers le sommet"><br><sub>Le quartier du lac et le téléphérique vers le sommet</sub></td><td width="50%"><img src="docs/screenshots/house-facade-builder.webp" alt="Une maison terminée : jardinières, le pupitre de la chronique et un bot bâtisseur"><br><sub>Une maison terminée : jardinières, le pupitre de la chronique et un bot bâtisseur</sub></td></tr>
<tr><td width="50%"><img src="docs/screenshots/house-growth-night.webp" alt="Une maison qui grandit jusqu’à l’étape 3, échafaudages compris"><br><sub>Une maison qui grandit jusqu’à l’étape 3, échafaudages compris</sub></td><td width="50%"><img src="docs/screenshots/builder-night.webp" alt="Un bâtisseur plante un épicéa pour les travaux publics du quartier"><br><sub>Un bâtisseur plante un épicéa pour les travaux publics du quartier</sub></td></tr>
<tr><td width="50%"><img src="docs/screenshots/colonists-camp.webp" alt="Mode Colons : une colonie de survie avec potager, entrepôt et marché"><br><sub><b>Mode Colons</b> : une colonie de survie avec potager, entrepôt et marché</sub></td><td></td></tr>
</table>

</details>

## Comment ça marche

```
Claude Code ──hook──▶ hooks/alps-hook.mjs ──HTTP──▶ bridge/bridge.mjs ──RCON──▶ Minecraft (Paper 1.21.11)
                                                        │
                                                        ├── http://127.0.0.1:7777/     page des réglages
                                                        └── http://127.0.0.1:7777/map  carte de la ville en direct
```

| Événement Claude Code | Ce qui se passe dans le monde |
|---|---|
| Nouveau chat | Un bâtisseur apparaît |
| Votre message | Le bâtisseur reçoit un nom (les premiers mots de votre prompt) et une parcelle |
| Claude modifie des fichiers, lance des commandes | La construction avance (~3 blocs/s), plus un bonus pour chaque action |
| Claude termine sa réponse | Le bâtisseur attend près de la maison ; au bout de 30 minutes, il s'endort |
| Maison terminée | Feu d'artifice, un villageois emménage, le bâtisseur part vers la parcelle suivante |
| Chat fermé | Le bâtisseur s'en va ; le chat suivant termine toute maison à moitié construite |

- Un projet (dossier) = un quartier. La ville est installée dans une vallée alpine, au milieu des montagnes.
- Une barre latérale à droite liste chaque chat actif avec son avancement en pourcentage.
- Quand vous rejoignez la partie, le chat affiche la liste des quartiers (cliquez pour vous téléporter) et un lien vers les réglages.

## Confidentialité

Le hook réduit chaque événement à de petits signaux et n'envoie que ceux-ci au bridge : le nom de l'outil, le type de notification, « c'était un test et il a échoué », « c'était un commit ». Les commandes, le contenu des fichiers, la sortie des outils et les réponses de Claude ne quittent jamais le hook. La seule exception, ce sont les premiers mots du premier message : ils deviennent le nom du bâtisseur. Le texte du prompt n'entre dans le livre de chronique que si l'option « Texte du prompt dans la chronique » est activée (elle est désactivée dans tous les presets).

## Prise en main

Il vous faut Java 21+ et Node.js 18+.

1. Installez les hooks une fois pour toutes :
   ```
   node install-hooks.mjs
   ```
   Le script ajoute les hooks à `~/.claude/settings.json` et crée une sauvegarde juste à côté. Les autres hooks ne sont pas touchés, et le relancer ne pose aucun problème. Seuls les nouveaux chats prennent les hooks en compte.
2. Placez un serveur Paper 1.21.11 dans `server/paper.jar`. Le dépôt ne contient aucun fichier du jeu : vous téléchargez le serveur vous-même et, en le lançant, vous acceptez l'[EULA de Minecraft](https://aka.ms/MinecraftEULA) (voir [NOTICE.md](NOTICE.md)).
3. Démarrez le serveur et le bridge : double-cliquez sur `start.cmd` (deux fenêtres réduites s'ouvrent).
4. Dans TLauncher, choisissez la version **1.21.11** → « Multijoueur » → serveur `localhost`.
5. Travaillez avec Claude comme d'habitude et regardez la ville grandir. Survolez-la en mode créatif ou avec `/gamemode spectator`.

Pour essayer sans vrais chats : bridge lancé, exécutez `node demo.mjs 3`.

## Carte en direct

**http://127.0.0.1:7777/map** affiche la ville directement dans votre navigateur : parcelles, quartiers et bâtisseurs sous forme de points en mouvement, avec ce que fait chaque chat à l'instant (modification, exécution de commandes, attente de votre autorisation, sommeil…). Les boutons « Se téléporter » et « Suivre » vous amènent jusqu'à un bâtisseur dans le jeu (il faut être connecté au serveur). La carte ne lit que l'état du bridge : aucun fichier du monde, aucun mod client. Un lien vers elle se trouve en haut de la page des réglages.

## Langue

Par défaut, tout ce que vous voyez dans le monde et sur les pages du bridge est en anglais. La langue change à chaud, sans redémarrage : via la liste déroulante de la page des réglages ou dans le terminal :

```
node configure.mjs language ru     # en | ru | es | de | fr | it | pt | zh | ja
```

Langues prises en charge : English, Русский, Español, Deutsch, Français, Italiano, Português, 中文 et 日本語. La valeur est enregistrée dans `config.json` sous `"language"` ; toute chaîne qui n'a pas encore de traduction s'affiche en anglais. Les enseignes suisses sur les bâtiments (par ex. `BAECKEREI`) restent volontairement en suisse allemand. Fonctionnement de la localisation : `docs/i18n.md`.

## Réglages : presets et fonctionnalités

Ouvrez **http://127.0.0.1:7777/** (un lien « [réglages] » apparaît aussi dans le chat du jeu quand vous vous connectez). Les modifications s'appliquent immédiatement, sans redémarrage, et sont enregistrées dans `config.json` (`preset` + `features`).

| Preset | Ce qui est activé |
|---|---|
| Minimal | Bâtisseurs et maisons, comme dans la première version |
| Basique (par défaut) | Les fonctionnalités testées qui ne font pas de bruit |
| Max | Toutes les fonctionnalités testées |

En plus d'un preset, vous pouvez activer ou désactiver n'importe quelle fonctionnalité. Les fonctionnalités marquées « expérimentale » sont écrites mais pas encore entièrement testées dans le monde : elles ne font partie d'aucun preset et ne peuvent être activées qu'à la main. L'état de chaque fonctionnalité figure dans `docs/roadmap.md`.

La même chose depuis le terminal :

```
node configure.mjs                 # preset et toutes les fonctionnalités
node configure.mjs basic           # choisir un preset (minimal | basic | max)
node configure.mjs tests on        # activer une fonctionnalité en plus du preset
node configure.mjs tests reset     # revenir à ce que prévoit le preset
node configure.mjs language de     # changer la langue
```

Un bridge en cours d'exécution prend en compte les modifications de `config.json` en quelques secondes.

### Fonctionnalités

| Groupe | Fonctionnalités |
|---|---|
| Claude au travail | Le bâtisseur vous appelle (en attente d'une autorisation ou d'une réponse : « ! », une cloche, une barre rouge), barre jaune « en attente d'une tâche », tests (étincelles, un drapeau, un nuage de pluie), commit = cloche, push = car PostAuto, PR = drapeau cantonal, recherche web = allay facteur, compaction = pause café, limite d'API = orage en montagne, mode plan = architecte |
| Bâtisseurs | Statut sous le nom, outil en main, apprentis sous-agents |
| Ville | Vrai jour et vraie nuit, lumières aux fenêtres, fumée de cheminée, économie des chats, **rénovation au lieu de démolition**, villageois selon leur métier, échafaudages, la Zytglogge sonne les heures |
| Progression | Progrès, chronique des maisons, rang de la localité (Weiler → Dorf → Städtli → Stadt), francs contre tokens (un panneau « Kasse: CHF … »), barre de progression du Cervin |
| Information | Hôtel de ville (une fenêtre avec tous les bâtisseurs), bâtisseurs sur la barre de localisation, « pendant votre absence » |
| Easter eggs | Cor des Alpes quand une maison est terminée, petits détails (TNT sur rm -rf, casque de chantier selon le modèle), horloges CFF, 1er Août et Noël |
| Confidentialité | Texte du prompt dans la chronique (manuel uniquement) |

La chronique des maisons ajoute une section « Chronique de la ville » à la page des réglages : chaque bâtiment avec son projet, ses bâtisseurs et sa date, un filtre par projet, une recherche et la téléportation vers la maison.

### Paramètres

La même page permet de régler combien d'actions il faut à un chat avant d'avoir sa propre maison et avant les étapes suivantes (économie des chats), ainsi que la vitesse de construction et la vitesse de rénovation. D'autres valeurs se règlent dans `config.json` :

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

Les chats sans dossier de projet construisent le quartier commun « Alpweide ». Par défaut, les villageois restent immobiles (`villagerAI: false`) et il y en a au plus 12 par quartier : une centaine de villageois errants chargent sensiblement le serveur.

## Rénovation au lieu de démolition

Quand les générateurs de bâtiments changent, la ville n'est pas reconstruite de zéro. Le bridge retient quelle version a construit chaque parcelle (l'archive des versions se trouve dans `bridge/archive/`) et répare les maisons par diff : il retire ce qui a disparu, pose ce qui est nouveau et laisse tranquilles les blocs identiques.

- Une maison à moitié construite est terminée selon le nouveau plan.
- Les maisons terminées, les places de quartier et la place principale sont réparées par une équipe : 2 blocs/s tant qu'au moins un chat travaille, et tout bâtisseur du quartier éveillé et libre vient en plus donner un coup de main. La barre latérale affiche une ligne du type « Rénovation : Chalet 40% » et, quand un quartier est terminé, un message apparaît dans le chat.
- Les lanternes, les jointures entre parcelles et le pavage sont versionnés séparément et mis à jour de la même manière.

Détails pour les auteurs de générateurs : `docs/generator-contract.md`.

## Progrès et hôtel de ville

Pour les progrès et le bouton « Hôtel de ville » du menu pause, le bridge installe lui-même le pack de données `datapack/promptenhorn` dans `server/world/datapacks/` et recharge les packs de données. Le bouton du menu pause apparaît après le prochain redémarrage du serveur (les dialogues ne sont chargés qu'au démarrage) ; le lien « [Hôtel de ville] » dans le chat fonctionne tout de suite. La fenêtre de l'hôtel de ville peut aussi ouvrir la carte en direct dans votre navigateur.

## Réglage selon l'ordinateur

`node tools/tune.mjs` mesure l'ordinateur (RAM, CPU, ce qui tourne) et, en lecture seule, le serveur en marche (TPS, MSPT, chunks, entités), puis affiche un plan : mémoire et options Java des scripts de démarrage, `view-distance` / `simulation-distance`, économies de ticks dans Paper/Spigot/Bukkit et limites du pont (`builderBotsMax`, `colonistsMax`, vitesse de rénovation, densité de vie). Rien n'est écrit sans `--apply` ; chaque fichier est d'abord copié dans `backups/tune/<heure>/`, puis redémarrez le serveur et le pont.

```
node tools/tune.mjs            # dry run
node tools/tune.mjs --apply    # write the plan, then restart
```

Repères : 8 Go : `-Xmx1536M`, distance 6. 16 Go : `-Xmx2560M`, distance 12, jusqu'à 4 bâtisseurs réels et 3 colons. 32 Go : `-Xmx4G`, distance 16. Pour garder une valeur : `"tuning": { "lock": ["server.view-distance"] }` dans `config.json`. Détails (en anglais) : [docs/performance.md](docs/performance.md).

## Arrêt et désinstallation

- Pour arrêter : tapez `stop` dans la fenêtre du serveur et fermez la fenêtre du bridge.
- Si le bridge ne tourne pas, le hook voit un fichier heartbeat périmé et se termine immédiatement.
- Pour supprimer les hooks : `node install-hooks.mjs --uninstall`.

## Fichiers

| Chemin | Ce que c'est |
|---|---|
| `bridge/bridge.mjs` | Le démon : événements, sessions, parcelles et objets, construction, rénovation |
| `bridge/features/*.mjs` | Les fonctionnalités que vous activez dans les réglages (registre et répartiteur dans `index.mjs`) |
| `bridge/settings.mjs`, `bridge/settings-page.mjs` | Presets, interrupteurs, paramètres ; la page des réglages et son API |
| `bridge/map-page.mjs` | Carte de la ville en direct (`/map`) |
| `bridge/i18n.mjs`, `locales/` | Localisation : `t()` et catalogues de chaînes par langue (`en.json` est la source) |
| `bridge/generators.mjs`, `bridge/archive/` | Versions des générateurs et leur archive |
| `bridge/renovate.mjs` | Rénovation par diff |
| `bridge/fx.mjs` | File d'effets avec un budget RCON par tick |
| `bridge/plotmeta.mjs` | Cloches, cheminées, portes, fenêtres, cadrans d'horloge repérés dans un plan |
| `bridge/smallforms.mjs` | Bancs, arbres, parterres de fleurs, fontaines, le parc, le belvédère |
| `bridge/buildings.mjs`, `bridge/blueprint.mjs` | Générateurs de bâtiments (assemblés à partir de `.dev/parts`) |
| `hooks/alps-hook.mjs` | Le hook Claude Code |
| `install-hooks.mjs`, `configure.mjs` | Installateur des hooks ; réglages depuis le terminal |
| `datapack/` | Pack de données des progrès et de l'hôtel de ville (`node datapack/build.mjs` le reconstruit) |
| `bots/` | Expérience : de vrais bots bâtisseurs Mineflayer (`package.json` séparé) |
| `docs/` | Contrat des générateurs, normes de construction, localisation, feuille de route |
| `server/` | Paper 1.21.11 : localhost uniquement, mode hors ligne, paisible, créatif |
| `state.json` | L'état de la ville |

Pour recommencer la ville de zéro : arrêtez tout, supprimez `server/world*` et `state.json`.

## Licence

- [LICENSE](LICENSE) — MIT, © 2026 linkartemy.
- [NOTICE.md](NOTICE.md) — un projet de fan indépendant, sans lien avec Mojang, Microsoft ou Anthropic ; aucun fichier du jeu n'est redistribué, et c'est vous qui acceptez l'EULA de Minecraft.
