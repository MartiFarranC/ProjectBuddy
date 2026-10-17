// Detecció al text dictat: si la idea diu que és una millora, una feature o
// una correcció, o esmenta el nom d'un projecte, ho proposem a l'usuari.
// És permissiva a propòsit (accents, majúscules, variants i errors típics del
// dictat); per això l'app sempre demana confirmació abans d'aplicar-ho.
window.PB_DETECT = (function () {
  const STOPWORDS = new Set([
    "de", "del", "dels", "la", "el", "els", "les", "lo", "los", "las", "i", "y", "a", "al", "als",
    "per", "amb", "con", "en", "un", "una", "uns", "unes", "que", "es", "the", "of", "and", "my", "meu", "meva",
  ]);

  // Minúscules, sense accents ni puntuació
  function normalize(text) {
    return (text || "")
      .toLowerCase()
      .replace(/l·l/g, "ll")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Paraules (ja normalitzades) que indiquen cada tipus. Inclou castellà,
  // anglès i com sol transcriure el dictat català «feature» (fitxer, fíxer…).
  const KIND_PATTERNS = {
    millora: [/\bmillor(a|es|ar|em|eu|ant)\b/, /\bmejor(a|as|ar)\b/, /\bimprove(ment|ments)?\b/],
    correccio: [
      /\bcorrecci(o|ons|on|ones)\b/,
      /\bcorregir\b/,
      /\bcorreg(eix|im|iu)\b/,
      /\bcorrect(ion|ions)?\b/,
      /\bbugs?\b/,
      /\berror(s|es)?\b/,
      /\berrad(a|es)\b/,
      /\barregl(ar|a|em|eu)\b/,
      /\bfix(ar)?\b/,
      /\bfallo(s)?\b/,
    ],
    feature: [
      /\bfeatures?\b/,
      /\bfitxers?\b/,
      /\bfixers?\b/,
      /\bfitur(e|es|s)?\b/,
      /\bfichers?\b/,
      /\bnova funcio(nalitat)?\b/,
      /\bfuncio(nalitat)? nova\b/,
      /\bfuncionalitat(s)?\b/,
      /\bfuncionalidad(es)?\b/,
    ],
  };

  // El tipus que apareix primer al text
  function detectKind(text) {
    const norm = normalize(text);
    let best = null;
    Object.entries(KIND_PATTERNS).forEach(([value, patterns]) => {
      patterns.forEach((re) => {
        const m = norm.match(re);
        if (m && (!best || m.index < best.index)) best = { value, word: m[0], index: m.index };
      });
    });
    return best;
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = dp[j];
        dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return dp[b.length];
  }

  // Una paraula del text s'assembla prou a una paraula del nom del projecte?
  // Les curtes han de ser iguals; les llargues toleren una lletra mal
  // transcrita o una terminació diferent (automàtic / automàtica).
  // Paraules que el dictat pot dir d'una altra manera
  const SYNONYMS = {
    app: ["aplicacio", "aplicacions", "aplicacion", "application", "apps"],
    web: ["pagina", "website", "webs"],
  };

  function wordMatches(word, target) {
    if (word === target) return true;
    if (SYNONYMS[target] && SYNONYMS[target].includes(word)) return true;
    if (target.length <= 4) return false;
    const stem = target.slice(0, Math.max(5, target.length - 2));
    if (target.length >= 7 && word.startsWith(stem)) return true;
    return 1 - levenshtein(word, target) / Math.max(word.length, target.length) >= 0.8;
  }

  const PROJECT_WORDS = new Set(["projecte", "projectes", "proyecto", "proyectos", "project", "projects"]);

  // Projecte que el text esmenta, o null
  function detectProject(text, groups) {
    const norm = normalize(text);
    const words = norm.split(" ").filter(Boolean);
    let best = null;

    groups.forEach((g) => {
      const title = normalize(g.title);
      if (!title) return;
      let tokens = title.split(" ").filter((t) => t.length >= 3 && !STOPWORDS.has(t));
      if (!tokens.length) tokens = title.split(" ").filter((t) => t.length >= 2);
      if (!tokens.length) return;

      let score;
      let lastMatch = -1;
      if ((" " + norm + " ").includes(" " + title + " ")) {
        score = 1;
        lastMatch = words.indexOf(tokens[0]);
      } else {
        let matched = 0;
        tokens.forEach((t) => {
          const idx = words.findIndex((w) => wordMatches(w, t));
          if (idx >= 0) {
            matched++;
            if (lastMatch < 0 || idx < lastMatch) lastMatch = idx;
          }
        });
        // Noms llargs: n'hi ha prou amb la meitat de les paraules importants
        const needed = tokens.length <= 2 ? tokens.length : Math.max(2, Math.ceil(tokens.length * 0.5));
        if (matched < needed) return;
        score = matched / tokens.length;
      }

      // Si just abans diu «projecte …», encara més segur
      const before = words.slice(Math.max(0, lastMatch - 3), Math.max(0, lastMatch));
      if (before.some((w) => PROJECT_WORDS.has(w))) score += 0.15;

      if (!best || score > best.score) best = { group: g, score };
    });

    return best ? best.group : null;
  }

  // Tot el que s'ha detectat en una idea
  function detect(text, groups) {
    return { kind: detectKind(text), group: detectProject(text, groups || []) };
  }

  return { normalize, detectKind, detectProject, detect };
})();
