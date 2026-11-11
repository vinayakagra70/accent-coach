/** Microphone access: a live analyser for the mirror, and short recordings for "record & compare". */
export class Mic {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Float32Array<ArrayBuffer> = new Float32Array(2048);

  get sampleRate() {
    return this.ctx?.sampleRate ?? 48000;
  }

  get active() {
    return !!this.stream;
  }

  async start(): Promise<void> {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
    });
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    // ~43 ms at 48 kHz: long enough for LPC, short enough to feel live
    this.analyser.fftSize = 2048;
    this.buf = new Float32Array(this.analyser.fftSize);
    src.connect(this.analyser);
  }

  /** Latest audio frame, or null when the mic isn't running. */
  frame(): Float32Array | null {
    if (!this.analyser) return null;
    this.analyser.getFloatTimeDomainData(this.buf);
    return this.buf;
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.analyser = null;
    void this.ctx?.close();
    this.ctx = null;
  }

  /** Records until the returned stop() is called; resolves to an object URL of the clip. */
  async record(): Promise<{ stop: () => Promise<string> }> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.start();
    return {
      stop: () =>
        new Promise<string>((resolve) => {
          rec.onstop = () => {
            stream.getTracks().forEach((t) => t.stop());
            resolve(URL.createObjectURL(new Blob(chunks, { type: rec.mimeType })));
          };
          rec.stop();
        }),
    };
  }
}
