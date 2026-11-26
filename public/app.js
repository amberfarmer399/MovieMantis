/**
 * MovieMantis — Client Application
 * Connects the Discovery Filter Catalog, Extended-Reference Watchlist Queue,
 * Personalized Recommendation Engine, and MongoDB Explain Plan & Validator Inspector.
 */

const state = {
  meta: null,
  movies: [],
  watchlist: [],
  watchlistByMovieId: new Map(),
  recommendations: [],
  lastMoviesDiagnostic: null,
  lastWatchlistDiagnostic: null
};

// ============================================================================
// 1. Toast Notification Helper
// ============================================================================

let toastTimer = null;
function showToast(message) {
  const banner = document.getElementById("toastBanner");
  if (!banner) return;
  banner.textContent = message;
  banner.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    banner.hidden = true;
  }, 3200);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ============================================================================
// 2. Modern Web Guidance: Dialog Light-Dismiss Fallback & ARIA :user-invalid Sync
// ============================================================================

function setupDialogFallbacks() {
  // Fallback for browsers without native <dialog closedby="any"> support
  if (!("closedBy" in HTMLDialogElement.prototype)) {
    const outside = (e, dialog) => {
      const r = dialog.getBoundingClientRect();
      return (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      );
    };
    for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
      let pressedOutside = false;
      dialog.addEventListener("pointerdown", (e) => {
        pressedOutside = outside(e, dialog);
      });
      dialog.addEventListener("pointerup", (e) => {
        if (pressedOutside && outside(e, dialog)) dialog.close();
      });
    }
  }
}

function setupUserInvalidAriaSync() {
  const linkError = (el, shown) => {
    const errorId = el.dataset?.error;
    if (!errorId) return;
    const ids = (el.getAttribute("aria-describedby") || "")
      .split(/\s+/)
      .filter((id) => id && id !== errorId);
    if (shown) ids.push(errorId);
    if (ids.length) el.setAttribute("aria-describedby", ids.join(" "));
    else el.removeAttribute("aria-describedby");
  };

  const announcer = document.createElement("div");
  announcer.setAttribute("aria-live", "polite");
  announcer.classList.add("visually-hidden");
  document.body.append(announcer);
  let announceTimer;
  let announcedField;

  const spokenText = (node) => {
    const copy = node.cloneNode(true);
    copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
    copy.querySelectorAll('[role="img"][aria-label]').forEach((n) => {
      n.replaceWith(`${n.getAttribute("aria-label")}: `);
    });
    return copy.textContent.replace(/\s+/g, " ").trim();
  };

  const announceError = (el) => {
    const error = document.getElementById(el.dataset.error);
    if (!error) return;
    const label = el.labels?.[0] ? `${spokenText(el.labels[0])}: ` : "";
    clearTimeout(announceTimer);
    announcer.textContent = "";
    announcedField = el;
    announceTimer = setTimeout(() => {
      announcer.textContent = label + spokenText(error);
    }, 500);
  };

  const flagged = new WeakSet();
  const announced = new WeakSet();
  const supportsUserInvalid = CSS.supports("selector(:user-invalid)");

  const syncAria = (el, announce = false) => {
    if (!el.matches?.("input, select, textarea")) return;
    const invalid = supportsUserInvalid
      ? el.matches(":user-invalid")
      : !el.validity.valid;
    if (invalid) {
      if (announce && !announced.has(el)) {
        announceError(el);
        announced.add(el);
      }
      el.setAttribute("aria-invalid", "true");
      if (!supportsUserInvalid) el.classList.add("user-invalid-fallback");
      linkError(el, true);
      flagged.add(el);
    } else if (flagged.has(el) || el.getAttribute("aria-invalid") !== "true") {
      el.setAttribute("aria-invalid", "false");
      el.classList.remove("user-invalid-fallback");
      linkError(el, false);
      flagged.delete(el);
      announced.delete(el);
      if (announcedField === el) {
        clearTimeout(announceTimer);
        announcer.textContent = "";
      }
    }
  };

  document.querySelectorAll("input, select, textarea").forEach((el) => syncAria(el));
  document.addEventListener("blur", (e) => syncAria(e.target, true), true);
  document.addEventListener("input", (e) => {
    if (e.target.hasAttribute("aria-invalid")) syncAria(e.target);
  });
  document.addEventListener("change", (e) => syncAria(e.target, true), true);
  document.addEventListener(
    "invalid",
    (e) => {
      announced.add(e.target);
      syncAria(e.target);
    },
    true
  );
}

