# VconBuilder

[English](README.md)

タイムコードと絵コンテをテキストファイル（`<フォルダ名>.vcb`、中身は JSON）で管理するローカルアプリです。
参考の画像・動画とテロップを入れたビデオコンテ（Vコン）を mp4 で書き出せます。
映像・照明・音声などのトラックはそれぞれ独立したタイミングを持つので、舞台のキューシートとしても使えます。

## ダウンロード

[Releases](https://github.com/shun-5a/VconBuilder/releases) から `VconBuilder_<バージョン>_x64-setup.exe` をダウンロードして実行してください
（今のユーザーにインストールされ、`.vcb` ファイルをダブルクリックするとアプリで開くようになります）。
インストーラーはまだコード署名していません。「Windows によって PC が保護されました」と出たら、**詳細情報** → **実行** を選んでください。

## 開発

Node.js のバージョンは `mise.toml` で固定しています（グローバルへのインストールは不要です）。

```bash
mise install
npm install
npm run tauri dev     # アプリを起動
npm test              # ユニットテスト
npm run lint          # Biome（TS/CSS の lint とフォーマット確認）、rustfmt --check、clippy
npm run format        # フォーマットと安全な lint 修正（Biome + rustfmt）
npm run tauri build   # インストーラーを src-tauri/target/release/bundle/nsis/ に作成
```

`npm run dev` だけを実行すると、UI を普通のブラウザで動かせます。バックエンドはメモリ上の偽物（`src/dev/mockTauri.ts`）で、
サンプル素材が入っています。

### ブランチ

- `develop`：開発の本線（既定ブランチ）。常にビルドでき、`npm test` / `npm run lint` が通る状態を保つ
- `feat/…`、`fix/…`、`chore/…`、`docs/…`：1つの変更ごとのブランチ。`develop` から作り、PR で `develop` に squash merge する
- `main`：リリースした版だけ。リリースのたびに `develop` を merge commit で取り込み、`vX.Y.Z` のタグを付ける
- `hotfix/…`：リリース済みの版の緊急修正。`main` から作り、`main` と `develop` の両方に取り込む

コミットメッセージは短い英語で、先頭に種類を付けます（`feat: …`、`fix: …`、`chore: …`、`docs: …`）。

### CI とリリース（GitHub Actions）

- `.github/workflows/ci.yml`：`develop` / `main` への PR（と `develop` への push）で、lint・テスト・画面のビルド・`cargo test` を実行する
- `.github/workflows/release.yml`：`main` 上のコミットに `vX.Y.Z` のタグを push すると、インストーラーを作って Release の**下書き**に添付する

リリースの手順：

1. `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` のバージョンを上げる（`develop` で PR を通す）
2. `develop` を `main` に merge commit で取り込み、`main` を push する
3. `main` で `git tag vX.Y.Z` → `git push origin vX.Y.Z`（タグとバージョンが違うとワークフローが止まる）
4. ワークフローが終わったら、Releases の画面で下書きを確認して公開する

## 機能

- **保存の操作が不要**：変更はすぐにプロジェクトファイルへ書き込まれます。アプリは「Untitled project」（アプリのデータフォルダに置かれます）で起動し、
  **File ▸ Save to folder…**（Ctrl+S）で保存先のフォルダを決めます。
  フォルダに保存済みのプロジェクトは、**File ▸ Save a copy…**（Ctrl+Shift+S）で複製できます。未保存のプロジェクトを閉じると、残すかどうかを聞きます
- **ダブルクリックで開く**：インストーラーが `.vcb` を Windows に登録します。プロジェクトファイルをダブルクリックするとアプリで開きます。
  アプリの起動中は別ウィンドウで開きます（同じプロジェクトを開いているウィンドウがあれば、それを前面に出します）
- **コンテ表**（右パネル、トラックごとのタブ）：どのトラックにも「IN ~ OUT」と「Reference」（映像・音声ファイル）の列が必ずあります。
  Notion 風の ＋ バーで行と列を追加できます（オーディオトラックはテキスト列のみ）。時間を編集すると、表計算のように後ろの行が前後に動きます。
  列ヘッダーの ◉ で、今のプリセットでの表示を切り替えます。追加したメディア列は画面の隅の小窓として、テキスト列はテロップとして表示されます
- **タイムライン**：移動・トリム・分割、スナップ、波形と動画のサムネイル表示。Alt+[ / Alt+] で選択中のクリップの IN / OUT を再生位置に合わせます（After Effects と同じ）。
  クリップの端を Alt+ドラッグすると、後ろのクリップも一緒にずれます。
  トラックヘッダーの ◉ は、ビジュアルトラックでは今のプリセットでの表示／非表示、オーディオトラックではミュートの切り替えです
- **プリセット**は After Effects のコンポジションのように扱います。プロジェクトの一部で、直接編集し、プロジェクトと一緒に保存されます。
  プリセットごとに、表示するトラック（`screens`）、トラックごとの小窓・テロップの列（`columns`）、小窓の位置、出力設定（✎）を持つので、
  同じ表から複数の動画を書き出せます
- **書き出し**：WebCodecs による H.264 + AAC の mp4（ffmpeg 不要）。File ▸ Export video… でプリセットを選んで書き出します
- **素材**：エクスプローラーやブラウザから `assets/` へドラッグ＆ドロップで取り込めます。Assets タブで名前を変えると、その素材を使っているクリップも更新されます。
  折りたためるグループで整理できます（`assetGroups` に保存され、ファイル自体は `assets/` のままです）
- **テキスト書き出し**：Markdown（全トラック＋統合表）と、トラックごとの CSV
- **AI**：AI エージェントは `.vcb` ファイル（JSON）を直接編集します。各プロジェクトには `AGENTS.md`（形式の説明、ルール、手順例）が作られます

## ソースの構成

| パス | 役割 |
|---|---|
| `src/model/` | スキーマ（zod）、タイムコード、編集操作、プリセット、Markdown/CSV、JSON 形式、AGENTS.md のガイド |
| `src/store/` | Zustand のストア（元に戻す／やり直し。ドラッグ1回で1ステップ） |
| `src/io/` | Tauri コマンドの呼び出し、自動保存と外部からの変更の監視、ドラッグ＆ドロップでの取り込み、テキスト書き出し |
| `src/render/` | Canvas の合成処理（プレビューと書き出しで共通）、mp4 の書き出し（Mediabunny + WebCodecs） |
| `src/audio/` | Web Audio のミックス（プレビューと書き出しで共通）、波形 |
| `src/views/` | プレビュー、タイムライン、表、素材、ダイアログ |
| `src-tauri/` | ファイルの読み書き（安全な保存）、フォルダの監視、素材の取り込み・ダウンロード、未保存プロジェクトのフォルダ、`.vcb` から開く処理とウィンドウ管理 |

## プロジェクトフォルダ

```
<project>/
├─ <project>.vcb      プロジェクトファイル、JSON（自動保存。外部での編集はすぐ反映。ダブルクリックでアプリが開く）
├─ AGENTS.md           AI エージェント向けのガイド（自動生成の部分＋自由に書けるメモ）
├─ assets/             画像・動画・音声
└─ exports/            mp4 / Markdown / CSV の書き出し先
```

## 補足

- Cargo.toml の `rust-version = "1.89"` によって、インストール済みの Rust でビルドできる Tauri のクレートが選ばれます。
  npm の `@tauri-apps/*` パッケージもそれに合わせて 2.11 系に固定しています。
- 未対応：macOS 版のビルド（Mac が必要。WKWebView での WebCodecs の対応状況も要確認）、ffmpeg との連携（任意）。
