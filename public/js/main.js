import { WebcamFeed } from "./webcam.js";
import { SessionRecorder, canvasThumb } from "./recorder.js";
import { FlappyDude } from "./game.js";
import { loadSessions, renderLog, saveSession } from "./community.js";

const $ = (id) => document.getElementById(id);

const canvas = $("game");
const overlay = $("overlay");
const hud = $("hud");
const preview = $("preview");
const nameInput = $("player-name");
const consentError = $("consent-error");
const uploadStatus = $("upload-status");
const logList = $("log-list");
const replayModal = $("replay-modal");
const replayVideo = $("replay-video");
const replayAudio = $("replay-audio");
const replayPrompt = $("replay-play-prompt");
const replayEditForm = $("replay-edit-form");
const replayEditName = $("replay-edit-name");
const replayEditDescription = $("replay-edit-description");
const replayEditStatus = $("replay-edit-status");
const btnCloseReplay = $("btn-close-replay");
const replayDownload = $("btn-download-replay");
const replayShare = $("btn-share-replay");
const logSearch = $("log-search");

const webcam = new WebcamFeed();
const recorder = new SessionRecorder();
const game = new FlappyDude(canvas, webcam);

let playerName = localStorage.getItem("flappyDudeName") || "";
nameInput.value = playerName;
$("best-label").textContent = `Best ${localStorage.getItem("flappyDudeBest") || 0}`;

let finishing = false;
let recording = false;
let activeReplay = null;
let pendingThumb = null;
let allSessions = [];

function showScreen(id) {
  for (const screen of overlay.querySelectorAll(".screen")) {
    screen.classList.toggle("hidden", screen.id !== id);
  }
  overlay.classList.toggle("play", !id || id === "screen-ready");
  if (!id) {
    for (const screen of overlay.querySelectorAll(".screen")) screen.classList.add("hidden");
  }
}

function setHud(on) {
  hud.hidden = !on;
}

async function refreshLog() {
  try {
    allSessions = await loadSessions();
    applyLogFilter();
  } catch {
    logList.innerHTML = `<p class="empty">Could not load the community log.</p>`;
  }
}

function applyLogFilter() {
  const query = (logSearch?.value || "").trim().toLowerCase();
  const sessions = !query
    ? allSessions
    : allSessions.filter(
        (s) =>
          (s.name || "").toLowerCase().includes(query) ||
          (s.description || "").toLowerCase().includes(query)
      );
  renderLog(logList, sessions, { onOpen: openReplay, onSave: persistReplayMeta, buildShareUrl: shareReplayUrl });
  if (query && allSessions.length && !sessions.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = `No replays match "${logSearch.value.trim()}".`;
    logList.innerHTML = "";
    logList.appendChild(p);
  }
}

logSearch?.addEventListener("input", applyLogFilter);

function shareReplayUrl(id) {
  return `${location.origin}/?replay=${id}`;
}

async function copyShareUrl(id, statusEl) {
  const url = shareReplayUrl(id);
  try {
    await navigator.clipboard.writeText(url);
    if (statusEl) {
      const original = statusEl.textContent;
      statusEl.textContent = "Share link copied to clipboard.";
      setTimeout(() => {
        if (statusEl.textContent === "Share link copied to clipboard.") statusEl.textContent = original;
      }, 2000);
    }
  } catch {
    window.prompt("Copy this link to share the replay:", url);
  }
}

function hasSidecarAudio(session) {
  return Boolean(session?.audioUrl);
}

function stopReplayMedia() {
  replayVideo.pause();
  replayAudio.pause();
  replayVideo.removeAttribute("src");
  replayAudio.removeAttribute("src");
  replayVideo.load();
  replayAudio.load();
}

function syncAudioClock() {
  if (!hasSidecarAudio(activeReplay)) return;
  try {
    if (Math.abs(replayAudio.currentTime - replayVideo.currentTime) > 0.35) {
      replayAudio.currentTime = replayVideo.currentTime;
    }
  } catch {
    /* audio not seekable yet */
  }
}

async function playReplayWithSound() {
  replayVideo.defaultMuted = false;
  replayVideo.muted = false;
  replayVideo.volume = 1;
  replayAudio.muted = false;
  replayAudio.volume = 1;
  try {
    if (hasSidecarAudio(activeReplay)) {
      try {
        replayAudio.currentTime = replayVideo.currentTime || 0;
      } catch {
        /* audio not seekable yet */
      }
      await Promise.all([replayVideo.play(), replayAudio.play()]);
    } else {
      await replayVideo.play();
    }
    replayPrompt.hidden = true;
  } catch {
    replayVideo.pause();
    replayAudio.pause();
    replayPrompt.hidden = false;
  }
}

function slugify(value) {
  return (
    String(value || "replay")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "replay"
  );
}