// ============================================================================
// 3. Extract Winning Plan Stage & Index Name from MongoDB explain()
// ============================================================================

function extractPlanSummary(winningPlan) {
  const stages = [];
  let indexName = "COLLSCAN (No Index)";

  function walk(node) {
    if (!node) return;
    if (node.stage) stages.push(node.stage);
    if (node.indexName) indexName = node.indexName;
    if (node.inputStage) walk(node.inputStage);
    if (Array.isArray(node.inputStages)) node.inputStages.forEach(walk);
    if (node.queryPlan) walk(node.queryPlan);
  }

  walk(winningPlan);
  return {
    stageChain: stages.join(" → ") || "IXSCAN",
    indexName
  };
}

// ============================================================================
// 4. API Data Fetching & Rendering
// ============================================================================

async function loadMeta() {
  const res = await fetch("/api/meta");
  const meta = await res.json();
  state.meta = meta;

  document.querySelector("#statCatalogCount strong").textContent = meta.counts.movies;
  document.querySelector("#statWatchlistCount strong").textContent = meta.counts.watchlist;

  // Populate filter selects
  const genreSelect = document.getElementById("filterGenre");
  if (genreSelect.options.length <= 1) {
    meta.genres.forEach((g) => {
      const opt = document.createElement("option");
      opt.value = g;
      opt.textContent = g;
      genreSelect.appendChild(opt);
    });
  }

  const ratingSelect = document.getElementById("filterRating");
  if (ratingSelect.options.length <= 1) {
    meta.contentRatings.forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = r;
      ratingSelect.appendChild(opt);
    });
  }

  const providerSelect = document.getElementById("filterProvider");
  if (providerSelect.options.length <= 1) {
    meta.streamingProviders.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      providerSelect.appendChild(opt);
    });
  }

  // Populate Add Movie modal checkboxes
  const genreCheckboxes = document.getElementById("addMovieGenresList");
  if (!genreCheckboxes.children.length) {
    meta.genres.forEach((g, idx) => {
      const label = document.createElement("label");
      label.className = "checkbox-label";
      label.innerHTML = `<input type="checkbox" name="genres" value="${escapeHtml(g)}" ${
        idx === 0 || g === "Sci-Fi" ? "checked" : ""
      }> <span>${escapeHtml(g)}</span>`;
      genreCheckboxes.appendChild(label);
    });
  }

  const providerCheckboxes = document.getElementById("addMovieProvidersList");
  if (!providerCheckboxes.children.length) {
    meta.streamingProviders.forEach((p, idx) => {
      const label = document.createElement("label");
      label.className = "checkbox-label";
      label.innerHTML = `<input type="checkbox" name="streamingProviders" value="${escapeHtml(p)}" ${
        idx === 0 ? "checked" : ""
      }> <span>${escapeHtml(p)}</span>`;
      providerCheckboxes.appendChild(label);
    });
  }

  document.getElementById("activeIndexesPre").textContent = JSON.stringify(
    meta.indexes,
    null,
    2
  );
}

async function loadWatchlist() {
  const status = document.getElementById("watchlistStatusFilter").value;
  const sortBy = document.getElementById("watchlistSortFilter").value;

  const params = new URLSearchParams({ status, sortBy });
  const res = await fetch(`/api/watchlists?${params.toString()}`);
  const data = await res.json();

  state.watchlist = data.watchlist || [];
  state.lastWatchlistDiagnostic = data.queryDiagnostic;

  // Also fetch full user watchlist map so movie cards show accurate badge status
  const allRes = await fetch("/api/watchlists?status=ALL");
  const allData = await allRes.json();
  state.watchlistByMovieId.clear();
  for (const item of allData.watchlist || []) {
    state.watchlistByMovieId.set(String(item.movieId), item);
  }

  document.querySelector("#statWatchlistCount strong").textContent =
    state.watchlistByMovieId.size;

  renderWatchlist();
  updateWatchlistTelemetry(data.queryDiagnostic);
}

