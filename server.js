import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.VERCEL ? path.join("/tmp", "data") : path.join(__dirname, "data");
const RECORDINGS_DIR = path.join(DATA_DIR, "recordings");
const THUMBS_DIR = path.join(DATA_DIR, "thumbnails");
const DB_PATH = path.join(DATA_DIR, "sessions.json");
const MAX_SESSIONS = 200;
const MAX_NAME = 48;
const MAX_DESC = 280;

for (const dir of [DATA_DIR, RECORDINGS_DIR, THUMBS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

function loadDb() {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveDb(sessions) {
  fs.writeFileSync(DB_PATH, JSON.stringify(sessions, null, 2));
}

function sanitizeName(value) {
  const cleaned = String(value || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME);
  return cleaned || "Dude";
}

function sanitizeDescription(value) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .replace(/\r\n/g, "\n")
    .slice(0, MAX_DESC)
    .trim();
}

function publicSession(session) {
  return {
    id: session.id,
    name: session.name,
    description: session.description || "",
    score: session.score,
    durationMs: session.durationMs,
    createdAt: session.createdAt,
    hasAudio: Boolean(session.hasAudio),
    videoUrl: `/api/sessions/${session.id}/video`,
    audioUrl: session.audioName ? `/api/sessions/${session.id}/audio` : null,
    thumbUrl: `/api/sessions/${session.id}/thumb`,
  };
}

async function resolveCmd(cmd) {
  const envKey = `${cmd.toUpperCase()}_PATH`;
  if (process.env[envKey] && fs.existsSync(process.env[envKey])) return process.env[envKey];
  try {
    const finder = process.platform === "win32" ? "where" : "which";
    const { stdout } = await execFileP(finder, [cmd], { windowsHide: true });
    const found = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (found && fs.existsSync(found)) return found;
  } catch {
    /* not on PATH */
  }
  return null;
}

const ffmpegPromise = resolveCmd("ffmpeg");

async function muxReplay(videoPath, audioPath, outPath) {
  const ffmpeg = await ffmpegPromise;
  if (!ffmpeg) throw new Error("ffmpeg not available");
  const attempts = [
    ["-y", "-i", videoPath, "-i", audioPath, "-c:v", "copy", "-c:a", "copy", "-map", "0:v:0", "-map", "1:a:0", "-shortest", outPath],
    [
      "-y",
      "-i",
      videoPath,
      "-i",
      audioPath,
      "-c:v",
      "copy",
      "-c:a",
      "libopus",
      "-b:a",
      "128k",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-shortest",
      outPath,
    ],
  ];
  let lastErr;
  for (const args of attempts) {
    try {
      await execFileP(ffmpeg, args, { timeout: 60_000, windowsHide: true });
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) return;
    } catch (err) {
      lastErr = err;
      fs.rmSync(outPath, { force: true });
    }
  }
  throw lastErr || new Error("Could not mix audio into the replay.");
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 3 },
  fileFilter(_req, file, cb) {
    if (file.fieldname === "video" && file.mimetype.startsWith("video/")) {
      cb(null, true);
      return;
    }
    if (
      file.fieldname === "audio" &&
      (file.mimetype.startsWith("audio/") || file.mimetype.startsWith("video/"))
    ) {
      cb(null, true);
      return;
    }
    if (file.fieldname === "thumb" && file.mimetype.startsWith("image/")) {
      cb(null, true);
      return;
    }
    cb(new Error("Unsupported file type"));
  },
});

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/api/sessions", (_req, res) => {
  const sessions = loadDb()
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(publicSession);
  res.json({ sessions });
});

