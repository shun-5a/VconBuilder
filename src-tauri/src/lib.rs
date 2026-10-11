use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use percent_encoding::percent_decode_str;
use std::collections::HashMap;
use std::fs;
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Extension of the project file (`<folder name>.vcb`, JSON); registered with the OS by the installer.
const PROJECT_EXT: &str = "vcb";
const ASSETS_DIR: &str = "assets";
const EXPORTS_DIR: &str = "exports";

/// The project folder each window has open (by window label), with the watcher for it.
#[derive(Default)]
struct WatchState(Mutex<HashMap<String, (PathBuf, RecommendedWatcher)>>);

/// Folder a window should open when it starts (from a double-clicked .vcb), by window label.
#[derive(Default)]
struct PendingOpen(Mutex<HashMap<String, String>>);

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn is_project_file(path: &Path) -> bool {
    path.extension()
        .is_some_and(|e| e.eq_ignore_ascii_case(PROJECT_EXT))
}

/// The project file of a folder: `<folder name>.vcb`; else the only .vcb in it (the folder was renamed);
/// else `<folder name>.vcb` as the name for a new one.
fn project_file_in(dir: &Path) -> PathBuf {
    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "project".into());
    let preferred = dir.join(format!("{name}.{PROJECT_EXT}"));
    if preferred.is_file() {
        return preferred;
    }
    let found: Vec<PathBuf> = fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.is_file() && is_project_file(p))
                .collect()
        })
        .unwrap_or_default();
    match found.as_slice() {
        [only] => only.clone(),
        _ => preferred,
    }
}

#[tauri::command]
fn project_file(dir: String) -> String {
    dunce_path(&project_file_in(Path::new(&dir)))
}

/// Comparable form of a folder path (resolves `..`, case-insensitive on Windows).
fn same_dir_key(path: &Path) -> String {
    let p = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let s = dunce_path(&p);
    if cfg!(windows) {
        s.to_lowercase()
    } else {
        s
    }
}

/// Project folder named by a launch argument: a .vcb file (its folder) or a folder.
fn dir_from_arg(arg: &str, cwd: &Path) -> Option<PathBuf> {
    let p = cwd.join(arg);
    if p.is_file() && is_project_file(&p) {
        p.parent().map(Path::to_path_buf)
    } else if p.is_dir() {
        Some(p)
    } else {
        None
    }
}