async function loadMovies() {
  const form = document.getElementById("filterForm");
  const formData = new FormData(form);
  const params = new URLSearchParams();

  for (const [k, v] of formData.entries()) {
    if (v && v !== "ALL") params.set(k, v);
  }

  const res = await fetch(`/api/movies?${params.toString()}`);
  const data = await res.json();

  state.movies = data.movies || [];
  state.lastMoviesDiagnostic = data.queryDiagnostic;

  renderMoviesGrid();
  updateMoviesTelemetry(data.queryDiagnostic);
}

async function loadRecommendations() {
  const res = await fetch("/api/recommendations");
  const data = await res.json();
  state.recommendations = data.recommendations || [];

  const pillsWrap = document.getElementById("topGenrePills");
  pillsWrap.innerHTML = (data.topGenres || [])
    .map((g, i) => `<span class="pill">#${i + 1} Affinity: <strong>${escapeHtml(g)}</strong></span>`)
    .join(" ");

  renderRecommendationsGrid();
}

// ============================================================================
// 5. UI Rendering Functions
// ============================================================================

function renderMoviesGrid() {
  const grid = document.getElementById("moviesGrid");
  const summary = document.getElementById("catalogResultSummary");
  summary.textContent = `Showing ${state.movies.length} title(s) ranked by your selected criteria`;

  if (!state.movies.length) {
    grid.innerHTML = `<div class="diag-card"><p>No movies matched the current filter criteria. Try widening the release year or resetting filters.</p></div>`;
    return;
  }

  grid.innerHTML = state.movies
    .map((m) => {
      const inWatchlist = state.watchlistByMovieId.get(String(m._id));
      const recScore = Number(m.metrics?.recommendationScore ?? 0).toFixed(1);
      const avgRating = Number(m.metrics?.avgRating ?? 0).toFixed(1);
      const popScore = Number(m.metrics?.popularityScore ?? 0).toFixed(1);

      return `
        <article class="movie-card">
          <div class="movie-poster-wrap">
            <img class="movie-poster" src="${escapeHtml(m.posterUrl)}" alt="${escapeHtml(m.title)} poster" loading="lazy">
            <span class="rating-chip">${escapeHtml(m.contentRating)}</span>
            <span class="score-badge" title="Composite Recommendation Ranking Score">⚡ ${recScore}</span>
          </div>
          <div class="movie-body">
            <div class="movie-title-row">
              <h3 class="movie-title">${escapeHtml(m.title)}</h3>
            </div>
            <div class="movie-meta">
              ${escapeHtml(m.releaseYear)} • ${escapeHtml(m.runtimeMinutes)} min
            </div>
            <div class="genre-pills">
              ${(m.genres || []).map((g) => `<span class="pill">${escapeHtml(g)}</span>`).join("")}
            </div>
            <div class="provider-pills">
              ${(m.streamingProviders || [])
                .map((p) => `<span class="pill pill-provider">▶ ${escapeHtml(p)}</span>`)
                .join("")}
            </div>
            <p class="movie-synopsis">${escapeHtml(m.synopsis)}</p>
            <div class="metrics-bar">
              <span>★ ${avgRating}/10 (${Number(m.metrics?.ratingCount || 0).toLocaleString()})</span>
              <span>🔥 Pop ${popScore}</span>
            </div>
            <div class="card-actions">
              ${
                inWatchlist
                  ? `<button type="button" class="btn btn-secondary btn-block" data-edit-watchlist="${escapeHtml(
                      inWatchlist._id
                    )}">✓ In Watchlist (${escapeHtml(inWatchlist.status)})</button>`
                  : `<button type="button" class="btn btn-primary btn-block" data-add-watchlist="${escapeHtml(
                      m._id
                    )}">+ Add to Watchlist</button>`
              }
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderWatchlist() {
  const container = document.getElementById("watchlistGrid");
  if (!state.watchlist.length) {
    container.innerHTML = `<div class="diag-card"><p>No watchlist entries match this status filter. Add movies from the Discover tab!</p></div>`;
    return;
  }

  container.innerHTML = state.watchlist
    .map((item) => {
      const snap = item.movieSnapshot || {};
      const affinity = Number(item.affinityScore ?? 0).toFixed(1);
      return `
        <article class="watchlist-card">
          <div class="watchlist-card-top">
            <img class="watchlist-thumb" src="${escapeHtml(snap.posterUrl)}" alt="${escapeHtml(snap.title)}">
            <div style="flex: 1;">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.5rem;">
                <h3 class="movie-title">${escapeHtml(snap.title)}</h3>
                <span class="affinity-meter" title="Personalized User-Movie Affinity Score">🎯 ${affinity}%</span>
              </div>
              <div class="movie-meta">
                ${escapeHtml(snap.releaseYear)} • ${escapeHtml(snap.runtimeMinutes)} min • Priority <strong>${escapeHtml(
        item.priorityRank
      )}/10</strong>
              </div>
              <div class="genre-pills" style="margin-top:0.35rem;">
                <span class="pill">Status: <strong>${escapeHtml(item.status)}</strong></span>
                ${
                  item.userRating
                    ? `<span class="pill">Your Rating: ★ ${escapeHtml(item.userRating)}/10</span>`
                    : ""
                }
              </div>
              <div class="genre-pills" style="margin-top:0.35rem;">
                ${(snap.genres || []).map((g) => `<span class="pill">${escapeHtml(g)}</span>`).join("")}
              </div>
            </div>
          </div>
          ${
            item.notes
              ? `<p class="movie-synopsis" style="font-style:italic;">"${escapeHtml(item.notes)}"</p>`
              : ""
          }
          <div class="card-actions">
            <button type="button" class="btn btn-secondary" data-edit-watchlist="${escapeHtml(
              item._id
            )}">Edit Status / Priority / Rating</button>
            <button type="button" class="btn btn-danger" data-delete-watchlist="${escapeHtml(
              item._id
            )}">Remove</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderRecommendationsGrid() {
  const grid = document.getElementById("recommendationsGrid");
  if (!state.recommendations.length) {
    grid.innerHTML = `<div class="diag-card"><p>Every movie in the catalog is already in your watchlist!</p></div>`;
    return;
  }

  grid.innerHTML = state.recommendations
    .map((m, idx) => {
      return `
        <article class="movie-card">
          <div class="movie-poster-wrap">
            <img class="movie-poster" src="${escapeHtml(m.posterUrl)}" alt="${escapeHtml(m.title)} poster" loading="lazy">
            <span class="rating-chip">#${idx + 1} Pick • ${escapeHtml(m.contentRating)}</span>
            <span class="score-badge">🎯 ${Number(m.personalizedMatchScore).toFixed(1)}% Match</span>
          </div>
          <div class="movie-body">
            <h3 class="movie-title">${escapeHtml(m.title)} (${escapeHtml(m.releaseYear)})</h3>
            <div class="match-reason-banner">${escapeHtml(m.matchReason)}</div>
            <div class="genre-pills">
              ${(m.genres || []).map((g) => `<span class="pill">${escapeHtml(g)}</span>`).join("")}
            </div>
            <p class="movie-synopsis">${escapeHtml(m.synopsis)}</p>
            <div class="metrics-bar">
              <span>Global Rec Score: ${Number(m.metrics?.recommendationScore ?? 0).toFixed(1)}</span>
              <span>★ ${Number(m.metrics?.avgRating ?? 0).toFixed(1)}/10</span>
            </div>
            <div class="card-actions">
              <button type="button" class="btn btn-primary btn-block" data-add-watchlist="${escapeHtml(
                m._id
              )}">+ Add to Watchlist</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function updateMoviesTelemetry(diag) {
  if (!diag) return;
  const summary = extractPlanSummary(diag.winningPlan);
  document.getElementById("diagMoviesStage").textContent = summary.stageChain;
  document.getElementById("diagMoviesIndex").textContent = summary.indexName;
  document.getElementById("diagMoviesKeys").textContent = diag.totalKeysExamined;
  document.getElementById("diagMoviesDocs").textContent = diag.nReturned;
  document.getElementById("moviesExplainPre").textContent = JSON.stringify(diag, null, 2);
}

