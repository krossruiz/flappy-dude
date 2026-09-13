function firstSupported(types) {
  if (typeof MediaRecorder === "undefined") return "";
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function pickVideoMime() {
  return firstSupported([
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ]);
}

function pickAudioMime() {
  return firstSupported([
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ]);
}

function makeRecorder(stream, options) {
  try {
    return new MediaRecorder(stream, options);
  } catch {
    return new MediaRecorder(stream);
  }
}

function collectRecorder(recorder, chunks) {
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size) chunks.push(event.data);
  };
}

function stopRecorder(recorder) {
  return new Promise((resolve) => {
    if (!recorder || recorder.state === "inactive") {
      resolve();
      return;
    }
    recorder.addEventListener("stop", () => resolve(), { once: true });
    try {
      recorder.stop();
    } catch {
      resolve();
    }
  });
}

export class SessionRecorder {
  constructor() {
    this.supported = typeof MediaRecorder !== "undefined" && Boolean(pickVideoMime());
    this.chunks = [];
    this.audioChunks = [];
    this.blob = null;
    this.audioBlob = null;
    this.durationMs = 0;
    this._objectUrl = null;
    this._audioObjectUrl = null;
    this.videoRecorder = null;
    this.audioRecorder = null;
  }

  start(canvas, micStream) {
    this.chunks = [];
    this.audioChunks = [];
    this.blob = null;
    this.audioBlob = null;
    this.durationMs = 0;
    this.startedAt = Date.now();
    this._revokeObjectUrl();
    if (!this.supported) return false;

    const canvasStream = canvas.captureStream?.(30) || canvas.webkitCaptureStream?.(30);
    if (!canvasStream?.getVideoTracks?.().length) {
      this.supported = false;
      return false;
    }
    this._captureStream = canvasStream;

    const videoMime = pickVideoMime();
    const videoOpts = { videoBitsPerSecond: 1_400_000 };
    if (videoMime) videoOpts.mimeType = videoMime;
    this.videoRecorder = makeRecorder(canvasStream, videoOpts);
    collectRecorder(this.videoRecorder, this.chunks);

    this.audioRecorder = null;
    const liveAudio = (micStream?.getAudioTracks?.() || []).filter((track) => track.readyState === "live");
    for (const track of liveAudio) track.enabled = true;
    if (liveAudio.length) {
      const audioStream = new MediaStream(liveAudio);
      this._audioStream = audioStream;
      const audioMime = pickAudioMime();
      const audioOpts = { audioBitsPerSecond: 128_000 };
      if (audioMime) audioOpts.mimeType = audioMime;
      this.audioRecorder = makeRecorder(audioStream, audioOpts);
      collectRecorder(this.audioRecorder, this.audioChunks);
      this.audioRecorder.start(200);
    }

    this.videoRecorder.start(200);
    return true;
  }

  _revokeObjectUrl() {
    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = null;
    }
    if (this._audioObjectUrl) {
      URL.revokeObjectURL(this._audioObjectUrl);
      this._audioObjectUrl = null;
    }
  }

  localUrl() {
    if (!this.blob) return null;
    if (!this._objectUrl) this._objectUrl = URL.createObjectURL(this.blob);
    return this._objectUrl;
  }

  localAudioUrl() {
    if (!this.audioBlob) return null;
    if (!this._audioObjectUrl) this._audioObjectUrl = URL.createObjectURL(this.audioBlob);
    return this._audioObjectUrl;
  }

  async stop() {
    this.durationMs = Date.now() - (this.startedAt || Date.now());
    await Promise.all([stopRecorder(this.videoRecorder), stopRecorder(this.audioRecorder)]);
    this.blob = this.chunks.length
      ? new Blob(this.chunks, { type: this.videoRecorder?.mimeType || "video/webm" })
      : null;
    this.audioBlob = this.audioChunks.length
      ? new Blob(this.audioChunks, { type: this.audioRecorder?.mimeType || "audio/webm" })
      : null;
    return this.blob;
  }

  async upload({ name, score, thumbBlob, description = "" }) {
    if (!this.blob) throw new Error("No replay was captured.");
    const body = new FormData();
    body.append("name", name);
    body.append("score", String(score));
    body.append("durationMs", String(this.durationMs));
    body.append("description", description);
    const ext = (this.blob.type || "").includes("mp4") ? "mp4" : "webm";
    body.append("video", this.blob, `replay.${ext}`);
    if (this.audioBlob) {
      const audioExt = (this.audioBlob.type || "").includes("mp4") ? "m4a" : "webm";
      body.append("audio", this.audioBlob, `audio.${audioExt}`);
    }
    if (thumbBlob) body.append("thumb", thumbBlob, "thumb.jpg");
    const res = await fetch("/api/sessions", { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Upload failed.");
    return data.session;
  }
}

export function canvasThumb(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.72);
  });
}
