/**
 * Benchmark quad-labeling client (issue #258). Plain JS, no build step, no
 * external network calls — every fetch() below hits this same local
 * server. See src/benchmark-label/server.ts for the API this talks to and
 * pipeline/docs/benchmark-labeling.md for the label contract this must
 * never violate.
 *
 * AMODAL COORDINATES (the single most important thing in this file): the
 * canvas <-> native-pixel mapping in toNative()/toCanvas() below does NOT
 * clamp. A card cropped by the photo frame has corners outside [0,w]x[0,h]
 * — the "world" div is padded around the photo specifically so those
 * clicks/drags are reachable, and the coordinate math is a straight
 * scale+offset with no Math.max/min anywhere near it. If you're touching
 * this file and reach for a clamp, stop — read the AMODAL section of
 * pipeline/docs/benchmark-labeling.md first.
 */

const state = {
  config: { sceneTypes: [], orientations: [], tags: [] },
  photos: [],
  current: null, // { fileName, photoId, sceneType, orientation, quads: [], naturalW, naturalH }
  zoom: 1,
  pad: 0,
  pendingCorners: [],
  selectedQuadIndex: -1,
  dragging: null, // { quadIndex, cornerIndex }
  nextQuadDefaultTags: [],
  skippedCount: 0,
  filenameHint: null,
  // Found while verifying BLOCKER 2's fix by actually clicking (PR #262
  // review round 2): true only between "Add card" and the 4th corner
  // click — distinguishes "placing corner #1" (0 already placed) from
  // idle canvas clicks (also 0 pending), which the old
  // `pendingCorners.length > 0` check on its own could never tell apart —
  // so corner #1 was silently dropped every time and the click-to-place
  // flow never worked via mouse at all.
  placingQuad: false,
  // PR #262 review (cheap extra): true whenever the current photo has
  // corner clicks or quad edits that haven't been saved yet — cleared on
  // load and on a successful save. Guards against silently discarding
  // real human work by switching photos mid-edit (see hasUnsavedWork()).
  dirty: false,
};

const el = (id) => document.getElementById(id);

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json();
  return { ok: res.ok, status: res.status, body };
}

// --- bootstrap ---------------------------------------------------------

async function init() {
  const cfg = await api("/api/config");
  state.config = cfg.body;
  el("scene-type").innerHTML = state.config.sceneTypes.map((s) => `<option value="${s}">${s}</option>`).join("");
  el("orientation").innerHTML = state.config.orientations.map((o) => `<option value="${o}">${o}</option>`).join("");
  renderTagEditorCheckboxes();

  await refreshPhotoList();
  wireToolbar();
  wireCanvas();
  wirePrintingPicker();
}

/**
 * Builds the per-quad tag checkboxes from the protocol's own tag list
 * (GET /api/config's `tags`, i.e. benchmark/types.ts's QUAD_TAGS) instead
 * of hardcoding them a second time here — issue #274 grew the vocabulary
 * from 3 tags to 13, and a second hardcoded copy is exactly the kind of
 * two-places-that-must-move-together drift that issue was about. Runs
 * once at startup; renderQuadEditor()'s existing
 * `#tag-editor input[type="checkbox"]` query already works against
 * whatever checkboxes exist here, so nothing downstream needed to change.
 */
function renderTagEditorCheckboxes() {
  el("tag-editor").innerHTML = state.config.tags
    .map((t) => `<label><input type="checkbox" value="${escapeAttr(t)}"> ${escapeHtml(t)}</label>`)
    .join("");
}

async function refreshPhotoList() {
  const res = await api("/api/photos");
  state.photos = res.body.photos;
  const labeled = state.photos.filter((p) => p.labeled).length;
  el("progress").textContent = `${labeled} / ${state.photos.length} labeled`;
  el("photo-list").innerHTML = state.photos
    .map(
      (p) =>
        `<li data-file="${escapeAttr(p.fileName)}" class="${p.labeled ? "labeled" : "unlabeled"}${p.fileName === state.current?.fileName ? " active" : ""}">${escapeHtml(p.fileName)}${p.labeled ? ` (${p.quadCount})` : ""}</li>`,
    )
    .join("");
  for (const li of el("photo-list").children) {
    li.addEventListener("click", () => {
      // PR #262 review (cheap extra): mid-edit corner clicks or unsaved
      // quad changes are real human work — across hundreds of photos over
      // hours, silently discarding them by switching photos is a realistic
      // way to lose it for free.
      if (hasUnsavedWork() && !confirm("Discard unsaved changes to the current photo?")) return;
      openPhoto(li.dataset.file);
    });
  }
}