function updateWatchlistTelemetry(diag) {
  if (!diag) return;
  const summary = extractPlanSummary(diag.winningPlan);
  document.getElementById("diagWatchlistStage").textContent = summary.stageChain;
  document.getElementById("diagWatchlistIndex").textContent = summary.indexName;
  document.getElementById("diagWatchlistKeys").textContent = diag.totalKeysExamined;
  document.getElementById("diagWatchlistDocs").textContent = diag.totalDocsExamined;
  document.getElementById("watchlistsExplainPre").textContent = JSON.stringify(diag, null, 2);
}

// ============================================================================
// 6. Event Listeners & Interactive Workflows
// ============================================================================

function setupEvents() {
  // Navigation Tabs
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => {
        p.classList.remove("active");
        p.hidden = true;
      });

      btn.classList.add("active");
      const targetPanel = document.getElementById(`tab-${btn.dataset.tab}`);
      if (targetPanel) {
        targetPanel.classList.add("active");
        targetPanel.hidden = false;
      }

      if (btn.dataset.tab === "watchlist") loadWatchlist();
      if (btn.dataset.tab === "recommendations") loadRecommendations();
      if (btn.dataset.tab === "diagnostics") loadMeta();
    });
  });

  // Runtime slider label
  const runtimeInput = document.getElementById("filterRuntime");
  const runtimeLabel = document.getElementById("runtimeValueLabel");
  runtimeInput.addEventListener("input", () => {
    runtimeLabel.textContent = `${runtimeInput.value} min`;
  });

  // Discovery Filter Form submission & live change
  const filterForm = document.getElementById("filterForm");
  filterForm.addEventListener("submit", (e) => {
    e.preventDefault();
    loadMovies();
  });
  filterForm.addEventListener("change", () => loadMovies());

  document.getElementById("resetFiltersBtn").addEventListener("click", () => {
    filterForm.reset();
    runtimeLabel.textContent = "240 min";
    loadMovies();
  });

  // Watchlist filter selects
  document.getElementById("watchlistStatusFilter").addEventListener("change", loadWatchlist);
  document.getElementById("watchlistSortFilter").addEventListener("change", loadWatchlist);

  // Delegated clicks for "+ Add to Watchlist", "Edit", and "Remove"
  document.body.addEventListener("click", async (e) => {
    const addBtn = e.target.closest("[data-add-watchlist]");
    if (addBtn) {
      const movieId = addBtn.getAttribute("data-add-watchlist");
      addBtn.disabled = true;
      try {
        const res = await fetch("/api/watchlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ movieId, status: "WANT_TO_WATCH", priorityRank: 8 })
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data.error || "Could not add to watchlist");
        } else {
          showToast(`Added "${data.watchlistItem.movieSnapshot.title}" to Watchlist!`);
          await Promise.all([loadWatchlist(), loadMovies(), loadRecommendations()]);
        }
      } finally {
        addBtn.disabled = false;
      }
      return;
    }

    const editBtn = e.target.closest("[data-edit-watchlist]");
    if (editBtn) {
      const entryId = editBtn.getAttribute("data-edit-watchlist");
      let item =
        state.watchlist.find((w) => String(w._id) === entryId) ||
        Array.from(state.watchlistByMovieId.values()).find((w) => String(w._id) === entryId);
      if (!item) return;

      document.getElementById("editWatchlistId").value = item._id;
      document.getElementById("editWatchlistMovieName").textContent =
        `${item.movieSnapshot?.title} (${item.movieSnapshot?.releaseYear})`;
      document.getElementById("editWatchlistStatus").value = item.status;
      document.getElementById("editWatchlistPriority").value = item.priorityRank;
      document.getElementById("priorityValLabel").textContent = item.priorityRank;
      document.getElementById("editWatchlistRating").value = item.userRating ?? "";
      document.getElementById("editWatchlistNotes").value = item.notes || "";

      document.getElementById("editWatchlistDialog").showModal();
      return;
    }

    const deleteBtn = e.target.closest("[data-delete-watchlist]");
    if (deleteBtn) {
      const entryId = deleteBtn.getAttribute("data-delete-watchlist");
      const res = await fetch(`/api/watchlists/${entryId}`, { method: "DELETE" });
      if (res.ok) {
        showToast("Removed from Watchlist");
        await Promise.all([loadWatchlist(), loadMovies(), loadRecommendations()]);
      }
    }
  });

  // Add Movie Modal open/close & submission
  const addMovieDialog = document.getElementById("addMovieDialog");
  document.getElementById("openAddMovieBtn").addEventListener("click", () => {
    document.getElementById("addMovieServerError").hidden = true;
    addMovieDialog.showModal();
  });
  document.getElementById("closeAddMovieDialogBtn").addEventListener("click", () => {
    addMovieDialog.close();
  });
  document.getElementById("cancelAddMovieBtn").addEventListener("click", () => {
    addMovieDialog.close();
  });

  document.getElementById("addMovieForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    if (!form.checkValidity()) {
      const firstInvalid = form.querySelector(":invalid");
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    const formData = new FormData(form);
    const genres = formData.getAll("genres");
    const streamingProviders = formData.getAll("streamingProviders");
    const errBanner = document.getElementById("addMovieServerError");

    if (genres.length === 0) {
      errBanner.textContent = "Please select at least one genre (required by MongoDB $jsonSchema).";
      errBanner.hidden = false;
      return;
    }

    const payload = {
      title: formData.get("title"),
      releaseYear: Number(formData.get("releaseYear")),
      runtimeMinutes: Number(formData.get("runtimeMinutes")),
      contentRating: formData.get("contentRating"),
      genres,
      streamingProviders,
      posterUrl: formData.get("posterUrl"),
      synopsis: formData.get("synopsis"),
      metrics: {
        avgRating: Number(formData.get("avgRating")),
        ratingCount: 1500,
        popularityScore: 86.0
      }
    };

    const res = await fetch("/api/movies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!res.ok) {
      errBanner.textContent = `${data.error}: ${JSON.stringify(data.details)}`;
      errBanner.hidden = false;
      return;
    }

    addMovieDialog.close();
    form.reset();
    showToast(`Added "${data.movie.title}" to MongoDB Catalog!`);
    await Promise.all([loadMeta(), loadMovies(), loadRecommendations()]);
  });

  // Edit Watchlist Modal
  const editWatchlistDialog = document.getElementById("editWatchlistDialog");
  const prioritySlider = document.getElementById("editWatchlistPriority");
  prioritySlider.addEventListener("input", () => {
    document.getElementById("priorityValLabel").textContent = prioritySlider.value;
  });

  document.getElementById("closeEditWatchlistBtn").addEventListener("click", () => {
    editWatchlistDialog.close();
  });
  document.getElementById("cancelEditWatchlistBtn").addEventListener("click", () => {
    editWatchlistDialog.close();
  });

  document.getElementById("editWatchlistForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const entryId = document.getElementById("editWatchlistId").value;
    const payload = {
      status: document.getElementById("editWatchlistStatus").value,
      priorityRank: Number(document.getElementById("editWatchlistPriority").value),
      userRating: document.getElementById("editWatchlistRating").value || null,
      notes: document.getElementById("editWatchlistNotes").value
    };

    const res = await fetch(`/api/watchlists/${entryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      editWatchlistDialog.close();
      showToast("Updated watchlist entry & recomputed affinity score!");
      await Promise.all([loadWatchlist(), loadMovies(), loadRecommendations()]);
    } else {
      showToast(data.error || "Update failed");
    }
  });

  // Interactive $jsonSchema Validation Tester buttons
  document.getElementById("testInvalidMovieBtn").addEventListener("click", async () => {
    const invalidPayload = {
      title: "Invalid Schema Movie",
      slug: "INVALID SLUG WITH SPACES!",
      releaseYear: 1750,
      runtimeMinutes: -45,
      contentRating: "SUPER-R",
      genres: ["NonExistentGenre"],
      metrics: { avgRating: 19.5 },
      createdAt: new Date()
    };
    const res = await fetch("/api/validate-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "movies", payload: invalidPayload })
    });
    const data = await res.json();
    document.getElementById("validationTestOutput").textContent = JSON.stringify(
      { testedCollection: "movies", sentPayload: invalidPayload, mongoResponse: data },
      null,
      2
    );
  });

  document.getElementById("testInvalidWatchlistBtn").addEventListener("click", async () => {
    const invalidPayload = {
      userId: "not-an-object-id",
      status: "INVALID_STATUS",
      priorityRank: 99,
      affinityScore: 250.0
    };
    const res = await fetch("/api/validate-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "watchlists", payload: invalidPayload })
    });
    const data = await res.json();
    document.getElementById("validationTestOutput").textContent = JSON.stringify(
      { testedCollection: "watchlists", sentPayload: invalidPayload, mongoResponse: data },
      null,
      2
    );
  });
}

// ============================================================================
// 7. Bootstrap Application
// ============================================================================

document.addEventListener("DOMContentLoaded", async () => {
  setupDialogFallbacks();
  setupUserInvalidAriaSync();
  setupEvents();

  await loadMeta();
  await loadWatchlist();
  await loadMovies();
  await loadRecommendations();
});
