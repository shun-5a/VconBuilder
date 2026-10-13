/**
 * Dev-only: an in-memory stand-in for the Rust backend so the UI can run in a plain browser
 * (`npm run dev` without Tauri). Not included in production builds.
 */

import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

type Bytes = Uint8Array<ArrayBuffer>;
const files = new Map<string, Bytes>();
const urls = new Map<string, { bytes: Bytes; url: string }>();
const enc = new TextEncoder();
const UNTITLED = "C:/mock/appdata/untitled/";
/** Sample assets seeded into every new untitled project. */
const samples = new Map<string, Bytes>();
const dec = new TextDecoder();
const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+/g, "/");

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  webm: "video/webm",
};

function blobUrl(path: string): string {
  const bytes = files.get(norm(path));
  if (!bytes) return "about:blank";
  const cached = urls.get(path);
  if (cached && cached.bytes === bytes) return cached.url;
  const ext = path.split(".").pop()!.toLowerCase();
  const url = URL.createObjectURL(new Blob([bytes], { type: MIME[ext] ?? "application/octet-stream" }));
  urls.set(path, { bytes, url });
  return url;
}

/** Same rule as the backend: `<folder name>.vcb`, else the only .vcb directly in the folder. */
function projectFileIn(dir: string): string {
  const d = norm(dir).replace(/\/$/, "");
  const preferred = `${d}/${d.split("/").pop()}.vcb`;
  if (files.has(preferred)) return preferred;
  const found = [...files.keys()].filter((k) => k.startsWith(`${d}/`) && !k.slice(d.length + 1).includes("/") && k.endsWith(".vcb"));
  return found.length === 1 ? found[0] : preferred;
}

function uniqueAsset(dir: string, name: string): string {
  let rel = `assets/${name}`;
  const dot = name.lastIndexOf(".");
  for (let i = 1; files.has(norm(`${dir}/${rel}`)); i++) rel = `assets/${name.slice(0, dot)}_${i}${name.slice(dot)}`;
  return rel;
}

function handle(cmd: string, a: Record<string, any> = {}): unknown {
  switch (cmd) {
    case "read_text": {
      const b = files.get(norm(a.path));
      if (!b) throw new Error(`not found: ${a.path}`);
      return dec.decode(b);
    }
    case "file_exists":
      return files.has(norm(a.path));
    case "write_text_atomic":
      files.set(norm(a.path), enc.encode(a.text) as Bytes);
      if (norm(a.path).endsWith("/assets")) void emit("fs-assets-changed");
      return null;
    case "ensure_project_dirs":
    case "open_project":
      return null;
    case "project_file":
      return projectFileIn(a.dir);
    case "take_open_dir":
      return null;
    case "list_assets": {
      const prefix = norm(`${a.dir}/assets/`);
      return [...files.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(norm(`${a.dir}/`).length))
        .sort();
    }
    case "reserve_asset": {
      const rel = uniqueAsset(a.dir, a.name);
      files.set(norm(`${a.dir}/${rel}`), new Uint8Array(0));
      return rel;
    }
    case "rename_asset": {
      const from = norm(`${a.dir}/${a.rel}`);
      const bytes = files.get(from);
      if (!bytes) throw new Error(`${a.rel} does not exist`);
      let name = String(a.newName);
      if (!/\.[A-Za-z0-9]+$/.test(name)) name += a.rel.slice(a.rel.lastIndexOf("."));
      const rel = `assets/${name}`;
      if (files.has(norm(`${a.dir}/${rel}`))) throw new Error(`${name} already exists`);
      files.delete(from);
      files.set(norm(`${a.dir}/${rel}`), bytes);
      return rel;
    }
    case "create_empty_file":
      files.set(norm(a.path), new Uint8Array(0));
      return null;
    case "remove_file":
      files.delete(norm(a.path));
      return null;
    case "reveal_path":
      console.info("[mock] reveal", a.path);
      return null;
    case "open_path":
      console.info("[mock] open", a.path);
      (window as any).__mockOpened = a.path;
      return null;
    case "download_asset":
      throw new Error("download is not available in the browser mock");
    case "list_untitled":
      return [
        ...new Set(
          [...files.keys()].filter((k) => k.startsWith(UNTITLED) && k.endsWith(".vcb")).map((k) => k.slice(0, k.lastIndexOf("/"))),
        ),
      ].reverse();
    case "create_untitled_dir": {
      const dir = `${UNTITLED}untitled-${Date.now()}`;
      for (const [name, bytes] of samples) files.set(norm(`${dir}/assets/${name}`), bytes);
      return dir;
    }
    case "is_untitled_dir":
      return norm(a.dir).startsWith(UNTITLED);
    case "discard_untitled":
      for (const k of [...files.keys()]) if (k.startsWith(`${norm(a.dir)}/`)) files.delete(k);
      return null;
    case "stop_watching":
      return null;
    case "copy_project": {
      const from = `${norm(a.from)}/`;
      const to = `${norm(a.to)}/`;
      if ([...files.keys()].some((k) => k.startsWith(to))) throw new Error(`${a.to} already exists and is not empty`);
      for (const [k, v] of [...files]) if (k.startsWith(from)) files.set(to + k.slice(from.length), v);
      const copied = projectFileIn(a.to);
      const wanted = `${to}${to.slice(0, -1).split("/").pop()}.vcb`;
      if (files.has(copied) && copied !== wanted) {
        files.set(wanted, files.get(copied)!);
        files.delete(copied);
      }
      return null;
    }
    case "plugin:window|destroy":
      console.info("[mock] window destroyed");
      (window as any).__mockDestroyed = true;
      return null;
    case "plugin:dialog|save":
      return "C:/mock/Saved project";
    case "plugin:dialog|open":
      return "C:/mock/project/project.vcb";
    case "plugin:dialog|confirm":
    case "plugin:dialog|ask":
      return true;
    default:
      console.warn("[mock] unhandled", cmd, a);
      return null;
  }
}

