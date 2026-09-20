// Dictat per veu en català (Web Speech API). Funciona a Chrome/Edge i Safari
// recents; si el navegador no ho suporta, l'opció de micro es desactiva
// silenciosament i l'usuari escriu la idea a mà.
window.PB_SPEECH = (function () {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = !!SpeechRecognition;

  function createSession({ onInterim, onFinalChunk, onEnd, onError }) {
    if (!supported) return null;
    const rec = new SpeechRecognition();
    rec.lang = "ca-ES";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          onFinalChunk(transcript.trim());
        } else {
          interim += transcript;
        }
      }
      if (interim) onInterim(interim);
    };

    rec.onerror = (event) => onError && onError(event.error);
    rec.onend = () => onEnd && onEnd();

    return {
      start: () => rec.start(),
      stop: () => rec.stop(),
    };
  }

  return { supported, createSession };
})();
