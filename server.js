const parseJourEnDate = require('./parseJourEnDate');
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- CORS : autorise les appels depuis ta PWA (GitHub Pages) ----
app.use(cors());

// ---- Supabase ----
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  { realtime: { params: { eventsPerSecond: 0 } } }
);

// ---- Singleton browser + verrou de concurrence ----
let browserInstance = null;
let launching = null;

async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }
  if (launching) {
    return launching;
  }
  launching = (async () => {
    browserInstance = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
    launching = null;
    return browserInstance;
  })();
  return launching;
}

// ---- Appel direct de l'API interne de lotobonheur.ci ----
async function fetchResultatsAPI(monthYear, drawType = 'Tous les tirages') {
  const url = `https://lotobonheur.ci/api/results?monthYear=${encodeURIComponent(monthYear)}&drawType=${encodeURIComponent(drawType)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36',
      'Accept': 'application/json',
      'Referer': 'https://lotobonheur.ci/resultats',
      'Accept-Language': 'fr-FR,fr;q=0.9',
    },
  });

  if (!response.ok) {
    throw new Error(`API a répondu avec le statut ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    throw new Error(`Réponse non-JSON reçue (content-type: ${contentType}). Début: ${text.slice(0, 300)}`);
  }

  return response.json();
}

// ---- Détermine le mois/année courant en français, ex: "juillet 2026" ----
function getMonthYearFR(date = new Date()) {
  const mois = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
  ];
  return `${mois[date.getMonth()]} ${date.getFullYear()}`;
}

// ---- Convertit un nom de mois FR en numéro (01-12) ----
const MOIS_FR_INDEX = {
  janvier: '01', février: '02', fevrier: '02', mars: '03', avril: '04',
  mai: '05', juin: '06', juillet: '07', août: '08', aout: '08',
  septembre: '09', octobre: '10', novembre: '11', décembre: '12', decembre: '12',
};

// ---- Déduit l'année ISO correcte pour un jour "jj/mm" donné un monthYear "août 2026" ----
// Gère le cas où la semaine affichée déborde sur le mois précédent/suivant
// (ex: on demande "janvier 2026" mais une ligne affiche "31/12")
function resoudreDateISO(jourMoisStr, monthYearFR) {
  const [jj, mm] = jourMoisStr.split('/');
  const match = (monthYearFR || '').toLowerCase().match(/([a-zéû]+)\s+(\d{4})/);

  if (!match) {
    return `${new Date().getFullYear()}-${mm}-${jj}`;
  }

  const [, moisNomDemande, anneeDemandee] = match;
  const mmDemande = MOIS_FR_INDEX[moisNomDemande] || null;

  let annee = parseInt(anneeDemandee, 10);

  if (mmDemande) {
    const moisDemandeNum = parseInt(mmDemande, 10);
    const moisLigneNum = parseInt(mm, 10);

    // Si le mois de la ligne ne correspond pas au mois demandé,
    // c'est un débordement de semaine sur le mois voisin
    if (moisLigneNum !== moisDemandeNum) {
      if (moisDemandeNum === 1 && moisLigneNum === 12) {
        annee -= 1; // ex: on est en janvier 2026, la ligne "31/12" -> décembre 2025
      } else if (moisDemandeNum === 12 && moisLigneNum === 1) {
        annee += 1; // ex: on est en décembre 2025, la ligne "01/01" -> janvier 2026
      }
      // sinon (débordement de quelques jours dans le même mois voisin proche), on garde l'année telle quelle
    }
  }

  return `${annee}-${mm}-${jj}`;
}

