/**
 * Playback transport. The AudioContext clock is the master: the playhead is derived from it each frame,
 * so picture follows sound.
 */

import { getAudioContext, preloadProjectAudio, scheduleAudio } from "../../audio/audio";
import { assetUrl } from "../../io/backend";
import { projectEndFrame } from "../../model/ops";
import { useStore } from "../../store/store";

let nodes: AudioBufferSourceNode[] = [];
let master: GainNode | null = null;
let raf = 0;
let startFrame = 0;
let startTime = 0;
let session = 0;

const urlOf = (rel: string) => assetUrl(useStore.getState().dir!, rel);

function stopNodes() {
  for (const n of nodes) {
    try {
      n.stop();
    } catch {
      // already stopped
    }
  }
  nodes = [];
  master?.disconnect();
  master = null;
}

async function startAt(frame: number) {
  const my = ++session;
  const { project } = useStore.getState();
  if (!project) return;
  const ctx = getAudioContext();
  // resume() can stay pending when the webview blocks audio without a user gesture; don't hang on it.
  await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 300))]);
  await preloadProjectAudio(project, urlOf);
  if (my !== session) return;

  stopNodes();
  // Audio clock when sound is running, otherwise the system clock (picture still plays, silently).
  const audioOk = ctx.state === "running";
  const now = () => (audioOk ? ctx.currentTime : performance.now() / 1000);
  startFrame = frame;
  startTime = now() + 0.05;
  if (audioOk) {
    master = ctx.createGain();
    master.connect(ctx.destination);
    nodes = scheduleAudio(ctx, master, project, urlOf, frame, startTime);
  } else {
    useStore.setState({ notice: "Audio could not start (playing silently)" });
  }
  useStore.setState({ playing: true });

  const fps = project.settings.fps;
  const end = Math.max(projectEndFrame(project), 1);
  cancelAnimationFrame(raf);
  const tick = () => {
    if (my !== session) return;
    const f = startFrame + Math.max(0, Math.floor((now() - startTime) * fps));
    if (f >= end) {
      stop();
      useStore.getState().setPlayhead(end);
      return;
    }
    if (f !== useStore.getState().playhead) useStore.getState().setPlayhead(f);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

export function play() {
  const { project, playhead } = useStore.getState();
  if (!project) return;
  const from = playhead >= projectEndFrame(project) ? 0 : playhead;
  useStore.getState().setPlayhead(from);
  void startAt(from);
}

export function stop() {
  session++;
  cancelAnimationFrame(raf);
  stopNodes();
  useStore.setState({ playing: false });
}

export function togglePlay() {
  if (useStore.getState().playing) stop();
  else play();
}

/** Moves the playhead; keeps playing from the new position when playing. */
export function seek(frame: number) {
  const f = Math.max(0, Math.round(frame));
  useStore.getState().setPlayhead(f);
  if (useStore.getState().playing) void startAt(f);
}

// Re-schedule audio when the project changes during playback (gain, mute, clip moves...).
useStore.subscribe((s, prev) => {
  if (s.playing && s.project !== prev.project && s.project) void startAt(s.playhead);
});