/// Joins `rel` onto `dir`, rejecting paths that escape `dir`.
fn safe_join(dir: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path.is_absolute()
        || rel_path.components().any(|c| {
            matches!(
                c,
                std::path::Component::ParentDir | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(format!("invalid relative path: {rel}"));
    }
    Ok(dir.join(rel_path))
}

fn to_rel(dir: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(dir)
        .ok()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
}

fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if "<>:\"/\\|?*".contains(c) || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "asset".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Returns a path inside `assets/` that does not exist yet, numbering duplicates (`name_1.png`).
fn unique_asset_path(dir: &Path, name: &str) -> PathBuf {
    let assets = dir.join(ASSETS_DIR);
    let name = sanitize_file_name(name);
    let candidate = assets.join(&name);
    if !candidate.exists() {
        return candidate;
    }
    let p = Path::new(&name);
    let stem = p
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let ext = p
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    (1..)
        .map(|i| assets.join(format!("{stem}_{i}{ext}")))
        .find(|c| !c.exists())
        .unwrap()
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(err)
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Writes text atomically (temp file + rename) so watchers and external editors never see a half-written file.
#[tauri::command]
fn write_text_atomic(path: String, text: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    let tmp = path.with_file_name(format!(
        ".{}.tmp",
        path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default()
    ));
    fs::write(&tmp, text.as_bytes()).map_err(err)?;
    fs::rename(&tmp, &path).map_err(err)
}

#[tauri::command]
fn ensure_project_dirs(dir: String) -> Result<(), String> {
    let dir = PathBuf::from(dir);
    fs::create_dir_all(dir.join(ASSETS_DIR)).map_err(err)?;
    fs::create_dir_all(dir.join(EXPORTS_DIR)).map_err(err)
}

/// Grants the webview access to the project folder and starts watching it for external edits.
/// Change events go only to the window that opened the folder.
#[tauri::command]
fn open_project(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<WatchState>,
    dir: String,
) -> Result<(), String> {
    let dir = PathBuf::from(&dir);
    app.asset_protocol_scope()
        .allow_directory(&dir, true)
        .map_err(err)?;

    let emitter = app.clone();
    let label = window.label().to_string();
    let target = label.clone();
    let root = dir.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        if event.kind.is_access() {
            return;
        }
        for path in &event.paths {
            let Some(rel) = to_rel(&root, path) else {
                continue;
            };
            if !rel.contains('/') && is_project_file(path) {
                let _ = emitter.emit_to(target.as_str(), "fs-project-changed", ());
            } else if rel.starts_with("assets/") || rel == ASSETS_DIR {
                // The changed file (project-relative), so the UI can drop what it cached for it.
                let changed: Vec<&str> = if rel == ASSETS_DIR {
                    vec![]
                } else {
                    vec![rel.as_str()]
                };
                let _ = emitter.emit_to(target.as_str(), "fs-assets-changed", changed);
            }
        }
    })
    .map_err(err)?;
    watcher.watch(&dir, RecursiveMode::Recursive).map_err(err)?;
    state.0.lock().unwrap().insert(label, (dir, watcher));
    Ok(())
}

/// The folder this window was asked to open on launch (a double-clicked .vcb), once.
#[tauri::command]
fn take_open_dir(window: tauri::Window, pending: tauri::State<PendingOpen>) -> Option<String> {
    pending.0.lock().unwrap().remove(window.label())
}

/// A second launch (double-clicking a .vcb while the app runs): focus the window that already has
/// that project open, or open it in a new window.
fn open_in_window(app: &tauri::AppHandle, dir: PathBuf) {
    let key = same_dir_key(&dir);
    let open_in = app
        .state::<WatchState>()
        .0
        .lock()
        .unwrap()
        .iter()
        .find(|(_, (d, _))| same_dir_key(d) == key)
        .map(|(label, _)| label.clone());
    if let Some(w) = open_in.and_then(|label| app.get_webview_window(&label)) {
        let _ = w.unminimize();
        let _ = w.set_focus();
        return;
    }
    let label = (1..)
        .map(|n| format!("project-{n}"))
        .find(|l| app.get_webview_window(l).is_none())
        .unwrap();
    app.state::<PendingOpen>()
        .0
        .lock()
        .unwrap()
        .insert(label.clone(), dunce_path(&dir));
    let app = app.clone();
    // Windows are built off the single-instance callback (building inside it can deadlock on Windows).
    tauri::async_runtime::spawn(async move {
        let built = tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::default())
            .title("VconBuilder")
            .inner_size(1600.0, 960.0)
            .disable_drag_drop_handler()
            .build();
        if let Err(e) = built {
            eprintln!("could not open a window: {e}");
        }
    });
}

#[tauri::command]
fn list_assets(dir: String) -> Result<Vec<String>, String> {
    let dir = PathBuf::from(dir);
    let mut out = Vec::new();
    let mut stack = vec![dir.join(ASSETS_DIR)];
    while let Some(d) = stack.pop() {
        let Ok(entries) = fs::read_dir(&d) else {
            continue;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            if p.is_dir() {
                stack.push(p);
            } else if let Some(rel) = to_rel(&dir, &p) {
                out.push(rel);
            }
        }
    }
    out.sort();
    Ok(out)
}

/// Renames a file inside `assets/` (same folder). The extension is kept when the new name has none.
/// Refuses to overwrite an existing file. Returns the new project-relative path.
#[tauri::command]
fn rename_asset(dir: String, rel: String, new_name: String) -> Result<String, String> {
    let dir = PathBuf::from(dir);
    if !rel.starts_with("assets/") {
        return Err("only files in assets/ can be renamed".into());
    }
    let from = safe_join(&dir, &rel)?;
    if !from.is_file() {
        return Err(format!("{rel} does not exist"));
    }
    let mut name = sanitize_file_name(&new_name);
    if Path::new(&name).extension().is_none() {
        if let Some(ext) = from.extension() {
            name = format!("{name}.{}", ext.to_string_lossy());
        }
    }
    let to = from.with_file_name(&name);
    if to == from {
        return Ok(rel);
    }
    // Allow changing only the letter case on case-insensitive file systems.
    let same_file_case_change = to
        .to_string_lossy()
        .eq_ignore_ascii_case(&from.to_string_lossy());
    if to.exists() && !same_file_case_change {
        return Err(format!("{name} already exists"));
    }
    fs::rename(&from, &to).map_err(err)?;
    to_rel(&dir, &to).ok_or_else(|| "failed to resolve asset path".into())
}

/// Creates an empty, uniquely named file in `assets/` and returns its project-relative path.
#[tauri::command]
fn reserve_asset(dir: String, name: String) -> Result<String, String> {
    let dir = PathBuf::from(dir);
    fs::create_dir_all(dir.join(ASSETS_DIR)).map_err(err)?;
    let path = unique_asset_path(&dir, &name);
    fs::File::create(&path).map_err(err)?;
    to_rel(&dir, &path).ok_or_else(|| "failed to resolve asset path".into())
}

