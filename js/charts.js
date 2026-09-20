// ProjectBuddy · gràfiques de la pàgina d'estadístiques (Chart.js)
window.PB_CHARTS = (function () {
  let charts = {};

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

  function destroy(key) {
    if (charts[key]) {
      charts[key].destroy();
      charts[key] = null;
    }
  }

  function baseGrid() {
    return {
      color: cssVar("--gridline"),
      drawTicks: false,
    };
  }

  function baseTicks() {
    return {
      color: cssVar("--muted"),
      font: { family: "system-ui, -apple-system, 'Segoe UI', sans-serif", size: 11 },
    };
  }

  Chart.defaults.font.family = "system-ui, -apple-system, 'Segoe UI', sans-serif";
  Chart.defaults.color = cssVar("--muted");

  function renderHero(projects) {
    const total = projects.length;
    const done = projects.filter((p) => p.questionnaire_done);
    const avg = (key) =>
      done.length ? (done.reduce((s, p) => s + (p[key] || 0), 0) / done.length).toFixed(1) : "—";
    const pending = total - done.length;

    const tiles = [
      { num: total, lbl: "Idees totals" },
      { num: avg("difficulty"), lbl: "Dificultat mitjana" },
      { num: avg("necessity"), lbl: "Necessitat mitjana" },
      { num: avg("desire"), lbl: "Ganes mitjanes" },
      { num: pending, lbl: "Pendents de valorar" },
    ];

    document.getElementById("stats-hero").innerHTML = tiles
      .map((t) => `<div class="hero-tile"><div class="num">${t.num}</div><div class="lbl">${t.lbl}</div></div>`)
      .join("");
  }

  function renderTimeline(projects) {
    const ctx = document.getElementById("chart-timeline");
    destroy("timeline");

    const weekMap = new Map();
    projects.forEach((p) => {
      const d = new Date(p.created_at);
      const monday = new Date(d);
      const day = (d.getDay() + 6) % 7; // dilluns = 0
      monday.setDate(d.getDate() - day);
      monday.setHours(0, 0, 0, 0);
      const key = monday.toISOString().slice(0, 10);
      weekMap.set(key, (weekMap.get(key) || 0) + 1);
    });

    const keys = [...weekMap.keys()].sort();
    const labels = keys.map((k) => {
      const d = new Date(k);
      return d.toLocaleDateString("ca-ES", { day: "numeric", month: "short" });
    });
    const data = keys.map((k) => weekMap.get(k));
    const blue = cssVar("--cat-1");

    charts.timeline = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            data,
            borderColor: blue,
            backgroundColor: withAlpha(blue, 0.15),
            fill: true,
            tension: 0.35,
            pointRadius: 3,
            pointBackgroundColor: blue,
            borderWidth: 2,
          },
        ],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: baseTicks() },
          y: {
            beginAtZero: true,
            grid: baseGrid(),
            ticks: { ...baseTicks(), precision: 0 },
          },
        },
      },
    });
  }

  function renderCategory(projects, categories) {
    const ctx = document.getElementById("chart-category");
    destroy("category");

    const counts = new Map();
    projects.forEach((p) => {
      const name = p.category || "Sense categoria";
      counts.set(name, (counts.get(name) || 0) + 1);
    });

    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const labels = entries.map((e) => e[0]);
    const data = entries.map((e) => e[1]);
    const colors = labels.map((name) => {
      const slot = window.PB_DB.categorySlot(categories, name);
      return cssVar(`--cat-${slot}`);
    });

    charts.category = new Chart(ctx, {
      type: "bar",
      data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 4, maxBarThickness: 28 }] },
      options: {
        indexAxis: "y",
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, grid: baseGrid(), ticks: { ...baseTicks(), precision: 0 } },
          y: { grid: { display: false }, ticks: baseTicks() },
        },
      },
    });
  }

  function renderLocation(projects) {
    const ctx = document.getElementById("chart-location");
    destroy("location");

    const counts = new Map();
    projects.forEach((p) => {
      const name = p.location || "Sense ubicació";
      counts.set(name, (counts.get(name) || 0) + 1);
    });
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const blue = cssVar("--cat-1");

    charts.location = new Chart(ctx, {
      type: "bar",
      data: {
        labels: entries.map((e) => e[0]),
        datasets: [{ data: entries.map((e) => e[1]), backgroundColor: withAlpha(blue, 0.75), borderRadius: 4, maxBarThickness: 28 }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: baseTicks() },
          y: { beginAtZero: true, grid: baseGrid(), ticks: { ...baseTicks(), precision: 0 } },
        },
      },
    });
  }

  function renderPriority(projects, categories) {
    const ctx = document.getElementById("chart-priority");
    destroy("priority");

    const rated = projects.filter((p) => p.questionnaire_done);
    const counts = new Map();
    rated.forEach((p) => counts.set(p.category || "Sense categoria", (counts.get(p.category || "Sense categoria") || 0) + 1));
    const topCats = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);

    const groups = new Map();

    rated.forEach((p) => {
      const cat = p.category || "Sense categoria";
      const bucket = topCats.includes(cat) ? cat : "Altres";
      if (!groups.has(bucket)) groups.set(bucket, []);
      groups.get(bucket).push({
        x: p.necessity,
        y: p.desire,
        r: 6 + (6 - (p.difficulty || 3)) * 3,
        title: p.title,
      });
    });

    const datasets = [...groups.entries()].map(([name, points]) => {
      const isOther = name === "Altres";
      const solid = isOther ? cssVar("--muted") : cssVar(`--cat-${window.PB_DB.categorySlot(categories, name)}`);
      return {
        label: name,
        data: points,
        backgroundColor: withAlpha(solid, 0.55),
        borderColor: solid,
        borderWidth: 1.5,
      };
    });

    charts.priority = new Chart(ctx, {
      type: "bubble",
      data: { datasets },
      options: {
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: cssVar("--text-secondary"), boxWidth: 10, boxHeight: 10 },
          },
          tooltip: {
            callbacks: {
              label: (item) => `${item.raw.title} · Necessitat ${item.raw.x}, Ganes ${item.raw.y}`,
            },
          },
        },
        scales: {
          x: {
            min: 0.5,
            max: 5.5,
            title: { display: true, text: "Necessitat", color: cssVar("--muted") },
            grid: baseGrid(),
            ticks: baseTicks(),
          },
          y: {
            min: 0.5,
            max: 5.5,
            title: { display: true, text: "Ganes", color: cssVar("--muted") },
            grid: baseGrid(),
            ticks: baseTicks(),
          },
        },
      },
    });
  }

  function renderAll(projects, categories) {
    renderHero(projects);
    renderTimeline(projects);
    renderCategory(projects, categories);
    renderLocation(projects);
    renderPriority(projects, categories);
  }

  return { renderAll };
})();
