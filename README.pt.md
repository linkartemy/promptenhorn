[English](README.md) · [Русский](README.ru.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Italiano](README.it.md) · **Português** · [中文](README.zh.md) · [日本語](README.ja.md)

# Promptenhorn

*Um Matterhorn feito de prompts.* Dentro do jogo, o mundo se chama Claude Alps.

Cada chat do Claude Code vira um construtor no Minecraft. Enquanto o Claude trabalha, o construtor (Steve, Alex, Kai…) levanta uma casa. As casas vão formando uma pequena cidade suíça: primeiro uma aldeia de chalés, depois um centro histórico com arcadas, uma igreja e um hotel, e então bairros modernos.

Não custa tokens: os hooks são simples comandos locais. Eles não escrevem nada no chat, não tomam decisões pelo Claude e rodam em segundo plano (`async`), então o Claude nunca precisa esperar por eles.

![A cidade de dia: a torre do relógio, a praça de um bairro e casas do centro histórico à beira do lago. À direita, a lista de construtores dos chats e suas obras](docs/screenshots/city-day.webp)

<details open><summary><b>Galeria</b></summary>

<table>
<tr><td width="50%"><img src="docs/screenshots/city-night-aerial.webp" alt="A cidade à noite: janelas acesas e chaminés fumegando"><br><sub>A cidade à noite: janelas acesas e chaminés fumegando</sub></td><td width="50%"><img src="docs/screenshots/harbour-lighthouse-steamer.webp" alt="Farol, porto e o vapor do lago"><br><sub>Farol, porto e o vapor do lago</sub></td></tr>
<tr><td width="50%"><img src="docs/screenshots/waterfront-cable-car.webp" alt="O bairro à beira do lago e o teleférico até o cume"><br><sub>O bairro à beira do lago e o teleférico até o cume</sub></td><td width="50%"><img src="docs/screenshots/house-facade-builder.webp" alt="Uma casa pronta: floreiras, o atril da crônica e um bot construtor"><br><sub>Uma casa pronta: floreiras, o atril da crônica e um bot construtor</sub></td></tr>
<tr><td width="50%"><img src="docs/screenshots/house-growth-night.webp" alt="Uma casa crescendo até a etapa 3, com andaimes"><br><sub>Uma casa crescendo até a etapa 3, com andaimes</sub></td><td width="50%"><img src="docs/screenshots/builder-night.webp" alt="Um construtor planta um abeto para as obras públicas do bairro"><br><sub>Um construtor planta um abeto para as obras públicas do bairro</sub></td></tr>
<tr><td width="50%"><img src="docs/screenshots/colonists-camp.webp" alt="Modo Colonos: uma colônia de sobrevivência com horta, depósito e mercado"><br><sub><b>Modo Colonos</b>: uma colônia de sobrevivência com horta, depósito e mercado</sub></td><td width="50%"><img src="docs/screenshots/colonists-mine.webp" alt="Os colonos cavam uma mina com tochas; à direita, os estoques"><br><sub>Os colonos cavam uma mina com tochas; à direita, os estoques</sub></td></tr>
</table>

</details>

## Como funciona

```
Claude Code ──hook──▶ hooks/alps-hook.mjs ──HTTP──▶ bridge/bridge.mjs ──RCON──▶ Minecraft (Paper 1.21.11)
                                                        │
                                                        ├── http://127.0.0.1:7777/     página de configurações
                                                        └── http://127.0.0.1:7777/map  mapa da cidade ao vivo
```

| Evento do Claude Code | O que acontece no mundo |
|---|---|
| Novo chat | Um construtor aparece |
| Sua mensagem | O construtor ganha um nome (as primeiras palavras do seu prompt) e um lote |
| O Claude edita arquivos, executa comandos | A obra avança (~3 blocos/s), mais um bônus a cada ação |
| O Claude termina a resposta | O construtor espera ao lado da casa; depois de 30 minutos, vai dormir |
| Casa concluída | Fogos de artifício, um aldeão se muda e o construtor segue para o próximo lote |
| Chat fechado | O construtor vai embora; o próximo chat termina qualquer casa construída pela metade |

