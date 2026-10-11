/**
 * mp4 export: H.264 video via WebCodecs (Mediabunny) + AAC audio mixed with an OfflineAudioContext.
 * Frames are drawn with the same compositor as the preview.
 */
import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  CanvasSink,
  CanvasSource,
  canEncodeAudio,
  canEncodeVideo,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  type StreamTargetChunk,
  type WrappedCanvas,
} from "mediabunny";
import { audibleTracks, preloadProjectAudio, scheduleAudio } from "../audio/audio";
import { assetUrl, createEmptyFile, removeFile, writeChunk } from "../io/backend";
import { clipAt, endF, projectEndFrame, startF } from "../model/ops";
import type { Clip, Project, Track } from "../model/schema";
import { clipMediaRef, clipVisualRefs, mediaSeconds, type ResolvedPreset, renderFrame, type Visual } from "./compositor";
import { loadImageBitmap, mediaKind } from "./media";

export type ExportProgress = { phase: "Preparing" | "Audio" | "Video" | "Finalizing"; done: number; total: number };
export type CancelToken = { cancelled: boolean };

const SAMPLE_RATE = 48_000;
const EPS = 1e-6;

/** Output frame index → project frame. */
const toProjectFrame = (i: number, outFps: number, fps: number) => Math.floor((i / outFps) * fps + EPS);
/** First output frame index whose project frame is >= `frame`. */
const firstOutputFrame = (frame: number, outFps: number, fps: number) => Math.ceil((frame / fps) * outFps - EPS);

function shownScreens(p: Project, preset: ResolvedPreset): Track[] {
  const screens = preset.screens.map((id) => p.tracks.find((t) => t.id === id)).filter((t): t is Track => !!t && t.kind !== "audio");
  return preset.layout === "single" ? screens.slice(0, 1) : screens;
}

/** Sequential video-frame reader for one clip, fed with the source timestamps of the frames it is shown on. */
class ClipVideoReader {
  private gen: AsyncGenerator<WrappedCanvas | null, void, unknown> | null = null;
  private input: Input | null = null;
  current: Visual | null = null;

  constructor(
    private url: string,
    private timestamps: number[],
  ) {}

  async next(): Promise<Visual | null> {
    if (!this.gen) {
      const blob = await (await fetch(this.url)).blob();
      this.input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
      const track = await this.input.getPrimaryVideoTrack();
      if (!track) return null;
      this.gen = new CanvasSink(track).canvasesAtTimestamps(this.timestamps);
    }
    const r = await this.gen.next();
    if (!r.done && r.value) this.current = r.value.canvas as Visual;
    return this.current;
  }

  async close() {
    await this.gen?.return(undefined);
    this.input?.dispose();
  }
}