function writeChunk(body: Uint8Array, headers: Record<string, string>) {
  const path = norm(decodeURIComponent(headers["x-path"]));
  const pos = Number(headers["x-position"]);
  const cur = files.get(path) ?? new Uint8Array(0);
  const next = new Uint8Array(Math.max(cur.length, pos + body.length));
  next.set(cur);
  next.set(body, pos);
  files.set(path, next);
}

// ------------------------------------------------------------ sample assets

async function canvasPng(label: string, hue: number): Promise<Bytes> {
  const c = document.createElement("canvas");
  c.width = 1280;
  c.height = 720;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 1280, 720);
  grad.addColorStop(0, `hsl(${hue} 70% 35%)`);
  grad.addColorStop(1, `hsl(${hue + 60} 70% 15%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 1280, 720);
  g.fillStyle = "rgba(255,255,255,0.85)";
  g.font = "bold 120px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(label, 640, 360);
  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

function sineWav(seconds: number): Bytes {
  const rate = 48000;
  const n = seconds * rate;
  const buf = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) buf.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  buf.setUint32(4, 36 + n * 2, true);
  str(8, "WAVEfmt ");
  buf.setUint32(16, 16, true);
  buf.setUint16(20, 1, true);
  buf.setUint16(22, 1, true);
  buf.setUint32(24, rate, true);
  buf.setUint32(28, rate * 2, true);
  buf.setUint16(32, 2, true);
  buf.setUint16(34, 16, true);
  str(36, "data");
  buf.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.5 * t);
    buf.setInt16(44 + i * 2, Math.sin(2 * Math.PI * (220 + 110 * Math.floor(t)) * t) * 12000 * env, true);
  }
  return new Uint8Array(buf.buffer);
}

export async function installTauriMock() {
  mockIPC(handle, { shouldMockEvents: true });
  mockWindows("main");
  const internals = (window as any).__TAURI_INTERNALS__;
  const invoke = internals.invoke;
  internals.invoke = async (cmd: string, args: any, options?: { headers?: Record<string, string> }) => {
    if (cmd === "write_chunk") return writeChunk(args as Uint8Array, options?.headers ?? {});
    return invoke(cmd, args, options);
  };
  internals.convertFileSrc = (path: string) => blobUrl(path);

  samples.set("shot01.png", await canvasPng("SHOT 01", 200));
  samples.set("shot02.png", await canvasPng("SHOT 02", 20));
  samples.set("light_blue.png", await canvasPng("LIGHT", 260));
  samples.set("bgm.wav", sineWav(12));
  const dir = "C:/mock/project";
  for (const [name, bytes] of samples) files.set(norm(`${dir}/assets/${name}`), bytes);

  (window as any).__mockFs = {
    files,
    read: (p: string) => dec.decode(files.get(norm(p))),
    /** Simulates an external edit (e.g. by Claude Code) of a text file. */
    write: (p: string, text: string) => {
      files.set(norm(p), enc.encode(text) as Bytes);
      void emit("fs-project-changed");
    },
    bytes: (p: string) => files.get(norm(p)),
  };
}