- Um projeto (pasta) = um bairro. A cidade fica em um vale alpino entre as montanhas.
- Uma barra lateral à direita lista todos os chats ativos com o progresso em porcentagem.
- Ao entrar no jogo, o chat mostra a lista de bairros (clique para se teletransportar) e um link para as configurações.

## Privacidade

O hook reduz cada evento a pequenos sinais e envia só esses sinais para a ponte: o nome da ferramenta, o tipo de notificação, "isso foi um teste e falhou", "isso foi um commit". Comandos, conteúdo de arquivos, saída das ferramentas e respostas do Claude nunca saem do hook. A única exceção são as primeiras palavras da primeira mensagem: elas viram o nome do construtor. O texto do prompt só vai para o livro da crônica quando a opção "Texto do prompt na crônica" está ativada (ela vem desativada em todos os presets).

## Primeiros passos

Você precisa de Java 21+ e Node.js 18+.

1. Instale os hooks uma única vez:
   ```
   node install-hooks.mjs
   ```
   O script adiciona os hooks a `~/.claude/settings.json` e salva um backup ao lado. Os outros hooks não são alterados, e rodar de novo é seguro. Só os chats novos carregam os hooks.
2. Coloque um servidor Paper 1.21.11 em `server/paper.jar`. O repositório não inclui arquivos do jogo: você mesmo baixa o servidor e, ao executá-lo, aceita o [EULA do Minecraft](https://aka.ms/MinecraftEULA) (veja [NOTICE.md](NOTICE.md)).
3. Inicie o servidor e a ponte: clique duas vezes em `start.cmd` (abrem-se duas janelas minimizadas).
4. No TLauncher, escolha a versão **1.21.11** → "Multijogador" → servidor `localhost`.
5. Trabalhe com o Claude normalmente e veja a cidade crescer. Voe por ela no modo criativo ou com `/gamemode spectator`.

Para testar sem chats reais: com a ponte rodando, execute `node demo.mjs 3`.

## Mapa ao vivo

**http://127.0.0.1:7777/map** mostra a cidade direto no navegador: lotes, bairros e construtores como pontos em movimento, junto com o que cada chat está fazendo naquele momento (editando, executando comandos, esperando sua permissão, dormindo…). Os botões "Teletransportar" e "Seguir" levam você até um construtor no jogo (é preciso estar no servidor). O mapa lê apenas o estado da ponte: nada de arquivos do mundo nem mods no cliente. Há um link para ele no topo da página de configurações.

## Idioma

Por padrão, tudo o que você vê no mundo e nas páginas da ponte está em inglês. O idioma muda na hora, sem reiniciar: use o menu suspenso na página de configurações ou o terminal:

```
node configure.mjs language ru     # en | ru | es | de | fr | it | pt | zh | ja
```

Idiomas suportados: English, Русский, Español, Deutsch, Français, Italiano, Português, 中文 e 日本語. O valor fica salvo em `config.json` como `"language"`; qualquer texto que ainda não tenha tradução aparece em inglês. As placas das lojas suíças nos prédios (por exemplo, `BAECKEREI`) ficam em alemão suíço de propósito. Como a localização funciona: `docs/i18n.md`.

## Configurações: presets e recursos

Abra **http://127.0.0.1:7777/** (ao entrar no jogo também aparece um link "[settings]" no chat). As mudanças valem na hora, sem reiniciar, e são salvas em `config.json` (`preset` + `features`).

| Preset | O que vem ativado |
|---|---|
| Minimal | Construtores e casas, como na primeira versão |
| Basic (padrão) | Recursos testados que não fazem barulho |
| Max | Todos os recursos testados |

Além do preset, você pode ligar ou desligar qualquer recurso. Os recursos marcados como "experimental" já estão escritos, mas ainda não foram totalmente testados no mundo: não fazem parte de nenhum preset e só podem ser ativados manualmente. O status de cada recurso está em `docs/roadmap.md`.

O mesmo pelo terminal:

```
node configure.mjs                 # preset e todos os recursos
node configure.mjs basic           # escolher um preset (minimal | basic | max)
node configure.mjs tests on        # ligar um recurso por cima do preset
node configure.mjs tests reset     # voltar ao que o preset define
node configure.mjs language de     # mudar o idioma
```

Uma ponte em execução detecta mudanças em `config.json` em poucos segundos.

### Recursos

| Grupo | Recursos |
|---|---|
| Claude trabalhando | O construtor chama você (quando espera permissão ou uma resposta: "!", um sino, uma barra vermelha), barra amarela de "esperando uma tarefa", testes (faíscas, uma bandeira, uma nuvem de chuva), commit = sino, push = ônibus PostAuto, PR = bandeira do cantão, busca na web = allay carteiro, compactação = pausa para o café, limite da API = tempestade nas montanhas, modo plano = arquiteto |
| Construtores | Status abaixo do nome, ferramenta na mão, aprendizes subagentes |
| Cidade | Dia e noite reais, luzes nas janelas, fumaça na chaminé, economia de chats, **reforma em vez de demolição**, aldeões por profissão, andaimes, o Zytglogge bate as horas |
| Progresso | Conquistas, crônica da casa, categoria do povoado (Weiler → Dorf → Städtli → Stadt), francos por tokens (um painel "Kasse: CHF …"), barra de progresso do Matterhorn |
| Informação | Prefeitura (uma janela com todos os construtores), construtores na barra localizadora, "enquanto você estava fora" |
| Easter eggs | Trompa alpina quando uma casa fica pronta, pequenos detalhes (TNT no rm -rf, capacete conforme o modelo), relógios da SBB, 1º de agosto e Natal |
| Privacidade | Texto do prompt na crônica (só manual) |

A crônica da casa adiciona à página de configurações uma seção "Crônica da cidade": cada prédio com seu projeto, construtores e data, filtro por projeto, busca e teletransporte até a casa.

### Parâmetros

Na mesma página você define quantas ações um chat precisa antes de ganhar a própria casa e antes das próximas etapas (economia de chats), a velocidade de construção e a velocidade da reforma. Outros valores podem ser definidos em `config.json`:

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

Chats sem pasta de projeto constroem o bairro compartilhado "Alpweide". Por padrão os aldeões ficam parados (`villagerAI: false`) e há no máximo 12 por bairro: uma centena de aldeões andando por aí pesa bastante no servidor.

## Reforma em vez de demolição

Quando os geradores de prédios mudam, a cidade não é reconstruída do zero. A ponte lembra qual versão construiu cada lote (o arquivo de versões fica em `bridge/archive/`) e conserta as casas por diferença: remove o que saiu, coloca o que é novo e não mexe nos blocos que já batem.

- Uma casa construída pela metade é terminada com a nova planta.
- Casas prontas, praças dos bairros e a praça principal são consertadas por uma equipe: 2 blocos/s enquanto pelo menos um chat estiver trabalhando, e qualquer construtor acordado e livre do bairro vem ajudar. A barra lateral mostra uma linha como "Reforma: Chalé 40%" e, quando um bairro fica pronto, aparece uma mensagem no chat.
- Os postes de luz, as emendas entre lotes e o calçamento têm versões próprias e são atualizados do mesmo jeito.

Detalhes para autores de geradores: `docs/generator-contract.md`.

## Conquistas e a prefeitura

Para as conquistas e o botão "Prefeitura" no menu de pausa, a ponte instala sozinha o pacote de dados `datapack/promptenhorn` em `server/world/datapacks/` e recarrega os pacotes de dados. O botão do menu de pausa aparece depois do próximo reinício do servidor (os diálogos só são carregados na inicialização); o link "[Town hall]" no chat funciona na hora. A janela da prefeitura também pode abrir o mapa ao vivo no seu navegador.

## Ajuste ao computador

`node tools/tune.mjs` mede o computador (RAM, CPU, o que está rodando) e, só lendo, o servidor em execução (TPS, MSPT, chunks, entidades), e mostra um plano: memória e flags Java dos scripts de início, `view-distance` / `simulation-distance`, economia de ticks no Paper/Spigot/Bukkit e os limites da ponte (`builderBotsMax`, `colonistsMax`, velocidade da reforma, densidade de vida). Só escreve com `--apply`, copiando antes cada arquivo para `backups/tune/<hora>/`; depois reinicie o servidor e a ponte.

```
node tools/tune.mjs            # dry run
node tools/tune.mjs --apply    # write the plan, then restart
```

Referência: 8 GB: `-Xmx1536M`, distância 6. 16 GB: `-Xmx2560M`, distância 12, até 4 construtores reais e 3 colonos. 32 GB: `-Xmx4G`, distância 16. Para fixar um valor: `"tuning": { "lock": ["server.view-distance"] }` em `config.json`. Detalhes (em inglês): [docs/performance.md](docs/performance.md).

## Parar e desinstalar

- Para parar: digite `stop` na janela do servidor e feche a janela da ponte.
- Se a ponte não estiver rodando, o hook encontra um arquivo de heartbeat desatualizado e sai na hora.
- Para remover os hooks: `node install-hooks.mjs --uninstall`.

## Arquivos

| Caminho | O que é |
|---|---|
| `bridge/bridge.mjs` | O daemon: eventos, sessões, lotes e objetos, construção, reforma |
| `bridge/features/*.mjs` | Recursos que você liga nas configurações (registro e despachante em `index.mjs`) |
| `bridge/settings.mjs`, `bridge/settings-page.mjs` | Presets, chaves, parâmetros; a página de configurações e sua API |
| `bridge/map-page.mjs` | Mapa da cidade ao vivo (`/map`) |
| `bridge/i18n.mjs`, `locales/` | Localização: `t()` e catálogos de textos por idioma (`en.json` é a fonte) |
| `bridge/generators.mjs`, `bridge/archive/` | Versões dos geradores e seu arquivo |
| `bridge/renovate.mjs` | Reforma por diferença |
| `bridge/fx.mjs` | Fila de efeitos com um orçamento de RCON por tick |
| `bridge/plotmeta.mjs` | Sinos, chaminés, portas, janelas e mostradores de relógio encontrados em uma planta |
| `bridge/smallforms.mjs` | Bancos, árvores, canteiros, fontes, o parque, o mirante |
| `bridge/buildings.mjs`, `bridge/blueprint.mjs` | Geradores de prédios (montados a partir de `.dev/parts`) |
| `hooks/alps-hook.mjs` | O hook do Claude Code |
| `install-hooks.mjs`, `configure.mjs` | Instalador dos hooks; configurações pelo terminal |
| `datapack/` | Pacote de dados das conquistas e da prefeitura (`node datapack/build.mjs` gera de novo) |
| `bots/` | Experimento: bots construtores de verdade com Mineflayer (`package.json` separado) |
| `docs/` | Contrato dos geradores, padrões de construção, localização, roadmap |
| `server/` | Paper 1.21.11: só localhost, offline-mode, pacífico, criativo |
| `state.json` | O estado da cidade |

Para recomeçar a cidade do zero: pare tudo e apague `server/world*` e `state.json`.

## Licença

- [LICENSE](LICENSE) — MIT, © 2026 linkartemy.
- [NOTICE.md](NOTICE.md) — um projeto de fã independente, sem vínculo com a Mojang, a Microsoft ou a Anthropic; nenhum arquivo do jogo é redistribuído, e você mesmo aceita o EULA do Minecraft.