app.post(
  "/api/sessions",
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "audio", maxCount: 1 },
    { name: "thumb", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const video = req.files?.video?.[0];
      if (!video) {
        res.status(400).json({ error: "A session video is required." });
        return;
      }

      const id = randomUUID();
      const isMp4 = video.mimetype.includes("mp4");
      const videoExt = isMp4 ? "mp4" : "webm";
      const videoName = `${id}.${videoExt}`;
      const thumbName = `${id}.jpg`;
      const videoPath = path.join(RECORDINGS_DIR, videoName);

      fs.writeFileSync(videoPath, video.buffer);

      const thumb = req.files?.thumb?.[0];
      if (thumb) {
        fs.writeFileSync(path.join(THUMBS_DIR, thumbName), thumb.buffer);
      }

      const score = Math.max(0, Math.min(99999, Number(req.body.score) || 0));
      const durationMs = Math.max(0, Math.min(30 * 60 * 1000, Number(req.body.durationMs) || 0));

      let audioName = null;
      let hasAudio = false;
      let mime = video.mimetype;
      const audio = req.files?.audio?.[0];
      if (audio) {
        const audioExt = (audio.mimetype || "").includes("mp4") ? "m4a" : "webm";
        const audioFile = `${id}.audio.${audioExt}`;
        const audioPath = path.join(RECORDINGS_DIR, audioFile);
        fs.writeFileSync(audioPath, audio.buffer);
        const muxPath = path.join(RECORDINGS_DIR, `${id}.mux.${videoExt}`);
        try {
          await muxReplay(videoPath, audioPath, muxPath);
          fs.rmSync(videoPath, { force: true });
          fs.renameSync(muxPath, videoPath);
          fs.rmSync(audioPath, { force: true });
          hasAudio = true;
          mime = isMp4 ? "video/mp4" : "video/webm";
        } catch (err) {
          console.error("Replay mux failed, keeping separate audio:", err?.message || err);
          audioName = audioFile;
          hasAudio = true;
        }
      }

      const session = {
        id,
        name: sanitizeName(req.body.name),
        description: sanitizeDescription(req.body.description),
        score,
        durationMs,
        createdAt: new Date().toISOString(),
        videoName,
        audioName,
        hasAudio,
        thumbName: thumb ? thumbName : null,
        mime,
      };

      const sessions = loadDb();
      sessions.push(session);
      sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      const extra = sessions.splice(MAX_SESSIONS);
      for (const old of extra) {
        for (const file of [old.videoName, old.audioName, old.thumbName]) {
          if (!file) continue;
          const dir = file.endsWith(".jpg") ? THUMBS_DIR : RECORDINGS_DIR;
          fs.rmSync(path.join(dir, file), { force: true });
        }
      }
      saveDb(sessions);

      res.status(201).json({ session: publicSession(session) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Could not save the session." });
    }
  }
);

app.patch("/api/sessions/:id", (req, res) => {
  const sessions = loadDb();
  const session = sessions.find((item) => item.id === req.params.id);
  if (!session) {
    res.status(404).json({ error: "Replay not found." });
    return;
  }
  if ("name" in req.body) session.name = sanitizeName(req.body.name);
  if ("description" in req.body) session.description = sanitizeDescription(req.body.description);
  saveDb(sessions);
  res.json({ session: publicSession(session) });
});

app.get("/api/sessions/:id/video", (req, res) => {
  const session = loadDb().find((s) => s.id === req.params.id);
  if (!session) {
    res.status(404).json({ error: "Replay not found." });
    return;
  }
  const filePath = path.join(RECORDINGS_DIR, session.videoName);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Replay file missing." });
    return;
  }
  res.setHeader("Content-Type", session.mime || "video/webm");
  res.sendFile(filePath);
});

app.get("/api/sessions/:id/audio", (req, res) => {
  const session = loadDb().find((s) => s.id === req.params.id);
  if (!session?.audioName) {
    res.status(404).json({ error: "Replay audio not found." });
    return;
  }
  const filePath = path.join(RECORDINGS_DIR, session.audioName);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Replay audio missing." });
    return;
  }
  res.setHeader("Content-Type", "audio/webm");
  res.sendFile(filePath);
});

app.get("/api/sessions/:id/thumb", (req, res) => {
  const session = loadDb().find((s) => s.id === req.params.id);
  if (!session?.thumbName) {
    res.status(404).end();
    return;
  }
  const filePath = path.join(THUMBS_DIR, session.thumbName);
  if (!fs.existsSync(filePath)) {
    res.status(404).end();
    return;
  }
  res.setHeader("Content-Type", "image/jpeg");
  res.sendFile(filePath);
});

app.use(express.static(path.join(__dirname, "public")));

app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: "The replay file is too large." });
    return;
  }
  if (err) {
    res.status(400).json({ error: err.message || "Upload failed." });
    return;
  }
  next();
});

if (!process.env.VERCEL) {
  app.listen(PORT, async () => {
    const ffmpeg = await ffmpegPromise;
    console.log(`Flappy Dude running at http://localhost:${PORT}`);
    console.log(ffmpeg ? `ffmpeg: ${ffmpeg}` : "ffmpeg not found — mic audio will be stored as a sidecar");
  });
}

export default app;
