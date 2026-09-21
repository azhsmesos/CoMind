import workletUrl from "./pcm-worklet.js?url";
declare global {
  interface Window {
    audioCapture: {
      frame(data: Uint8Array, level: number): void;
      ready(): void;
      error(code: string): void;
    };
    startVoiceCapture(): Promise<void>;
  }
}
window.startVoiceCapture = async () => {
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let ended = false;
  const cleanup = () => {
    ended = true;
    clearInterval(watchdog);
    stream?.getTracks().forEach((t) => t.stop());
    void context?.close();
  };
  const fail = (code: string) => {
    if (!ended) {
      window.audioCapture.error(code);
      cleanup();
    }
  };
  try {
    stream = location.hash === "#mock-microphone"
      ? await navigator.mediaDevices.getUserMedia({
          video: false, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })
      : await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: { width: 1, height: 1, frameRate: 1 },
    });
    const audio = stream.getAudioTracks()[0];
    if (!audio) {
      fail("no-audio");
      return;
    }
    // Keep the display track alive for Chromium's loopback stream, never read its pixels.
    stream
      .getTracks()
      .forEach((t) => t.addEventListener("ended", () => fail("ended")));
    context = new AudioContext({ sampleRate: 16000 });
    await context.audioWorklet.addModule(workletUrl);
    const source = context.createMediaStreamSource(new MediaStream([audio]));
    const node = new AudioWorkletNode(context, "comind-pcm");
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(node);
    node.connect(mute);
    mute.connect(context.destination);
    let lastFrame = Date.now();
    let first = true;
    node.port.onmessage = (e) => {
      if (ended) return;
      lastFrame = Date.now();
      if (first) {
        first = false;
        window.audioCapture.ready();
      }
      window.audioCapture.frame(new Uint8Array(e.data.pcm), e.data.level);
    };
    await context.resume();
    watchdog = setInterval(() => {
      if (Date.now() - lastFrame > 5000 || audio.readyState !== "live")
        fail("ended");
    }, 1000);
    window.addEventListener("beforeunload", cleanup, { once: true });
  } catch (error) {
    fail(error instanceof DOMException ? error.name : "capture-failed");
  }
};