export async function exportMp4(
  project: Project,
  preset: ResolvedPreset,
  dir: string,
  outPath: string,
  onProgress: (p: ExportProgress) => void,
  cancel: CancelToken,
): Promise<void> {
  const fps = project.settings.fps;
  const { width, height, fps: outFps } = preset;
  if (width % 2 || height % 2) throw new Error("H.264 requires an even width and height");
  const endFrame = projectEndFrame(project);
  if (endFrame <= 0) throw new Error("There are no clips to export");
  const totalFrames = firstOutputFrame(endFrame, outFps, fps);
  const durationSec = totalFrames / outFps;
  const urlOf = (rel: string) => assetUrl(dir, rel);

  if (!(await canEncodeVideo("avc", { width, height, bitrate: preset.video.bitrate }))) {
    throw new Error(`H.264 encoding at ${width}x${height} is not supported here`);
  }
  const wantAudio =
    preset.audio.enabled && audibleTracks(project).some((t) => t.clips.some((c) => mediaKind(clipMediaRef(t, c)) === "audio"));
  if (wantAudio && !(await canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: SAMPLE_RATE }))) {
    throw new Error("AAC encoding is not supported here");
  }

  // ---- prepare media
  onProgress({ phase: "Preparing", done: 0, total: 1 });
  const screens = shownScreens(project, preset);
  const images = new Map<string, ImageBitmap>();
  const readers = new Map<string, ClipVideoReader>();
  for (const t of screens) {
    for (const c of t.clips) {
      for (const ref of clipVisualRefs(t, c, preset)) {
        const kind = mediaKind(ref);
        if (kind === "image" && !images.has(ref)) {
          images.set(ref, await loadImageBitmap(urlOf(ref)).catch(() => null as unknown as ImageBitmap));
        } else if (kind === "video") {
          readers.set(`${t.id}/${c.id}/${ref}`, new ClipVideoReader(urlOf(ref), clipTimestamps(c, fps, outFps, totalFrames)));
        }
      }
    }
  }

  // ---- output
  await createEmptyFile(outPath);
  const pending: Promise<void>[] = [];
  const writable = new WritableStream<StreamTargetChunk>({
    write(chunk) {
      const p = writeChunk(outPath, chunk.position, chunk.data);
      pending.push(p);
      return p;
    },
  });
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target: new StreamTarget(writable, { chunked: true, chunkSize: 16 * 1024 * 1024 }),
  });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: false })!;
  const videoSource = new CanvasSource(canvas, {
    codec: "avc",
    bitrate: preset.video.bitrate,
    bitrateMode: preset.video.bitrateMode,
    keyFrameInterval: 2,
  });
  output.addVideoTrack(videoSource, { frameRate: outFps });

  let audioSource: AudioBufferSource | null = null;
  if (wantAudio) {
    audioSource = new AudioBufferSource({ codec: "aac", bitrate: preset.audio.bitrate });
    output.addAudioTrack(audioSource);
  }

  const abort = async () => {
    await output.cancel().catch(() => {});
    await Promise.allSettled(pending);
    await removeFile(outPath).catch(() => {});
    throw new Error("Cancelled");
  };

  try {
    await output.start();

    if (audioSource) {
      onProgress({ phase: "Audio", done: 0, total: 1 });
      await preloadProjectAudio(project, urlOf);
      const octx = new OfflineAudioContext(2, Math.ceil(durationSec * SAMPLE_RATE), SAMPLE_RATE);
      scheduleAudio(octx, octx.destination, project, urlOf, 0, 0, endFrame);
      const mixed = await octx.startRendering();
      if (cancel.cancelled) return await abort();
      await audioSource.add(mixed);
      audioSource.close();
    }

    const active = new Map<string, Visual | null>();
    const getVisual = (ref: string, _s: number, clip: Clip, track: Track): Visual | null => {
      if (mediaKind(ref) === "image") return images.get(ref) ?? null;
      return active.get(`${track.id}/${clip.id}/${ref}`) ?? null;
    };

    for (let i = 0; i < totalFrames; i++) {
      if (cancel.cancelled) return await abort();
      const frame = toProjectFrame(i, outFps, fps);
      active.clear();
      for (const t of screens) {
        const c = clipAt(t, frame, fps);
        if (!c) continue;
        for (const ref of clipVisualRefs(t, c, preset)) {
          const key = `${t.id}/${c.id}/${ref}`;
          const reader = readers.get(key);
          if (reader) active.set(key, await reader.next());
        }
      }
      renderFrame(ctx, project, preset, frame, getVisual);
      await videoSource.add(i / outFps, 1 / outFps);
      if (i % 5 === 0) onProgress({ phase: "Video", done: i, total: totalFrames });
    }

    onProgress({ phase: "Finalizing", done: totalFrames, total: totalFrames });
    await output.finalize();
    await Promise.all(pending);
  } catch (e) {
    if (output.state !== "canceled" && output.state !== "finalized") await output.cancel().catch(() => {});
    throw e;
  } finally {
    for (const r of readers.values()) await r.close().catch(() => {});
    for (const b of images.values()) b?.close();
  }
}

/** Source timestamps (seconds) for every output frame on which `clip` is visible. */
function clipTimestamps(clip: Clip, fps: number, outFps: number, totalFrames: number): number[] {
  const i0 = firstOutputFrame(startF(clip, fps), outFps, fps);
  const i1 = Math.min(firstOutputFrame(endF(clip, fps), outFps, fps), totalFrames);
  const out: number[] = [];
  for (let i = i0; i < i1; i++) out.push(mediaSeconds(clip, toProjectFrame(i, outFps, fps), fps));
  return out;
}
