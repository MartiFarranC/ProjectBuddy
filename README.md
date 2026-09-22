# ProjectBuddy

El teu Notion personal per capturar i triar quins projectes val la pena fer.
Pensat per publicar-se tal qual a **GitHub Pages** (és 100% HTML/CSS/JS estàtic,
sense servidor propi).

## Què fa

- **Captura ràpida**: escriu o dicta (en català) la idea en el moment que la tens.
  Al mòbil, l'app obre directament la pantalla de captura; a l'ordinador, obre
  primer la llista de projectes.
- **Qüestionari fix** per a cada projecte: Dificultat, Necessitat, Ganes de
  fer-ho (1-5) i si depèn de hardware o recursos externs.
- **Data, hora i ubicació** de quan vas tenir la idea (la ubicació és un
  desplegable de xips: llocs predeterminats + els que tu afegeixis).
- **Categories** personalitzables per organitzar els projectes.
- **Estadístiques**: idees per setmana, per categoria, per ubicació, i una
  "matriu de prioritat" (necessitat vs. ganes, mida = com de fàcil) per ajudar-te
  a triar què fer primer.
- Disseny fosc, editorial i minimal, pensat per anar còmode amb TDAH: poques
  decisions per pantalla, desat automàtic, sense soroll visual innecessari.

## 1. Configura la base de dades (Supabase)

GitHub Pages no pot executar codi de servidor, així que les dades es guarden a
[Supabase](https://supabase.com) (gratuït) perquè les vegis igual des del mòbil
i des de l'ordinador.

1. Crea un compte i un projecte nou a supabase.com (triga ~2 minuts a
   provisionar-se).
2. Al menú lateral, ves a **SQL Editor** → **New query**, enganxa tot el
   contingut de [`sql/schema.sql`](sql/schema.sql) i prem **Run**. Això crea les
   taules `projects`, `categories`, `locations`.
3. Ves a **Project Settings → API** i copia:
   - `Project URL`
   - `anon public` key
4. Obre [`js/config.js`](js/config.js) i enganxa aquests dos valors.

No hi ha cap login, compte ni contrasenya: obres la pàgina i ja hi ets, directe.

> ⚠️ **Això vol dir que la URL en si és tota la protecció que tens.**
> Qualsevol persona que l'obri (o que trobi la clau `anon`, que és pública al
> codi font de la pàgina) pot llegir i esborrar les teves idees — no hi ha cap
> usuari ni permís pel mig. No comparteixis ni publicitis l'enllaç, i si mai
> vols tornar-hi a posar una mica de protecció (contrasenya, login...), torna-
> m'ho a demanar.

## 2. Publica a GitHub Pages

```bash
git init
git add .
git commit -m "ProjectBuddy inicial"
git branch -M main
git remote add origin https://github.com/<el-teu-usuari>/ProjectBuddy.git
git push -u origin main
```

A GitHub: **Settings → Pages → Source: Deploy from a branch → `main` / `/(root)`**.
En un parell de minuts la pàgina serà a `https://<el-teu-usuari>.github.io/ProjectBuddy/`.

## Notes sobre el dictat de veu

El botó del micròfon fa servir la Web Speech API del navegador amb `lang="ca-ES"`.
Funciona molt bé a **Chrome, Edge i Safari** (mòbil i escriptori). Firefox
d'escriptori no la suporta: el botó es desactiva sol i sempre pots escriure la
idea a mà. No es puja cap fitxer d'àudio enlloc — la transcripció es fa al
navegador i només es desa el text.

## Estructura del projecte

```
index.html          Estructura de totes les pantalles (SPA)
css/style.css        Tot el disseny i les animacions
js/config.js          Les teves claus de Supabase (edita aquest fitxer)
js/supabaseClient.js  Inicialització del client
js/db.js               CRUD de projectes, categories i ubicacions
js/speech.js           Dictat de veu en català
js/charts.js           Gràfiques de la pàgina d'estadístiques
js/app.js               Routing i tota la lògica d'interfície
sql/schema.sql        Taules + seguretat (executa'l a Supabase)
```

## Personalitzar

- **Categories/ubicacions predeterminades**: edita `DEFAULT_CATEGORIES` i
  `DEFAULT_LOCATIONS` a `js/db.js`.
- **Preguntes del qüestionari**: són fixes (Dificultat / Necessitat / Ganes /
  Hardware extern) tal com es va decidir; si en vols canviar el text o afegir-ne
  una, és tot a la secció `<!-- ---- Detall / qüestionari ---- -->` de
  `index.html` + `sql/schema.sql` per a una columna nova.
- **Colors**: variables CSS a la capçalera de `css/style.css` (`--cat-1`...`--cat-8`
  per a categories, `--accent` per als botons i elements interactius).
