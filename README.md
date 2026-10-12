# VconBuilder

[日本語](README.ja.md)

## About

A local app that keeps timecodes and storyboards in a text file (`<folder name>.vcb`, JSON) and exports
vcons (video contes) with reference images/videos and burned-in captions as mp4.

## Download

Get `VconBuilder_<version>_x64-setup.exe` from [Releases](https://github.com/shun-5a/VconBuilder/releases) and run it
(installs for the current user; `.vcb` project files open in the app by double-click).
The installer is not code-signed yet: if SmartScreen says "Windows protected your PC", choose **More info** → **Run anyway**.
To update, run the installer of the new version; it replaces the installed one.

## Features

The window has the preview (top left), the timeline (bottom left) and the right panel (Conte / Assets tabs).

### Menu (File / Edit)

- **No save step**: every change is written to the project file immediately. The app opens straight into an
  "Untitled project" (kept in the app data folder); **File ▸ Save to folder…** (Ctrl+S) gives it a home.
  For a project already in a folder, **File ▸ Save a copy…** (Ctrl+Shift+S) duplicates it. Closing an untitled project asks
  whether to keep it
- **File ▸ Export video…**: pick a preset and export an H.264 + AAC mp4 (via WebCodecs, no ffmpeg)
- **Text export**: Markdown (all tracks + combined table) and CSV per track

### Preview

- Shows the frame at the playhead exactly as it is exported
- **Presets** are the views you export: saved with the project and edited directly. Each preset has its own visible tracks
  (`screens`), inset / caption columns per track (`columns`), inset placement and output settings (✎), so one set of tables
  can be exported as several differently arranged videos

### Timeline

- Move / trim / split clips, snapping, waveforms and video thumbnails
- Alt+[ / Alt+] set the selected clip's IN / OUT to the playhead; Alt+drag on a clip edge also shifts the following clips
- ◉ in a track header: visual tracks are shown / hidden in the current preset, audio tracks are muted / unmuted

### Conte tab (the tables)

- One tab per track with that track's table. IN ~ OUT and Reference (the picture / audio file) are required on every track
- Editing times pushes / pulls the following rows like a spreadsheet
- Hovering a row shows ▲ / ▼ to swap it with the row above / below (both keep their lengths) and ✕ to delete it
- Media cells are filled from a list with thumbnails, grouped (and collapsible) like the Assets tab
- ◉ in a column header shows, for the current preset, an extra media column as a small inset in a corner, or a text column as a caption

### Assets tab

- Drag & drop from the file manager or a browser to import into `assets/`
- Double-click a picture to open the file in its default app; double-click the name to rename it (clips using the file are updated)
- Organise files in collapsible groups (stored in `assetGroups`; the files stay in `assets/`)

### Working with AI

- Agents edit the `.vcb` file (JSON) directly; the app watches it and shows external edits immediately
- Every project gets an `AGENTS.md` guide (format reference, rules, recipes)

### Project folder

```
<project>/
├─ <project>.vcb      the project file, JSON (autosaved; external edits show up immediately; double-click opens the app)
├─ AGENTS.md           guide for AI agents (generated block + your project notes)
├─ assets/             images, videos, audio
└─ exports/            mp4 / Markdown / CSV exports
```

## Development and source layout

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

### Source layout

| Path | Role |
|---|---|
| `src/model/` | schema (zod), timecode, edit operations, presets, Markdown/CSV, JSON format, AGENTS.md guide |
| `src/store/` | Zustand store (undo/redo, one undo step per drag) |
| `src/io/` | Tauri command bridge, autosave + external-change watching, drag & drop import, text export |
| `src/render/` | Canvas compositor (shared by preview and export), mp4 exporter (Mediabunny + WebCodecs) |
| `src/audio/` | Web Audio mixing (shared by preview and export), waveforms |
| `src/views/` | preview, timeline, tables, assets, dialogs |
| `src-tauri/` | file I/O (atomic save), folder watching, asset import/download, untitled-project folders, opening `.vcb` files and windows |

### Branches

- `develop`: the main line (default branch); always builds and passes `npm test` / `npm run lint`
- `feat/…`, `fix/…`, `chore/…`, `docs/…`: one change each, branched from `develop` and squash-merged back through a PR
- `main`: released versions only; `develop` is merged in (merge commit) and tagged `vX.Y.Z` for each release
- `hotfix/…`: urgent fixes branched from `main`, merged into both `main` and `develop`

Commit messages are short English lines prefixed with the type (`feat: …`, `fix: …`, `chore: …`, `docs: …`).

### CI and releases (GitHub Actions)

- `.github/workflows/ci.yml`: every PR to `develop` / `main` (and pushes to `develop`) runs lint, tests, the front-end build and `cargo test`
- `.github/workflows/release.yml`: pushing a tag `vX.Y.Z` that is on `main` builds the installer and attaches it to a **draft** release

Release steps:

1. Raise the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` (on `develop`, through a PR)
2. Merge `develop` into `main` (merge commit) and push `main`
3. `git tag vX.Y.Z` on `main` and `git push origin vX.Y.Z` (the tag must match the version, or the workflow stops)
4. When the workflow has finished, check the draft on the Releases page and publish it

## Notes

- `rust-version = "1.89"` in Cargo.toml makes cargo pick Tauri crates that build with the installed Rust;
  the `@tauri-apps/*` npm packages are pinned to the matching 2.11 line. CI also uses Rust 1.89.
- Not done yet: macOS build (needs a Mac; WebCodecs support in WKWebView to be verified), optional ffmpeg integration.
