import { useEffect, useRef, useState } from "react";
import { getDecodedBuffer, getPeaks, loadAudioBuffer, PEAKS_PER_SECOND } from "../../audio/audio";
import { durF } from "../../model/ops";
import type { Clip } from "../../model/schema";
import { tcToFrames } from "../../model/timecode";

const MAX_CANVAS_W = 4096;

export function Waveform({ url, clip, fps, widthPx }: { url: string; clip: Clip; fps: number; widthPx: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [buf, setBuf] = useState<AudioBuffer | null>(() => getDecodedBuffer(url));

  useEffect(() => {
    let alive = true;
    if (!buf) loadAudioBuffer(url).then((b) => alive && setBuf(b));
    return () => {
      alive = false;
    };
  }, [url, buf]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !buf) return;
    const w = Math.max(1, Math.min(MAX_CANVAS_W, Math.round(widthPx)));
    const h = canvas.clientHeight || 40;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    const peaks = getPeaks(buf);
    const offSec = clip.offset ? tcToFrames(clip.offset, fps) / fps : 0;
    const durSec = durF(clip, fps) / fps;
    ctx.fillStyle = "rgba(160, 240, 190, 0.55)";
    const mid = h / 2;
    for (let x = 0; x < w; x++) {
      const a = Math.floor((offSec + (x / w) * durSec) * PEAKS_PER_SECOND);
      const b = Math.max(a + 1, Math.floor((offSec + ((x + 1) / w) * durSec) * PEAKS_PER_SECOND));
      let m = 0;
      for (let i = a; i < b && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i];
      const ph = Math.max(0.5, m * (h / 2 - 2));
      ctx.fillRect(x, mid - ph, 1, ph * 2);
    }
  }, [buf, clip, fps, widthPx]);

  return <canvas ref={ref} className="wave" />;
}
