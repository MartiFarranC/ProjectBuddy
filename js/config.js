// ProjectBuddy · configuració de connexió a Supabase
//
// 1. Crea un projecte gratuït a https://supabase.com
// 2. Ves a Project Settings → API i copia "Project URL" i "anon public" key
// 3. Enganxa-les aquí sota
//
// Aquesta clau és pública per disseny: sola no dona accés a cap dada. Cal
// entrar amb un usuari i les polítiques RLS (sql/schema.sql) fan que cadascú
// només vegi els seus projectes.
window.PB_CONFIG = {
  SUPABASE_URL: "https://mjdbqbcyensvyvhzegrc.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_HQ6ONekZFvOOVqgQTqqbig_91-f45mi",
};