function updateReplayActionUI() {
  const hosted = Boolean(activeReplay?.id);
  const saveBtn = $("btn-save-replay-meta");
  saveBtn.querySelector("span").textContent = hosted
    ? "Save title & description"
    : "Upload video to community";
  replayDownload.hidden = !activeReplay?.videoUrl;
  replayDownload.href = activeReplay?.videoUrl || "#";
  replayDownload.download = `flappy-dude-${slugify(activeReplay?.name)}.webm`;
  replayShare.hidden = !hosted;
  replayEditStatus.textContent = hosted
    ? ""
    : "Not uploaded yet — add a title & description, then upload it to share it.";
}

function openReplay(session) {
  activeReplay = session;
  $("replay-title").textContent = session.name;
  $("replay-meta").textContent = `Score ${session.score}`;
  const descView = $("replay-description-view");
  descView.textContent = session.description || "";
  descView.hidden = !session.description;
  replayEditName.value = session.name || "";
  replayEditDescription.value = session.description || "";
  updateReplayActionUI();
  stopReplayMedia();
  replayVideo.defaultMuted = false;
  replayVideo.muted = false;
  replayVideo.volume = 1;
  replayAudio.muted = false;
  replayAudio.volume = 1;
  replayVideo.src = session.videoUrl;
  if (session.audioUrl) replayAudio.src = session.audioUrl;
  replayPrompt.hidden = true;
  replayModal.showModal();
  const start = () => playReplayWithSound();
  if (replayVideo.readyState >= 2) start();
  else replayVideo.addEventListener("canplay", start, { once: true });
}

replayVideo.addEventListener("play", () => {
  if (!hasSidecarAudio(activeReplay)) return;
  try {
    replayAudio.currentTime = replayVideo.currentTime;
  } catch {
    /* audio not seekable yet */
  }
  replayAudio.play().catch(() => {
    replayPrompt.hidden = false;
  });
});
replayVideo.addEventListener("pause", () => replayAudio.pause());
replayVideo.addEventListener("seeking", syncAudioClock);
replayVideo.addEventListener("seeked", syncAudioClock);
replayVideo.addEventListener("ended", () => {
  replayAudio.pause();
});
replayVideo.addEventListener("volumechange", () => {
  replayAudio.muted = replayVideo.muted;
  replayAudio.volume = replayVideo.volume;
});
replayPrompt.addEventListener("click", () => {
  replayPrompt.hidden = true;
  playReplayWithSound();
});

function hasUnsavedLocalReplay() {
  return Boolean(activeReplay && !activeReplay.id && recorder.blob);
}

function confirmDiscardIfNeeded() {
  if (!hasUnsavedLocalReplay()) return true;
  return window.confirm("Your video will be lost, are you sure you want to exit?");
}

btnCloseReplay.addEventListener("click", () => {
  if (!confirmDiscardIfNeeded()) return;
  replayModal.close();
});

replayModal.addEventListener("cancel", (event) => {
  if (!confirmDiscardIfNeeded()) event.preventDefault();
});

window.addEventListener("beforeunload", (event) => {
  if (!hasUnsavedLocalReplay()) return;
  event.preventDefault();
  event.returnValue = "";
});

replayModal.addEventListener("close", () => {
  stopReplayMedia();
  activeReplay = null;
  replayPrompt.hidden = true;
});

async function persistReplayMeta(id, { name, description }) {
  const session = await saveSession(id, { name, description });
  if (activeReplay?.id === id) {
    const keepLocal = String(activeReplay.videoUrl || "").startsWith("blob:");
    activeReplay = {
      ...activeReplay,
      ...session,
      videoUrl: keepLocal ? activeReplay.videoUrl : session.videoUrl,
      audioUrl: keepLocal ? activeReplay.audioUrl : session.audioUrl,
    };
    $("replay-title").textContent = session.name;
    const descView = $("replay-description-view");
    descView.textContent = session.description || "";
    descView.hidden = !session.description;
    replayEditName.value = session.name || "";
    replayEditDescription.value = session.description || "";
  }
  await refreshLog();
  return session;
}

async function uploadActiveReplay({ name, description }) {
  if (!recorder.blob) {
    replayEditStatus.textContent = "Replay capture is not supported in this browser, so nothing can be uploaded.";
    return;
  }
  const saveBtn = $("btn-save-replay-meta");
  saveBtn.disabled = true;
  replayEditStatus.textContent = "Uploading…";
  try {
    const posted = await recorder.upload({
      name: (name || playerName).trim() || playerName,
      score: activeReplay.score,
      thumbBlob: pendingThumb,
      description,
    });
    activeReplay = { ...activeReplay, ...posted, videoUrl: activeReplay.videoUrl, audioUrl: activeReplay.audioUrl };
    pendingThumb = null;
    $("replay-title").textContent = posted.name;
    const descView = $("replay-description-view");
    descView.textContent = posted.description || "";
    descView.hidden = !posted.description;
    updateReplayActionUI();
    replayEditStatus.textContent = "Uploaded to the community log.";
    uploadStatus.textContent = "Replay posted to the community log.";
    await refreshLog();
  } catch (err) {
    replayEditStatus.textContent = err.message || "Could not upload the replay.";
  } finally {
    saveBtn.disabled = false;
  }
}

