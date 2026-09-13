function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export class WebcamFeed {
  constructor() {
    this.video = document.createElement("video");
    this.video.setAttribute("playsinline", "");
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.playsInline = true;

    this.square = document.createElement("canvas");
    this.square.width = 256;
    this.square.height = 256;
    this.ctx = this.square.getContext("2d", { alpha: false });

    this.stream = null;
    this.detector = null;
    this.faceX = 0.5;
    this.faceY = 0.42;
    this.targetX = 0.5;
    this.targetY = 0.42;
    this._detectTimer = 0;
    this.ready = false;
  }

  async enable() {
    const video = {
      facingMode: "user",
      width: { ideal: 720 },
      height: { ideal: 720 },
    };
    const audio = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio, video });
    } catch (err) {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video }).catch(() => {
        throw err;
      });
    }
    // Only attach video tracks to the muted preview element. Binding the full
    // stream (mic included) makes Chrome mute those audio tracks for every
    // consumer — including MediaRecorder — so replays would be silent.
    this.video.srcObject = new MediaStream(this.stream.getVideoTracks());
    await this.video.play();
    this.ready = true;
    this._initDetector();
  }

  async _initDetector() {
    if (typeof window.FaceDetector === "function") {
      try {
        this.detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      } catch {
        this.detector = null;
      }
    }
  }

  async _detect(now) {
    if (!this.detector || !this.video.videoWidth) return;
    if (now - this._detectTimer < 120) return;
    this._detectTimer = now;
    try {
      const faces = await this.detector.detect(this.video);
      const face = faces[0];
      if (!face) return;
      const box = face.boundingBox;
      const vw = this.video.videoWidth;
      const vh = this.video.videoHeight;
      this.targetX = clamp((box.x + box.width / 2) / vw, 0.2, 0.8);
      this.targetY = clamp((box.y + box.height / 2) / vh, 0.2, 0.8);
    } catch {
      /* FaceDetector is optional */
    }
  }

  update(now = performance.now()) {
    if (!this.ready) return this.square;
    this.faceX += (this.targetX - this.faceX) * 0.12;
    this.faceY += (this.targetY - this.faceY) * 0.12;
    this._detect(now);

    const v = this.video;
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    if (!vw) return this.square;

    const side = Math.min(vw, vh);
    let sx = vw * this.faceX - side / 2;
    let sy = vh * this.faceY - side / 2;
    sx = clamp(sx, 0, vw - side);
    sy = clamp(sy, 0, vh - side);

    const ctx = this.ctx;
    ctx.save();
    ctx.translate(256, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, sx, sy, side, side, 0, 0, 256, 256);
    ctx.restore();
    return this.square;
  }

  stop() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.ready = false;
  }
}