// ---- Parse la réponse JSON de l'API en une liste plate de tirages ----
// Structure réelle de l'API (vérifiée sur capture du 09/08/2026) :
// apiData.drawsResultsWeekly = [
//   { date: "dimanche 09/08", drawResults: { nightDraws: [...], standardDraws: [...] } },
//   { date: "samedi 08/08", drawResults: {...} },
//   ...
// ]
function parseApiResponse(apiData, monthYearFR) {
  const resultats = [];

  if (!apiData || !Array.isArray(apiData.drawsResultsWeekly)) {
    return resultats;
  }

  for (const jourData of apiData.drawsResultsWeekly) {
    const dateMatch = (jourData.date || '').match(/(\d{2})\/(\d{2})/);
    if (!dateMatch) continue;

    const dateISO = resoudreDateISO(dateMatch[0], monthYearFR);

    const nightDraws = jourData.drawResults?.nightDraws || [];
    const standardDraws = jourData.drawResults?.standardDraws || [];
    const tousLesTirages = [...nightDraws, ...standardDraws];

    for (const t of tousLesTirages) {
      if (!t.drawName || t.drawName === '-') continue;
      if (!t.winningNumbers || t.winningNumbers.includes('.')) continue; // tirage pas encore joué

      const gagnants = t.winningNumbers.split(' - ').map((n) => n.trim());
      const machine =
        t.machineNumbers && !t.machineNumbers.includes('.')
          ? t.machineNumbers.split(' - ').map((n) => n.trim())
          : [];

      resultats.push({
        date_tirage: dateISO,
        tirage: t.drawName,
        gagnants,
        machine,
      });
    }
  }

  return resultats;
}

// ---- Sauvegarde Supabase pour les résultats venant de l'API (date déjà en ISO) ----
async function sauvegarderTiragesAPI(resultats) {
  const seen = new Map();
  for (const r of resultats) {
    seen.set(`${r.date_tirage}__${r.tirage}`, r);
  }
  const resultatsUniques = Array.from(seen.values());

  const rows = resultatsUniques.map((r) => ({
    date_tirage: r.date_tirage,
    tirage: r.tirage,
    numeros_gagnants: r.gagnants,
    numeros_machine: r.machine,
  }));

  const { data, error } = await supabase
    .from('tirages')
    .upsert(rows, { onConflict: 'date_tirage,tirage' });

  if (error) throw error;
  return { data, count: rows.length };
}

// ---- Scraping Puppeteer (fallback, inchangé) ----
async function scrapeResultats(page) {
  await page.goto('https://lotobonheur.ci/resultats', {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });

  await page.waitForSelector('.bg-green-700.rounded-full', { timeout: 30000 });

  const resultats = await page.evaluate(() => {
    const semaines = document.querySelectorAll('div.pb-5');
    const data = [];

    semaines.forEach((semaineDiv) => {
      const jourH5 = semaineDiv.querySelector('h5');
      const jourLabel = jourH5 ? jourH5.textContent.trim() : null;

      const grid = semaineDiv.querySelector('.grid');
      if (!grid) return;

      const cartes = grid.querySelectorAll(':scope > div');

      cartes.forEach((carte) => {
        const titreEl = carte.querySelector('div.mt-2.font-bold.text-sm');
        const tirageNom = titreEl ? titreEl.textContent.trim() : null;

        const lignes = carte.querySelectorAll(
          'div.flex.flex-row.space-x-2.justify-start.items-center'
        );

        let gagnants = [];
        let machine = [];

        lignes.forEach((ligne) => {
          const label = ligne.querySelector('h5');
          if (!label) return;
          const boules = Array.from(
            ligne.querySelectorAll('.bg-green-700.rounded-full p')
          ).map((p) => p.textContent.trim());

          if (label.textContent.includes('Gagnants')) {
            gagnants = boules;
          } else if (label.textContent.includes('Machine')) {
            machine = boules;
          }
        });

        if (tirageNom && gagnants.length > 0) {
          data.push({ jour: jourLabel, tirage: tirageNom, gagnants, machine });
        }
      });
    });

    return data;
  });

  return resultats;
}

// ---- Déduplication (utilisée par le flux Puppeteer) ----
function dedupResultats(resultats) {
  const seen = new Map();
  for (const r of resultats) {
    const key = `${r.jour}__${r.tirage}`;
    seen.set(key, r);
  }
  return Array.from(seen.values());
}

