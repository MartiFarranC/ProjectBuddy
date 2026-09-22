// ProjectBuddy · controlador principal (routing, vistes, interaccions)
(function () {
  "use strict";

  const state = {
    projects: [],
    categories: [],
    locations: [],
    currentView: null,
    currentProjectId: null,
    captureCategory: null,
    captureLocation: null,
    micSession: null,
    micRecording: false,
    autosaveTimer: null,
  };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ---------------------------------------------------------------------
   * Utilitats
   * ------------------------------------------------------------------- */

  function isMobile() {
    return window.matchMedia("(max-width: 820px)").matches;
  }

  function catColorVar(slot) {
    return `var(--cat-${slot || 8})`;
  }

  function formatDateTime(iso) {
    const d = new Date(iso);
    return d.toLocaleString("ca-ES", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatRelative(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return "ara mateix";
    if (mins < 60) return `fa ${mins} min`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `fa ${hours} h`;
    const days = Math.round(hours / 24);
    if (days < 7) return `fa ${days} d`;
    return formatDateTime(iso);
  }

  function excerpt(text, n) {
    if (!text) return "";
    return text.length > n ? text.slice(0, n).trim() + "…" : text;
  }

  function autoTitle(content) {
    if (!content) return "Idea sense títol";
    const firstLine = content.split("\n")[0].trim();
    return excerpt(firstLine, 60) || "Idea sense títol";
  }

  function priorityScore(p) {
    if (!p.questionnaire_done) return -999;
    return (p.desire || 0) + (p.necessity || 0) - (p.difficulty || 0);
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function toast(msg) {
    const stack = $("#toast-stack");
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(() => {
      el.classList.add("leaving");
      setTimeout(() => el.remove(), 200);
    }, 2400);
  }

  /* ---------------------------------------------------------------------
   * Routing / vistes
   * ------------------------------------------------------------------- */

  function showView(name) {
    state.currentView = name;
    $$(".view").forEach((v) => (v.hidden = v.id !== `view-${name}`));
    $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.nav === name));
    $$(".bottom-nav button").forEach((b) => b.classList.toggle("active", b.dataset.nav === name));
    window.scrollTo({ top: 0, behavior: "smooth" });

    if (name === "dashboard") renderDashboard();
    if (name === "stats") renderStats();
  }

  function wireNav() {
    $$("[data-nav]").forEach((btn) => {
      btn.addEventListener("click", () => showView(btn.dataset.nav));
    });
    $("#fab-new-idea").addEventListener("click", () => {
      resetCaptureForm();
      showView("capture");
    });
    $("#capture-go-dashboard").addEventListener("click", () => showView("dashboard"));
    $("#detail-back-btn").addEventListener("click", () => showView("dashboard"));
  }

  /* ---------------------------------------------------------------------
   * Captura
   * ------------------------------------------------------------------- */

  function renderCaptureChips() {
    const catWrap = $("#capture-categories");
    catWrap.innerHTML = "";
    state.categories.forEach((c) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = c.name;
      chip.addEventListener("click", () => {
        state.captureCategory = state.captureCategory === c.name ? null : c.name;
        renderCaptureChips();
      });
      if (state.captureCategory === c.name) chip.classList.add("selected");
      catWrap.appendChild(chip);
    });
    const newCat = document.createElement("button");
    newCat.type = "button";
    newCat.className = "chip";
    newCat.textContent = "+ Nova";
    newCat.addEventListener("click", async () => {
      const name = prompt("Nom de la categoria nova:");
      if (!name) return;
      await window.PB_DB.addCategory(name.trim());
      state.categories = await window.PB_DB.listCategories();
      state.captureCategory = name.trim();
      renderCaptureChips();
    });
    catWrap.appendChild(newCat);

    const locWrap = $("#capture-locations");
    locWrap.innerHTML = "";
    state.locations.forEach((name) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = name;
      chip.addEventListener("click", () => {
        state.captureLocation = state.captureLocation === name ? null : name;
        renderCaptureChips();
      });
      if (state.captureLocation === name) chip.classList.add("selected");
      locWrap.appendChild(chip);
    });
    const other = document.createElement("button");
    other.type = "button";
    other.className = "chip";
    other.textContent = "+ Altres";
    other.addEventListener("click", async () => {
      const name = prompt("Nom del lloc:");
      if (!name) return;
      await window.PB_DB.addLocation(name.trim());
      state.locations = await window.PB_DB.listLocations();
      state.captureLocation = name.trim();
      renderCaptureChips();
    });
    locWrap.appendChild(other);
  }

  function resetCaptureForm() {
    $("#idea-textarea").value = "";
    state.captureCategory = null;
    state.captureLocation = null;
    $("#mic-hint").textContent = "Prem el micro i parla en català";
    $("#mic-hint").classList.remove("live");
    renderCaptureChips();
  }

  function wireCapture() {
    renderCaptureChips();

    const micBtn = $("#mic-btn");
    const hint = $("#mic-hint");

    if (!window.PB_SPEECH.supported) {
      micBtn.disabled = true;
      hint.textContent = "El teu navegador no permet dictar (prova Chrome o Safari)";
    } else {
      micBtn.addEventListener("click", () => {
        if (state.micRecording) {
          state.micSession.stop();
          return;
        }
        const textarea = $("#idea-textarea");
        state.micSession = window.PB_SPEECH.createSession({
          onInterim: (text) => {
            hint.textContent = text;
            hint.classList.add("live");
          },
          onFinalChunk: (text) => {
            textarea.value = (textarea.value + " " + text).trim();
            hint.textContent = "Escoltant, torna a parlar quan vulguis";
          },
          onEnd: () => {
            state.micRecording = false;
            micBtn.classList.remove("recording");
            hint.classList.remove("live");
            hint.textContent = "Dicta en català";
          },
          onError: (err) => {
            state.micRecording = false;
            micBtn.classList.remove("recording");
            hint.textContent = "No t'he sentit bé, torna-ho a provar";
          },
        });
        state.micSession.start();
        state.micRecording = true;
        micBtn.classList.add("recording");
        hint.textContent = "Escoltant...";
      });
    }

    $("#save-idea-btn").addEventListener("click", saveNewIdea);
  }

  async function saveNewIdea() {
    const content = $("#idea-textarea").value.trim();
    if (!content) {
      toast("Escriu alguna cosa primer");
      return;
    }
    const btn = $("#save-idea-btn");
    btn.disabled = true;

    try {
      await window.PB_DB.createProject({
        title: autoTitle(content),
        content,
        category: state.captureCategory,
        location: state.captureLocation,
      });
      state.projects = await window.PB_DB.listProjects();
      toast("Idea desada");
      resetCaptureForm();
    } catch (err) {
      console.error(err);
      toast("No s'ha pogut desar la idea");
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------------------------------------------------------------------
   * Dashboard
   * ------------------------------------------------------------------- */

  let activeCategoryFilter = null;

  function renderCategoryFilterChips() {
    const wrap = $("#category-filter-chips");
    wrap.innerHTML = "";
    const used = [...new Set(state.projects.map((p) => p.category).filter(Boolean))];
    if (!used.length) return;
    used.forEach((name) => {
      const chip = document.createElement("button");
      chip.className = "chip";
      chip.textContent = name;
      chip.addEventListener("click", () => {
        activeCategoryFilter = activeCategoryFilter === name ? null : name;
        renderDashboard();
      });
      if (activeCategoryFilter === name) chip.classList.add("selected");
      wrap.appendChild(chip);
    });
  }

  function renderDashboard() {
    renderCategoryFilterChips();
    const grid = $("#project-grid");
    const empty = $("#dashboard-empty");
    const search = ($("#search-input").value || "").toLowerCase();
    const sortMode = $("#sort-select").value;

    let list = state.projects.slice();

    if (activeCategoryFilter) list = list.filter((p) => p.category === activeCategoryFilter);
    if (search) {
      list = list.filter(
        (p) =>
          (p.title || "").toLowerCase().includes(search) ||
          (p.content || "").toLowerCase().includes(search)
      );
    }

    if (sortMode === "priority") list.sort((a, b) => priorityScore(b) - priorityScore(a));
    else if (sortMode === "difficulty")
      list.sort((a, b) => (b.difficulty || 0) - (a.difficulty || 0));
    else if (sortMode === "pending")
      list.sort((a, b) => Number(a.questionnaire_done) - Number(b.questionnaire_done));
    else list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    $("#dash-count").textContent = `${state.projects.length} idea${state.projects.length === 1 ? "" : "s"}`;

    grid.innerHTML = "";
    empty.hidden = list.length > 0;

    list.forEach((p) => {
      const card = document.createElement("div");
      card.className = "project-card";
      const slot = window.PB_DB.categorySlot(state.categories, p.category);
      card.style.setProperty("--card-color", catColorVar(slot));

      const scores = p.questionnaire_done
        ? `<span>D${p.difficulty} · N${p.necessity} · G${p.desire}</span>`
        : `<span class="tag-pending">Per valorar</span>`;

      card.innerHTML = `
        <div class="card-top">
          ${p.category ? `<span class="tag"><span class="tag-dot"></span>${p.category}</span>` : "<span></span>"}
        </div>
        <h3 class="card-title">${escapeHtml(p.title)}</h3>
        <p class="card-excerpt">${escapeHtml(excerpt(p.content, 140))}</p>
        <div class="card-meta">
          <span>${formatRelative(p.created_at)}${p.location ? " · " + escapeHtml(p.location) : ""}</span>
          ${scores}
        </div>
      `;
      card.addEventListener("click", () => openDetail(p.id));
      grid.appendChild(card);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  /* ---------------------------------------------------------------------
   * Detall + qüestionari
   * ------------------------------------------------------------------- */

  function openDetail(id) {
    state.currentProjectId = id;
    const p = state.projects.find((x) => x.id === id);
    if (!p) return;

    $("#detail-title-input").value = p.title || "";
    $("#detail-content-input").value = p.content || "";
    $("#detail-created-at").textContent = formatDateTime(p.created_at);
    $("#detail-location-display").textContent = p.location || "Sense ubicació";

    $("#slider-difficulty").value = p.difficulty || 3;
    $("#slider-necessity").value = p.necessity || 3;
    $("#slider-desire").value = p.desire || 3;
    updateSliderValue("difficulty");
    updateSliderValue("necessity");
    updateSliderValue("desire");

    $("#needs-external-toggle").checked = !!p.needs_external;
    $("#external-detail-wrap").hidden = !p.needs_external;
    $("#external-detail-input").value = p.external_detail || "";

    renderDetailChips(p);
    showView("detail");
  }

  function renderDetailChips(p) {
    const catWrap = $("#detail-categories");
    catWrap.innerHTML = "";
    state.categories.forEach((c) => {
      const chip = document.createElement("button");
      chip.className = "chip";
      chip.textContent = c.name;
      if (p.category === c.name) chip.classList.add("selected");
      chip.addEventListener("click", () => {
        p.category = p.category === c.name ? null : c.name;
        renderDetailChips(p);
        scheduleAutosave();
      });
      catWrap.appendChild(chip);
    });
    const newCat = document.createElement("button");
    newCat.className = "chip";
    newCat.textContent = "+ Nova";
    newCat.addEventListener("click", async () => {
      const name = prompt("Nom de la categoria nova:");
      if (!name) return;
      await window.PB_DB.addCategory(name.trim());
      state.categories = await window.PB_DB.listCategories();
      p.category = name.trim();
      renderDetailChips(p);
      scheduleAutosave();
    });
    catWrap.appendChild(newCat);

    const locWrap = $("#detail-locations");
    locWrap.innerHTML = "";
    state.locations.forEach((name) => {
      const chip = document.createElement("button");
      chip.className = "chip";
      chip.textContent = name;
      if (p.location === name) chip.classList.add("selected");
      chip.addEventListener("click", () => {
        p.location = p.location === name ? null : name;
        $("#detail-location-display").textContent = p.location || "Sense ubicació";
        renderDetailChips(p);
        scheduleAutosave();
      });
      locWrap.appendChild(chip);
    });
    const newLoc = document.createElement("button");
    newLoc.className = "chip";
    newLoc.textContent = "+ Nova";
    newLoc.addEventListener("click", async () => {
      const name = prompt("Nom del lloc:");
      if (!name) return;
      await window.PB_DB.addLocation(name.trim());
      state.locations = await window.PB_DB.listLocations();
      p.location = name.trim();
      $("#detail-location-display").textContent = p.location;
      renderDetailChips(p);
      scheduleAutosave();
    });
    locWrap.appendChild(newLoc);
  }

  function updateSliderValue(key) {
    $(`#value-${key}`).textContent = $(`#slider-${key}`).value;
  }

  function scheduleAutosave() {
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = setTimeout(saveDetailChanges, 500);
  }

  async function saveDetailChanges() {
    const p = state.projects.find((x) => x.id === state.currentProjectId);
    if (!p) return;

    const difficulty = Number($("#slider-difficulty").value);
    const necessity = Number($("#slider-necessity").value);
    const desire = Number($("#slider-desire").value);

    const patch = {
      title: $("#detail-title-input").value.trim() || "Idea sense títol",
      content: $("#detail-content-input").value,
      category: p.category || null,
      location: p.location || null,
      difficulty,
      necessity,
      desire,
      needs_external: $("#needs-external-toggle").checked,
      external_detail: $("#external-detail-input").value,
      questionnaire_done: true,
    };

    try {
      const updated = await window.PB_DB.updateProject(p.id, patch);
      Object.assign(p, updated);
      const ind = $("#autosave-indicator");
      ind.classList.add("show");
      setTimeout(() => ind.classList.remove("show"), 1400);
    } catch (err) {
      console.error(err);
      toast("No s'ha pogut desar el canvi");
    }
  }

  function wireDetail() {
    ["difficulty", "necessity", "desire"].forEach((key) => {
      const slider = $(`#slider-${key}`);
      slider.addEventListener("input", () => {
        updateSliderValue(key);
        scheduleAutosave();
      });
    });

    $("#detail-title-input").addEventListener("input", scheduleAutosave);
    $("#detail-content-input").addEventListener("input", scheduleAutosave);

    $("#needs-external-toggle").addEventListener("change", (e) => {
      $("#external-detail-wrap").hidden = !e.target.checked;
      scheduleAutosave();
    });
    $("#external-detail-input").addEventListener("input", scheduleAutosave);

    $("#delete-project-btn").addEventListener("click", async () => {
      if (!confirm("Segur que vols eliminar aquest projecte? No es pot desfer.")) return;
      try {
        await window.PB_DB.deleteProject(state.currentProjectId);
        state.projects = state.projects.filter((p) => p.id !== state.currentProjectId);
        toast("Projecte eliminat");
        showView("dashboard");
      } catch (err) {
        console.error(err);
        toast("No s'ha pogut eliminar");
      }
    });
  }

  /* ---------------------------------------------------------------------
   * Estadístiques
   * ------------------------------------------------------------------- */

  function renderStats() {
    const empty = $("#stats-empty");
    if (!state.projects.length) {
      empty.hidden = false;
      $(".stats-grid").hidden = true;
      $("#stats-hero").innerHTML = "";
      return;
    }
    empty.hidden = true;
    $(".stats-grid").hidden = false;
    window.PB_CHARTS.renderAll(state.projects, state.categories);
  }

  async function loadData() {
    const [projects, categories, locations] = await Promise.all([
      window.PB_DB.listProjects(),
      window.PB_DB.listCategories(),
      window.PB_DB.listLocations(),
    ]);
    state.projects = projects;
    state.categories = categories;
    state.locations = locations;
  }

  async function enterApp() {
    $("#view-setup").hidden = true;
    $("#app").hidden = false;

    await loadData();
    renderCaptureChips();

    showView(isMobile() ? "capture" : "dashboard");
  }

  /* ---------------------------------------------------------------------
   * Arrencada
   * ------------------------------------------------------------------- */

  async function boot() {
    wireNav();
    wireCapture();
    wireDetail();

    $("#search-input").addEventListener("input", debounce(renderDashboard, 150));
    $("#sort-select").addEventListener("change", renderDashboard);

    if (!window.PB_READY) {
      $("#view-setup").hidden = false;
      $("#config-warning").innerHTML =
        "Encara no has connectat Supabase. Obre <code>js/config.js</code> i segueix el README per activar el desat d'idees.";
      return;
    }

    await enterApp();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
