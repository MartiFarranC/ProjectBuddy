// Inicialitza el client de Supabase (la llibreria es carrega via CDN a index.html,
// exposa un global `supabase` amb .createClient)
window.PB_READY = false;
window.sb = null;

(function initSupabase() {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.PB_CONFIG || {};
  const configured =
    SUPABASE_URL &&
    SUPABASE_ANON_KEY &&
    !SUPABASE_URL.includes("POSA_AQUI") &&
    !SUPABASE_ANON_KEY.includes("POSA_AQUI");

  if (!configured) {
    console.warn(
      "[ProjectBuddy] Falta configurar Supabase a js/config.js — mira el README."
    );
    return;
  }

  window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  window.PB_READY = true;
})();
