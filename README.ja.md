[English](README.md) · [Русский](README.ru.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Italiano](README.it.md) · [Português](README.pt.md) · [中文](README.zh.md) · **日本語**

# Promptenhorn

*プロンプトで築いたマッターホルン。* ゲームの中では、この世界は Claude Alps と呼ばれています。

Claude Code のチャットはひとつひとつが Minecraft の建築家になります。Claude が作業している間、建築家（Steve、Alex、Kai…）は家を建てます。家が増えるにつれて小さなスイスの町ができあがっていきます。最初はシャレーの村、次にアーケードや教会、ホテルのある旧市街、そして近代的な街区へ。

トークンは一切消費しません。フックはただのローカルコマンドです。チャットには何も出力せず、Claude の代わりに何かを決めることもなく、バックグラウンド（`async`）で動くので、Claude がフックを待つことはありません。

![昼の町：時計塔、街区の広場、湖畔の旧市街の家々。右側にはチャットの建築家とその建物の一覧](docs/screenshots/city-day.webp)

<details open><summary><b>ギャラリー</b></summary>

<table>
<tr><td width="50%"><img src="docs/screenshots/city-night-aerial.webp" alt="夜の町：窓の明かりと煙突の煙"><br><sub>夜の町：窓の明かりと煙突の煙</sub></td><td width="50%"><img src="docs/screenshots/harbour-lighthouse-steamer.webp" alt="灯台、港、湖の蒸気船"><br><sub>灯台、港、湖の蒸気船</sub></td></tr>
<tr><td width="50%"><img src="docs/screenshots/waterfront-cable-car.webp" alt="湖畔の街区と山頂へのロープウェイ"><br><sub>湖畔の街区と山頂へのロープウェイ</sub></td><td width="50%"><img src="docs/screenshots/house-facade-builder.webp" alt="完成した家：花箱、年代記の書見台、建築ボット"><br><sub>完成した家：花箱、年代記の書見台、建築ボット</sub></td></tr>
<tr><td width="50%"><img src="docs/screenshots/house-growth-night.webp" alt="足場を組んで第3段階へ成長する家"><br><sub>足場を組んで第3段階へ成長する家</sub></td><td width="50%"><img src="docs/screenshots/builder-night.webp" alt="街区の公共事業としてトウヒを植える建築家"><br><sub>街区の公共事業としてトウヒを植える建築家</sub></td></tr>
<tr><td width="50%"><img src="docs/screenshots/colonists-camp.webp" alt="コロニストモード：畑・倉庫・市場のあるサバイバルコロニー"><br><sub><b>コロニストモード</b>：畑・倉庫・市場のあるサバイバルコロニー</sub></td><td width="50%"><img src="docs/screenshots/colonists-mine.webp" alt="松明を灯した坑道を掘る入植者たち。右側はコロニーの備蓄"><br><sub>松明を灯した坑道を掘る入植者たち。右側はコロニーの備蓄</sub></td></tr>
</table>

</details>

## 仕組み

```
Claude Code ──hook──▶ hooks/alps-hook.mjs ──HTTP──▶ bridge/bridge.mjs ──RCON──▶ Minecraft (Paper 1.21.11)
                                                        │
                                                        ├── http://127.0.0.1:7777/     設定ページ
                                                        └── http://127.0.0.1:7777/map  町のライブマップ
```

| Claude Code のイベント | 世界で起きること |
|---|---|
| 新しいチャット | 建築家が現れる |
| あなたのメッセージ | 建築家に名前（プロンプトの最初の数語）と区画が与えられる |
| Claude がファイルを編集し、コマンドを実行する | 建設が進む（約 3 ブロック/秒）。さらにアクションごとにボーナス |
| Claude が返信を終える | 建築家は家のそばで待機し、30 分後に眠りにつく |
| 家が完成 | 花火が上がり、村人が引っ越してきて、建築家は次の区画へ向かう |
| チャットを閉じる | 建築家は去り、建てかけの家は次のチャットが仕上げる |

