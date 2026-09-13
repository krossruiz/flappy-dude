function timeAgo(iso) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export async function loadSessions() {
  const res = await fetch("/api/sessions");
  if (!res.ok) throw new Error("Could not load the community log.");
  const data = await res.json();
  return data.sessions || [];
}

export async function saveSession(id, { name, description }) {
  const res = await fetch(`/api/sessions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not save the replay.");
  return data.session;
}

export function renderLog(listEl, sessions, { onOpen, onSave, buildShareUrl }) {
  listEl.innerHTML = "";
  if (!sessions.length) {
    listEl.innerHTML = `<p class="empty">No one has flapped yet. Be the first.</p>`;
    return;
  }
  for (const session of sessions) {
    const card = document.createElement("article");
    card.className = "log-card";
    const desc = session.description || "";
    const filename = `flappy-dude-${slugify(session.name)}.webm`;
    card.innerHTML = `
      <button type="button" class="log-card-main">
        ${
          session.thumbUrl
            ? `<img src="${session.thumbUrl}" alt="${escapeHtml(session.name)}'s replay">`
            : `<div class="ph"></div>`
        }
        <div>
          <h3>${escapeHtml(session.name)}</h3>
          <p>Score ${session.score} · ${timeAgo(session.createdAt)}</p>
        </div>
      </button>
      ${desc ? `<p class="log-card-desc">${escapeHtml(desc)}</p>` : ""}
      <div class="log-card-actions">
        <button type="button" class="log-mini-btn log-edit-toggle">Edit</button>
        <a class="log-mini-btn" href="${escapeAttr(session.videoUrl)}" download="${escapeAttr(filename)}">Download</a>
        <button type="button" class="log-mini-btn log-share-btn">Share URL</button>
      </div>
      <form class="log-edit-form hidden">
        <label>
          <span>Title</span>
          <input name="name" type="text" maxlength="48" value="${escapeAttr(session.name)}" required />
        </label>
        <label>
          <span>Description</span>
          <textarea name="description" maxlength="280" rows="3" placeholder="What happened on this run?">${escapeHtml(desc)}</textarea>
        </label>
        <div class="log-card-actions">
          <button type="submit" class="log-mini-btn">Save</button>
          <button type="button" class="log-mini-btn log-edit-cancel">Cancel</button>
        </div>
        <p class="log-edit-status" hidden></p>
      </form>
    `;

    const form = card.querySelector(".log-edit-form");
    const toggle = card.querySelector(".log-edit-toggle");
    const status = card.querySelector(".log-edit-status");
    const shareBtn = card.querySelector(".log-share-btn");

    card.querySelector(".log-card-main").addEventListener("click", () => onOpen(session));
    shareBtn.addEventListener("click", async () => {
      const url = buildShareUrl ? buildShareUrl(session.id) : `${location.origin}/?replay=${session.id}`;
      const original = shareBtn.textContent;
      try {
        await navigator.clipboard.writeText(url);
        shareBtn.textContent = "Copied!";
      } catch {
        window.prompt("Copy this link to share the replay:", url);
      }
      setTimeout(() => (shareBtn.textContent = original), 1500);
    });
    toggle.addEventListener("click", () => {
      form.classList.toggle("hidden");
      toggle.hidden = !form.classList.contains("hidden");
    });
    card.querySelector(".log-edit-cancel").addEventListener("click", () => {
      form.classList.add("hidden");
      toggle.hidden = false;
      status.hidden = true;
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = form.elements.namedItem("name").value;
      const description = form.elements.namedItem("description").value;
      status.hidden = false;
      status.textContent = "Saving…";
      try {
        const updated = await onSave(session.id, { name, description });
        Object.assign(session, updated);
        status.textContent = "Saved.";
        form.classList.add("hidden");
        toggle.hidden = false;
        card.querySelector("h3").textContent = updated.name;
        let descEl = card.querySelector(".log-card-desc");
        if (updated.description) {
          if (!descEl) {
            descEl = document.createElement("p");
            descEl.className = "log-card-desc";
            form.before(descEl);
          }
          descEl.textContent = updated.description;
        } else if (descEl) {
          descEl.remove();
        }
      } catch (err) {
        status.textContent = err.message || "Could not save.";
      }
    });
    listEl.appendChild(card);
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