// ---- Sauvegarde Supabase pour les résultats venant de Puppeteer (inchangé) ----
async function sauvegarderTirages(resultats) {
  const resultatsUniques = dedupResultats(resultats);

  const rows = resultatsUniques.map((r) => ({
    date_tirage: parseJourEnDate(r.jour),
    tirage: r.tirage,
    numeros_gagnants: r.gagnants,
    numeros_machine: r.machine,
  }));

  const { data, error } = await supabase
    .from('tirages')
    .upsert(rows, { onConflict: 'date_tirage,tirage' });

  if (error) throw error;
  return data;
}

// ---- Routes ----
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'LONACI Tracker API en ligne' });
});

app.get('/api/ping', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/debug-api', async (req, res) => {
  try {
    const monthYear = req.query.monthYear || 'décembre 2021';
    const drawType = req.query.drawType || 'Tous les tirages';
    const data = await fetchResultatsAPI(monthYear, drawType);
    res.json({ success: true, raw: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---- Route principale : API en priorité, Puppeteer en fallback ----
app.get('/api/resultats', async (req, res) => {
  const monthYear = req.query.monthYear || getMonthYearFR();
  const drawType = req.query.drawType || 'Tous les tirages';

  try {
    const apiData = await fetchResultatsAPI(monthYear, drawType);
    const resultats = parseApiResponse(apiData, monthYear);

    if (resultats.length === 0) {
      throw new Error('API a répondu mais aucun tirage exploitable trouvé');
    }

    const { count } = await sauvegarderTiragesAPI(resultats);

    return res.json({
      success: true,
      source: 'api',
      count,
      resultats,
    });
  } catch (apiErr) {
    console.error('fetchResultatsAPI a échoué, fallback Puppeteer:', apiErr.message);
  }

  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    const resultats = await scrapeResultats(page);

    try {
      await sauvegarderTirages(resultats);
    } catch (saveErr) {
      console.error('Erreur sauvegarde Supabase:', saveErr.message);
      return res.status(500).json({
        success: false,
        source: 'puppeteer',
        error: 'Erreur sauvegarde Supabase: ' + saveErr.message,
        resultats,
      });
    }

    res.json({ success: true, source: 'puppeteer', count: resultats.length, resultats });
  } catch (err) {
    res.status(500).json({ success: false, source: 'puppeteer', error: err.message });
  } finally {
    if (page) await page.close();
  }
});

// ---- Petit utilitaire : parse un champ qui peut être une string JSON ou déjà un tableau ----
function parseChampJSON(valeur) {
  if (Array.isArray(valeur)) return valeur;
  if (typeof valeur === 'string') {
    try {
      const parsed = JSON.parse(valeur);
      return Array.isArray(parsed) ? parsed : valeur;
    } catch {
      return valeur;
    }
  }
  return valeur;
}

app.get('/api/historique', async (req, res) => {
  try {
    const { date, tirage, limit } = req.query;

    let query = supabase
      .from('tirages')
      .select('*')
      .order('date_tirage', { ascending: false });

    if (date) query = query.eq('date_tirage', date);
    if (tirage) query = query.eq('tirage', tirage);
    query = query.limit(limit ? parseInt(limit) : 100);

    const { data, error } = await query;
    if (error) throw error;

    const historique = data.map((row) => ({
      ...row,
      numeros_gagnants: parseChampJSON(row.numeros_gagnants),
      numeros_machine: parseChampJSON(row.numeros_machine),
    }));

    res.json({ success: true, count: historique.length, historique });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/health-db', async (req, res) => {
  try {
    const { data, error } = await supabase.from('tirages').select('*').limit(1);
    if (error) throw error;
    res.json({ success: true, message: 'Connexion Supabase OK' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/debug', async (req, res) => {
  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.goto('https://lotobonheur.ci/resultats', {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });
    const html = await page.content();
    res.set('Content-Type', 'text/plain');
    res.send(html);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (page) await page.close();
  }
});

app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
