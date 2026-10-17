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
    captureKind: null,
    captureLocation: null,
    captureGroup: null,
    captureFromGroup: null,
    captureReturn: null, // "map" o "group": on tornar després de desar
    detectDismissed: new Set(), // propostes que ja has dit que no, en aquest formulari
    detailReturn: "dashboard",
    currentGroupId: null,
    groupAutosaveTimer: null,
    newGroupCategories: [],
    mapFocusId: null,
    mapFilter: "per_fer",
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
    quickReviewing: false, // després de gravar: revisant el text abans de desar
    quickReviewReady: false,
    quickReviewSince: 0,
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

  // Nom complet d'una idea. El títol automàtic es talla als 60 caràcters amb
  // «…»; si és el cas i el text comença igual, es mostra fins al final de la
  // primera frase (sense passar de ~120 caràcters, tallant per paraula).
  const IDEA_NAME_MAX = 120;
  function ideaName(p) {
    const title = (p.title || "").trim();
    if (title.endsWith("…")) {
      const firstLine = (p.content || "").split("\n")[0].trim();
      if (firstLine.startsWith(title.slice(0, -1).trim())) {
        const sentence = firstLine.match(/^.*?[.!?](?=\s|$)/);
        const name = sentence ? sentence[0] : firstLine;
        if (name.length <= IDEA_NAME_MAX) return name;
        const cut = name.slice(0, IDEA_NAME_MAX);
        return cut.slice(0, cut.lastIndexOf(" ") > 60 ? cut.lastIndexOf(" ") : IDEA_NAME_MAX).trim() + "…";
      }
    }
    return title || "Idea sense títol";
  }

  function ideasLabel(n) {
    return `${n} ${n === 1 ? "idea" : "idees"}`;
  }

  function priorityScore(p) {
    if (!p.questionnaire_done) return -999;
    return (p.desire || 0) + (p.necessity || 0) - (p.difficulty || 0);
  }

  // Ajusta l'alçada d'un textarea al seu contingut
  function autoGrow(el) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }

  function autoGrowAll(root) {
    $$("textarea.auto-grow", root).forEach(autoGrow);
  }

  function wireAutoGrow() {
    $$("textarea.auto-grow").forEach((el) => el.addEventListener("input", () => autoGrow(el)));
    // Al títol, Intro passa a la descripció en lloc de fer un salt de línia
    $$("textarea.detail-title").forEach((el) =>
      el.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const next = el.parentElement.querySelector("textarea.auto-grow:not(.detail-title)");
        if (next) next.focus();
      })
    );
    window.addEventListener(
      "resize",
      debounce(() => {
        if (state.currentView === "detail") autoGrowAll($("#view-detail"));
        if (state.currentView === "group") autoGrowAll($("#view-group"));
      }, 150)
    );
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
   * Càrrega: pantalla inicial i indicador «Carregant… / Desant…»
   * ------------------------------------------------------------------- */

  function showBootLoader(text) {
    $("#boot-loader-text").textContent = text || "Encenent les idees…";
    $("#boot-loader").classList.remove("done");
  }

  function hideBootLoader() {
    $("#boot-loader").classList.add("done");
  }

  // Cada crida a la base de dades passa per aquí. L'indicador només surt si
  // tarda una mica (així no parpelleja) i es queda un mínim perquè es vegi.
  const busy = { count: 0, writes: 0, showTimer: null, shownAt: 0, hideTimer: null };
  const BUSY_DELAY_MS = 250;
  const BUSY_MIN_MS = 450;

  function updateBusyPill() {
    const pill = $("#busy-pill");
    if (busy.count > 0) {
      clearTimeout(busy.hideTimer);
      $("#busy-pill-text").textContent = busy.writes > 0 ? "Desant…" : "Carregant…";
      if (pill.hidden && !busy.showTimer) {
        busy.showTimer = setTimeout(() => {
          busy.showTimer = null;
          if (busy.count > 0) {
            pill.hidden = false;
            busy.shownAt = Date.now();
          }
        }, BUSY_DELAY_MS);
      }
      return;
    }
    clearTimeout(busy.showTimer);
    busy.showTimer = null;
    if (pill.hidden) return;
    const wait = Math.max(0, BUSY_MIN_MS - (Date.now() - busy.shownAt));
    busy.hideTimer = setTimeout(() => {
      if (busy.count === 0) pill.hidden = true;
    }, wait);
  }

  function trackBusy(promise, isWrite) {
    busy.count++;
    if (isWrite) busy.writes++;
    updateBusyPill();
    const done = () => {
      busy.count--;
      if (isWrite) busy.writes--;
      updateBusyPill();
    };
    promise.then(done, done);
    return promise;
  }

  function trackDatabaseCalls() {
    Object.keys(window.PB_DB).forEach((key) => {
      const fn = window.PB_DB[key];
      if (typeof fn !== "function") return;
      window.PB_DB[key] = (...args) => {
        const result = fn(...args);
        return result && typeof result.then === "function"
          ? trackBusy(result, !key.startsWith("list"))
          : result;
      };
    });
  }

  function fillBulbIcons() {
    const svg = $("#boot-loader .bulb");
    $$("[data-bulb]").forEach((el) => {
      el.innerHTML = "";
      el.appendChild(svg.cloneNode(true));
    });
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
    document.body.classList.toggle("on-detail", name === "detail");
    window.scrollTo({ top: 0, behavior: "smooth" });

    if (name === "capture") {
      state.manualFormOpen = false;
      updateCaptureLayout();
    }
    if (name === "dashboard") renderDashboard();
    if (name === "stats") renderStats();
    if (name === "groups") renderGroups();
    if (name === "map") renderMap();
    else stopMapLoop();
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
    renderKindChips($("#capture-kinds"), state.captureKind, (kind) => {
      state.captureKind = kind;
      renderCaptureChips();
    });

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

    renderCaptureSync();
  }

  // Projecte triat per a la idea nova (si en té): el botó «Sincronitzar el
  // projecte» obre el selector de bombolles
  function renderCaptureSync() {
    const current = $("#capture-sync-current");
    const btn = $("#sync-project-btn");
    btn.disabled = !state.groupsAvailable;
    btn.title = state.groupsAvailable ? "" : "Actualitza la base de dades (sql/schema.sql) per fer servir projectes";
    const g = state.captureGroup && state.groups.find((x) => x.id === state.captureGroup);
    current.hidden = !g;
    if (!g) return;
    current.innerHTML = `<span class="card-group linked" style="--group-color:${catColorVar(groupSlot(g))}"><span class="card-group-dot"></span>${escapeHtml(g.title)}</span><button type="button" class="capture-sync-clear" aria-label="Treu el projecte">✕</button>`;
    $(".capture-sync-clear", current).addEventListener("click", () => {
      state.captureGroup = null;
      state.captureFromGroup = null;
      state.captureReturn = null;
      renderCaptureSync();
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
    state.captureKind = null;
    state.captureLocation = null;
    state.captureGroup = null;
    state.captureFromGroup = null;
    state.captureReturn = null;
    state.detectDismissed = new Set();
    $("#mic-hint").textContent = "Prem el micro i parla en català";
    $("#mic-hint").classList.remove("live");
    renderCaptureChips();
  }

  function wireCapture() {
    renderCaptureChips();

    wireDictation($("#mic-btn"), $("#mic-hint"), $("#idea-textarea"), suggestForCaptureForm);

    $("#save-idea-btn").addEventListener("click", () => saveNewIdea());
    $("#sync-project-btn").addEventListener("click", () => {
      if (validateNewIdea(true)) openProjectPicker((groupId) => saveNewIdea(groupId));
    });
    wireProjectPicker();

    wireQuickCapture();
  }

  // Botó de micro que dicta dins d'un textarea (formulari d'idea i de projecte)
  function wireDictation(micBtn, hint, textarea, onDictationEnd) {
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
          micBtn.classList.remove("recording", "warming");
          hint.classList.remove("live", "waiting");
          hint.textContent = idleText;
          stopMicVoiceMeter();
          if (onDictationEnd) onDictationEnd();
        },
        onError: () => {
          state.micRecording = false;
          micBtn.classList.remove("recording", "warming");
          hint.classList.remove("waiting");
          hint.textContent = "No t'he sentit bé, torna-ho a provar";
          stopMicVoiceMeter();
        },
        onReady: () => {
          if (!state.micRecording) return;
          micBtn.classList.remove("warming");
          micBtn.classList.add("recording");
          hint.classList.remove("waiting");
          hint.textContent = "Ara parla";
          startMicVoiceMeter();
        },
      });
      state.micSession.start();
      state.micRecording = true;
      micBtn.classList.add("warming");
      hint.classList.add("waiting");
      hint.textContent = "Espera…";
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
      if (state.quickReviewing) return; // ara el botó és el ✓ de desar
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

    // En revisió, tocar la bombolla (el ✓) desa la idea. S'ignora el clic que
    // arriba just en deixar anar el dit, que és el final de la gravació.
    btn.addEventListener("click", () => {
      if (!state.quickReviewing || !state.quickReviewReady) return;
      if (Date.now() - state.quickReviewSince < 500) return;
      saveQuickReview();
    });
    $("#quick-review-cancel").addEventListener("click", () => {
      exitQuickReview();
      flashQuickText("Idea descartada");
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

    exitQuickReview();
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
      onReady: onQuickReady,
    });
    try {
      state.quickSpeechSession.start();
    } catch (err) {
      console.error(err);
    }

    state.quickRecording = true;
    state.quickOverCancel = false;
    $("#quick-capture").classList.add("is-recording");
    setQuickWaiting();

    state.quickMoveHandler = updateQuickCancelHover;
    window.addEventListener("pointermove", state.quickMoveHandler);
  }

  // Mentre el reconeixement es prepara: «Espera…» i cap ona (el que diguis
  // encara es perdria)
  function setQuickWaiting() {
    clearTimeout(quickHintTimer);
    const btn = $("#quick-record-btn");
    btn.classList.remove("recording");
    btn.classList.add("warming");
    $("#quick-record-hint").textContent = "Espera…";
    $("#quick-record-hint").classList.add("waiting");
    stopQuickWaveform();
  }

  // Ja escolta de debò: «Ara parla» i l'ona vermella comença
  function onQuickReady() {
    if (!state.quickRecording) return;
    const btn = $("#quick-record-btn");
    btn.classList.remove("warming");
    btn.classList.add("recording");
    const hint = $("#quick-record-hint");
    hint.textContent = "Ara parla · deixa anar per desar";
    hint.classList.remove("waiting");
    hint.classList.remove("ready-flash");
    void hint.offsetWidth;
    hint.classList.add("ready-flash");
    startQuickWaveform();
    if (navigator.vibrate) navigator.vibrate(30);
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
        setQuickWaiting(); // es torna a preparar: avisa fins que torni a escoltar
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
    btn.classList.remove("recording", "warming");
    hint.classList.remove("waiting", "ready-flash");
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

    enterQuickReview();
  }

  // En deixar anar: es para el dictat i, quan arriba el text final, la
  // bombolla es converteix en un ✓. Res es desa fins que el toques.
  function enterQuickReview() {
    const btn = $("#quick-record-btn");
    state.quickPendingSave = true;
    state.quickReviewing = true;
    state.quickReviewReady = false;
    state.quickReviewSince = Date.now();
    $("#quick-capture").classList.add("is-reviewing");
    btn.classList.add("finishing");
    btn.setAttribute("aria-label", "Desa la idea");
    $("#quick-record-hint").textContent = "Acabant de transcriure…";
    $("#quick-review-cancel").hidden = false;
    if (state.quickSpeechSession && !state.quickSpeechEnded) {
      state.quickSpeechSession.stop();
      // Si el navegador no arriba a avisar del final, seguim igualment
      setTimeout(finishQuickSave, 2500);
    } else {
      finishQuickSave();
    }
  }

  function exitQuickReview() {
    const btn = $("#quick-record-btn");
    state.quickPendingSave = false;
    state.quickReviewing = false;
    state.quickReviewReady = false;
    $("#quick-capture").classList.remove("is-reviewing");
    btn.classList.remove("finishing", "review", "saving");
    btn.setAttribute("aria-label", "Mantén premut per gravar una idea nova");
    $("#quick-review-cancel").hidden = true;
    $("#quick-preview-wrap").hidden = true;
    $("#quick-preview").value = "";
    $("#quick-record-hint").textContent = "Mantén premut per gravar una idea";
  }

  // Missatge temporal sota la bombolla; un de nou anul·la el temporitzador de
  // l'anterior perquè no se'l mengi
  let quickHintTimer = null;
  function flashQuickText(text, ms) {
    const hint = $("#quick-record-hint");
    clearTimeout(quickHintTimer);
    hint.textContent = text;
    quickHintTimer = setTimeout(() => {
      if (!state.quickRecording && !state.quickReviewing) hint.textContent = "Mantén premut per gravar una idea";
    }, ms || 1600);
  }

  // Ja tenim el text final: es mostra per revisar-lo i la bombolla fa de ✓
  function finishQuickSave() {
    if (!state.quickPendingSave) return;
    state.quickPendingSave = false;

    const btn = $("#quick-record-btn");
    const hint = $("#quick-record-hint");
    btn.classList.remove("finishing");

    const content = (state.quickTranscript + " " + state.quickInterim).trim();
    if (!content) {
      exitQuickReview();
      flashQuickText(quickSpeechErrorText(state.quickSpeechError), 2200);
      return;
    }

    const preview = $("#quick-preview");
    preview.value = content;
    $("#quick-preview-wrap").hidden = false;
    autoGrow(preview);
    btn.classList.add("review");
    state.quickReviewReady = true;
    hint.textContent = "Revisa el text i toca ✓ per desar-la";
  }

  // Toc al ✓: desa la idea amb el text (potser editat) de la previsualització
  async function saveQuickReview() {
    const hint = $("#quick-record-hint");
    const btn = $("#quick-record-btn");
    const content = $("#quick-preview").value.trim();
    if (!content) {
      toast("El text és buit: escriu alguna cosa o cancel·la");
      flashField($("#quick-preview"));
      return;
    }
    state.quickReviewReady = false; // evita desar-la dos cops
    btn.classList.add("saving");
    hint.textContent = "Desant…";

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
      exitQuickReview();
      openDetail(created.id);
      suggestFromTranscript(created);
    } catch (err) {
      console.error(err);
      toast("No s'ha pogut desar la idea");
      btn.classList.remove("saving");
      state.quickReviewReady = true; // es pot tornar a provar
      hint.textContent = "No s'ha pogut desar: torna-ho a provar";
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

  // Comprova la idea nova abans de desar-la. Per sincronitzar-la amb un
  // projecte també cal saber si és una feature, una millora o una correcció.
  function validateNewIdea(forSync) {
    const content = $("#idea-textarea").value.trim();
    if (!content) {
      toast(forSync ? "Escriu la idea abans de sincronitzar-la" : "Escriu alguna cosa primer");
      flashField($("#idea-textarea"));
      $("#idea-textarea").focus();
      return false;
    }
    if (forSync && !state.captureKind) {
      toast("Tria si és una feature nova, una millora o una correcció");
      flashField($("#capture-kinds"));
      return false;
    }
    return true;
  }

  function flashField(el) {
    el.classList.remove("field-error");
    void el.offsetWidth; // reinicia l'animació
    el.classList.add("field-error");
    setTimeout(() => el.classList.remove("field-error"), 1600);
  }

  async function saveNewIdea(syncGroupId) {
    const forSync = typeof syncGroupId === "string";
    if (!validateNewIdea(forSync)) return;
    const content = $("#idea-textarea").value.trim();
    const btn = $("#save-idea-btn");
    btn.disabled = true;

    try {
      const groupId = forSync ? syncGroupId : state.captureGroup;
      const idea = {
        title: autoTitle(content),
        content,
        location: state.captureLocation,
      };
      if (groupId) idea.group_id = groupId;
      if (state.captureKind) idea.kind = state.captureKind;
      await saveWithKindFallback((fields) => window.PB_DB.createProject(fields), idea);
      state.projects = await window.PB_DB.listProjects();
      const g = groupId && state.groups.find((x) => x.id === groupId);
      toast(g ? `Idea desada i sincronitzada amb «${g.title}»` : "Idea desada");
      const backToGroup = state.captureFromGroup;
      const returnTo = state.captureReturn;
      resetCaptureForm();
      if (backToGroup && returnTo === "map") {
        state.mapFocusId = backToGroup;
        showView("map");
      } else if (backToGroup) {
        openGroup(backToGroup);
      }
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
  let activeKindFilter = null;

  function renderCategoryFilterChips() {
    const wrap = $("#category-filter-chips");
    wrap.innerHTML = "";
    // Tipus d'idea primer, després les categories (heretades del projecte)
    window.PB_DB.IDEA_KINDS.filter((k) => state.projects.some((p) => p.kind === k.value)).forEach((k) => {
      const chip = document.createElement("button");
      chip.className = "chip chip-kind";
      chip.style.setProperty("--kind-color", catColorVar(k.slot));
      chip.innerHTML = `<span class="chip-glyph">${KIND_GLYPHS[k.value] || ""}</span>${k.label}`;
      chip.addEventListener("click", () => {
        activeKindFilter = activeKindFilter === k.value ? null : k.value;
        renderDashboard();
      });
      if (activeKindFilter === k.value) chip.classList.add("selected");
      wrap.appendChild(chip);
    });
    const used = [...new Set(state.projects.flatMap(ideaCategories))];
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

    if (activeCategoryFilter) list = list.filter((p) => ideaCategories(p).includes(activeCategoryFilter));
    if (activeKindFilter) list = list.filter((p) => p.kind === activeKindFilter);
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

    $("#dash-count").textContent = ideasLabel(state.projects.length);

    grid.innerHTML = "";
    empty.hidden = list.length > 0;

    list.forEach((p) => {
      const card = document.createElement("div");
      card.className = "project-card";
      const category = ideaCategory(p);
      const slot = window.PB_DB.categorySlot(state.categories, category);
      card.style.setProperty("--card-color", catColorVar(slot));

      const scores = p.questionnaire_done
        ? `<span>D${p.difficulty} · N${p.necessity} · G${p.desire}</span>`
        : `<span class="tag-pending">Per valorar</span>`;

      card.innerHTML = `
        <div class="card-top">
          <span class="card-tags">${categoryTagsHtml(ideaCategories(p))}</span>
          <span class="card-badges">${kindTagHtml(p)}${statusBadgeHtml(p)}</span>
        </div>
        <h3 class="card-title">${escapeHtml(ideaName(p))}</h3>
        <p class="card-excerpt">${escapeHtml(excerpt(p.content, 140))}</p>
        ${cardGroupHtml(p)}
        <div class="card-meta">
          <span>${formatRelative(p.created_at)}${p.location ? " · " + escapeHtml(p.location) : ""}</span>
          ${scores}
        </div>
      `;
      card.addEventListener("click", () => openDetail(p.id));
      const groupLink = $(".card-group.linked", card);
      if (groupLink) {
        groupLink.addEventListener("click", (e) => {
          e.stopPropagation();
          openGroup(p.group_id, "dashboard");
        });
      }
      grid.appendChild(card);
    });
  }

  // Línia de la targeta que diu a quin projecte pertany la idea (o que no en té)
  function cardGroupHtml(p) {
    if (!state.groupsAvailable) return "";
    const g = p.group_id && state.groups.find((x) => x.id === p.group_id);
    if (!g) return `<div class="card-group">Sense projecte</div>`;
    return `<button type="button" class="card-group linked" style="--group-color:${catColorVar(groupSlot(g))}" title="Obre el projecte">
        <span class="card-group-dot"></span>${escapeHtml(g.title || "Projecte sense títol")}
      </button>`;
  }

  /* ---- Tipus d'idea i categoria heretada del projecte ---- */

  // Les idees no tenen categoria pròpia: són les del projecte on estan enllaçades
  function ideaCategories(p) {
    const g = p.group_id && state.groups.find((x) => x.id === p.group_id);
    return window.PB_DB.groupCategories(g);
  }

  // La principal (la primera): és la que dona color
  function ideaCategory(p) {
    return ideaCategories(p)[0] || null;
  }

  function categoryTagsHtml(names) {
    return names
      .map(
        (n) =>
          `<span class="tag" style="--card-color:${catColorVar(window.PB_DB.categorySlot(state.categories, n))}"><span class="tag-dot"></span>${escapeHtml(n)}</span>`
      )
      .join("");
  }

  function kindOf(p) {
    return window.PB_DB.IDEA_KINDS.find((k) => k.value === p.kind) || null;
  }

  // Símbol de cada tipus d'idea
  const KIND_GLYPHS = {
    feature:
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5l1.9 5.6 5.6 1.9-5.6 1.9-1.9 5.6-1.9-5.6L2.5 10l5.6-1.9z" fill="currentColor"/></svg>',
    millora:
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16V4.5M5 9.5l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    correccio:
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13.6 2.8a4 4 0 0 0-4 5.1L3.3 14.2a1.6 1.6 0 0 0 2.3 2.3l6.3-6.3a4 4 0 0 0 5.1-4l-2.4 2.4-2.6-.7-.7-2.6z" fill="currentColor"/></svg>',
  };

  // Etiqueta de tipus: mateix format que la d'estat (símbol + text, del seu color)
  function kindTagHtml(p) {
    const k = kindOf(p);
    if (!k) return "";
    return `<span class="status-badge kind-badge has-glyph" style="--kind-color:${catColorVar(k.slot)}">${KIND_GLYPHS[k.value] || ""}${k.label}</span>`;
  }

  function renderKindChips(wrap, selected, onSelect) {
    wrap.innerHTML = "";
    window.PB_DB.IDEA_KINDS.forEach((k) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip chip-kind";
      chip.style.setProperty("--kind-color", catColorVar(k.slot));
      chip.innerHTML = `<span class="chip-glyph">${KIND_GLYPHS[k.value] || ""}</span>${k.label}`;
      if (selected === k.value) chip.classList.add("selected");
      chip.addEventListener("click", () => onSelect(selected === k.value ? null : k.value));
      wrap.appendChild(chip);
    });
  }

  // Si la base de dades encara no té una columna nova, desa la resta i avisa
  // que cal executar el SQL nou
  async function saveWithColumnFallback(save, fields, column, warning) {
    try {
      return await save(fields);
    } catch (err) {
      const msg = `${err.message || ""} ${err.details || ""}`;
      if (!(column in fields) || !msg.includes(column)) throw err;
      const { [column]: value, ...rest } = fields;
      if (warning(value)) toast(warning(value));
      return await save(rest);
    }
  }

  function saveWithKindFallback(save, fields) {
    return saveWithColumnFallback(save, fields, "kind", (kind) =>
      kind ? "Per desar el tipus d'idea, executa un altre cop sql/schema.sql a Supabase" : ""
    );
  }

  function saveWithCategoriesFallback(save, fields) {
    return saveWithColumnFallback(save, fields, "categories", (list) =>
      list && list.length > 1 ? "Per desar més d'una categoria, executa un altre cop sql/schema.sql a Supabase" : ""
    );
  }

  // Camps de categoria d'un projecte: la llista i la primera com a principal
  function groupCategoryFields(list) {
    return { category: list[0] || null, categories: list };
  }

  function toggleInList(list, name) {
    return list.includes(name) ? list.filter((n) => n !== name) : [...list, name];
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
    autoGrowAll($("#view-detail"));
  }

  // Projecte de la idea: pastilla amb el projecte actual (✕ per treure'l)
  // i el botó «Sincronitzar el projecte», que obre el selector de bombolles
  function renderDetailGroups(p) {
    const current = $("#detail-sync-current");
    $("#detail-sync-btn").disabled = !state.groupsAvailable;
    const g = p.group_id && state.groups.find((x) => x.id === p.group_id);
    current.hidden = !g;
    if (!g) return;
    current.innerHTML = `<button type="button" class="card-group linked" style="--group-color:${catColorVar(groupSlot(g))}" title="Obre el projecte"><span class="card-group-dot"></span>${escapeHtml(g.title)}</button><button type="button" class="capture-sync-clear" aria-label="Treu-la del projecte">✕</button>`;
    $(".card-group", current).addEventListener("click", () => openGroup(g.id, "groups"));
    $(".capture-sync-clear", current).addEventListener("click", () => linkIdea(p, null, () => renderDetailGroups(p)));
  }

  // Abans de sincronitzar, la idea ha de tenir text i tipus
  function syncDetailIdea() {
    const p = state.projects.find((x) => x.id === state.currentProjectId);
    if (!p) return;
    if (!$("#detail-content-input").value.trim()) {
      toast("Escriu la idea abans de sincronitzar-la");
      flashField($("#detail-content-input"));
      $("#detail-content-input").focus();
      return;
    }
    if (!p.kind) {
      toast("Tria si és una feature nova, una millora o una correcció");
      flashField($("#detail-kinds"));
      $("#detail-kinds").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    openProjectPicker((groupId) => linkIdea(p, groupId, () => renderDetailGroups(p)));
  }

  // Enllaça (o desenllaça, amb null) una idea a un projecte i ho desa de seguida
  async function linkIdea(p, groupId, after) {
    const previous = p.group_id || null;
    p.group_id = groupId;
    if (after) after();
    try {
      await window.PB_DB.updateProject(p.id, { group_id: groupId });
      const g = state.groups.find((x) => x.id === groupId);
      toast(groupId ? `Idea sincronitzada amb «${g ? g.title : "projecte"}»` : "Idea treta del projecte");
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
      chip.innerHTML = `${statusGlyph(s.value) ? `<span class="chip-glyph">${statusGlyph(s.value)}</span>` : ""}${s.label}`;
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
    renderKindChips($("#detail-kinds"), p.kind || null, (kind) => {
      p.kind = kind;
      renderDetailChips(p);
      scheduleAutosave();
    });

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
      title: $("#detail-title-input").value.replace(/\s+/g, " ").trim() || "Idea sense títol",
      content: $("#detail-content-input").value,
      location: p.location || null,
      status: p.status || "idea",
      difficulty,
      necessity,
      desire,
      needs_external: $("#needs-external-toggle").checked,
      external_detail: $("#external-detail-input").value,
      questionnaire_done: true,
    };
    if (p.kind !== undefined) patch.kind = p.kind || null;

    try {
      const updated = await saveWithKindFallback((fields) => window.PB_DB.updateProject(p.id, fields), patch);
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

    $("#detail-sync-btn").addEventListener("click", syncDetailIdea);

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

  // Símbol de cada estat (les idees sense començar no en porten)
  const STATUS_GLYPHS = {
    en_curs:
      '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 4a6 6 0 0 1 0 12z" fill="currentColor"/></svg>',
    feta: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10.5l3.2 3.2L15 6.8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    abandonada:
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 6.5l7 7M13.5 6.5l-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  };

  function statusGlyph(value) {
    return STATUS_GLYPHS[value] || "";
  }

  // Etiqueta d'estat per a llistes: símbol + text, del color de l'estat
  function statusBadgeHtml(item, isGroup) {
    const st = statusOf(item);
    const glyph = statusGlyph(st.value);
    return `<span class="status-badge status-${st.value}${glyph ? " has-glyph" : ""}">${glyph}${isGroup ? st.groupLabel : st.label}</span>`;
  }

  // Filtre del mapa: quins estats es veuen
  const MAP_FILTERS = {
    tots: () => true,
    per_fer: (st) => st === "idea" || st === "en_curs",
    en_curs: (st) => st === "en_curs",
    idea: (st) => st === "idea",
  };

  function mapShows(item) {
    const test = MAP_FILTERS[state.mapFilter] || MAP_FILTERS.per_fer;
    return test(item.status || "idea");
  }

  function openNewGroup() {
    if (!state.groupsAvailable) {
      toast("Per crear projectes, primer executa sql/schema.sql al SQL Editor de Supabase");
      return;
    }
    $("#group-textarea").value = "";
    state.newGroupCategories = [];
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
      if (state.newGroupCategories.includes(c.name)) chip.classList.add("selected");
      chip.addEventListener("click", () => {
        state.newGroupCategories = toggleInList(state.newGroupCategories, c.name);
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
      const created = await saveWithCategoriesFallback((fields) => window.PB_DB.createGroup(fields), {
        title: groupTitle(content),
        content,
        ...groupCategoryFields(state.newGroupCategories),
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
    $("#groups-no-results").hidden = true;
    $("#group-search-input").closest(".dash-controls").hidden = !n || !state.groupsAvailable;
    if (!state.groupsAvailable) {
      empty.hidden = false;
      empty.textContent =
        "Per fer servir projectes, executa un altre cop sql/schema.sql al SQL Editor de Supabase.";
      return;
    }

    // Cerca pel nom, la descripció, la categoria i les idees que conté
    const search = ($("#group-search-input").value || "").trim().toLowerCase();
    const list = search
      ? state.groups.filter((g) =>
          [g.title, g.content, ...window.PB_DB.groupCategories(g), ...ideasOfGroup(g.id).map(ideaName)]
            .some((text) => (text || "").toLowerCase().includes(search))
        )
      : state.groups;
    $("#groups-no-results").hidden = !n || list.length > 0;

    list.forEach((g) => {
      const count = ideasOfGroup(g.id).length;
      const card = document.createElement("div");
      card.className = "project-card";
      card.style.setProperty("--card-color", catColorVar(groupSlot(g)));
      card.innerHTML = `
        <div class="card-top">
          <span class="card-tags">${categoryTagsHtml(window.PB_DB.groupCategories(g))}</span>
          ${statusBadgeHtml(g, true)}
        </div>
        <h3 class="card-title">${escapeHtml(g.title)}</h3>
        <p class="card-excerpt">${escapeHtml(excerpt(g.content, 140))}</p>
        <div class="card-meta"><span>${formatRelative(g.created_at)}</span><span class="card-count">${ideasLabel(count)}</span></div>
      `;
      card.addEventListener("click", () => openGroup(g.id, "groups"));
      grid.appendChild(card);
    });
  }

  // Sense categoria, cada projecte agafa igualment un color estable
  function groupSlot(g) {
    const first = window.PB_DB.groupCategories(g)[0];
    if (first) return window.PB_DB.categorySlot(state.categories, first);
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
    renderGroupStatus(g);
    renderGroupIdeas(g);
    showView("group");
    autoGrowAll($("#view-group"));
  }

  function renderGroupStatus(g) {
    const wrap = $("#group-status");
    wrap.innerHTML = "";
    const current = g.status || "idea";
    window.PB_DB.STATUSES.forEach((st) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip status-" + st.value;
      chip.innerHTML = `${statusGlyph(st.value) ? `<span class="chip-glyph">${statusGlyph(st.value)}</span>` : ""}${st.groupLabel}`;
      if (current === st.value) chip.classList.add("selected");
      chip.addEventListener("click", async () => {
        if (current === st.value) return;
        g.status = st.value;
        renderGroupStatus(g);
        try {
          const updated = await window.PB_DB.updateGroup(g.id, { status: st.value });
          Object.assign(g, updated);
        } catch (err) {
          console.error(err);
          g.status = current;
          renderGroupStatus(g);
          toast("Per marcar l'estat dels projectes, executa un altre cop sql/schema.sql a Supabase");
        }
      });
      wrap.appendChild(chip);
    });
  }

  function renderGroupCategories(g) {
    const wrap = $("#group-categories");
    wrap.innerHTML = "";
    state.categories.forEach((c) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = c.name;
      if (window.PB_DB.groupCategories(g).includes(c.name)) chip.classList.add("selected");
      chip.addEventListener("click", () => {
        Object.assign(g, groupCategoryFields(toggleInList(window.PB_DB.groupCategories(g), c.name)));
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
      row.style.setProperty("--card-color", catColorVar(window.PB_DB.categorySlot(state.categories, ideaCategory(p))));
      row.innerHTML = `
        <div class="group-idea-main">
          <div class="group-idea-title">${escapeHtml(ideaName(p))}</div>
          <div class="group-idea-meta">${kindTagHtml(p)}${statusBadgeHtml(p)} <span>${formatRelative(p.created_at)}</span></div>
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
      const updated = await saveWithCategoriesFallback((fields) => window.PB_DB.updateGroup(g.id, fields), {
        title: $("#group-title-input").value.replace(/\s+/g, " ").trim() || "Projecte sense títol",
        content: $("#group-content-input").value,
        ...groupCategoryFields(window.PB_DB.groupCategories(g)),
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

  // Obre el formulari d'idea nova ja lligada a un projecte; en desar, torna
  // allà d'on venies (la fitxa del projecte o el mapa)
  function startIdeaForGroup(groupId, returnTo) {
    resetCaptureForm();
    showView("capture");
    state.manualFormOpen = true; // el formulari, no la gravació ràpida
    updateCaptureLayout();
    state.captureGroup = groupId;
    state.captureFromGroup = groupId;
    state.captureReturn = returnTo;
    renderCaptureChips();
    if (!isMobile()) $("#idea-textarea").focus();
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

    $("#group-new-idea-btn").addEventListener("click", () => startIdeaForGroup(state.currentGroupId, "group"));

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
    try {
      const saved = localStorage.getItem("pb-map-filter");
      if (saved && MAP_FILTERS[saved]) state.mapFilter = saved;
    } catch (e) {}
    $$("#map-filter [data-filter]").forEach((b) =>
      b.addEventListener("click", () => {
        state.mapFilter = b.dataset.filter;
        try {
          localStorage.setItem("pb-map-filter", state.mapFilter);
        } catch (e) {}
        renderMap();
      })
    );
    $("#map-back-btn").addEventListener("click", unfocusMap);
    $("#map-new-idea-btn").addEventListener("click", () => {
      if (state.mapFocusId) startIdeaForGroup(state.mapFocusId, "map");
    });
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
    // Les mides de lletra es calculen amb la font carregada: si arriba tard,
    // es tornen a calcular perquè cap nom quedi retallat
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (state.currentView === "map") renderMap();
      });
    }
  }

  /* ---------------------------------------------------------------------
   * Mapa mental: cada projecte és una bombolla que sura; en tocar-ne una,
   * les seves idees en surten com a bombolles més petites, unides amb
   * fils corbats. Tot es mou amb una petita simulació (no amb CSS) perquè
   * els fils segueixin les bombolles mentre suren.
   * ------------------------------------------------------------------- */

  const MAP_BAR_SPACE = 70; // espai de baix per als botons del mapa
  const MAP_TOP_DEFAULT = 56; // espai de dalt pel botó «Crear projecte nou» i el filtre
  const SVG_NS = "http://www.w3.org/2000/svg";

  const map = {
    nodes: [], // { kind, id, el, x, y, size, tx, ty, tsize, home, seed, line }
    raf: null,
    t0: 0,
    calm: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    top: MAP_TOP_DEFAULT,
  };

  // L'espai lliure de dalt depèn d'on acaba el filtre (al mòbil va en una fila a part)
  function measureMapTop() {
    const stage = $("#map-stage").getBoundingClientRect();
    const filter = $("#map-filter").getBoundingClientRect();
    map.top = Math.max(MAP_TOP_DEFAULT, filter.bottom - stage.top + 14);
  }

  function renderMapFilter() {
    $$("#map-filter [data-filter]").forEach((b) => {
      const on = b.dataset.filter === state.mapFilter;
      b.classList.toggle("active", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  function mapIdeasOf(groupId) {
    return ideasOfGroup(groupId).filter(mapShows);
  }

  function mapKindBadgeHtml(p) {
    const k = kindOf(p);
    if (!k) return "";
    return `<span class="map-badge map-kind-badge" style="--kind-color:${catColorVar(k.slot)}" title="${k.label}">${KIND_GLYPHS[k.value] || ""}</span>`;
  }

  function mapBadgeHtml(item) {
    const glyph = statusGlyph(item.status || "idea");
    return glyph ? `<span class="map-badge status-${item.status}">${glyph}</span>` : "";
  }

  function mapSize() {
    const stage = $("#map-stage");
    return { W: stage.clientWidth, H: stage.clientHeight };
  }

  function mapCenter(W, H) {
    return { cx: W / 2, cy: (map.top + H - MAP_BAR_SPACE) / 2 };
  }

  // Paràmetres de moviment estables per a cada node (a partir del seu id)
  function nodeSeed(id) {
    const h = hashString(id);
    const r = (k) => (((h >>> (k * 3)) ^ (h >>> (k * 7 + 1))) & 0xff) / 255;
    return {
      fx1: 0.13 + r(0) * 0.12,
      fx2: 0.29 + r(1) * 0.2,
      fy1: 0.11 + r(2) * 0.12,
      fy2: 0.31 + r(3) * 0.2,
      p1: r(4) * Math.PI * 2,
      p2: r(5) * Math.PI * 2,
      p3: r(6) * Math.PI * 2,
      p4: r(7) * Math.PI * 2,
      bend: (r(8) - 0.5) * 2, // curvatura del fil, -1..1
      breath: 0.2 + r(9) * 0.25,
    };
  }

  // Tria la mida de lletra perquè el text sencer càpiga dins la bombolla,
  // sense tallar-lo ni partir paraules. Es mesura en una bombolla de 100px
  // i es desa com a factor (--fit): el CSS el multiplica per l'amplada real
  // de la bombolla (unitats cqw), així s'adapta sol quan la bombolla creix.
  const FIT_REF = 100;
  const MAP_TEXT_WIDTH = 0.8; // ha de coincidir amb l'amplada del títol al CSS
  let fitMeasurer = null;

  function fitBubbleText(el, selector, heightShare) {
    const span = $(selector, el);
    if (!span) return;
    const fit = measureFit(span.textContent, el.classList.contains("map-bubble"), heightShare);
    el.style.setProperty("--fit", fit.toFixed(2));
  }

  // Factor de lletra (px per cada 100px de bombolla) perquè `text` hi càpiga
  function measureFit(text, isGroup, heightShare) {
    if (!fitMeasurer) {
      fitMeasurer = document.createElement("div");
      fitMeasurer.className = "map-fit-measurer";
      document.body.appendChild(fitMeasurer);
    }
    fitMeasurer.style.fontWeight = isGroup ? "700" : "600";
    fitMeasurer.style.width = `${FIT_REF * MAP_TEXT_WIDTH}px`;
    fitMeasurer.textContent = text;

    const maxH = FIT_REF * heightShare;
    const maxFont = isGroup ? 17 : 14;
    let lo = 4;
    let hi = maxFont;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      fitMeasurer.style.fontSize = `${mid}px`;
      const fits = fitMeasurer.scrollHeight <= maxH && fitMeasurer.scrollWidth <= FIT_REF * MAP_TEXT_WIDTH + 0.5;
      if (fits) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  // Mida mínima perquè el text hi surti com a mínim a `minFont` px
  function sizeForReadable(text, isGroup, heightShare, minFont) {
    return (minFont / measureFit(text, isGroup, heightShare)) * FIT_REF;
  }

  function startMapLoop() {
    if (map.raf) return;
    map.t0 = performance.now();
    const tick = (now) => {
      map.raf = requestAnimationFrame(tick);
      stepMap((now - map.t0) / 1000);
    };
    map.raf = requestAnimationFrame(tick);
  }

  function stopMapLoop() {
    if (map.raf) cancelAnimationFrame(map.raf);
    map.raf = null;
  }

  // Posició visible d'un node: on va (amb inèrcia) + un balanceig suau
  function stepMap(t) {
    const amp = map.calm ? 0 : 1;
    map.nodes.forEach((n) => {
      const ease = n.kind === "idea" ? 0.09 : 0.07;
      n.x += (n.tx - n.x) * ease;
      n.y += (n.ty - n.y) * ease;
      n.size += (n.tsize - n.size) * ease;
      const s = n.seed;
      const a = amp * Math.min(9, 3 + n.size / 18);
      n.rx = n.x + a * (Math.sin(t * s.fx1 * 2 * Math.PI + s.p1) * 0.7 + Math.sin(t * s.fx2 * 2 * Math.PI + s.p2) * 0.3);
      n.ry = n.y + a * (Math.sin(t * s.fy1 * 2 * Math.PI + s.p3) * 0.7 + Math.sin(t * s.fy2 * 2 * Math.PI + s.p4) * 0.3);
      const breathe = 1 + amp * 0.025 * Math.sin(t * s.breath * 2 * Math.PI + s.p2);
      // La mida de maqueta només canvia quan canvia la mida objectiu; el
      // creixement i la respiració es fan escalant. Si es canviés l'amplada
      // a cada fotograma, el text es tornaria a partir en línies i parpellejaria.
      if (n.tsize > 0 && Math.abs((n.layout || 0) - n.tsize) > 0.5) {
        n.layout = n.tsize;
        n.el.style.width = `${n.layout}px`;
        n.el.style.height = `${n.layout}px`;
      }
      const L = n.layout || 1;
      const scale = Math.max(0, (n.size * breathe) / L);
      n.el.style.transform = `translate3d(${(n.rx - L / 2).toFixed(2)}px, ${(n.ry - L / 2).toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
    });

    // Fils corbats del projecte obert a cadascuna de les seves idees
    const hub = map.nodes.find((n) => n.kind === "group" && n.id === state.mapFocusId);
    map.nodes.forEach((n) => {
      if (!n.line) return;
      if (!hub) {
        n.line.setAttribute("d", "");
        return;
      }
      const dx = n.rx - hub.rx;
      const dy = n.ry - hub.ry;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d;
      const uy = dy / d;
      const x1 = hub.rx + ux * (hub.size / 2);
      const y1 = hub.ry + uy * (hub.size / 2);
      const x2 = n.rx - ux * (n.size / 2);
      const y2 = n.ry - uy * (n.size / 2);
      const wave = amp * Math.sin(t * 0.35 + n.seed.p1) * 0.08;
      const k = (n.seed.bend * 0.22 + wave) * d;
      const mx = (x1 + x2) / 2 - uy * k;
      const my = (y1 + y2) / 2 + ux * k;
      n.line.setAttribute("d", `M${x1.toFixed(1)},${y1.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`);
      n.line.style.opacity = d > (hub.size + n.size) / 2 + 4 ? "" : "0";
    });
  }

  function renderMap() {
    const stage = $("#map-stage");
    const svg = $("#map-links");
    $$(".map-bubble, .map-idea", stage).forEach((el) => el.remove());
    svg.innerHTML = "";
    map.nodes = [];
    stage.classList.remove("is-focused");

    const empty = $("#map-empty");
    renderMapFilter();
    measureMapTop();
    const groups = state.groups.filter(mapShows);
    empty.hidden = groups.length > 0 && state.groupsAvailable;
    if (!state.groupsAvailable) {
      empty.innerHTML = "Per fer servir el mapa, executa un altre cop<br />sql/schema.sql al SQL Editor de Supabase.";
    } else if (!state.groups.length) {
      empty.innerHTML = "Encara no tens cap projecte.<br />Crea'n un amb «Crear projecte nou».";
    } else {
      empty.innerHTML = "Cap projecte amb aquest filtre.<br />Prova «Tots» per veure'ls tots.";
    }
    resetMapBar();
    if (!groups.length || !state.groupsAvailable) {
      stopMapLoop();
      return;
    }

    const { W, H } = mapSize();
    const { cx, cy } = mapCenter(W, H);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

    // Mida: totes comparteixen l'espai; les que tenen més idees, més grans
    const counts = groups.map((g) => mapIdeasOf(g.id).length);
    const maxCount = Math.max(1, ...counts);
    const usable = W * (H - MAP_BAR_SPACE - map.top);
    const base = Math.max(70, Math.min(170, Math.sqrt((usable * 0.3) / groups.length)));
    const maxSize = Math.min(W, H) * 0.42;
    const sizes = counts.map((c, i) => {
      const bySize = base * (0.75 + 0.5 * (c / maxCount));
      // Un nom llarg fa la bombolla més gran perquè es pugui llegir sencer
      const readable = sizeForReadable(groups[i].title || "Projecte sense títol", true, 0.56, 11);
      return Math.min(Math.max(bySize, readable), maxSize);
    });
    const positions = layoutBubbles(sizes, W, H);

    groups.forEach((g, i) => {
      const size = sizes[i];
      const { x, y } = positions[i];
      const count = counts[i];
      const el = document.createElement("button");
      el.type = "button";
      el.className = "map-bubble";
      el.dataset.id = g.id;
      el.style.setProperty("--bubble-color", catColorVar(groupSlot(g)));
      el.innerHTML = `
        <span class="map-bubble-title">${escapeHtml(g.title || "Projecte sense títol")}</span>
        <span class="map-bubble-count">${ideasLabel(count)}</span>
        ${mapBadgeHtml(g)}`;
      el.setAttribute("aria-label", `${g.title}: ${ideasLabel(count)}`);
      fitBubbleText(el, ".map-bubble-title", 0.56);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (state.mapFocusId === g.id) openGroup(g.id, "map");
        else focusMap(g.id);
      });
      stage.appendChild(el);

      // Neixen totes una mica cap al centre i s'escampen fins al seu lloc
      map.nodes.push({
        kind: "group",
        id: g.id,
        el,
        x: cx + (x - cx) * 0.6,
        y: cy + (y - cy) * 0.6,
        size: size * 0.5,
        tx: x,
        ty: y,
        tsize: size,
        home: { x, y, size },
        seed: nodeSeed(g.id),
      });
    });

    stepMap(0);
    startMapLoop();
    if (state.mapFocusId && groups.some((g) => g.id === state.mapFocusId)) focusMap(state.mapFocusId);
    else state.mapFocusId = null;
  }

  // Separa cercles que es trepitgen i els manté dins la pantalla. `fixed`
  // són cercles que no es mouen (p.ex. la bombolla del projecte obert);
  // `pull` és cap on tendeixen (centre i força).
  function relaxCircles(pts, W, H, { fixed = [], gap = 12, pull = null, iterations = 300, top = map.top, bottom = H - MAP_BAR_SPACE } = {}) {
    const n = pts.length;
    for (let iter = 0; iter < iterations; iter++) {
      for (let i = 0; i < n; i++) {
        const a = pts[i];
        for (let j = i + 1; j < n; j++) {
          const b = pts[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d = Math.hypot(dx, dy);
          const min = a.r + b.r + gap;
          if (d >= min) continue;
          if (d < 0.01) {
            dx = Math.cos(i + j);
            dy = Math.sin(i + j);
            d = 1;
          }
          const push = (min - d) / 2;
          a.x -= (dx / d) * push;
          a.y -= (dy / d) * push;
          b.x += (dx / d) * push;
          b.y += (dy / d) * push;
        }
        fixed.forEach((f) => {
          let dx = a.x - f.x;
          let dy = a.y - f.y;
          const d = Math.hypot(dx, dy) || 1;
          const min = a.r + f.r + gap * 2;
          if (d < min) {
            a.x = f.x + (dx / d) * min;
            a.y = f.y + (dy / d) * min;
          }
        });
      }
      pts.forEach((p) => {
        if (pull) {
          p.x += (pull.x - p.x) * pull.k;
          p.y += (pull.y - p.y) * pull.k;
        }
        p.x = Math.min(Math.max(p.x, p.r + 8), W - p.r - 8);
        p.y = Math.min(Math.max(p.y, top + p.r), bottom - p.r);
      });
    }
    return pts;
  }

  // Projectes: espiral irregular i després es reparteixen sense trepitjar-se
  function layoutBubbles(sizes, W, H) {
    const { cx, cy } = mapCenter(W, H);
    const rx = W / 2 - 40;
    const ry = (H - MAP_BAR_SPACE - map.top) / 2 - 20;
    const n = sizes.length;
    const pts = sizes.map((s, i) => {
      const r = n === 1 ? 0 : Math.sqrt((i + 0.5) / n) * 0.75;
      const a = i * 2.39996 + Math.sin(i * 1.7) * 0.4;
      return { x: cx + Math.cos(a) * r * rx, y: cy + Math.sin(a) * r * ry, r: s / 2 };
    });
    return relaxCircles(pts, W, H, { gap: 18, pull: { x: cx, y: cy, k: 0.005 } });
  }

  function resetMapBar() {
    $("#map-back-btn").hidden = true;
    $("#map-open-btn").hidden = true;
    $("#map-new-idea-btn").hidden = true;
    $("#map-hint").hidden = false;
    $("#map-hint").textContent = "Toca una bombolla per veure'n les idees";
  }

  function removeIdeaNodes(animated) {
    const ideas = map.nodes.filter((n) => n.kind === "idea");
    map.nodes = map.nodes.filter((n) => n.kind !== "idea");
    if (!animated) {
      ideas.forEach((n) => {
        n.el.remove();
        if (n.line) n.line.remove();
      });
      return;
    }
    // Tornen cap a dins de la bombolla mentre s'esvaeixen
    const hub = map.nodes.find((n) => n.kind === "group" && n.id === ideas[0]?.groupId);
    ideas.forEach((n) => {
      n.el.classList.add("leaving");
      if (n.line) n.line.classList.add("leaving");
      const dying = { ...n, kind: "dying", tx: hub ? hub.tx : n.x, ty: hub ? hub.ty : n.y, tsize: 0 };
      map.nodes.push(dying);
      setTimeout(() => {
        map.nodes = map.nodes.filter((x) => x !== dying);
        n.el.remove();
        if (n.line) n.line.remove();
      }, 450);
    });
  }

  function focusMap(groupId) {
    const stage = $("#map-stage");
    const svg = $("#map-links");
    const g = state.groups.find((x) => x.id === groupId);
    if (!g) return;
    const changing = state.mapFocusId && state.mapFocusId !== groupId;
    state.mapFocusId = groupId;
    removeIdeaNodes(changing);
    stage.classList.add("is-focused");

    const { W, H } = mapSize();
    const { cx, cy } = mapCenter(W, H);
    const ideas = mapIdeasOf(groupId);
    const hiddenByFilter = ideasOfGroup(groupId).length - ideas.length;
    const color = catColorVar(groupSlot(g));
    const scale = Math.max(0.85, Math.min(1, Math.min(W, H) / 760));

    // El projecte triat va al centre; els altres tornen al seu lloc
    let hub = null;
    map.nodes.forEach((n) => {
      if (n.kind !== "group") return;
      const isFocus = n.id === groupId;
      n.el.classList.toggle("is-focus", isFocus);
      if (isFocus) {
        hub = n;
        n.tx = cx;
        n.ty = cy;
        n.tsize = Math.min(Math.max(n.home.size, 110 * scale), Math.min(W, H) * 0.3);
      } else {
        n.tx = n.home.x;
        n.ty = n.home.y;
        n.tsize = n.home.size;
      }
    });
    if (!hub) return;

    // Idees: bombolles petites escampades al voltant de manera irregular
    const ADD = { add: true };
    const items = [...(ideas.length ? ideas : [null]), ADD];
    const hubR = hub.tsize / 2;
    const pts = items.map((p, i) => {
      const seed = nodeSeed((p ? (p.add ? "nova" : p.id) : "buit") + groupId);
      const size = p && p.add
        ? 62 * scale
        : p
        ? Math.min(Math.max(64 * scale, sizeForReadable(ideaName(p), false, 0.7, 10)), 160 * scale)
        : 96 * scale;
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / items.length + seed.bend * 0.35;
      const ring = hubR + size / 2 + (45 + seed.breath * 260) * scale; // 0.2..0.45 → distàncies variades
      return { p, seed, size, r: size / 2, x: cx + Math.cos(a) * ring * 1.15, y: cy + Math.sin(a) * ring };
    });
    relaxCircles(pts, W, H, {
      fixed: [{ x: cx, y: cy, r: hubR }],
      gap: 14,
      iterations: 200,
    });

    pts.forEach((pt, i) => {
      if (pt.p && pt.p.add) {
        addNewIdeaBubble(pt, i, groupId, hub, svg, stage);
        return;
      }
      const p = pt.p;
      const el = document.createElement("button");
      el.type = "button";
      el.className = "map-idea" + (p ? "" : " is-empty");
      el.style.setProperty("--idea-color", p ? `var(--${statusOf(p).color})` : "var(--muted)");
      el.style.setProperty("--delay", `${(i * 0.04).toFixed(2)}s`);
      const emptyText = hiddenByFilter ? "Cap idea amb aquest filtre" : "Encara no hi ha idees";
      el.innerHTML = `<span class="map-idea-title">${escapeHtml(p ? ideaName(p) : emptyText)}</span>${p ? mapBadgeHtml(p) + mapKindBadgeHtml(p) : ""}`;
      fitBubbleText(el, ".map-idea-title", 0.7);
      if (p) {
        el.title = ideaName(p);
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          openDetail(p.id, "map");
        });
      }
      stage.appendChild(el);

      let line = null;
      if (p) {
        line = document.createElementNS(SVG_NS, "path");
        line.style.setProperty("--line-color", `color-mix(in srgb, ${color} 55%, transparent)`);
        svg.appendChild(line);
      }

      // Surten de dins la bombolla del projecte
      map.nodes.push({
        kind: "idea",
        id: p ? p.id : "buit",
        groupId,
        el,
        line,
        x: hub.x,
        y: hub.y,
        size: 0,
        tx: pt.x,
        ty: pt.y,
        tsize: pt.size,
        seed: pt.seed,
      });
    });

    $("#map-back-btn").hidden = false;
    $("#map-open-btn").hidden = false;
    $("#map-new-idea-btn").hidden = false;
    $("#map-hint").hidden = true;
  }

  // Bombolla «+ Nova idea»: crea una idea ja lligada al projecte obert
  function addNewIdeaBubble(pt, i, groupId, hub, svg, stage) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "map-idea map-add";
    el.style.setProperty("--delay", `${(i * 0.04).toFixed(2)}s`);
    el.innerHTML = `<span class="map-add-plus" aria-hidden="true">+</span><span class="map-add-label">Nova idea</span>`;
    el.setAttribute("aria-label", "Nova idea per a aquest projecte");
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      startIdeaForGroup(groupId, "map");
    });
    stage.appendChild(el);

    const line = document.createElementNS(SVG_NS, "path");
    line.classList.add("map-add-line");
    svg.appendChild(line);

    map.nodes.push({
      kind: "idea",
      id: "nova",
      groupId,
      el,
      line,
      x: hub.x,
      y: hub.y,
      size: 0,
      tx: pt.x,
      ty: pt.y,
      tsize: pt.size,
      seed: pt.seed,
    });
  }

  /* ---------------------------------------------------------------------
   * Detecció al text dictat: proposa el tipus i el projecte, sempre
   * demanant confirmació
   * ------------------------------------------------------------------- */

  function detectHints(text, { skipKind, skipGroup, dismissed } = {}) {
    const found = window.PB_DETECT.detect(text, state.groupsAvailable ? state.groups : []);
    let kind = !skipKind && found.kind ? found.kind : null;
    let group = !skipGroup && found.group ? found.group : null;
    if (dismissed) {
      if (kind && dismissed.has("kind:" + kind.value)) kind = null;
      if (group && dismissed.has("group:" + group.id)) group = null;
    }
    return kind || group ? { kind, group } : null;
  }

  // Mostra la finestra i resol amb { kind, groupId } si dius que sí, o null
  function askDetection(hints) {
    return new Promise((resolve) => {
      const modal = $("#detect-modal");
      const kindLabel = hints.kind ? window.PB_DB.IDEA_KINDS.find((k) => k.value === hints.kind.value).label.toLowerCase() : "";
      const parts = [];
      if (hints.kind) parts.push(`<strong>«${escapeHtml(kindLabel)}»</strong>`);
      if (hints.group) parts.push(`${hints.kind ? "del" : "el"} projecte <strong>«${escapeHtml(hints.group.title)}»</strong>`);
      $("#detect-phrase").innerHTML = parts.join(" ");

      let kind = hints.kind ? hints.kind.value : null;
      let linkGroup = !!hints.group;
      const renderKinds = () =>
        renderKindChips($("#detect-kinds"), kind, (k) => {
          kind = k;
          renderKinds();
        });
      renderKinds();

      const toggle = $("#detect-group-toggle");
      $("#detect-group-row").hidden = !hints.group;
      const renderToggle = () => {
        if (!hints.group) return;
        toggle.setAttribute("aria-pressed", linkGroup ? "true" : "false");
        toggle.classList.toggle("on", linkGroup);
        toggle.innerHTML = `<span class="detect-check" aria-hidden="true">${linkGroup ? "✓" : ""}</span>Sincronitzar-la amb «${escapeHtml(hints.group.title)}»`;
      };
      renderToggle();
      toggle.onclick = () => {
        linkGroup = !linkGroup;
        renderToggle();
      };

      const close = (result) => {
        modal.hidden = true;
        document.removeEventListener("keydown", onKey);
        resolve(result);
      };
      const onKey = (e) => {
        if (e.key === "Escape") close(null);
      };
      $("#detect-no").onclick = () => close(null);
      $("#detect-yes").onclick = () => {
        // Per sincronitzar-la amb un projecte cal saber de quin tipus és
        if (linkGroup && !kind) {
          toast("Tria el tipus per sincronitzar-la amb el projecte");
          flashField($("#detect-kinds"));
          return;
        }
        close({ kind, groupId: linkGroup ? hints.group.id : null });
      };
      modal.onclick = (e) => {
        if (e.target === modal) close(null);
      };
      document.addEventListener("keydown", onKey);
      modal.hidden = false;
      $("#detect-yes").focus();
    });
  }

  // Després de gravar una idea per veu (ja desada i oberta a la seva fitxa)
  async function suggestFromTranscript(idea) {
    const hints = detectHints(idea.content, { skipKind: !!idea.kind, skipGroup: !!idea.group_id });
    if (!hints) return;
    const choice = await askDetection(hints);
    if (!choice) return;
    const patch = {};
    if (choice.kind && choice.kind !== idea.kind) patch.kind = choice.kind;
    if (choice.groupId) patch.group_id = choice.groupId;
    if (!Object.keys(patch).length) return;
    try {
      const updated = await saveWithKindFallback((fields) => window.PB_DB.updateProject(idea.id, fields), patch);
      Object.assign(idea, updated);
      const g = choice.groupId && state.groups.find((x) => x.id === choice.groupId);
      toast(g ? `Idea sincronitzada amb «${g.title}»` : "Tipus de la idea desat");
      if (state.currentView === "detail" && state.currentProjectId === idea.id) {
        renderDetailChips(idea);
        renderDetailGroups(idea);
      }
    } catch (err) {
      console.error(err);
      toast("No s'ha pogut aplicar");
    }
  }

  // Al formulari d'idea nova, quan acaba el dictat: omple el tipus i el
  // projecte del formulari (encara no es desa res)
  async function suggestForCaptureForm() {
    const text = $("#idea-textarea").value;
    const hints = detectHints(text, {
      skipKind: !!state.captureKind,
      skipGroup: !!state.captureGroup,
      dismissed: state.detectDismissed,
    });
    if (!hints) return;
    const choice = await askDetection(hints);
    if (!choice) {
      if (hints.kind) state.detectDismissed.add("kind:" + hints.kind.value);
      if (hints.group) state.detectDismissed.add("group:" + hints.group.id);
      return;
    }
    if (choice.kind) state.captureKind = choice.kind;
    if (choice.groupId) state.captureGroup = choice.groupId;
    renderCaptureChips();
    toast("Fet: revisa-ho i desa la idea");
  }

  /* ---------------------------------------------------------------------
   * Selector de projecte: finestra amb les bombolles dels projectes
   * ------------------------------------------------------------------- */

  let pickerOnPick = null;

  function openProjectPicker(onPick) {
    pickerOnPick = onPick;
    $("#project-picker").hidden = false;
    document.body.classList.add("picker-open");
    renderProjectPicker();
  }

  function closeProjectPicker() {
    $("#project-picker").hidden = true;
    document.body.classList.remove("picker-open");
    $("#picker-stage").innerHTML = "";
    pickerOnPick = null;
  }

  function renderProjectPicker() {
    const stage = $("#picker-stage");
    stage.innerHTML = "";
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    const groups = state.groups;
    const items = [...groups, { add: true }];

    const counts = groups.map((g) => ideasOfGroup(g.id).length);
    const maxCount = Math.max(1, ...counts);
    const base = Math.max(64, Math.min(140, Math.sqrt((W * H * 0.28) / items.length)));
    const maxSize = Math.min(W, H) * 0.4;
    const sizes = items.map((it, i) =>
      it.add
        ? Math.min(base * 0.7, 90)
        : Math.min(
            Math.max(base * (0.75 + 0.45 * (counts[i] / maxCount)), sizeForReadable(it.title || "Projecte sense títol", true, 0.56, 11)),
            maxSize
          )
    );
    const cx = W / 2;
    const cy = H / 2;
    const pts = sizes.map((sz, i) => {
      const r = items.length === 1 ? 0 : Math.sqrt((i + 0.5) / items.length) * 0.75;
      const a = i * 2.39996 + Math.sin(i * 1.7) * 0.4;
      return { x: cx + Math.cos(a) * r * (W / 2 - 30), y: cy + Math.sin(a) * r * (H / 2 - 30), r: sz / 2 };
    });
    relaxCircles(pts, W, H, { gap: 16, pull: { x: cx, y: cy, k: 0.005 }, top: 8, bottom: H - 8 });

    items.forEach((it, i) => {
      const size = sizes[i];
      const { x, y } = pts[i];
      const el = document.createElement("button");
      el.type = "button";
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.transform = `translate3d(${(x - size / 2).toFixed(1)}px, ${(y - size / 2).toFixed(1)}px, 0)`;
      const seed = nodeSeed(it.add ? "picker-add" : it.id);
      el.style.setProperty("--dx", `${((seed.bend) * 7).toFixed(1)}px`);
      el.style.setProperty("--dy", `${((seed.breath - 0.33) * 30).toFixed(1)}px`);
      el.style.setProperty("--float-dur", `${(5 + seed.fx1 * 12).toFixed(2)}s`);
      el.style.setProperty("--float-delay", `${(-seed.p1).toFixed(2)}s`);

      if (it.add) {
        el.className = "map-idea map-add picker-bubble";
        el.innerHTML = `<span class="map-add-plus" aria-hidden="true">+</span><span class="map-add-label">Nou projecte</span>`;
        el.addEventListener("click", async () => {
          const name = prompt("Nom del projecte nou:");
          if (!name || !name.trim()) return;
          try {
            const created = await window.PB_DB.createGroup({ title: name.trim() });
            state.groups.unshift(created);
            pickGroup(created.id);
          } catch (err) {
            console.error(err);
            toast("No s'ha pogut crear el projecte");
          }
        });
      } else {
        el.className = "map-bubble picker-bubble";
        el.style.setProperty("--bubble-color", catColorVar(groupSlot(it)));
        el.innerHTML = `
          <span class="map-bubble-title">${escapeHtml(it.title || "Projecte sense títol")}</span>
          <span class="map-bubble-count">${ideasLabel(counts[i])}</span>
          ${mapBadgeHtml(it)}`;
        el.setAttribute("aria-label", `Sincronitza amb ${it.title}`);
        fitBubbleText(el, ".map-bubble-title", 0.56);
        el.addEventListener("click", () => pickGroup(it.id));
      }
      stage.appendChild(el);
    });
  }

  function pickGroup(groupId) {
    const onPick = pickerOnPick;
    closeProjectPicker();
    if (onPick) onPick(groupId);
  }

  function wireProjectPicker() {
    $("#picker-close").addEventListener("click", closeProjectPicker);
    $("#project-picker").addEventListener("click", (e) => {
      if (e.target.id === "project-picker") closeProjectPicker();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("#project-picker").hidden) closeProjectPicker();
    });
    window.addEventListener(
      "resize",
      debounce(() => {
        if (!$("#project-picker").hidden) renderProjectPicker();
      }, 200)
    );
  }

  function unfocusMap() {
    if (!state.mapFocusId) return;
    removeIdeaNodes(true);
    state.mapFocusId = null;
    $("#map-stage").classList.remove("is-focused");
    map.nodes.forEach((n) => {
      if (n.kind !== "group") return;
      n.el.classList.remove("is-focus");
      n.tx = n.home.x;
      n.ty = n.home.y;
      n.tsize = n.home.size;
    });
    resetMapBar();
  }

  /* ---------------------------------------------------------------------
   * Estadístiques
   * ------------------------------------------------------------------- */

  function renderStats() {
    const empty = $("#stats-empty");
    const hasData = state.projects.length > 0;
    empty.hidden = hasData;
    $$("#view-stats .stats-grid, #view-stats .stats-section").forEach((el) => (el.hidden = !hasData));
    if (!hasData) {
      $("#stats-hero").innerHTML = "";
      return;
    }
    // Les gràfiques per categoria fan servir la del projecte de cada idea
    const ideas = state.projects.map((p) => ({ ...p, category: ideaCategory(p), categories: ideaCategories(p) }));
    window.PB_CHARTS.renderAll({
      ideas,
      groups: state.groupsAvailable ? state.groups : [],
      categories: state.categories,
      ideaName,
      onOpenIdea: (id) => openDetail(id, "stats"),
    });
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
    showBootLoader();
    $("#view-setup").hidden = true;
    $("#view-auth").hidden = true;
    $("#app").hidden = false;
    $("#user-chip").textContent =
      (user.user_metadata && user.user_metadata.name) || user.email;

    try {
      await loadData();
      renderCaptureChips();
      showView(isMobile() ? "capture" : "dashboard");
    } finally {
      hideBootLoader();
    }
  }

  /* ---------------------------------------------------------------------
   * Accés (login / registre)
   * ------------------------------------------------------------------- */

  let authMode = "login";

  function showAuth() {
    hideBootLoader();
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
        const { data, error } = await trackBusy(window.sb.auth.signUp({
          email,
          password,
          options: { data: name ? { name } : {} },
        }), true);
        if (error) throw error;
        if (!data.session) {
          setAuthMode("login");
          setAuthMessage("Compte creat. Confirma'l des del correu que t'hem enviat i després entra.", true);
        }
      } else {
        const { error } = await trackBusy(window.sb.auth.signInWithPassword({ email, password }), false);
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
    fillBulbIcons();
    trackDatabaseCalls();
    checkForNewVersion();
    wireNav();
    wireCapture();
    wireDetail();
    wireGroups();
    wireAutoGrow();

    $("#search-input").addEventListener("input", debounce(renderDashboard, 150));
    $("#group-search-input").addEventListener("input", debounce(renderGroups, 150));
    $("#sort-select").addEventListener("change", renderDashboard);

    if (!window.PB_READY) {
      hideBootLoader();
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
