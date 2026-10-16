// ProjectBuddy · controlador principal (routing, vistes, interaccions)
(function () {
  "use strict";

  const state = {
    projects: [], // les idees (la taula es diu "projects" per motius històrics)
    groups: [], // els projectes, que agrupen idees
    groupsAvailable: true, // fals si encara no s'ha executat el SQL nou
    categories: [],
    locations: [],
    currentView: null,
    currentProjectId: null,
    captureCategory: null,
    captureLocation: null,
    captureGroup: null,
    captureFromGroup: null,
    detailReturn: "dashboard",
    currentGroupId: null,
    groupAutosaveTimer: null,
    newGroupCategory: null,
    mapFocusId: null,
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
    quickInterim: "",
    quickSpeaking: false,
    quickSpeechPulse: 0,
    quickSpeechError: null,
    quickSpeechEnded: false,
    quickLocationPromise: null,
    quickOverCancel: false,
    quickMoveHandler: null,
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
    if (state.currentView !== name) state.previousView = state.currentView;
    state.currentView = name;
    $$(".view").forEach((v) => (v.hidden = v.id !== `view-${name}`));
    $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.nav === name));
    $$(".bottom-nav button").forEach((b) => b.classList.toggle("active", b.dataset.nav === name));
    document.body.classList.toggle("on-map", name === "map");
    window.scrollTo({ top: 0, behavior: "smooth" });

    if (name === "capture") {
      state.manualFormOpen = false;
      updateCaptureLayout();
    }
    if (name === "dashboard") renderDashboard();
    if (name === "stats") renderStats();
    if (name === "groups") renderGroups();
    if (name === "map") renderMap();
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
    $("#new-group-btn").addEventListener("click", openNewGroup);
    $("#capture-go-dashboard").addEventListener("click", () => showView("dashboard"));
    $("#detail-back-btn").addEventListener("click", () => {
      if (state.detailReturn === "group" && state.currentGroupId) openGroup(state.currentGroupId);
      else showView(state.detailReturn || "dashboard");
    });
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

    renderGroupChips($("#capture-groups"), state.captureGroup, (id) => {
      state.captureGroup = id;
      renderCaptureChips();
    });
  }

  // Xips per triar a quin projecte va una idea. `onSelect` rep l'id triat
  // (o null si es desmarca); "+ Nou projecte" en crea un i el selecciona.
  function renderGroupChips(wrap, selectedId, onSelect) {
    wrap.innerHTML = "";
    if (!state.groupsAvailable) {
      wrap.innerHTML = `<span class="mic-hint">Actualitza la base de dades (sql/schema.sql) per fer servir projectes</span>`;
      return;
    }
    state.groups.forEach((g) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip chip-group";
      chip.textContent = g.title || "Projecte sense títol";
      if (selectedId === g.id) chip.classList.add("selected");
      chip.addEventListener("click", () => onSelect(selectedId === g.id ? null : g.id));
      wrap.appendChild(chip);
    });
    const newGroup = document.createElement("button");
    newGroup.type = "button";
    newGroup.className = "chip";
    newGroup.textContent = "+ Nou projecte";
    newGroup.addEventListener("click", async () => {
      const name = prompt("Nom del projecte nou:");
      if (!name || !name.trim()) return;
      try {
        const created = await window.PB_DB.createGroup({ title: name.trim() });
        state.groups.unshift(created);
        onSelect(created.id);
      } catch (err) {
        console.error(err);
        toast("No s'ha pogut crear el projecte");
      }
    });
    wrap.appendChild(newGroup);
  }

  function resetCaptureForm() {
    $("#idea-textarea").value = "";
    state.captureCategory = null;
    state.captureLocation = null;
    state.captureGroup = null;
    state.captureFromGroup = null;
    $("#mic-hint").textContent = "Prem el micro i parla en català";
    $("#mic-hint").classList.remove("live");
    renderCaptureChips();
  }

  function wireCapture() {
    renderCaptureChips();

    wireDictation($("#mic-btn"), $("#mic-hint"), $("#idea-textarea"));

    $("#save-idea-btn").addEventListener("click", saveNewIdea);

    wireQuickCapture();
  }

  // Botó de micro que dicta dins d'un textarea (formulari d'idea i de projecte)
  function wireDictation(micBtn, hint, textarea) {
    const idleText = "Dicta en català";
    if (!window.PB_SPEECH.supported) {
      micBtn.disabled = true;
      hint.textContent = "El teu navegador no permet dictar (prova Chrome o Safari)";
      return;
    }
    micBtn.addEventListener("click", () => {
      if (state.micRecording) {
        state.micSession.stop();
        return;
      }
      state.micSession = window.PB_SPEECH.createSession({
        onInterim: (text) => {
          if (!text) return;
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
          hint.textContent = idleText;
          stopMicVoiceMeter();
        },
        onError: () => {
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

    // (Nomes "pointerup"/"pointercancel": amb "pointerleave" el ratolí
    // interpreta arrossegar cap al botó de cancel·lar com una sortida i
    // aturava la gravació abans d'hora; al tàctil no calia perquè el
    // navegador ja manté el punter "capturat" al botó mentre el dit hi és.)
    ["pointerup", "pointercancel"].forEach((evt) => {
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
          stopQuickRecording(evt !== "pointercancel" && !state.quickOverCancel);
        }
      });
    });

    // Al ratolí (sense captura implícita de punter) deixar anar sobre el
    // botó de cancel·lar dispara l'event aquí en lloc del botó de gravar.
    $("#quick-cancel-btn").addEventListener("pointerup", (e) => {
      e.preventDefault();
      if (state.quickRecording) stopQuickRecording(false);
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
    state.quickInterim = "";
    state.quickSpeechError = null;
    state.quickSpeechEnded = false;
    state.quickLocationPromise = lookupQuickLocation();

    // Només el reconeixement de veu fa servir el micro: si a més obrim un
    // getUserMedia per a l'ona, en molts mòbils el reconeixement es queda
    // sense àudio. L'ona es mou amb els events de veu del reconeixement.
    state.quickSpeaking = false;
    state.quickSpeechSession = window.PB_SPEECH.createSession({
      onInterim: (text) => {
        state.quickInterim = text;
        state.quickSpeechPulse = 1;
      },
      onFinalChunk: (text) => {
        state.quickTranscript = (state.quickTranscript + " " + text).trim();
        state.quickInterim = "";
        state.quickSpeechPulse = 1;
      },
      onEnd: onQuickSpeechEnd,
      onError: (err) => {
        state.quickSpeechError = err;
      },
      onSpeechStart: () => {
        state.quickSpeaking = true;
      },
      onSpeechEnd: () => {
        state.quickSpeaking = false;
      },
    });
    try {
      state.quickSpeechSession.start();
    } catch (err) {
      console.error(err);
    }

    state.quickRecording = true;
    state.quickOverCancel = false;
    btn.classList.add("recording");
    $("#quick-capture").classList.add("is-recording");
    hint.textContent = "T'escolto... deixa anar per desar";
    startQuickWaveform();

    state.quickMoveHandler = updateQuickCancelHover;
    window.addEventListener("pointermove", state.quickMoveHandler);
  }

  // Errors després dels quals no té sentit tornar a engegar el reconeixement
  const FATAL_SPEECH_ERRORS = ["not-allowed", "service-not-allowed", "audio-capture", "network", "language-not-supported"];

  function onQuickSpeechEnd() {
    // El mòbil sovint talla el reconeixement sol després d'una pausa: si
    // encara tens el botó premut, el tornem a engegar i no es perd res.
    if (state.quickRecording && !FATAL_SPEECH_ERRORS.includes(state.quickSpeechError)) {
      state.quickTranscript = (state.quickTranscript + " " + state.quickInterim).trim();
      state.quickInterim = "";
      state.quickSpeechError = null;
      try {
        state.quickSpeechSession.start();
        return;
      } catch (err) {
        console.error(err);
      }
    }
    state.quickSpeechEnded = true;
    finishQuickSave();
  }

  function quickSpeechErrorText(err) {
    if (err === "not-allowed" || err === "service-not-allowed")
      return "El navegador no deixa fer servir el dictat (revisa els permisos)";
    if (err === "network") return "El dictat necessita connexió a internet";
    if (err === "audio-capture") return "El dictat no pot accedir al micròfon";
    if (err === "language-not-supported") return "El dictat en català no està disponible en aquest navegador";
    return "No t'he sentit, torna-ho a provar" + (err ? ` (${err})` : "");
  }

  function updateQuickCancelHover(e) {
    const cancelBtn = $("#quick-cancel-btn");
    const rect = cancelBtn.getBoundingClientRect();
    const over =
      e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    state.quickOverCancel = over;
    cancelBtn.classList.toggle("hover-target", over);
  }

  function stopQuickRecording(shouldSave) {
    const btn = $("#quick-record-btn");
    const hint = $("#quick-record-hint");
    const cancelBtn = $("#quick-cancel-btn");

    state.quickRecording = false;
    btn.classList.remove("recording");
    $("#quick-capture").classList.remove("is-recording");
    cancelBtn.classList.remove("hover-target");
    state.quickOverCancel = false;
    if (state.quickMoveHandler) {
      window.removeEventListener("pointermove", state.quickMoveHandler);
      state.quickMoveHandler = null;
    }
    stopQuickWaveform();

    if (state.quickStream) {
      state.quickStream.getTracks().forEach((t) => t.stop());
      state.quickStream = null;
    }

    if (!shouldSave) {
      state.quickPendingSave = false;
      if (state.quickSpeechSession) state.quickSpeechSession.stop();
      hint.textContent = "Gravació cancel·lada";
      setTimeout(() => {
        hint.textContent = "Mantén premut per gravar una idea";
      }, 1500);
      return;
    }

    state.quickPendingSave = true;
    btn.classList.add("saving");
    hint.textContent = "Desant...";
    if (state.quickSpeechSession && !state.quickSpeechEnded) {
      state.quickSpeechSession.stop();
      // Si el navegador no arriba a avisar del final, desa igualment
      setTimeout(finishQuickSave, 2500);
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

    const content = (state.quickTranscript + " " + state.quickInterim).trim();
    if (!content) {
      hint.textContent = quickSpeechErrorText(state.quickSpeechError);
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
      openDetail(created.id);
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

  // Ona "sintètica": no llegeix el micro (el té el reconeixement de veu),
  // sinó que s'anima amb els events de veu: puja quan detecta que parles i
  // fa un pic a cada tros de text reconegut.
  function startQuickWaveform() {
    const canvas = $("#quick-wave-canvas");
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = canvas.clientWidth || 132;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const waveColor =
      getComputedStyle(document.documentElement).getPropertyValue("--critical").trim() || "#d03b3b";

    let level = 0;
    state.quickSpeechPulse = 0;
    const t0 = performance.now();

    function draw(now) {
      state.quickWaveRAF = requestAnimationFrame(draw);
      const t = ((now || t0) - t0) / 1000;

      const target = Math.max(state.quickSpeaking ? 0.55 : 0.08, state.quickSpeechPulse);
      level += (target - level) * 0.12;
      state.quickSpeechPulse *= 0.92;
      document.documentElement.style.setProperty("--mic-level", level.toFixed(3));

      ctx.clearRect(0, 0, size, size);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = waveColor;
      ctx.beginPath();
      const amp = (size / 2) * 0.6 * level;
      const steps = 64;
      for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * size;
        const env = Math.sin((i / steps) * Math.PI); // s'apaga als extrems
        const y =
          size / 2 +
          env * amp * (Math.sin(i * 0.45 + t * 9) * 0.6 + Math.sin(i * 0.17 - t * 5) * 0.4);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    draw();
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
      const idea = {
        title: autoTitle(content),
        content,
        category: state.captureCategory,
        location: state.captureLocation,
      };
      if (state.captureGroup) idea.group_id = state.captureGroup;
      await window.PB_DB.createProject(idea);
      state.projects = await window.PB_DB.listProjects();
      toast("Idea desada");
      const backToGroup = state.captureFromGroup;
      resetCaptureForm();
      if (backToGroup) openGroup(backToGroup);
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

      const status = window.PB_DB.STATUSES.find((s) => s.value === (p.status || "idea")) || window.PB_DB.STATUSES[0];

      card.innerHTML = `
        <div class="card-top">
          ${p.category ? `<span class="tag"><span class="tag-dot"></span>${p.category}</span>` : "<span></span>"}
          <span class="status-badge status-${status.value}">${status.label}</span>
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

  function openDetail(id, returnView) {
    state.detailReturn = returnView || "dashboard";
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
    renderDetailStatusChips(p);
    renderDetailGroups(p);
    showView("detail");
  }

  function renderDetailGroups(p) {
    renderGroupChips($("#detail-groups"), p.group_id || null, (id) => linkIdea(p, id, () => renderDetailGroups(p)));
  }

  // Enllaça (o desenllaça, amb null) una idea a un projecte i ho desa de seguida
  async function linkIdea(p, groupId, after) {
    const previous = p.group_id || null;
    p.group_id = groupId;
    if (after) after();
    try {
      await window.PB_DB.updateProject(p.id, { group_id: groupId });
      const g = state.groups.find((x) => x.id === groupId);
      toast(groupId ? `Enllaçada a «${g ? g.title : "projecte"}»` : "Idea desenllaçada");
    } catch (err) {
      console.error(err);
      p.group_id = previous;
      if (after) after();
      toast("No s'ha pogut enllaçar la idea");
    }
  }

  function renderDetailStatusChips(p) {
    const wrap = $("#detail-status");
    wrap.innerHTML = "";
    const current = p.status || "idea";
    window.PB_DB.STATUSES.forEach((s) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip status-" + s.value;
      chip.textContent = s.label;
      if (current === s.value) chip.classList.add("selected");
      chip.addEventListener("click", () => {
        p.status = s.value;
        renderDetailStatusChips(p);
        scheduleAutosave();
      });
      wrap.appendChild(chip);
    });
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
      status: p.status || "idea",
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
      if (!confirm("Segur que vols eliminar aquesta idea? No es pot desfer.")) return;
      try {
        await window.PB_DB.deleteProject(state.currentProjectId);
        state.projects = state.projects.filter((p) => p.id !== state.currentProjectId);
        toast("Idea eliminada");
        showView("dashboard");
      } catch (err) {
        console.error(err);
        toast("No s'ha pogut eliminar");
      }
    });
  }

  /* ---------------------------------------------------------------------
   * Projectes (agrupen idees)
   * ------------------------------------------------------------------- */

  function groupTitle(content) {
    const t = autoTitle(content);
    return t === "Idea sense títol" ? "Projecte sense títol" : t;
  }

  function ideasOfGroup(groupId) {
    return state.projects
      .filter((p) => p.group_id === groupId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  function statusOf(p) {
    return window.PB_DB.STATUSES.find((s) => s.value === (p.status || "idea")) || window.PB_DB.STATUSES[0];
  }

  function openNewGroup() {
    if (!state.groupsAvailable) {
      toast("Per crear projectes, primer executa sql/schema.sql al SQL Editor de Supabase");
      return;
    }
    $("#group-textarea").value = "";
    state.newGroupCategory = null;
    renderNewGroupCategories();
    showView("group-new");
    if (!isMobile()) $("#group-textarea").focus();
  }

  function renderNewGroupCategories() {
    const wrap = $("#group-new-categories");
    wrap.innerHTML = "";
    state.categories.forEach((c) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = c.name;
      if (state.newGroupCategory === c.name) chip.classList.add("selected");
      chip.addEventListener("click", () => {
        state.newGroupCategory = state.newGroupCategory === c.name ? null : c.name;
        renderNewGroupCategories();
      });
      wrap.appendChild(chip);
    });
  }

  async function saveNewGroup() {
    const content = $("#group-textarea").value.trim();
    if (!content) {
      toast("Explica de què va el projecte");
      return;
    }
    const btn = $("#save-group-btn");
    btn.disabled = true;
    try {
      const created = await window.PB_DB.createGroup({
        title: groupTitle(content),
        content,
        category: state.newGroupCategory,
      });
      state.groups.unshift(created);
      toast("Projecte creat");
      openGroup(created.id, "groups");
    } catch (err) {
      console.error(err);
      toast("No s'ha pogut crear el projecte");
    } finally {
      btn.disabled = false;
    }
  }

  function renderGroups() {
    const grid = $("#group-grid");
    const empty = $("#groups-empty");
    const n = state.groups.length;
    $("#groups-count").textContent = `${n} projecte${n === 1 ? "" : "s"}`;
    grid.innerHTML = "";
    empty.hidden = n > 0;
    if (!state.groupsAvailable) {
      empty.hidden = false;
      empty.textContent =
        "Per fer servir projectes, executa un altre cop sql/schema.sql al SQL Editor de Supabase.";
      return;
    }

    state.groups.forEach((g) => {
      const count = ideasOfGroup(g.id).length;
      const card = document.createElement("div");
      card.className = "project-card";
      card.style.setProperty("--card-color", catColorVar(groupSlot(g)));
      card.innerHTML = `
        <div class="card-top">
          ${g.category ? `<span class="tag"><span class="tag-dot"></span>${escapeHtml(g.category)}</span>` : "<span></span>"}
          <span class="card-count">${count} idea${count === 1 ? "" : "s"}</span>
        </div>
        <h3 class="card-title">${escapeHtml(g.title)}</h3>
        <p class="card-excerpt">${escapeHtml(excerpt(g.content, 140))}</p>
        <div class="card-meta"><span>${formatRelative(g.created_at)}</span></div>
      `;
      card.addEventListener("click", () => openGroup(g.id, "groups"));
      grid.appendChild(card);
    });
  }

  // Sense categoria, cada projecte agafa igualment un color estable
  function groupSlot(g) {
    if (g.category) return window.PB_DB.categorySlot(state.categories, g.category);
    return (hashString(g.id) % 8) + 1;
  }

  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function openGroup(id, returnView) {
    const g = state.groups.find((x) => x.id === id);
    if (!g) return;
    state.currentGroupId = id;
    if (returnView) state.groupReturn = returnView;

    $("#group-title-input").value = g.title || "";
    $("#group-content-input").value = g.content || "";
    $("#group-created-at").textContent = "Creat el " + formatDateTime(g.created_at);
    renderGroupCategories(g);
    renderGroupIdeas(g);
    showView("group");
  }

  function renderGroupCategories(g) {
    const wrap = $("#group-categories");
    wrap.innerHTML = "";
    state.categories.forEach((c) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = c.name;
      if (g.category === c.name) chip.classList.add("selected");
      chip.addEventListener("click", () => {
        g.category = g.category === c.name ? null : c.name;
        renderGroupCategories(g);
        scheduleGroupAutosave();
      });
      wrap.appendChild(chip);
    });
  }

  function renderGroupIdeas(g) {
    const list = $("#group-ideas");
    const ideas = ideasOfGroup(g.id);
    list.innerHTML = "";
    $("#group-ideas-empty").hidden = ideas.length > 0;
    $("#group-ideas-count").textContent = ideas.length ? `· ${ideas.length}` : "";

    ideas.forEach((p) => {
      const row = document.createElement("div");
      row.className = "group-idea";
      row.style.setProperty("--card-color", catColorVar(window.PB_DB.categorySlot(state.categories, p.category)));
      row.innerHTML = `
        <div class="group-idea-main">
          <div class="group-idea-title">${escapeHtml(p.title)}</div>
          <div class="group-idea-meta">${statusOf(p).label} · ${formatRelative(p.created_at)}</div>
        </div>
        <button type="button" class="group-idea-unlink" title="Desenllaça del projecte" aria-label="Desenllaça del projecte">✕</button>
      `;
      row.addEventListener("click", () => openDetail(p.id, "group"));
      $(".group-idea-unlink", row).addEventListener("click", (e) => {
        e.stopPropagation();
        linkIdea(p, null, () => renderGroupIdeas(g));
      });
      list.appendChild(row);
    });

    // Desplegable per enllaçar idees que ja existeixen
    const select = $("#group-add-idea");
    const others = state.projects.filter((p) => p.group_id !== g.id);
    select.innerHTML = "";
    const first = document.createElement("option");
    first.value = "";
    first.textContent = others.length ? "+ Enllaça una idea que ja tens…" : "No hi ha més idees per enllaçar";
    select.appendChild(first);
    select.disabled = !others.length;
    others.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      const inOther = p.group_id && state.groups.find((x) => x.id === p.group_id);
      opt.textContent = excerpt(p.title, 60) + (inOther ? ` (ara a «${excerpt(inOther.title, 24)}»)` : "");
      select.appendChild(opt);
    });
  }

  function scheduleGroupAutosave() {
    clearTimeout(state.groupAutosaveTimer);
    state.groupAutosaveTimer = setTimeout(saveGroupChanges, 500);
  }

  async function saveGroupChanges() {
    const g = state.groups.find((x) => x.id === state.currentGroupId);
    if (!g) return;
    try {
      const updated = await window.PB_DB.updateGroup(g.id, {
        title: $("#group-title-input").value.trim() || "Projecte sense títol",
        content: $("#group-content-input").value,
        category: g.category || null,
      });
      Object.assign(g, updated);
      const ind = $("#group-autosave-indicator");
      ind.classList.add("show");
      setTimeout(() => ind.classList.remove("show"), 1400);
    } catch (err) {
      console.error(err);
      toast("No s'ha pogut desar el canvi");
    }
  }

  function wireGroups() {
    wireDictation($("#group-mic-btn"), $("#group-mic-hint"), $("#group-textarea"));
    $("#save-group-btn").addEventListener("click", saveNewGroup);
    $("#group-new-cancel").addEventListener("click", () => {
      const prev = state.previousView;
      showView(["capture", "dashboard", "groups", "map", "stats"].includes(prev) ? prev : "groups");
    });

    $("#group-back-btn").addEventListener("click", () => showView(state.groupReturn || "groups"));
    $("#group-title-input").addEventListener("input", scheduleGroupAutosave);
    $("#group-content-input").addEventListener("input", scheduleGroupAutosave);

    $("#group-add-idea").addEventListener("change", (e) => {
      const g = state.groups.find((x) => x.id === state.currentGroupId);
      const p = state.projects.find((x) => x.id === e.target.value);
      if (!g || !p) return;
      linkIdea(p, g.id, () => renderGroupIdeas(g));
    });

    $("#group-new-idea-btn").addEventListener("click", () => {
      const groupId = state.currentGroupId;
      resetCaptureForm();
      showView("capture");
      state.manualFormOpen = true; // el formulari, no la gravació ràpida
      updateCaptureLayout();
      state.captureGroup = groupId;
      state.captureFromGroup = groupId;
      renderCaptureChips();
    });

    $("#delete-group-btn").addEventListener("click", async () => {
      const id = state.currentGroupId;
      if (!confirm("Segur que vols eliminar aquest projecte? Les idees es queden, només es desenllacen.")) return;
      try {
        await window.PB_DB.deleteGroup(id);
        state.groups = state.groups.filter((g) => g.id !== id);
        state.projects.forEach((p) => {
          if (p.group_id === id) p.group_id = null;
        });
        if (state.mapFocusId === id) state.mapFocusId = null;
        toast("Projecte eliminat");
        showView("groups");
      } catch (err) {
        console.error(err);
        toast("No s'ha pogut eliminar");
      }
    });

    // Mapa mental
    $("#map-back-btn").addEventListener("click", unfocusMap);
    $("#map-open-btn").addEventListener("click", () => {
      if (state.mapFocusId) openGroup(state.mapFocusId, "map");
    });
    $("#map-stage").addEventListener("click", (e) => {
      if (e.target.id === "map-stage" || e.target.id === "map-links") unfocusMap();
    });
    window.addEventListener(
      "resize",
      debounce(() => {
        if (state.currentView === "map") renderMap();
      }, 200)
    );
  }

  /* ---------------------------------------------------------------------
   * Mapa mental: cada projecte és una bombolla que sura; en tocar-ne una,
   * les seves idees surten al voltant com un diagrama
   * ------------------------------------------------------------------- */

  const MAP_BAR_SPACE = 70; // espai de baix per als botons del mapa
  const MAP_TOP_SPACE = 56; // espai de dalt pel botó «Crear projecte nou»

  function mapSize() {
    const stage = $("#map-stage");
    return { W: stage.clientWidth, H: stage.clientHeight };
  }

  function renderMap() {
    const stage = $("#map-stage");
    const svg = $("#map-links");
    $$(".map-bubble, .map-idea", stage).forEach((el) => el.remove());
    svg.innerHTML = "";
    stage.classList.remove("is-focused");

    const empty = $("#map-empty");
    const groups = state.groups;
    empty.hidden = groups.length > 0 && state.groupsAvailable;
    if (!state.groupsAvailable) {
      empty.innerHTML = "Per fer servir el mapa, executa un altre cop<br />sql/schema.sql al SQL Editor de Supabase.";
    }
    resetMapBar();
    if (!groups.length || !state.groupsAvailable) return;

    const { W, H } = mapSize();
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

    // Mida: totes comparteixen l'espai; les que tenen més idees, més grans
    const counts = groups.map((g) => ideasOfGroup(g.id).length);
    const maxCount = Math.max(1, ...counts);
    const usable = W * (H - MAP_BAR_SPACE - MAP_TOP_SPACE);
    const base = Math.max(70, Math.min(170, Math.sqrt((usable * 0.32) / groups.length)));
    const sizes = counts.map((c) => Math.min(base * (0.8 + 0.45 * (c / maxCount)), Math.min(W, H) * 0.42));
    const positions = layoutBubbles(sizes, W, H);

    groups.forEach((g, i) => {
      const size = sizes[i];
      const { x, y } = positions[i];
      const h = hashString(g.id);
      const rnd = (k) => ((h >>> (k * 4)) & 0xff) / 255; // 0..1 estable per bombolla
      const drift = (k) => `${((rnd(k) - 0.5) * 18).toFixed(1)}px`;

      const el = document.createElement("button");
      el.type = "button";
      el.className = "map-bubble";
      el.dataset.id = g.id;
      el._home = { x, y, size };
      placeBubble(el, x, y, size);
      el.style.setProperty("--bubble-color", catColorVar(groupSlot(g)));
      el.style.setProperty("--bubble-font", `${Math.max(11, Math.min(17, size / 9)).toFixed(1)}px`);
      el.style.setProperty("--float-dur", `${(6 + rnd(0) * 5).toFixed(2)}s`);
      el.style.setProperty("--float-delay", `${(-rnd(1) * 8).toFixed(2)}s`);
      ["dx1", "dy1", "dx2", "dy2", "dx3", "dy3"].forEach((v, k) => el.style.setProperty(`--${v}`, drift(k + 2)));

      const count = counts[i];
      el.innerHTML = `
        <span class="map-bubble-float">
          <span class="map-bubble-title">${escapeHtml(g.title || "Projecte sense títol")}</span>
          <span class="map-bubble-count">${count} idea${count === 1 ? "" : "s"}</span>
        </span>`;
      el.setAttribute("aria-label", `${g.title}: ${count} idees`);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (state.mapFocusId === g.id) openGroup(g.id, "map");
        else focusMap(g.id);
      });
      stage.appendChild(el);
    });

    if (state.mapFocusId && groups.some((g) => g.id === state.mapFocusId)) focusMap(state.mapFocusId);
    else state.mapFocusId = null;
  }

  function placeBubble(el, x, y, size) {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
  }

  // Posicions inicials en espiral i després unes quantes passades que
  // separen les bombolles que es trepitgen i les mantenen dins la pantalla
  function layoutBubbles(sizes, W, H) {
    const top = MAP_TOP_SPACE;
    const bottom = H - MAP_BAR_SPACE;
    const cx = W / 2;
    const cy = (top + bottom) / 2;
    const rx = W / 2 - 40;
    const ry = (bottom - top) / 2 - 20;
    const n = sizes.length;
    const pts = sizes.map((s, i) => {
      const r = n === 1 ? 0 : Math.sqrt((i + 0.5) / n) * 0.75;
      const a = i * 2.39996;
      return { x: cx + Math.cos(a) * r * rx, y: cy + Math.sin(a) * r * ry, r: s / 2 };
    });

    const gap = 14;
    for (let iter = 0; iter < 300; iter++) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = pts[i];
          const b = pts[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d = Math.hypot(dx, dy);
          const min = a.r + b.r + gap;
          if (d >= min) continue;
          if (d < 0.01) {
            dx = 1;
            dy = 0;
            d = 1;
          }
          const push = (min - d) / 2;
          a.x -= (dx / d) * push;
          a.y -= (dy / d) * push;
          b.x += (dx / d) * push;
          b.y += (dy / d) * push;
        }
      }
      pts.forEach((p) => {
        p.x += (cx - p.x) * 0.005;
        p.y += (cy - p.y) * 0.005;
        p.x = Math.min(Math.max(p.x, p.r + 8), W - p.r - 8);
        p.y = Math.min(Math.max(p.y, top + p.r), bottom - p.r);
      });
    }
    return pts;
  }

  function resetMapBar() {
    $("#map-back-btn").hidden = true;
    $("#map-open-btn").hidden = true;
    $("#map-hint").hidden = false;
    $("#map-hint").textContent = "Toca una bombolla per veure'n les idees";
  }

  function focusMap(groupId) {
    const stage = $("#map-stage");
    const svg = $("#map-links");
    const g = state.groups.find((x) => x.id === groupId);
    if (!g) return;
    state.mapFocusId = groupId;
    $$(".map-idea", stage).forEach((el) => el.remove());
    svg.innerHTML = "";
    stage.classList.add("is-focused");

    const { W, H } = mapSize();
    const cx = W / 2;
    const cy = (MAP_TOP_SPACE + H - MAP_BAR_SPACE) / 2;
    const ideas = ideasOfGroup(groupId);
    const color = catColorVar(groupSlot(g));

    // Torna cada bombolla al seu lloc i porta la triada al centre
    let focusSize = 120;
    $$(".map-bubble", stage).forEach((el) => {
      const home = el._home;
      if (el.dataset.id === groupId) {
        focusSize = Math.min(Math.max(home.size, 110), Math.min(W, H) * 0.3);
        el.classList.add("is-focus");
        placeBubble(el, cx, cy, focusSize);
      } else {
        el.classList.remove("is-focus");
        placeBubble(el, home.x, home.y, home.size);
      }
    });

    // Les idees en una el·lipse al voltant (dos anells si n'hi ha moltes)
    const rx = Math.max(focusSize / 2 + 70, W / 2 - 90);
    const ry = Math.max(focusSize / 2 + 50, (H - MAP_BAR_SPACE - MAP_TOP_SPACE) / 2 - 26);
    const twoRings = ideas.length > 10;
    const nodes = ideas.length ? ideas : [null];

    nodes.forEach((p, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / nodes.length;
      const k = twoRings && i % 2 ? 0.66 : 1;
      const x = cx + Math.cos(a) * rx * k;
      const y = p ? cy + Math.sin(a) * ry * k : cy + focusSize / 2 + 60;

      const node = document.createElement("button");
      node.type = "button";
      node.className = "map-idea" + (p ? "" : " is-empty");
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      node.style.setProperty("--delay", `${(0.3 + i * 0.05).toFixed(2)}s`);
      if (p) {
        node.textContent = excerpt(p.title, 34);
        node.title = p.title;
        node.style.setProperty("--idea-color", `var(--${statusOf(p).color})`);
        node.addEventListener("click", (e) => {
          e.stopPropagation();
          openDetail(p.id, "map");
        });
      } else {
        node.textContent = "Encara no hi ha idees enllaçades";
      }
      stage.appendChild(node);

      if (!p) return;
      // Línia des de la vora de la bombolla fins a la idea
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy) || 1;
      const x1 = cx + (dx / d) * (focusSize / 2);
      const y1 = cy + (dy / d) * (focusSize / 2);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", x1);
      line.setAttribute("y1", y1);
      line.setAttribute("x2", x);
      line.setAttribute("y2", y);
      line.style.setProperty("--len", `${Math.hypot(x - x1, y - y1).toFixed(1)}`);
      line.style.setProperty("--line-color", `color-mix(in srgb, ${color} 60%, transparent)`);
      line.style.animationDelay = `${(0.15 + i * 0.05).toFixed(2)}s`;
      svg.appendChild(line);
    });

    $("#map-back-btn").hidden = false;
    $("#map-open-btn").hidden = false;
    $("#map-hint").hidden = true;
  }

  function unfocusMap() {
    if (!state.mapFocusId) return;
    state.mapFocusId = null;
    const stage = $("#map-stage");
    $$(".map-idea", stage).forEach((el) => el.remove());
    $("#map-links").innerHTML = "";
    stage.classList.remove("is-focused");
    $$(".map-bubble", stage).forEach((el) => {
      el.classList.remove("is-focus");
      placeBubble(el, el._home.x, el._home.y, el._home.size);
    });
    resetMapBar();
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

    // Si la base de dades encara no té la taula de projectes, la resta de
    // l'app ha de continuar funcionant igual
    try {
      state.groups = await window.PB_DB.listGroups();
      state.groupsAvailable = true;
    } catch (err) {
      console.error(err);
      state.groups = [];
      state.groupsAvailable = false;
    }
  }

  async function enterApp(user) {
    $("#view-setup").hidden = true;
    $("#view-auth").hidden = true;
    $("#app").hidden = false;
    $("#user-chip").textContent =
      (user.user_metadata && user.user_metadata.name) || user.email;

    await loadData();
    renderCaptureChips();

    showView(isMobile() ? "capture" : "dashboard");
  }

  /* ---------------------------------------------------------------------
   * Accés (login / registre)
   * ------------------------------------------------------------------- */

  let authMode = "login";

  function showAuth() {
    state.projects = [];
    state.groups = [];
    state.categories = [];
    state.locations = [];
    state.mapFocusId = null;
    $("#app").hidden = true;
    $("#view-auth").hidden = false;
    $("#auth-password").value = "";
    setAuthMessage("");
  }

  function setAuthMode(mode) {
    authMode = mode;
    const signup = mode === "signup";
    $$(".auth-tab").forEach((t) => t.classList.toggle("active", t.dataset.authMode === mode));
    $("#auth-name-field").hidden = !signup;
    $("#auth-sub").textContent = signup
      ? "Crea un compte per començar a desar idees."
      : "Entra per veure les teves idees.";
    $("#auth-submit").textContent = signup ? "Crea el compte" : "Entra";
    $("#auth-password").autocomplete = signup ? "new-password" : "current-password";
    setAuthMessage("");
  }

  function setAuthMessage(msg, isInfo) {
    const el = $("#auth-error");
    el.textContent = msg;
    el.hidden = !msg;
    el.classList.toggle("info", !!isInfo);
  }

  function authErrorText(error) {
    const code = error.code || "";
    if (code === "invalid_credentials") return "Correu o contrasenya incorrectes.";
    if (code === "user_already_exists") return "Ja hi ha un compte amb aquest correu. Prova d'entrar.";
    if (code === "email_not_confirmed") return "Encara has de confirmar el correu (mira la safata d'entrada).";
    if (code === "weak_password") return "La contrasenya és massa feble (mínim 6 caràcters).";
    return error.message || "No s'ha pogut completar. Torna-ho a provar.";
  }

  async function submitAuth(e) {
    e.preventDefault();
    const email = $("#auth-email").value.trim();
    const password = $("#auth-password").value;
    if (!email || !password) {
      setAuthMessage("Omple el correu i la contrasenya.");
      return;
    }

    const btn = $("#auth-submit");
    btn.disabled = true;
    setAuthMessage("");
    try {
      if (authMode === "signup") {
        const name = $("#auth-name").value.trim();
        const { data, error } = await window.sb.auth.signUp({
          email,
          password,
          options: { data: name ? { name } : {} },
        });
        if (error) throw error;
        if (!data.session) {
          setAuthMode("login");
          setAuthMessage("Compte creat. Confirma'l des del correu que t'hem enviat i després entra.", true);
        }
      } else {
        const { error } = await window.sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setAuthMessage(authErrorText(err));
    } finally {
      btn.disabled = false;
    }
  }

  async function logout() {
    await window.sb.auth.signOut();
  }

  function wireAuth() {
    $$(".auth-tab").forEach((t) =>
      t.addEventListener("click", () => setAuthMode(t.dataset.authMode))
    );
    $("#auth-form").addEventListener("submit", submitAuth);
    $("#logout-btn").addEventListener("click", logout);
    $("#logout-btn-mobile").addEventListener("click", logout);
  }

  /* ---------------------------------------------------------------------
   * Arrencada
   * ------------------------------------------------------------------- */

  // GitHub Pages deixa que el navegador guardi la pàgina fins a 10 minuts, i
  // al mòbil un recàrrega normal pot seguir mostrant la versió vella. A cada
  // càrrega mirem (saltant-nos la memòria cau) quina versió hi ha publicada;
  // si és més nova, tornem a carregar des d'una URL nova (?v=), que el
  // navegador no té guardada.
  async function checkForNewVersion() {
    try {
      const res = await fetch(`js/version.js?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const m = (await res.text()).match(/PB_VERSION = "([0-9.]+)"/);
      const latest = m && m[1];
      if (!latest || latest === window.PB_VERSION) return;

      // Evita bucles si la CDN encara serveix la versió antiga
      const key = "pb-reloaded-for";
      try {
        if (sessionStorage.getItem(key) === latest) return;
        sessionStorage.setItem(key, latest);
      } catch (e) {}

      const url = new URL(window.location.href);
      url.searchParams.set("v", latest);
      window.location.replace(url.toString());
    } catch (err) {
      // Sense xarxa: ens quedem amb el que hi ha
    }
  }

  async function boot() {
    $("#app-version").textContent = "v" + (window.PB_VERSION || "0.0");
    checkForNewVersion();
    wireNav();
    wireCapture();
    wireDetail();
    wireGroups();

    $("#search-input").addEventListener("input", debounce(renderDashboard, 150));
    $("#sort-select").addEventListener("change", renderDashboard);

    if (!window.PB_READY) {
      $("#view-setup").hidden = false;
      $("#config-warning").innerHTML =
        "Encara no has connectat Supabase. Obre <code>js/config.js</code> i segueix el README per activar el desat d'idees.";
      return;
    }

    wireAuth();

    // Una sola font de veritat: cada canvi de sessió (inici, login, logout,
    // caducitat) decideix si es mostra l'app o la pantalla d'accés.
    let currentUserId; // undefined = encara no sabem res de la sessió
    window.sb.auth.onAuthStateChange((_event, session) => {
      const user = session ? session.user : null;
      const userId = user ? user.id : null;
      if (userId === currentUserId) return; // p.ex. refresc de token
      currentUserId = userId;
      // Fora del callback: Supabase no recomana fer crides await a dins
      setTimeout(() => {
        if (user) {
          enterApp(user).catch((err) => {
            console.error(err);
            toast("No s'han pogut carregar les dades");
          });
        } else {
          showAuth();
        }
      }, 0);
    });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
