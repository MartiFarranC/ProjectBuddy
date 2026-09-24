// Capa d'accés a dades: totes les consultes a Supabase passen per aquí.
window.PB_DB = (function () {
  // Categories i ubicacions predeterminades (viuen al client; les que
  // l'usuari afegeix ell mateix es guarden a Supabase i es fusionen amb aquestes)
  const DEFAULT_CATEGORIES = [
    { name: "App / Web", slot: 1 },
    { name: "Maquinari", slot: 2 },
    { name: "Art / Disseny", slot: 3 },
    { name: "Negoci", slot: 4 },
    { name: "Aprenentatge", slot: 5 },
    { name: "Automatització", slot: 6 },
    { name: "Joc", slot: 7 },
    { name: "Altres", slot: 8 },
  ];

  const DEFAULT_LOCATIONS = ["Casa", "Feina / Uni", "Transport", "Carrer"];

  const STATUSES = [
    { value: "idea", label: "Idea", color: "muted" },
    { value: "en_curs", label: "En curs", color: "warning" },
    { value: "feta", label: "Feta", color: "good" },
    { value: "abandonada", label: "Abandonada", color: "serious" },
  ];

  async function listProjects() {
    const { data, error } = await window.sb
      .from("projects")
      .select("*")
      .eq("archived", false)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }

  async function createProject(partial) {
    const { data, error } = await window.sb
      .from("projects")
      .insert([partial])
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function updateProject(id, patch) {
    const { data, error } = await window.sb
      .from("projects")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function deleteProject(id) {
    const { error } = await window.sb.from("projects").delete().eq("id", id);
    if (error) throw error;
  }

  async function listCategories() {
    const { data, error } = await window.sb
      .from("categories")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw error;
    const custom = (data || []).map((c) => ({ name: c.name, slot: c.color_slot }));
    return dedupeByName([...DEFAULT_CATEGORIES, ...custom]);
  }

  async function addCategory(name) {
    const slot = (Math.floor(Math.random() * 8) + 1);
    const { data, error } = await window.sb
      .from("categories")
      .insert([{ name, color_slot: slot }])
      .select()
      .single();
    if (error && error.code !== "23505") throw error; // 23505 = ja existia, ok
    return data;
  }

  async function listLocations() {
    const { data, error } = await window.sb
      .from("locations")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw error;
    const custom = (data || []).map((l) => l.name);
    return [...new Set([...DEFAULT_LOCATIONS, ...custom])];
  }

  async function addLocation(name) {
    const { error } = await window.sb
      .from("locations")
      .insert([{ name }]);
    if (error && error.code !== "23505") throw error;
  }

  function dedupeByName(list) {
    const seen = new Set();
    return list.filter((item) => {
      if (seen.has(item.name)) return false;
      seen.add(item.name);
      return true;
    });
  }

  function categorySlot(categories, name) {
    const found = categories.find((c) => c.name === name);
    return found ? found.slot : 8;
  }

  return {
    DEFAULT_CATEGORIES,
    DEFAULT_LOCATIONS,
    STATUSES,
    listProjects,
    createProject,
    updateProject,
    deleteProject,
    listCategories,
    addCategory,
    listLocations,
    addLocation,
    categorySlot,
  };
})();