/** True while the currently open photo has corner clicks in progress
 * (pendingCorners) or any quad edit since the photo was last loaded/saved
 * (state.dirty) — see the `dirty` field's own comment for exactly which
 * actions set/clear it. */
function hasUnsavedWork() {
  return !!state.current && (state.dirty || state.placingQuad || state.pendingCorners.length > 0);
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

// --- photo loading -------------------------------------------------------

async function openPhoto(fileName) {
  const img = new Image();
  const loaded = new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("failed to load image"));
  });
  img.src = `/api/photo?file=${encodeURIComponent(fileName)}`;
  await loaded;

  const [labelRes, hintRes] = await Promise.all([
    api(`/api/label?file=${encodeURIComponent(fileName)}`),
    api(`/api/parse-filename?file=${encodeURIComponent(fileName)}`),
  ]);
  const existing = labelRes.body.label;
  const guess = state.photos.find((p) => p.fileName === fileName)?.sceneTypeGuess ?? state.config.sceneTypes[0];

  state.current = {
    fileName,
    photoId: fileName.split("/").pop().replace(/\.[^./]+$/, ""),
    sceneType: existing?.sceneType ?? guess ?? state.config.sceneTypes[0],
    orientation: existing?.orientation ?? (img.naturalWidth >= img.naturalHeight ? "landscape" : "portrait"),
    quads: existing ? JSON.parse(JSON.stringify(existing.quads)) : [],
    naturalW: img.naturalWidth,
    naturalH: img.naturalHeight,
  };
  state.pendingCorners = [];
  state.placingQuad = false;
  state.selectedQuadIndex = -1;
  state.dirty = false;
  state.pad = Math.round(0.5 * Math.min(img.naturalWidth, img.naturalHeight));
  state.zoom = Math.min(1, (el("viewport").clientWidth || 800) / (img.naturalWidth + 2 * state.pad));

  el("photo-name").textContent = fileName;
  el("scene-type").value = state.current.sceneType;
  el("orientation").value = state.current.orientation;
  el("save-status").textContent = "";
  el("save-status").className = "";

  applyFilenameHint(hintRes.body);

  el("photo").src = img.src;
  layoutWorld();
  renderQuadList();
  redrawOverlay();
  await refreshPhotoList();
}

/** Foiling-code token -> the specific refinement tag it pre-fills
 * alongside the generic `foil` bit (issue #274). "nf" adds nothing (no
 * foil at all). The filename convention has no gold-foil code, so
 * gold-foil is never pre-filled from a filename — only via manual
 * confirmation against the picker's shown rarity/foiling/art_variations. */
const FOIL_KIND_TAG = { cf: "cold-foil", rf: "rainbow-foil", nf: null };

function applyFilenameHint(hint) {
  state.filenameHint = hint;
  const box = el("filename-hint");
  if (!hint.parsed) {
    box.textContent = `⚠ filename not parsed — ${hint.reason}`;
    box.className = "unparsed";
    state.nextQuadDefaultTags = [];
    return;
  }
  const tags = [];
  if (hint.sleeved) tags.push("sleeved");
  if (hint.foil) {
    tags.push("foil");
    const refinement = FOIL_KIND_TAG[hint.foilKind];
    if (refinement) tags.push(refinement);
  }
  if (hint.marvel) tags.push("marvel");
  state.nextQuadDefaultTags = tags;
  box.textContent =
    `parsed from filename: ${hint.cardNameQuery}` +
    `${hint.printCode ? ` (${hint.printCode}${hint.edition ? "-" + hint.edition : ""})` : ""}` +
    ` — sleeved=${hint.sleeved} foil=${hint.foil}${hint.marvel ? " marvel=true" : ""}` +
    ` — pre-filled tags: ${tags.join(", ") || "none"} — confirm per-quad below` +
    ` (promo, and any full-art/extended-art/alternate-* or gold-foil treatment, aren't` +
    ` in the filename — check the picker's rarity/foiling code below and tag manually)`;
  box.className = "parsed";
  prefillPrintingSearch();
}

/**
 * Issue #258 addendum (its own emphasis): "The tool MUST parse this
 * convention and pre-fill sleeved/foil tags AND THE PRINTING-PICKER QUERY
 * from the filename, so the human only clicks corners and confirms." This
 * pre-fills the search box and runs the search — it does NOT select a
 * result. resolveCandidates/runPrintingSearch still require an explicit
 * human click even when the query happens to resolve uniquely (never-
 * auto-pick, unchanged) — this only saves the human from retyping the
 * card name or set+collector code on every single quad, across hundreds
 * of photos, which is exactly the tedium the addendum exists to eliminate.
 * Called both when a photo opens (covers reopening an already-labeled
 * photo with a quad already selected) and every time a new quad is
 * committed (covers the common fresh-photo case, where no quad exists yet
 * when the filename hint first arrives).
 */
