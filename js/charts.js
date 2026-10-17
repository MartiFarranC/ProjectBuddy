// ProjectBuddy · pàgina d'estadístiques (Chart.js + peces en HTML)
//
// Colors per feina: els estats (sense començar / en procés / feta /
// abandonada) fan servir els colors d'estat, sempre amb text o símbol al
// costat; les categories i els tipus d'idea, la paleta categòrica en ordre
// fix; les magnituds d'una sola sèrie (setmanes, ubicacions, mapa de calor),
// un sol to.
window.PB_CHARTS = (function () {
  const charts = {};

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function withAlpha(hex, alpha) {
    const h = hex.replace("#", "");
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function destroy(key) {
    if (charts[key]) {
      charts[key].destroy();
      charts[key] = null;
    }
  }

  const FONT = "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";

  function ticks(extra) {
    return { color: cssVar("--muted"), font: { family: FONT, size: 11 }, ...(extra || {}) };
  }

  function grid() {
    return { color: cssVar("--gridline"), drawTicks: false };
  }

  function tooltip(extra) {
    return {
      backgroundColor: cssVar("--surface-3"),
      borderColor: cssVar("--border"),
      borderWidth: 1,
      titleColor: cssVar("--text"),
      bodyColor: cssVar("--text-secondary"),
      titleFont: { family: FONT, weight: "600" },
      bodyFont: { family: FONT },
      padding: 10,
      cornerRadius: 8,
      displayColors: true,
      boxWidth: 8,
      boxHeight: 8,
      boxPadding: 4,
      ...(extra || {}),
    };
  }

  if (window.Chart) {
    Chart.defaults.font.family = FONT;
    Chart.defaults.color = cssVar("--muted");
    Chart.defaults.maintainAspectRatio = false;
  }

  // Estats (colors d'estat, reservats) en ordre de "per fer" a "tancat"
  function statusList() {
    return [
      { value: "idea", label: "Sense començar", color: cssVar("--muted") },
      { value: "en_curs", label: "En procés", color: cssVar("--warning") },
      { value: "feta", label: "Fetes", color: cssVar("--good") },
      { value: "abandonada", label: "Abandonades", color: cssVar("--serious") },
    ];
  }

  function statusOf(p) {
    return p.status || "idea";
  }

  function emptyNote(boxId, text) {
    const box = document.getElementById(boxId);
    if (!box) return;
    box.style.height = "auto";
    box.innerHTML = `<p class="chart-empty">${escapeHtml(text)}</p>`;
  }

  // Les caixes de les gràfiques es buiden quan no hi ha dades; abans de
  // tornar a pintar cal recuperar el canvas
  function ensureCanvas(boxId, canvasId, height) {
    const box = document.getElementById(boxId);
    if (!box.querySelector("canvas")) box.innerHTML = `<canvas id="${canvasId}"></canvas>`;
    box.style.height = `${height}px`;
    return document.getElementById(canvasId);
  }

  /* ---------------- Xifres clau ---------------- */

  function startOfWeek(date) {
    const d = new Date(date);
    const day = (d.getDay() + 6) % 7; // dilluns = 0
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function dayKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  function currentStreak(ideas) {
    const days = new Set(ideas.map((p) => dayKey(p.created_at)));
    const d = new Date();
    if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1); // la ratxa es manté fins que acaba avui
    let n = 0;
    while (days.has(dayKey(d))) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  function renderHero({ ideas, groups }) {
    const total = ideas.length;
    const thisWeek = ideas.filter((p) => new Date(p.created_at) >= startOfWeek(new Date())).length;
    const done = ideas.filter((p) => statusOf(p) === "feta").length;
    const inProgress = ideas.filter((p) => statusOf(p) === "en_curs").length;
    const open = ideas.filter((p) => ["idea", "en_curs"].includes(statusOf(p))).length;
    const unlinked = ideas.filter((p) => !p.group_id).length;
    const pending = ideas.filter((p) => !p.questionnaire_done).length;
    const groupsActive = groups.filter((g) => statusOf(g) === "en_curs").length;

    // Mitjana de les últimes 8 setmanes (o menys, si fa poc que fas servir l'app)
    const first = ideas.reduce((m, p) => Math.min(m, new Date(p.created_at).getTime()), Date.now());
    const weeksUsed = Math.max(1, Math.min(8, Math.ceil((Date.now() - first) / (7 * 864e5))));
    const since = Date.now() - weeksUsed * 7 * 864e5;
    const perWeek = ideas.filter((p) => new Date(p.created_at).getTime() >= since).length / weeksUsed;
    const streak = currentStreak(ideas);

    const pct = total ? Math.round((done / total) * 100) : 0;
    const tiles = [
      { num: total, lbl: "Idees", sub: thisWeek ? `+${thisWeek} aquesta setmana` : "cap aquesta setmana" },
      { num: open, lbl: "Per fer", sub: `${inProgress} en procés` },
      { num: `${pct}%`, lbl: "Fetes", sub: `${done} de ${total}`, meter: pct },
      { num: groups.length, lbl: "Projectes", sub: `${groupsActive} en procés` },
      { num: perWeek.toFixed(perWeek < 10 ? 1 : 0), lbl: "Idees per setmana", sub: `mitjana de ${weeksUsed} setm.` },
      { num: streak, lbl: streak === 1 ? "Dia de ratxa" : "Dies de ratxa", sub: streak ? "seguits amb alguna idea" : "crea'n una avui" },
      { num: unlinked, lbl: "Sense projecte", sub: unlinked ? "sincronitza-les" : "totes enllaçades" },
      { num: pending, lbl: "Per valorar", sub: pending ? "falta la valoració" : "totes valorades" },
    ];

    document.getElementById("stats-hero").innerHTML = tiles
      .map(
        (t) => `<div class="hero-tile">
          <div class="num">${escapeHtml(t.num)}</div>
          <div class="lbl">${escapeHtml(t.lbl)}</div>
          <div class="sub">${escapeHtml(t.sub)}</div>
          ${t.meter !== undefined ? `<div class="meter" aria-hidden="true"><span style="width:${t.meter}%"></span></div>` : ""}
        </div>`
      )
      .join("");
  }

  /* ---------------- Estat de les idees (barra 100%) ---------------- */

  function renderStatusSplit({ ideas }) {
    const wrap = document.getElementById("stats-status-split");
    const total = ideas.length;
    const parts = statusList()
      .map((s) => ({ ...s, n: ideas.filter((p) => statusOf(p) === s.value).length }))
      .filter((s) => s.n > 0);

    const bar = parts
      .map(
        (s) =>
          `<span class="split-seg" style="flex:${s.n};background:${s.color}" title="${escapeHtml(s.label)}: ${s.n} (${Math.round((s.n / total) * 100)}%)"></span>`
      )
      .join("");
    const legend = parts
      .map(
        (s) => `<li><span class="legend-dot" style="background:${s.color}"></span>
          <span class="legend-name">${escapeHtml(s.label)}</span>
          <span class="legend-val">${s.n}</span>
          <span class="legend-pct">${Math.round((s.n / total) * 100)}%</span></li>`
      )
      .join("");
    wrap.innerHTML = `<div class="split-bar" role="img" aria-label="${escapeHtml(
      parts.map((s) => `${s.label}: ${s.n}`).join(", ")
    )}">${bar}</div><ul class="split-legend">${legend}</ul>`;
  }

  /* ---------------- Progrés per projecte (barres apilades) ---------------- */

  function renderProjects({ ideas, groups }) {
    destroy("projects");
    const MAX = 8;
    const rows = groups
      .map((g) => {
        const mine = ideas.filter((p) => p.group_id === g.id);
        const by = {};
        statusList().forEach((s) => (by[s.value] = mine.filter((p) => statusOf(p) === s.value).length));
        return { g, total: mine.length, by };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.by.idea + b.by.en_curs - (a.by.idea + a.by.en_curs) || b.total - a.total);

    const unlinked = ideas.filter((p) => !p.group_id);
    if (!rows.length) {
      emptyNote("box-projects", "Quan enllacis idees als projectes, aquí veuràs com avança cadascun.");
      return;
    }

    // Més de 8 projectes: la resta s'ajunta a "Altres"
    let shown = rows.slice(0, MAX);
    if (rows.length > MAX) {
      const rest = rows.slice(MAX);
      const by = {};
      statusList().forEach((s) => (by[s.value] = rest.reduce((n, r) => n + r.by[s.value], 0)));
      shown.push({ g: { title: `Altres (${rest.length})` }, total: rest.reduce((n, r) => n + r.total, 0), by });
    }
    if (unlinked.length) {
      const by = {};
      statusList().forEach((s) => (by[s.value] = unlinked.filter((p) => statusOf(p) === s.value).length));
      shown.push({ g: { title: "Sense projecte" }, total: unlinked.length, by });
    }

    const canvas = ensureCanvas("box-projects", "chart-projects", 46 + shown.length * 34);
    const surface = cssVar("--surface");
    charts.projects = new Chart(canvas, {
      type: "bar",
      data: {
        labels: shown.map((r) => r.g.title),
        datasets: statusList().map((s) => ({
          label: s.label,
          data: shown.map((r) => r.by[s.value]),
          backgroundColor: s.color,
          borderColor: surface,
          borderWidth: { left: 0, right: 2, top: 0, bottom: 0 }, // 2px entre segments
          borderSkipped: false,
          borderRadius: 3,
          maxBarThickness: 18,
        })),
      },
      options: {
        indexAxis: "y",
        interaction: { mode: "index", axis: "y", intersect: false },
        plugins: {
          legend: {
            position: "top",
            align: "start",
            labels: { color: cssVar("--text-secondary"), boxWidth: 9, boxHeight: 9, useBorderRadius: true, borderRadius: 5, font: { family: FONT, size: 12 } },
          },
          tooltip: tooltip({
            filter: (item) => item.raw > 0,
            callbacks: {
              footer: (items) => {
                const r = shown[items[0].dataIndex];
                const pct = r.total ? Math.round((r.by.feta / r.total) * 100) : 0;
                return `${r.total} idees · ${pct}% fetes`;
              },
            },
          }),
        },
        scales: {
          x: { stacked: true, beginAtZero: true, grid: grid(), ticks: ticks({ precision: 0 }), border: { display: false } },
          y: {
            stacked: true,
            grid: { display: false },
            border: { display: false },
            ticks: ticks({
              color: cssVar("--text-secondary"),
              font: { family: FONT, size: 12 },
              callback(value) {
                const label = this.getLabelForValue(value);
                const max = this.chart.width < 500 ? 14 : 26; // al mòbil hi ha menys lloc
                return label.length > max ? label.slice(0, max - 1) + "…" : label;
              },
            }),
          },
        },
      },
    });
  }

  /* ---------------- Què faig primer ---------------- */

  function priorityScore(p) {
    return (p.desire || 0) + (p.necessity || 0) - (p.difficulty || 0);
  }

  function renderTopIdeas({ ideas, groups, ideaName, onOpenIdea }) {
    const list = document.getElementById("stats-top-ideas");
    const candidates = ideas
      .filter((p) => p.questionnaire_done && ["idea", "en_curs"].includes(statusOf(p)))
      .sort((a, b) => priorityScore(b) - priorityScore(a) || new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5);

    if (!candidates.length) {
      list.innerHTML = `<li class="chart-empty">Valora algunes idees (dificultat, necessitat i ganes) i aquí sortiran les que més val la pena fer.</li>`;
      return;
    }
    list.innerHTML = candidates
      .map((p) => {
        const g = p.group_id && groups.find((x) => x.id === p.group_id);
        return `<li><button type="button" class="top-idea" data-id="${escapeHtml(p.id)}">
          <span class="top-idea-score" title="Prioritat">${priorityScore(p)}</span>
          <span class="top-idea-main">
            <span class="top-idea-title">${escapeHtml(ideaName(p))}</span>
            <span class="top-idea-meta">${g ? escapeHtml(g.title) + " · " : ""}D${p.difficulty} · N${p.necessity} · G${p.desire}${statusOf(p) === "en_curs" ? " · en procés" : ""}</span>
          </span>
        </button></li>`;
      })
      .join("");
    list.querySelectorAll(".top-idea").forEach((btn) => btn.addEventListener("click", () => onOpenIdea(btn.dataset.id)));
  }

  // Eixos de valoració: només 1, 2, 3, 4 i 5
  function scale1to5(scale) {
    scale.ticks = [1, 2, 3, 4, 5].map((value) => ({ value }));
  }

  function renderPriority({ ideas, categories, ideaName }) {
    destroy("priority");
    const canvas = document.getElementById("chart-priority");
    const rated = ideas.filter((p) => p.questionnaire_done && ["idea", "en_curs"].includes(statusOf(p)));

    // Les bombolles es trepitgen totes: com a molt tres colors (les tres
    // categories amb més idees); la resta, en gris a "Altres"
    const counts = new Map();
    rated.forEach((p) => counts.set(p.category || "Sense categoria", (counts.get(p.category || "Sense categoria") || 0) + 1));
    const topCats = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);

    const groupsMap = new Map();
    rated.forEach((p) => {
      const cat = p.category || "Sense categoria";
      const bucket = topCats.includes(cat) && cat !== "Sense categoria" ? cat : "Altres";
      if (!groupsMap.has(bucket)) groupsMap.set(bucket, []);
      groupsMap.get(bucket).push({ x: p.necessity, y: p.desire, r: 5 + (6 - (p.difficulty || 3)) * 2.6, title: ideaName(p), d: p.difficulty });
    });

    const surface = cssVar("--surface");
    const datasets = [...groupsMap.entries()]
      .sort((a, b) => (a[0] === "Altres") - (b[0] === "Altres"))
      .map(([name, points]) => {
        const solid = name === "Altres" ? cssVar("--muted") : cssVar(`--cat-${window.PB_DB.categorySlot(categories, name)}`);
        return { label: name, data: points, backgroundColor: withAlpha(solid, 0.6), borderColor: surface, borderWidth: 2, hoverBorderColor: solid };
      });

    charts.priority = new Chart(canvas, {
      type: "bubble",
      data: { datasets },
      options: {
        plugins: {
          legend: {
            display: datasets.length > 1,
            position: "bottom",
            labels: { color: cssVar("--text-secondary"), boxWidth: 9, boxHeight: 9, useBorderRadius: true, borderRadius: 5, font: { family: FONT, size: 12 } },
          },
          tooltip: tooltip({
            callbacks: {
              title: (items) => items[0].raw.title,
              label: (item) => `Necessitat ${item.raw.x} · Ganes ${item.raw.y} · Dificultat ${item.raw.d}`,
            },
          }),
        },
        scales: {
          x: { min: 0.5, max: 5.5, afterBuildTicks: scale1to5, title: { display: true, text: "Necessitat →", color: cssVar("--muted"), font: { family: FONT, size: 11 } }, grid: grid(), ticks: ticks(), border: { display: false } },
          y: { min: 0.5, max: 5.5, afterBuildTicks: scale1to5, title: { display: true, text: "Ganes →", color: cssVar("--muted"), font: { family: FONT, size: 11 } }, grid: grid(), ticks: ticks(), border: { display: false } },
        },
      },
    });
  }

  /* ---------------- Ritme ---------------- */

  function renderTimeline({ ideas }) {
    destroy("timeline");
    const canvas = document.getElementById("chart-timeline");
    const WEEKS = 16;
    const thisWeek = startOfWeek(new Date());
    const weeks = [];
    for (let i = WEEKS - 1; i >= 0; i--) {
      const d = new Date(thisWeek);
      d.setDate(d.getDate() - i * 7);
      weeks.push(d);
    }
    // Totes les setmanes, també les buides: si no, la línia enganya
    const counts = weeks.map((w, i) => {
      const next = i + 1 < weeks.length ? weeks[i + 1] : new Date(8.64e15);
      return ideas.filter((p) => {
        const t = new Date(p.created_at);
        return t >= w && t < next;
      }).length;
    });
    const labels = weeks.map((d) => d.toLocaleDateString("ca-ES", { day: "numeric", month: "short" }));
    const blue = cssVar("--cat-1");

    charts.timeline = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Idees",
            data: counts,
            borderColor: blue,
            backgroundColor: withAlpha(blue, 0.14),
            fill: true,
            tension: 0.3,
            cubicInterpolationMode: "monotone", // la corba no baixa mai de zero
            borderWidth: 2,
            pointRadius: counts.map((c, i) => (i === counts.length - 1 ? 4 : 0)),
            pointHoverRadius: 5,
            pointBackgroundColor: blue,
            pointBorderColor: cssVar("--surface"),
            pointBorderWidth: 2,
          },
        ],
      },
      options: {
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: tooltip({
            displayColors: false,
            callbacks: {
              title: (items) => `Setmana del ${items[0].label}`,
              label: (item) => `${item.raw} ${item.raw === 1 ? "idea" : "idees"}`,
            },
          }),
        },
        scales: {
          x: { grid: { display: false }, ticks: ticks({ maxRotation: 0, autoSkipPadding: 14 }), border: { display: false } },
          y: { beginAtZero: true, grid: grid(), ticks: ticks({ precision: 0 }), border: { display: false } },
        },
      },
    });
  }

  // Mapa de calor dia × franja horària (un sol to: més fosc = més idees)
  function renderHeatmap({ ideas }) {
    const wrap = document.getElementById("stats-heatmap");
    const days = ["Dl", "Dt", "Dc", "Dj", "Dv", "Ds", "Dg"];
    const fullDays = ["Dilluns", "Dimarts", "Dimecres", "Dijous", "Divendres", "Dissabte", "Diumenge"];
    const bands = [
      { label: "Matinada", short: "0–6 h", from: 0, to: 6 },
      { label: "Matí", short: "6–12 h", from: 6, to: 12 },
      { label: "Migdia", short: "12–16 h", from: 12, to: 16 },
      { label: "Tarda", short: "16–20 h", from: 16, to: 20 },
      { label: "Vespre", short: "20–24 h", from: 20, to: 24 },
    ];
    const grid = days.map(() => bands.map(() => 0));
    ideas.forEach((p) => {
      const d = new Date(p.created_at);
      const di = (d.getDay() + 6) % 7;
      const bi = bands.findIndex((b) => d.getHours() >= b.from && d.getHours() < b.to);
      grid[di][bi]++;
    });
    const max = Math.max(1, ...grid.flat());
    const blue = cssVar("--cat-1");

    // Dia i franja amb més idees, per dir-ho en text
    let best = null;
    grid.forEach((row, di) => row.forEach((n, bi) => {
      if (n && (!best || n > best.n)) best = { n, di, bi };
    }));

    let html = `<div class="heat-grid" style="grid-template-columns: auto repeat(${bands.length}, 1fr)">`;
    html += `<span></span>` + bands.map((b) => `<span class="heat-col">${b.label}<small>${b.short}</small></span>`).join("");
    grid.forEach((row, di) => {
      html += `<span class="heat-row">${days[di]}</span>`;
      row.forEach((n, bi) => {
        const a = n ? 0.18 + 0.82 * (n / max) : 0;
        html += `<span class="heat-cell${n ? "" : " zero"}" style="--heat:${n ? withAlpha(blue, a) : "transparent"}" title="${fullDays[di]}, ${bands[bi].label.toLowerCase()}: ${n} ${n === 1 ? "idea" : "idees"}">${n || ""}</span>`;
      });
    });
    html += `</div>`;
    html += best
      ? `<p class="heat-note">Quan més idees tens: <strong>${fullDays[best.di].toLowerCase()} ${bands[best.bi].label === "Matinada" ? "de matinada" : "al " + bands[best.bi].label.toLowerCase()}</strong> (${best.n}).</p>`
      : "";
    wrap.innerHTML = html;
  }

  /* ---------------- De què van ---------------- */

  function horizontalBars(key, boxId, canvasId, rows, emptyText) {
    destroy(key);
    if (!rows.length) {
      emptyNote(boxId, emptyText);
      return;
    }
    const canvas = ensureCanvas(boxId, canvasId, 30 + rows.length * 32);
    const total = rows.reduce((n, r) => n + r.value, 0);
    charts[key] = new Chart(canvas, {
      type: "bar",
      data: {
        labels: rows.map((r) => r.label),
        datasets: [{ data: rows.map((r) => r.value), backgroundColor: rows.map((r) => r.color), borderRadius: 4, borderSkipped: "start", maxBarThickness: 16 }],
      },
      options: {
        indexAxis: "y",
        plugins: {
          legend: { display: false },
          tooltip: tooltip({
            displayColors: false,
            callbacks: { label: (item) => `${item.raw} ${item.raw === 1 ? "idea" : "idees"} · ${Math.round((item.raw / total) * 100)}%` },
          }),
        },
        scales: {
          x: { beginAtZero: true, grid: grid(), ticks: ticks({ precision: 0 }), border: { display: false } },
          y: { grid: { display: false }, border: { display: false }, ticks: ticks({ color: cssVar("--text-secondary"), font: { family: FONT, size: 12 } }) },
        },
      },
    });
  }

  function renderKind({ ideas }) {
    const rows = window.PB_DB.IDEA_KINDS.map((k) => ({
      label: k.label,
      value: ideas.filter((p) => p.kind === k.value).length,
      color: cssVar(`--cat-${k.slot}`),
    })).filter((r) => r.value > 0);
    const none = ideas.filter((p) => !p.kind).length;
    if (none && rows.length) rows.push({ label: "Sense tipus", value: none, color: cssVar("--muted") });
    horizontalBars("kind", "box-kind", "chart-kind", rows, "Marca les idees com a feature, millora o correcció per veure-ho aquí.");
  }

  function renderCategory({ ideas, categories }) {
    const counts = new Map();
    // Una idea compta a cada categoria del seu projecte
    ideas.forEach((p) => {
      const names = p.categories && p.categories.length ? p.categories : p.category ? [p.category] : [];
      names.forEach((name) => counts.set(name, (counts.get(name) || 0) + 1));
    });
    let entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    // Com a molt 7 categories amb color; la resta, a "Altres"
    if (entries.length > 7) {
      const rest = entries.slice(7).reduce((n, e) => n + e[1], 0);
      entries = [...entries.slice(0, 7), ["Altres", rest]];
    }
    const rows = entries.map(([name, value]) => ({
      label: name,
      value,
      color: name === "Altres" ? cssVar("--muted") : cssVar(`--cat-${window.PB_DB.categorySlot(categories, name)}`),
    }));
    const none = ideas.filter((p) => !(p.categories && p.categories.length) && !p.category).length;
    if (none && rows.length) rows.push({ label: "Sense categoria", value: none, color: withAlpha(cssVar("--muted"), 0.6) });
    horizontalBars("category", "box-category", "chart-category", rows, "Les idees agafen la categoria del projecte: enllaça-les a projectes amb categoria.");
  }

  function renderLocation({ ideas }) {
    const counts = new Map();
    ideas.forEach((p) => {
      if (p.location) counts.set(p.location, (counts.get(p.location) || 0) + 1);
    });
    let entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (entries.length > 7) {
      const rest = entries.slice(7).reduce((n, e) => n + e[1], 0);
      entries = [...entries.slice(0, 7), ["Altres", rest]];
    }
    // Una sola sèrie de magnitud: un sol to
    const blue = cssVar("--cat-1");
    const rows = entries.map(([label, value]) => ({ label, value, color: label === "Altres" ? cssVar("--muted") : blue }));
    horizontalBars("location", "box-location", "chart-location", rows, "Encara no hi ha idees amb ubicació.");
  }

  function renderAll(data) {
    renderHero(data);
    renderStatusSplit(data);
    renderProjects(data);
    renderTopIdeas(data);
    renderPriority(data);
    renderTimeline(data);
    renderHeatmap(data);
    renderKind(data);
    renderCategory(data);
    renderLocation(data);
  }

  return { renderAll };
})();
