// Dictat per veu en català (Web Speech API). Funciona a Chrome/Edge i Safari
// recents; si el navegador no ho suporta, l'opció de micro es desactiva
// silenciosament i l'usuari escriu la idea a mà.
window.PB_SPEECH = (function () {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = !!SpeechRecognition;

  const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const words = (s) => s.split(/\s+/).filter(Boolean);

  // Chrome d'Android no es comporta com l'escriptori: amb `continuous` torna
  // a enviar resultats finals que ja havia enviat, sovint acumulats ("hola",
  // "hola com", "hola com estàs") i amb un `resultIndex` que no és fiable.
  // Per això refem el text sencer a partir de tots els resultats i ens
  // quedem amb la versió més llarga de cada frase repetida.
  function mergeFinals(results) {
    const parts = [];
    for (let i = 0; i < results.length; i++) {
      if (!results[i].isFinal) continue;
      const text = results[i][0].transcript.trim();
      if (!text) continue;
      const last = parts[parts.length - 1];
      if (last !== undefined) {
        if (norm(text).startsWith(norm(last))) {
          parts[parts.length - 1] = text;
          continue;
        }
        if (norm(last).includes(norm(text))) continue;
      }
      parts.push(text);
    }
    return parts.join(" ");
  }

  // Treu de `text` el principi que ja coincideix amb `already` (per paraules)
  function stripKnownPrefix(text, already) {
    const a = words(already);
    const t = words(text);
    let i = 0;
    while (i < a.length && i < t.length && norm(a[i]) === norm(t[i])) i++;
    return i === a.length ? t.slice(i).join(" ") : null;
  }

  function createSession({ onInterim, onFinalChunk, onEnd, onError, onSpeechStart, onSpeechEnd }) {
    if (!supported) return null;
    const rec = new SpeechRecognition();
    rec.lang = "ca-ES";
    rec.continuous = true;
    rec.interimResults = true;

    // Text final ja enviat en aquesta tirada del reconeixement
    let emitted = "";

    rec.onresult = (event) => {
      const full = mergeFinals(event.results);
      if (full && norm(full) !== norm(emitted)) {
        let delta = stripKnownPrefix(full, emitted);
        if (delta === null) {
          // El reconeixedor ha corregit text anterior: només afegim el que
          // va més enllà del que ja havíem enviat
          delta = norm(emitted).includes(norm(full))
            ? ""
            : words(full).slice(words(emitted).length).join(" ");
        }
        if (words(full).length >= words(emitted).length) emitted = full;
        if (delta) onFinalChunk(delta);
      }

      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        if (!event.results[i].isFinal) interim += event.results[i][0].transcript;
      }
      interim = interim.trim();
      if (interim) {
        // A Android el parcial sovint repeteix tot el que ja és final
        const rest = stripKnownPrefix(interim, emitted);
        if (rest !== null) interim = rest;
        else if (norm(emitted).includes(norm(interim))) interim = "";
      }
      onInterim && onInterim(interim);
    };

    rec.onerror = (event) => onError && onError(event.error);
    rec.onspeechstart = () => onSpeechStart && onSpeechStart();
    rec.onspeechend = () => onSpeechEnd && onSpeechEnd();
    rec.onend = () => onEnd && onEnd();

    return {
      start: () => {
        emitted = "";
        rec.start();
      },
      stop: () => rec.stop(),
    };
  }

  return { supported, createSession };
})();