function prefillPrintingSearch() {
  const hint = state.filenameHint;
  if (!hint || !hint.parsed) return;
  const query = hint.printCode || hint.cardNameQuery;
  el("printing-query").value = query;
  runPrintingSearch(query);
}

// --- world / canvas layout ---------------------------------------------

function layoutWorld() {
  const { naturalW, naturalH } = state.current;
  const worldW = (naturalW + 2 * state.pad) * state.zoom;
  const worldH = (naturalH + 2 * state.pad) * state.zoom;
  el("world").style.width = `${worldW}px`;
  el("world").style.height = `${worldH}px`;
  el("photo").style.left = `${state.pad * state.zoom}px`;
  el("photo").style.top = `${state.pad * state.zoom}px`;
  el("photo").style.width = `${naturalW * state.zoom}px`;
  el("photo").style.height = `${naturalH * state.zoom}px`;
  const canvas = el("overlay");
  canvas.width = worldW;
  canvas.height = worldH;
  canvas.style.width = `${worldW}px`;
  canvas.style.height = `${worldH}px`;
}

/** Native (photo pixel space, possibly negative or beyond width/height —
 * amodal) <- canvas client coordinates. No clamping. */
function toNative(canvasX, canvasY) {
  return { x: canvasX / state.zoom - state.pad, y: canvasY / state.zoom - state.pad };
}

/** Canvas pixel coordinates <- native photo pixel space. Inverse of
 * toNative — also no clamping (a native point outside the photo maps to a
 * canvas point in the padded margin, which is exactly where it should
 * render). */
function toCanvas(nativeX, nativeY) {
  return { x: (nativeX + state.pad) * state.zoom, y: (nativeY + state.pad) * state.zoom };
}

function eventToNative(evt) {
  const rect = el("overlay").getBoundingClientRect();
  return toNative(evt.clientX - rect.left, evt.clientY - rect.top);
}

// --- drawing -------------------------------------------------------------