fn header(request: &tauri::ipc::Request, key: &str) -> Result<String, String> {
    let raw = request
        .headers()
        .get(key)
        .ok_or_else(|| format!("missing header {key}"))?
        .to_str()
        .map_err(err)?;
    Ok(percent_decode_str(raw)
        .decode_utf8()
        .map_err(err)?
        .to_string())
}

fn body_bytes(request: &tauri::ipc::Request) -> Result<Vec<u8>, String> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        _ => Err("expected raw binary body".into()),
    }
}

/// Writes a binary chunk at a byte offset. Headers: `x-path` (absolute, URI-encoded), `x-position`.
/// Used for streamed asset imports and for mp4 export.
#[tauri::command]
fn write_chunk(request: tauri::ipc::Request) -> Result<(), String> {
    let path = header(&request, "x-path")?;
    let position: u64 = header(&request, "x-position")?.parse().map_err(err)?;
    let bytes = body_bytes(&request)?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(&path)
        .map_err(err)?;
    file.seek(SeekFrom::Start(position)).map_err(err)?;
    file.write_all(&bytes).map_err(err)
}

#[tauri::command]
fn create_empty_file(path: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::File::create(path).map(|_| ()).map_err(err)
}

#[tauri::command]
fn remove_file(path: String) -> Result<(), String> {
    fs::remove_file(path).map_err(err)
}

fn file_name_from_url(url: &reqwest::Url, content_type: Option<&str>) -> String {
    let last = url
        .path_segments()
        .and_then(|mut s| s.next_back().map(|x| x.to_string()))
        .unwrap_or_default();
    let last = percent_decode_str(&last).decode_utf8_lossy().to_string();
    let has_ext = Path::new(&last).extension().is_some();
    let base = if last.is_empty() {
        "download".to_string()
    } else {
        last
    };
    if has_ext {
        return base;
    }
    let ext = match content_type
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
    {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/avif" => "avif",
        "image/svg+xml" => "svg",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "audio/mpeg" => "mp3",
        "audio/wav" | "audio/x-wav" => "wav",
        _ => "bin",
    };
    format!("{base}.{ext}")
}

/// Downloads an http(s) URL dropped from a browser into `assets/`.
#[tauri::command]
async fn download_asset(dir: String, url: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let parsed = reqwest::Url::parse(&url).map_err(err)?;
        if parsed.scheme() != "http" && parsed.scheme() != "https" {
            return Err(format!("unsupported URL scheme: {}", parsed.scheme()));
        }
        let response = reqwest::blocking::Client::builder()
            .user_agent("VconBuilder/0.1")
            .build()
            .map_err(err)?
            .get(parsed.clone())
            .send()
            .map_err(err)?
            .error_for_status()
            .map_err(err)?;
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let dir = PathBuf::from(dir);
        fs::create_dir_all(dir.join(ASSETS_DIR)).map_err(err)?;
        let path = unique_asset_path(&dir, &file_name_from_url(&parsed, content_type.as_deref()));
        let bytes = response.bytes().map_err(err)?;
        fs::write(&path, &bytes).map_err(err)?;
        to_rel(&dir, &path).ok_or_else(|| "failed to resolve asset path".into())
    })
    .await
    .map_err(err)?
}

/// Shows a file in Explorer / Finder.
#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer")
        .arg(format!("/select,{}", path.replace('/', "\\")))
        .spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open")
        .args(["-R", &path])
        .spawn();
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let result = std::process::Command::new("xdg-open")
        .arg(Path::new(&path).parent().unwrap_or(Path::new(".")))
        .spawn();
    result.map(|_| ()).map_err(err)
}

#[tauri::command]
fn resolve_in_project(dir: String, rel: String) -> Result<String, String> {
    safe_join(Path::new(&dir), &rel).map(|p| p.to_string_lossy().to_string())
}

/// Strips the Windows verbatim prefix (\\?\) so the path works in config files and for Node.
fn dunce_path(path: &Path) -> String {
    let s = path.to_string_lossy().to_string();
    s.strip_prefix(r"\\?\").map(|x| x.to_string()).unwrap_or(s)
}

// ------------------------------------------------------------------ untitled projects

/// Unsaved ("Untitled") projects live under the app's local data dir until "Save As".
fn untitled_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(err)?
        .join("untitled"))
}

