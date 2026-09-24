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
    micStream: null,
    micAudioCtx: null,
    micMeterRAF: null,
    autosaveTimer: null,
    manualFormOpen: false,
    quickArmTimer: null,
    quickPointerId: undefined,
    quickRecording: false,
    quickPendingSave: false,
    quickStream: null,
    quickAudioCtx: null,
    quickWaveRAF: null,
    quickSpeechSession: null,
    quickTranscript: "",
    quickLocationPromise: null,
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

    if (name === "capture") {
      state.manualFormOpen = false;
      updateCaptureLayout();
    }
    if (name === "dashboard") renderDashboard();
    if (name === "stats") renderStats();
  }

  function updateCaptureLayout() {
    const quickAvailable = isMobile() && window.PB_SPEECH.supported;
    const showQuick = quickAvailable && !state.manualFormOpen;
    $("#quick-capture").hidden = !showQuick;
    $("#capture-card").hidden = showQuick;
    $("#capture-back-to-quick").hidden = !(quickAvailable && state.manualFormOpen);
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
            stopMicVoiceMeter();
          },
          onError: (err) => {
            state.micRecording = false;
            micBtn.classList.remove("recording");
            hint.textContent = "No t'he sentit bé, torna-ho a provar";
            stopMicVoiceMeter();
          },
        });
        state.micSession.start();
        state.micRecording = true;
        micBtn.classList.add("recording");
        hint.textContent = "Escoltant...";
        startMicVoiceMeter();
      });
    }

    $("#save-idea-btn").addEventListener("click", saveNewIdea);

    wireQuickCapture();
  }

  /* ---------------------------------------------------------------------
   * Mesurador de nivell de veu per al botó de dictat manual (desktop i
   * mòbil): un flux de micro a part només per animar el botó en temps
   * real, sense tocar el reconeixement de veu en si.
   * ------------------------------------------------------------------- */

  async function startMicVoiceMeter() {
    try {
      state.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return; // el dictat continua igual, només sense animació reactiva
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioCtx();
    const source = audioCtx.createMediaStreamSource(state.micStream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
      state.micMeterRAF = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = (dataArray[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / bufferLength);
      document.documentElement.style.setProperty("--mic-level", Math.min(1, rms * 5).toFixed(3));
    }
    draw();

    state.micAudioCtx = audioCtx;
  }

  function stopMicVoiceMeter() {
    if (state.micMeterRAF) cancelAnimationFrame(state.micMeterRAF);
    state.micMeterRAF = null;
    document.documentElement.style.setProperty("--mic-level", "0");

    if (state.micStream) {
      state.micStream.getTracks().forEach((t) => t.stop());
      state.micStream = null;
    }
    if (state.micAudioCtx) {
      state.micAudioCtx.close();
      state.micAudioCtx = null;
    }
  }

  /* ---------------------------------------------------------------------
   * Captura ràpida (mòbil): icona flotant → mantenir premut per gravar
   * ------------------------------------------------------------------- */

  const QUICK_ARM_DELAY_MS = 180; // temps que cal mantenir premut abans de començar a gravar de debò

  function wireQuickCapture() {
    const btn = $("#quick-record-btn");
    if (!btn || !window.PB_SPEECH.supported) return;

    btn.addEventListener("contextmenu", (e) => e.preventDefault());

    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (state.quickArmTimer || state.quickRecording) return;
      state.quickPointerId = e.pointerId;
      state.quickArmTimer = setTimeout(() => {
        state.quickArmTimer = null;
        startQuickRecording();
      }, QUICK_ARM_DELAY_MS);
    });

    ["pointerup", "pointercancel", "pointerleave"].forEach((evt) => {
      btn.addEventListener(evt, (e) => {
        if (state.quickPointerId !== undefined && e.pointerId !== state.quickPointerId) return;
        state.quickPointerId = undefined;

        if (state.quickArmTimer) {
          clearTimeout(state.quickArmTimer);
          state.quickArmTimer = null;
          flashQuickHint();
          return;
        }
        if (state.quickRecording) {
          stopQuickRecording(evt !== "pointercancel");
        }
      });
    });

    $("#quick-manual-link").addEventListener("click", () => {
      state.manualFormOpen = true;
      updateCaptureLayout();
    });

    $("#capture-back-to-quick").addEventListener("click", () => {
      state.manualFormOpen = false;
      updateCaptureLayout();
    });

    window.addEventListener("resize", debounce(updateCaptureLayout, 150));
  }

  function flashQuickHint() {
    const hint = $("#quick-record-hint");
    hint.textContent = "Mantén premut per gravar";
    hint.classList.remove("shake");
    void hint.offsetWidth; // reinicia l'animació si ja s'havia mostrat
    hint.classList.add("shake");
  }

  async function startQuickRecording() {
    const btn = $("#quick-record-btn");
    const hint = $("#quick-record-hint");

    state.quickTranscript = "";
    state.quickLocationPromise = lookupQuickLocation();

    try {
      state.quickStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      toast("Cal permís de micròfon per gravar");
      return;
    }

    state.quickRecording = true;
    btn.classList.add("recording");
    hint.textContent = "T'escolto... deixa anar per desar";
    startQuickWaveform(state.quickStream);

    state.quickSpeechSession = window.PB_SPEECH.createSession({
      onInterim: () => {},
      onFinalChunk: (text) => {
        state.quickTranscript = (state.quickTranscript + " " + text).trim();
      },
      onEnd: finishQuickSave,
      onError: () => {},
    });
    state.quickSpeechSession.start();
  }

  function stopQuickRecording(shouldSave) {
    const btn = $("#quick-record-btn");
    const hint = $("#quick-record-hint");

    state.quickRecording = false;
    btn.classList.remove("recording");
    stopQuickWaveform();

    if (state.quickStream) {
      state.quickStream.getTracks().forEach((t) => t.stop());
      state.quickStream = null;
    }

    if (!shouldSave) {
      state.quickPendingSave = false;
      if (state.quickSpeechSession) state.quickSpeechSession.stop();
      hint.textContent = "Mantén premut per gravar una idea";
      return;
    }

    state.quickPendingSave = true;
    btn.classList.add("saving");
    hint.textContent = "Desant...";
    if (state.quickSpeechSession) {
      state.quickSpeechSession.stop();
    } else {
      finishQuickSave();
    }
  }

  async function finishQuickSave() {
    if (!state.quickPendingSave) return;
    state.quickPendingSave = false;

    const btn = $("#quick-record-btn");
    const hint = $("#quick-record-hint");
    btn.classList.remove("saving");

    const content = state.quickTranscript.trim();
    if (!content) {
      hint.textContent = "No t'he sentit, torna-ho a provar";
      setTimeout(() => {
        hint.textContent = "Mantén premut per gravar una idea";
      }, 2200);
      return;
    }

    const locationName = await Promise.race([
      state.quickLocationPromise || Promise.resolve(null),
      new Promise((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);

    try {
      const created = await window.PB_DB.createProject({
        title: quickIdeaTitle(locationName),
        content,
        category: null,
        location: locationName,
      });
      state.projects.unshift(created);
      toast("Idea desada");
    } catch (err) {
      console.error(err);
      toast("No s'ha pogut desar la idea");
    } finally {
      hint.textContent = "Mantén premut per gravar una idea";
    }
  }

  function quickIdeaTitle(locationName) {
    const now = new Date();
    const datePart = now.toLocaleDateString("ca-ES", { day: "numeric", month: "short" });
    const timePart = now.toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit" });
    const when = `${datePart}, ${timePart}`;
    return locationName ? `${locationName} · ${when}` : when;
  }

  function lookupQuickLocation() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            resolve(await reverseGeocode(pos.coords.latitude, pos.coords.longitude));
          } catch {
            resolve(null);
          }
        },
        () => resolve(null),
        { timeout: 6000, maximumAge: 300000 }
      );
    });
  }

  async function reverseGeocode(lat, lon) {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=14&accept-language=ca`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("geocode failed");
    const data = await res.json();
    const a = data.address || {};
    return (
      a.suburb ||
      a.neighbourhood ||
      a.city_district ||
      a.town ||
      a.village ||
      a.city ||
      a.municipality ||
      a.county ||
      null
    );
  }

  function startQuickWaveform(stream) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioCtx();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const canvas = $("#quick-wave-canvas");
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = canvas.clientWidth || 132;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const waveColor =
      getComputedStyle(document.documentElement).getPropertyValue("--critical").trim() || "#d03b3b";

    function draw() {
      state.quickWaveRAF = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = (dataArray[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / bufferLength);
      document.documentElement.style.setProperty("--mic-level", Math.min(1, rms * 5).toFixed(3));

      ctx.clearRect(0, 0, size, size);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = waveColor;
      ctx.beginPath();
      const slice = size / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128;
        const y = (v * size) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += slice;
      }
      ctx.stroke();
    }
    draw();

    state.quickAudioCtx = audioCtx;
  }

  function stopQuickWaveform() {
    if (state.quickWaveRAF) cancelAnimationFrame(state.quickWaveRAF);
    state.quickWaveRAF = null;
    document.documentElement.style.setProperty("--mic-level", "0");

    const canvas = $("#quick-wave-canvas");
    if (canvas) canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);

    if (state.quickAudioCtx) {
      state.quickAudioCtx.close();
      state.quickAudioCtx = null;
    }
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