- 1 プロジェクト（フォルダ）= 1 街区。町は山々に囲まれたアルプスの谷に置かれます。
- 右側のサイドバーには、アクティブなチャットがすべて進捗率（パーセント）付きで表示されます。
- ゲームに参加すると、チャットに街区の一覧（クリックでテレポート）と設定へのリンクが表示されます。

## プライバシー

フックは各イベントを小さなシグナルに要約し、それだけを bridge に送ります。ツール名、通知の種類、「テストが実行されて失敗した」「コミットが行われた」といった情報です。コマンド、ファイルの内容、ツールの出力、Claude の返信がフックの外に出ることはありません。唯一の例外は最初のメッセージの最初の数語で、これが建築家の名前になります。プロンプトの本文が年代記の本に書き込まれるのは、「年代記にプロンプト本文を記録」オプションがオンのときだけです（どのプリセットでもオフになっています）。

## はじめに

Java 21+ と Node.js 18+ が必要です。

1. フックを一度だけインストールします：
   ```
   node install-hooks.mjs
   ```
   このスクリプトはフックを `~/.claude/settings.json` に追加し、同じ場所にバックアップを書き出します。他のフックには手を触れず、何度実行しても安全です。フックが読み込まれるのは新しいチャットだけです。
2. Paper 1.21.11 サーバーを `server/paper.jar` に置きます。リポジトリにはゲームファイルは含まれていません。サーバーはご自身でダウンロードし、実行することで [Minecraft EULA](https://aka.ms/MinecraftEULA) に同意したことになります（[NOTICE.md](NOTICE.md) を参照）。
3. サーバーと bridge を起動します：`start.cmd` をダブルクリックします（最小化されたウィンドウが 2 つ開きます）。
4. TLauncher でバージョン **1.21.11** を選び →「マルチプレイ」→ サーバー `localhost`。
5. いつもどおり Claude で作業し、町が育っていくのを眺めましょう。クリエイティブモードで飛ぶか、`/gamemode spectator` で見て回れます。

実際のチャットなしで試すには、bridge を起動した状態で `node demo.mjs 3` を実行します。

## ライブマップ

**http://127.0.0.1:7777/map** では、町をブラウザ上で直接見られます。区画、街区、そして動く点として表示される建築家に加え、各チャットがいま何をしているか（編集中、コマンド実行中、あなたの許可待ち、睡眠中…）も表示されます。「テレポート」と「追跡」ボタンを押すと、ゲーム内の建築家のもとへ移動します（サーバーに接続している必要があります）。マップが読むのは bridge の状態だけで、ワールドファイルもクライアント MOD も不要です。設定ページの上部にリンクがあります。

## 言語

デフォルトでは、世界の中や bridge のページで目にするものはすべて英語です。言語は再起動なしでその場で切り替えられます。設定ページのドロップダウンを使うか、ターミナルで次のように実行します：

```
node configure.mjs language ru     # en | ru | es | de | fr | it | pt | zh | ja
```

対応言語：English、Русский、Español、Deutsch、Français、Italiano、Português、中文、日本語。値は `config.json` に `"language"` として保存されます。まだ翻訳されていない文字列は英語で表示されます。建物に掲げられたスイスの店の看板（例：`BAECKEREI`）は、あえてスイスドイツ語のままにしています。ローカライズの仕組み：`docs/i18n.md`。

## 設定：プリセットと機能

**http://127.0.0.1:7777/** を開きます（ゲーム参加時のチャットにも「[settings]」リンクがあります）。変更は再起動なしで即座に反映され、`config.json`（`preset` + `features`）に保存されます。

| プリセット | 有効になるもの |
|---|---|
| Minimal | 建築家と家だけ。最初のバージョンと同じ |
| Basic（デフォルト） | テスト済みで、騒がしくない機能 |
| Max | テスト済みのすべての機能 |

プリセットに加えて、どの機能も個別にオン・オフできます。「実験的」と書かれた機能は実装済みですが、まだ世界の中で十分にテストされていません。どのプリセットにも含まれず、手動でのみ有効にできます。各機能の状況は `docs/roadmap.md` にあります。

ターミナルからも同じことができます：

```
node configure.mjs                 # プリセットとすべての機能
node configure.mjs basic           # プリセットを選ぶ（minimal | basic | max）
node configure.mjs tests on        # プリセットに加えて機能を 1 つオンにする
node configure.mjs tests reset     # プリセットの設定に戻す
node configure.mjs language de     # 言語を変更する
```

動作中の bridge は、`config.json` の変更を数秒以内に読み込みます。

### 機能

| グループ | 機能 |
|---|---|
| 作業中の Claude | 建築家があなたを呼ぶ（許可や回答を待っているとき：「!」、ベル、赤いバー）、黄色の「タスク待ち」バー、テスト（火花、旗、雨雲）、コミット = ベル、プッシュ = PostAuto（スイスの郵便バス）、PR = 州旗、ウェブ検索 = 手紙を運ぶアレイ、コンパクション = コーヒーブレイク、API 制限 = 山の雷雨、プランモード = 建築士 |
| 建築家 | 名前の下のステータス、手に持ったツール、サブエージェントの見習い |
| 町 | リアルな昼と夜、窓の明かり、煙突の煙、チャット経済、**取り壊しではなく改修**、職業ごとの村人、足場、Zytglogge（ベルンの時計塔）が時を告げる |
| 進捗 | 進捗（実績）、家の年代記、集落ランク（Weiler（集落）→ Dorf（村）→ Städtli（小さな町）→ Stadt（都市））、トークンをフランに換算（「Kasse: CHF …」（レジ：スイスフラン）の看板）、マッターホルン進捗バー |
| 情報 | 町役場（すべての建築家が載ったウィンドウ）、ロケーターバー上の建築家、「留守中の出来事」 |
| イースターエッグ | 家の完成時にアルプホルン、ちょっとした小ネタ（rm -rf で TNT、モデルごとのヘルメット）、SBB（スイス連邦鉄道）の時計、8 月 1 日（スイス建国記念日）とクリスマス |
| プライバシー | 年代記にプロンプト本文を記録（手動のみ） |

家の年代記を有効にすると、設定ページに「町の年代記」セクションが追加されます。すべての建物がプロジェクト、建築家、日付とともに並び、プロジェクトでの絞り込み、検索、家へのテレポートができます。

### パラメーター

同じページで、チャットが自分の家を持つまでと次の段階に進むまでに必要なアクション数（チャット経済）、建設速度、改修速度を設定できます。その他の値は `config.json` で設定できます：

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

プロジェクトフォルダのないチャットは、共有の「Alpweide」街区を建てます。デフォルトでは村人は動かず（`villagerAI: false`）、1 街区あたり最大 12 人です。歩き回る村人が 100 人もいると、サーバーにかなりの負荷がかかります。

## 取り壊しではなく改修

建物のジェネレーターが変わっても、町が一から建て直されることはありません。bridge は各区画をどのバージョンで建てたかを記憶しており（バージョンのアーカイブは `bridge/archive/` にあります）、差分で家を修繕します。なくなった部分を取り除き、新しい部分を置き、一致するブロックはそのまま残します。

- 建てかけの家は、新しい設計図で仕上げられます。
- 完成した家、街区の広場、メイン広場は作業班が修繕します。少なくとも 1 つのチャットが作業している間は 2 ブロック/秒で、さらにその街区で起きていて手の空いている建築家が手伝いに来ます。サイドバーには「Renovation: Chalet 40%」のような行が表示され、街区の修繕が終わるとチャットにメッセージが出ます。
- 街灯、区画どうしの継ぎ目、舗装は別々にバージョン管理され、同じ方法で更新されます。

ジェネレーター作者向けの詳細：`docs/generator-contract.md`。

## 進捗と町役場

進捗と、ポーズメニューの「町役場」ボタンのために、bridge は `datapack/promptenhorn` データパックを自動的に `server/world/datapacks/` にインストールし、データパックを再読み込みします。ポーズメニューのボタンは次回のサーバー再起動後に現れます（ダイアログは起動時にしか読み込まれないため）。チャットの「[Town hall]」リンクはすぐに使えます。町役場のウィンドウからは、ブラウザでライブマップを開くこともできます。

## PC に合わせた調整

`node tools/tune.mjs` はこの PC（メモリ、CPU、動いているもの）と、読み取り専用で動作中のサーバー（TPS、MSPT、チャンク、エンティティ）を測り、プランを表示します: 起動スクリプトの Java メモリとフラグ、`view-distance` / `simulation-distance`、Paper/Spigot/Bukkit の tick 削減、ブリッジの上限（`builderBotsMax`、`colonistsMax`、改修速度、暮らしの密度）。`--apply` を付けたときだけ書き込み、その前に各ファイルを `backups/tune/<時刻>/` に保存します。その後サーバーとブリッジを再起動してください。

```
node tools/tune.mjs            # dry run
node tools/tune.mjs --apply    # write the plan, then restart
```

目安: 8 GB: `-Xmx1536M`、描画距離 6。16 GB: `-Xmx2560M`、描画距離 12、リアルな大工 4 人と入植者 3 人まで。32 GB: `-Xmx4G`、描画距離 16。自分の値を固定するには `config.json` に `"tuning": { "lock": ["server.view-distance"] }`。詳細（英語）: [docs/performance.md](docs/performance.md)。

## 停止とアンインストール

- 停止するには：サーバーのウィンドウで `stop` と入力し、bridge のウィンドウを閉じます。
- bridge が動いていない場合、フックはハートビートファイルが古いことを検知してすぐに終了します。
- フックを削除するには：`node install-hooks.mjs --uninstall`。

## ファイル

| パス | 内容 |
|---|---|
| `bridge/bridge.mjs` | デーモン：イベント、セッション、区画とオブジェクト、建設、改修 |
| `bridge/features/*.mjs` | 設定で切り替える機能（レジストリとディスパッチャーは `index.mjs`） |
| `bridge/settings.mjs`、`bridge/settings-page.mjs` | プリセット、スイッチ、パラメーター。設定ページとその API |
| `bridge/map-page.mjs` | 町のライブマップ（`/map`） |
| `bridge/i18n.mjs`、`locales/` | ローカライズ：`t()` と言語ごとの文字列カタログ（`en.json` が原本） |
| `bridge/generators.mjs`、`bridge/archive/` | ジェネレーターのバージョンとそのアーカイブ |
| `bridge/renovate.mjs` | 差分による改修 |
| `bridge/fx.mjs` | tick ごとの RCON 予算付きエフェクトキュー |
| `bridge/plotmeta.mjs` | 設計図から見つけたベル、煙突、ドア、窓、文字盤 |
| `bridge/smallforms.mjs` | ベンチ、木、花壇、噴水、公園、展望台 |
| `bridge/buildings.mjs`、`bridge/blueprint.mjs` | 建物のジェネレーター（`.dev/parts` から組み立て） |
| `hooks/alps-hook.mjs` | Claude Code のフック |
| `install-hooks.mjs`、`configure.mjs` | フックのインストーラー。ターミナルからの設定 |
| `datapack/` | 進捗と町役場のデータパック（`node datapack/build.mjs` で再ビルド） |
| `bots/` | 実験：本物の Mineflayer 建築家ボット（別の `package.json`） |
| `docs/` | ジェネレーター契約、建物の基準、ローカライズ、ロードマップ |
| `server/` | Paper 1.21.11：localhost 限定、オフラインモード、ピースフル、クリエイティブ |
| `state.json` | 町の状態 |

町を最初からやり直すには：すべてを停止し、`server/world*` と `state.json` を削除します。

## ライセンス

- [LICENSE](LICENSE) — MIT、© 2026 linkartemy。
- [NOTICE.md](NOTICE.md) — 独立したファンプロジェクトであり、Mojang、Microsoft、Anthropic とは無関係です。ゲームファイルは再配布しておらず、Minecraft EULA にはご自身で同意していただきます。