/// Existing untitled project folders, newest first (for restoring unsaved work on launch).
/// Folders open in another window are left out.
#[tauri::command]
fn list_untitled(
    app: tauri::AppHandle,
    state: tauri::State<WatchState>,
) -> Result<Vec<String>, String> {
    let root = untitled_root(&app)?;
    let Ok(entries) = fs::read_dir(&root) else {
        return Ok(vec![]);
    };
    let open: Vec<String> = state
        .0
        .lock()
        .unwrap()
        .values()
        .map(|(d, _)| same_dir_key(d))
        .collect();
    let mut dirs: Vec<(std::time::SystemTime, PathBuf)> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| project_file_in(p).is_file() && !open.contains(&same_dir_key(p)))
        .map(|p| {
            let modified = fs::metadata(project_file_in(&p))
                .and_then(|m| m.modified())
                .unwrap_or(std::time::UNIX_EPOCH);
            (modified, p)
        })
        .collect();
    dirs.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(dirs.into_iter().map(|(_, p)| dunce_path(&p)).collect())
}

/// Creates a fresh, empty folder for a new untitled project.
#[tauri::command]
fn create_untitled_dir(app: tauri::AppHandle) -> Result<String, String> {
    let root = untitled_root(&app)?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(err)?
        .as_millis();
    let dir = root.join(format!("untitled-{stamp}"));
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dunce_path(&dir))
}

#[tauri::command]
fn is_untitled_dir(app: tauri::AppHandle, dir: String) -> Result<bool, String> {
    Ok(Path::new(&dir).starts_with(untitled_root(&app)?))
}

/// Deletes an untitled project folder. Refuses anything outside the untitled root.
#[tauri::command]
fn discard_untitled(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<WatchState>,
    dir: String,
) -> Result<(), String> {
    let root = untitled_root(&app)?;
    let dir = PathBuf::from(dir);
    if !dir.starts_with(&root) || dir == root {
        return Err("not an untitled project folder".into());
    }
    state.0.lock().unwrap().remove(window.label());
    fs::remove_dir_all(&dir).map_err(err)
}

/// Stops watching this window's project folder (before it is moved or deleted).
#[tauri::command]
fn stop_watching(window: tauri::Window, state: tauri::State<WatchState>) {
    state.0.lock().unwrap().remove(window.label());
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name();
        if name.to_string_lossy().ends_with(".tmp") {
            continue;
        }
        let src = entry.path();
        let dst = to.join(&name);
        if src.is_dir() {
            copy_dir(&src, &dst)?;
        } else {
            fs::copy(&src, &dst)?;
        }
    }
    Ok(())
}

/// "Save As": copies a whole project folder to `to`, which must not exist yet or be empty.
/// The project file is renamed after the new folder (`<to name>.vcb`).
#[tauri::command]
fn copy_project(from: String, to: String) -> Result<(), String> {
    let from = PathBuf::from(from);
    let to = PathBuf::from(to);
    if to.exists() && fs::read_dir(&to).map_err(err)?.next().is_some() {
        return Err(format!("{} already exists and is not empty", to.display()));
    }
    copy_dir(&from, &to).map_err(err)?;
    let copied = project_file_in(&to);
    let wanted = to.join(format!(
        "{}.{PROJECT_EXT}",
        to.file_name().unwrap_or_default().to_string_lossy()
    ));
    if copied.is_file() && copied != wanted {
        fs::rename(&copied, &wanted).map_err(err)?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first: a second launch hands its arguments to this process and exits.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let cwd = PathBuf::from(cwd);
            match argv.iter().skip(1).find_map(|a| dir_from_arg(a, &cwd)) {
                Some(dir) => open_in_window(app, dir),
                None => {
                    if let Some(w) = app.webview_windows().values().next() {
                        let _ = w.unminimize();
                        let _ = w.set_focus();
                    }
                }
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(WatchState::default())
        .manage(PendingOpen::default())
        .setup(|app| {
            // First launch by double-clicking a .vcb: the main window opens that project.
            let cwd = std::env::current_dir().unwrap_or_default();
            if let Some(dir) = std::env::args()
                .skip(1)
                .find_map(|a| dir_from_arg(&a, &cwd))
            {
                app.state::<PendingOpen>()
                    .0
                    .lock()
                    .unwrap()
                    .insert("main".into(), dunce_path(&dir));
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle();
                app.state::<WatchState>()
                    .0
                    .lock()
                    .unwrap()
                    .remove(window.label());
                app.state::<PendingOpen>()
                    .0
                    .lock()
                    .unwrap()
                    .remove(window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            project_file,
            take_open_dir,
            read_text,
            file_exists,
            write_text_atomic,
            ensure_project_dirs,
            open_project,
            list_assets,
            reserve_asset,
            rename_asset,
            write_chunk,
            create_empty_file,
            remove_file,
            download_asset,
            reveal_path,
            resolve_in_project,
            list_untitled,
            create_untitled_dir,
            is_untitled_dir,
            discard_untitled,
            stop_watching,
            copy_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
