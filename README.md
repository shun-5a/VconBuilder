# VconBuilder

[日本語](README.ja.md)

A local app that keeps timecodes and storyboards in a text file (`<folder name>.vcb`, JSON) and exports
vcons (video contes) with reference images/videos and burned-in captions as mp4.
Every track (video, lighting, audio, ...) has its own timing, so it also works as a stage-show cue sheet.

## Development

Node.js is pinned in `mise.toml` (no global installs needed).

```bash
mise install
npm install
npm run tauri dev     # run the app
npm test              # unit tests
npm run lint          # Biome (TS/CSS lint + format check), rustfmt --check, clippy
npm run format        # fix formatting and safe lint issues (Biome + rustfmt)
npm run tauri build   # installer in src-tauri/target/release/bundle/nsis/
```

`npm run dev` alone runs the UI in a plain browser against an in-memory fake backend with sample assets
(`src/dev/mockTauri.ts`).

### Branches

- `develop`: the main line (default branch); always builds and passes `npm test` / `npm run lint`
- `feat/…`, `fix/…`, `chore/…`, `docs/…`: one change each, branched from `develop` and squash-merged back through a PR
- `main`: released versions only; `develop` is merged in (merge commit) and tagged `vX.Y.Z` for each release
- `hotfix/…`: urgent fixes branched from `main`, merged into both `main` and `develop`

Commit messages are short English lines prefixed with the type (`feat: …`, `fix: …`, `chore: …`, `docs: …`).

## Features

- **No save step**: every change is written to the project file immediately. The app opens straight into an
  "Untitled project" (kept in the app data folder); **File ▸ Save to folder…** (Ctrl+S) gives it a home.
  For a project already in a folder, **File ▸ Save a copy…** (Ctrl+Shift+S) duplicates it. Closing an untitled project asks
  whether to keep it
- **Double-click to open**: the installer registers `.vcb` with Windows. Double-clicking a project file opens it;
  while the app runs it opens in another window (or brings forward the window that already has it)
- **Conte table** (right panel, one tab per track): IN ~ OUT and Reference (the picture / audio file) are required on every track;
  Notion-style + bars add rows and columns (audio tracks take text columns only); editing times pushes / pulls the following rows like a spreadsheet.
  ◉ in a column header shows, for the current preset, an extra media column as a small inset in a corner, or a text column as a caption
- **Timeline**: move / trim / split, snapping, waveforms, video thumbnails; Alt+[ / Alt+] set the selected clip's IN / OUT to the playhead (as in After Effects); Alt+drag on a clip edge also shifts the following clips.
  ◉ in a track header: visual tracks are shown/hidden in the current preset, audio tracks are muted/unmuted
- **Presets** work like After Effects compositions: part of the project, edited directly, saved with it. Each preset has its own visible tracks (`screens`), inset/caption columns per track (`columns`), inset placement and output settings (✎), so one set of tables can be exported as several videos
- **Export**: H.264 + AAC mp4 via WebCodecs (no ffmpeg); File ▸ Export video… picks a preset and renders it
- **Assets**: drag & drop from the file manager or a browser into `assets/`; rename in the Assets tab (clips using the file are updated); organise them in collapsible groups (stored in `assetGroups`, files stay in `assets/`)
- **Text export**: Markdown (all tracks + combined table) and CSV per track
- **AI**: agents edit the `.vcb` file (JSON) directly; every project gets an `AGENTS.md` guide (format reference, rules, recipes)

## Layout

| Path | Role |
|---|---|
| `src/model/` | schema (zod), timecode, edit operations, presets, Markdown/CSV, JSON format, AGENTS.md guide |
| `src/store/` | Zustand store (undo/redo, one undo step per drag) |
| `src/io/` | Tauri command bridge, autosave + external-change watching, drag & drop import, text export |
| `src/render/` | Canvas compositor (shared by preview and export), mp4 exporter (Mediabunny + WebCodecs) |
| `src/audio/` | Web Audio mixing (shared by preview and export), waveforms |
| `src/views/` | preview, timeline, tables, assets, dialogs |
| `src-tauri/` | file I/O (atomic save), folder watching, asset import/download, untitled-project folders |

## Project folder

```
<project>/
├─ <project>.vcb      the project file, JSON (autosaved; external edits show up immediately; double-click opens the app)
├─ AGENTS.md           guide for AI agents (generated block + your project notes)
├─ assets/             images, videos, audio
└─ exports/            mp4 / Markdown / CSV exports
```

## Notes

- `rust-version = "1.89"` in Cargo.toml makes cargo pick Tauri crates that build with the installed Rust;
  the `@tauri-apps/*` npm packages are pinned to the matching 2.11 line.
- Not done yet: macOS build (needs a Mac; WebCodecs support in WKWebView to be verified), optional ffmpeg integration.