function redrawOverlay() {
  const canvas = el("overlay");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // frame boundary, so the amodal padding region reads clearly as "outside
  // the photo" rather than looking like more photo content.
  const frameTL = toCanvas(0, 0);
  const frameBR = toCanvas(state.current.naturalW, state.current.naturalH);
  ctx.strokeStyle = "#666";
  ctx.lineWidth = 1;
  ctx.strokeRect(frameTL.x, frameTL.y, frameBR.x - frameTL.x, frameBR.y - frameTL.y);

  state.current.quads.forEach((quad, i) => drawQuad(ctx, quad, i === state.selectedQuadIndex, i));

  if (state.pendingCorners.length > 0) {
    ctx.strokeStyle = "#fc0";
    ctx.fillStyle = "#fc0";
    ctx.beginPath();
    state.pendingCorners.forEach((p, i) => {
      const c = toCanvas(p.x, p.y);
      if (i === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
      ctx.fillRect(c.x - 3, c.y - 3, 6, 6);
    });
    ctx.stroke();
  }
}

function drawQuad(ctx, quad, selected, index) {
  const pts = quad.corners.map((c) => toCanvas(c.x, c.y));
  ctx.strokeStyle = selected ? "#0f8" : quad.printingId ? "#08f" : "#f60";
  ctx.lineWidth = selected ? 3 : 2;
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle;
  pts.forEach((p) => ctx.fillRect(p.x - 4, p.y - 4, 8, 8));
  ctx.font = "12px sans-serif";
  ctx.fillText(`#${index + 1}`, pts[0].x + 6, pts[0].y - 6);
}

// --- canvas interaction (click-to-place, drag-to-correct) ----------------

const CORNER_LABELS = ["top-left", "top-right", "bottom-right", "bottom-left"];
const HANDLE_HIT_RADIUS_CANVAS_PX = 10;

function wireCanvas() {
  const canvas = el("overlay");

  canvas.addEventListener("mousedown", (evt) => {
    const native = eventToNative(evt);

    if (state.placingQuad && state.pendingCorners.length < 4) {
      state.pendingCorners.push(native);
      updateClickInstructions();
      redrawOverlay();
      if (state.pendingCorners.length === 4) {
        state.placingQuad = false;
        commitPendingQuad();
      }
      return;
    }

    const hit = findHandleAt(evt);
    if (hit) {
      state.dragging = hit;
      state.selectedQuadIndex = hit.quadIndex;
      renderQuadList();
      return;
    }
  });

  window.addEventListener("mousemove", (evt) => {
    if (!state.dragging) return;
    const native = eventToNative(evt);
    const quad = state.current.quads[state.dragging.quadIndex];
    // Directly assign — amodal drag targets outside the photo frame are
    // valid and expected, never clamped back into bounds.
    quad.corners[state.dragging.cornerIndex] = native;
    state.dirty = true;
    redrawOverlay();
  });

  window.addEventListener("mouseup", () => {
    state.dragging = null;
  });
}

function findHandleAt(evt) {
  const rect = el("overlay").getBoundingClientRect();
  const cx = evt.clientX - rect.left;
  const cy = evt.clientY - rect.top;
  for (let qi = 0; qi < state.current.quads.length; qi++) {
    const corners = state.current.quads[qi].corners;
    for (let ci = 0; ci < corners.length; ci++) {
      const p = toCanvas(corners[ci].x, corners[ci].y);
      if (Math.hypot(p.x - cx, p.y - cy) <= HANDLE_HIT_RADIUS_CANVAS_PX) {
        return { quadIndex: qi, cornerIndex: ci };
      }
    }
  }
  return null;
}

function updateClickInstructions() {
  const n = state.pendingCorners.length;
  el("click-instructions").textContent =
    n < 4 ? `click corner ${n + 1} of 4 (${CORNER_LABELS[n]}) — clicks outside the photo frame are OK` : "";
}

function commitPendingQuad() {
  const quad = {
    printingId: "",
    corners: state.pendingCorners.map((p) => ({ x: p.x, y: p.y })),
    tags: [...state.nextQuadDefaultTags],
  };
  state.current.quads.push(quad);
  state.pendingCorners = [];
  state.selectedQuadIndex = state.current.quads.length - 1;
  state.dirty = true;
  el("click-instructions").textContent = "";
  renderQuadList();
  redrawOverlay();
  prefillPrintingSearch();
}

// --- toolbar ---------------------------------------------------------------

function wireToolbar() {
  el("zoom-in").addEventListener("click", () => setZoom(state.zoom * 1.25));
  el("zoom-out").addEventListener("click", () => setZoom(state.zoom / 1.25));
  el("zoom-reset").addEventListener("click", () => setZoom(1));
  el("pad-more").addEventListener("click", () => {
    if (!state.current) return;
    state.pad = Math.round(state.pad * 1.5) + 20;
    layoutWorld();
    redrawOverlay();
  });
  el("add-card").addEventListener("click", () => {
    if (!state.current) return;
    state.pendingCorners = [];
    state.placingQuad = true;
    updateClickInstructions();
    // force at least one instruction render even at n=0
    el("click-instructions").textContent = `click corner 1 of 4 (${CORNER_LABELS[0]}) — clicks outside the photo frame are OK`;
  });
  el("skip-card").addEventListener("click", () => {
    state.skippedCount++;
    el("save-status").textContent = `${state.skippedCount} card(s) marked "not estimable" this session (not written to the label — just a reminder for you).`;
    el("save-status").className = "";
  });
  el("scene-type").addEventListener("change", (e) => {
    if (state.current) {
      state.current.sceneType = e.target.value;
      state.dirty = true;
    }
  });
  el("orientation").addEventListener("change", (e) => {
    if (state.current) {
      state.current.orientation = e.target.value;
      state.dirty = true;
    }
  });
  el("save-label").addEventListener("click", saveLabel);
  el("delete-quad").addEventListener("click", () => {
    if (state.selectedQuadIndex < 0) return;
    state.current.quads.splice(state.selectedQuadIndex, 1);
    state.selectedQuadIndex = -1;
    state.dirty = true;
    renderQuadList();
    redrawOverlay();
  });
}

function setZoom(z) {
  if (!state.current) return;
  state.zoom = Math.max(0.05, Math.min(8, z));
  layoutWorld();
  redrawOverlay();
}

// --- quad list / editor -----------------------------------------------

function renderQuadList() {
  const list = el("quad-list");
  list.innerHTML = state.current.quads
    .map(
      (q, i) =>
        `<li data-i="${i}" class="${i === state.selectedQuadIndex ? "selected" : ""} ${q.printingId ? "" : "no-printing"}">` +
        `#${i + 1} ${q.printingId ? escapeHtml(q.printingId) : "(no printing selected)"} [${q.tags.join(", ") || "no tags"}]</li>`,
    )
    .join("");
  for (const li of list.children) {
    li.addEventListener("click", () => {
      state.selectedQuadIndex = Number(li.dataset.i);
      renderQuadEditor();
      redrawOverlay();
    });
  }
  renderQuadEditor();
}

function renderQuadEditor() {
  const editor = el("quad-editor");
  if (state.selectedQuadIndex < 0 || !state.current.quads[state.selectedQuadIndex]) {
    editor.hidden = true;
    return;
  }
  editor.hidden = false;
  const quad = state.current.quads[state.selectedQuadIndex];
  el("printing-summary").textContent = quad.printingId ? `selected: ${quad.printingId}` : "no printing selected yet";
  for (const cb of document.querySelectorAll('#tag-editor input[type="checkbox"]')) {
    cb.checked = quad.tags.includes(cb.value);
    cb.onchange = () => {
      const set = new Set(quad.tags);
      cb.checked ? set.add(cb.value) : set.delete(cb.value);
      quad.tags = [...set];
      state.dirty = true;
      renderQuadList();
    };
  }
}

// --- printing picker -----------------------------------------------------

let searchDebounce = null;

function wirePrintingPicker() {
  el("printing-query").addEventListener("input", (e) => {
    clearTimeout(searchDebounce);
    const q = e.target.value;
    searchDebounce = setTimeout(() => runPrintingSearch(q), 250);
  });
}

async function runPrintingSearch(query) {
  const trimmed = query.trim();
  const looksLikeCode = /^[A-Za-z]{2,5}\d{2,4}$/.test(trimmed);
  const params = new URLSearchParams();
  if (looksLikeCode) params.set("code", trimmed.toUpperCase());
  else params.set("name", trimmed);
  if (trimmed.length === 0) {
    el("printing-results").innerHTML = "";
    return;
  }
  const res = await api(`/api/catalog/search?${params.toString()}`);
  renderPrintingResults(res.body);
}

function renderPrintingResults(result) {
  const list = el("printing-results");
  const candidates = result.status === "unique" ? [result.printing] : result.candidates;
  if (result.status === "not-found" || candidates.length === 0) {
    list.innerHTML = "<li>no matching printing — never guessing, pick a different query</li>";
    return;
  }
  if (result.status === "ambiguous") {
    list.insertAdjacentHTML("beforebegin", "");
  }
  list.innerHTML = candidates
    .map(
      (c) =>
        `<li data-id="${escapeAttr(c.printingId)}">` +
        (c.imageCached ? `<img src="/api/printing-image?id=${encodeURIComponent(c.printingId)}">` : `<span class="no-image">no image cached</span>`) +
        `<span>${escapeHtml(c.cardName)} — ${escapeHtml(c.printCode)} (${escapeHtml(c.edition)}/${escapeHtml(c.foiling)}/${escapeHtml(c.rarity)})` +
        // issue #274: art_variations wasn't shown before there were tags for
        // it — surfaced here (raw the-fab-cube codes: AA/AB/EA/FA/AT) so a
        // human can cross-check before ticking alternate-art/alternate-
        // border/extended-art/full-art/alternate-text below, same way
        // edition/foiling/rarity already back marvel/promo/cold-foil/etc.
        `${c.artVariations && c.artVariations.length ? ` [${c.artVariations.map(escapeHtml).join(",")}]` : ""}` +
        `<br><small>${escapeHtml(c.printingId)}</small></span>` +
        `</li>`,
    )
    .join("");
  for (const li of list.children) {
    if (!li.dataset.id) continue;
    li.addEventListener("click", () => {
      if (state.selectedQuadIndex < 0) return;
      state.current.quads[state.selectedQuadIndex].printingId = li.dataset.id;
      state.dirty = true;
      renderQuadList();
      redrawOverlay();
    });
  }
}

// --- save ------------------------------------------------------------------

async function saveLabel() {
  const c = state.current;
  const label = {
    photoId: c.photoId,
    fileName: c.fileName,
    sceneType: c.sceneType,
    orientation: c.orientation,
    quads: c.quads,
  };
  const res = await api(`/api/label?file=${encodeURIComponent(c.fileName)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(label),
  });
  const status = el("save-status");
  if (res.ok) {
    status.textContent = "saved.";
    status.className = "ok";
    state.dirty = false;
    await refreshPhotoList();
  } else {
    status.textContent = `NOT saved — validation failed:\n${(res.body.errors || []).join("\n")}`;
    status.className = "error";
  }
}

init();