replayShare.addEventListener("click", () => {
  if (!activeReplay?.id) return;
  copyShareUrl(activeReplay.id, replayEditStatus);
});

replayEditForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = replayEditName.value;
  const description = replayEditDescription.value;
  if (!activeReplay?.id) {
    await uploadActiveReplay({ name, description });
    return;
  }
  replayEditStatus.textContent = "Saving…";
  try {
    await persistReplayMeta(activeReplay.id, { name, description });
    replayEditStatus.textContent = "Saved to the community log.";
  } catch (err) {
    replayEditStatus.textContent = err.message || "Could not save.";
  }
});

$("btn-open-log").addEventListener("click", () => $("community").classList.add("open"));
$("btn-close-log").addEventListener("click", () => $("community").classList.remove("open"));

$("btn-enable").addEventListener("click", enableCamera);
$("btn-play").addEventListener("click", startReady);
$("btn-again").addEventListener("click", startReady);

async function enableCamera() {
  consentError.hidden = true;
  playerName = (nameInput.value || "").trim().slice(0, 48) || "Dude";
  localStorage.setItem("flappyDudeName", playerName);
  nameInput.value = playerName;
  const btn = $("btn-enable");
  btn.disabled = true;
  btn.querySelector("span").textContent = "Requesting camera & mic…";
  try {
    await webcam.enable();
  } catch (err) {
    consentError.hidden = false;
    consentError.textContent =
      err?.name === "NotAllowedError"
        ? "Camera permission was denied. Enable your front camera to play."
        : "Could not start the camera. Use localhost or HTTPS and allow the webcam.";
    btn.disabled = false;
    btn.querySelector("span").textContent = "Enable camera, mic & play";
    return;
  }
  try {
    await game.load();
    showScreen("screen-title");
    $("best-label").textContent = `Best ${game.best}`;
    if (!looping) loop();
  } catch (err) {
    consentError.hidden = false;
    consentError.textContent = "The game assets failed to load. Refresh and try again.";
  } finally {
    btn.disabled = false;
    btn.querySelector("span").textContent = "Enable camera, mic & play";
  }
}

function startReady() {
  if (!webcam.ready) return;
  finishing = false;
  recording = false;
  setHud(false);
  game.ready();
  showScreen("screen-ready");
}

function beginPlay() {
  if (game.state !== "ready") return;
  game.start();
  showScreen(null);
  overlay.classList.add("play");
  if (recorder.start(canvas, webcam.stream)) {
    recording = true;
    setHud(true);
  }
}

async function finishRun(score) {
  if (finishing) return;
  finishing = true;
  await wait(700);
  let thumb = null;
  try {
    thumb = await canvasThumb(canvas);
  } catch {
    thumb = null;
  }
  if (recording) {
    await recorder.stop();
    recording = false;
  }
  setHud(false);

  pendingThumb = thumb;
  const localUrl = recorder.blob ? recorder.localUrl() : null;
  if (localUrl) {
    openReplay({
      name: playerName,
      score,
      description: "",
      videoUrl: localUrl,
      audioUrl: recorder.localAudioUrl(),
    });
  }

  $("dead-score").textContent = String(score);
  $("dead-best").textContent = String(game.best);
  $("best-label").textContent = `Best ${game.best}`;
  showScreen("screen-dead");
  overlay.classList.remove("play");

  uploadStatus.textContent = recorder.blob
    ? "Review your replay, then upload it to the community log."
    : "Replay capture is not supported in this browser, so nothing was recorded.";
}

game.onGameOver = (score) => {
  void finishRun(score);
};

function onFlap(event) {
  if (event) event.preventDefault();
  if (game.state === "ready") beginPlay();
  else game.flap();
}

window.addEventListener("keydown", (event) => {
  if (event.code !== "Space" && event.code !== "ArrowUp") return;
  if (event.repeat) return;
  if (["INPUT", "TEXTAREA"].includes(event.target.tagName)) return;
  if (game.state === "ready" || game.state === "playing") onFlap(event);
});

canvas.addEventListener("pointerdown", (event) => {
  if (game.state === "ready" || game.state === "playing") onFlap(event);
});

let last = performance.now();
let looping = false;
function loop(now = performance.now()) {
  looping = true;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.update(dt);
  game.draw();
  if (game.state === "title" || !webcam.ready) drawPreview();
  requestAnimationFrame(loop);
}

function drawPreview() {
  const ctx = preview.getContext("2d");
  const face = webcam.update();
  ctx.drawImage(face, 0, 0, preview.width, preview.height);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openSharedReplayFromUrl() {
  const id = new URLSearchParams(location.search).get("replay");
  if (!id) return;
  const session = allSessions.find((s) => s.id === id);
  if (session) openReplay(session);
}

refreshLog().then(openSharedReplayFromUrl);
