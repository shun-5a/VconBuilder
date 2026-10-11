import { TC_PATTERN } from "./schema";

const pad = (n: number) => String(n).padStart(2, "0");

export function framesToTc(frames: number, fps: number): string {
  const sign = frames < 0 ? "-" : "";
  let f = Math.abs(Math.round(frames));
  const ff = f % fps;
  f = Math.floor(f / fps);
  const ss = f % 60;
  f = Math.floor(f / 60);
  const mm = f % 60;
  const hh = Math.floor(f / 60);
  return `${sign}${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

export function tcToFrames(tc: string, fps: number): number {
  if (!TC_PATTERN.test(tc)) throw new Error(`invalid timecode: ${tc}`);
  const [hh, mm, ss, ff] = tc.split(":").map(Number);
  return ((hh * 60 + mm) * 60 + ss) * fps + ff;
}

/**
 * Lenient timecode entry, AE style:
 * - `1:02:03:04`, `2:03:04`, `3:04` – colon groups are right-aligned to HH:MM:SS:FF
 * - `10203` – bare digits are split into pairs from the right (= 00:01:02:03)
 * - `2.5s` / `2s` – seconds
 * - `+12` / `-12` – frames relative to `base`; `+1s` relative seconds
 * Returns null when the input cannot be parsed.
 */
export function parseTcInput(input: string, fps: number, base = 0): number | null {
  const s = input.trim().replace(/[;.](?=\d{2}$)/, ":");
  if (!s) return null;

  const rel = /^([+-])(.+)$/.exec(s);
  if (rel) {
    const delta = parseTcInput(rel[2], fps);
    if (delta === null) return null;
    return Math.max(0, base + (rel[1] === "+" ? delta : -delta));
  }

  const sec = /^(\d+(?:\.\d+)?)s$/i.exec(s);
  if (sec) return Math.round(parseFloat(sec[1]) * fps);

  let parts: number[];
  if (s.includes(":")) {
    if (!/^\d*(:\d*)*$/.test(s)) return null;
    parts = s.split(":").map((p) => (p === "" ? 0 : Number(p)));
  } else if (/^\d+$/.test(s)) {
    const digits = s.padStart(Math.ceil(s.length / 2) * 2, "0");
    parts = [];
    for (let i = 0; i < digits.length; i += 2) parts.push(Number(digits.slice(i, i + 2)));
  } else {
    return null;
  }
  if (parts.length > 4) return null;
  while (parts.length < 4) parts.unshift(0);
  const [hh, mm, ss, ff] = parts;
  return ((hh * 60 + mm) * 60 + ss) * fps + ff;
}

export const framesToSeconds = (frames: number, fps: number) => frames / fps;

/** Short human duration such as `4s12f` (for table cells / clip labels). */
export function formatDuration(frames: number, fps: number): string {
  const s = Math.floor(frames / fps);
  const f = frames % fps;
  if (s === 0) return `${f}f`;
  return f === 0 ? `${s}s` : `${s}s${pad(f)}f`;
}
