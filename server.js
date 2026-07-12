const parseJourEnDate = require('./parseJourEnDate');
const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Supabase ----
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
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

// ---- Scraping ----
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

// ---- Sauvegarde Supabase ----
async function sauvegarderTirages(resultats) {
  const rows = resultats.map((r) => ({
    date_tirage: parseJourEnDate(r.jour),
    tirage: r.tirage,
    gagnants: r.gagnants,
    machine: r.machine,
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

app.get('/api/resultats', async (req, res) => {
  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    const resultats = await scrapeResultats(page);

    try {
      await sauvegarderTirages(resultats);
    } catch (saveErr) {
      console.error('Erreur sauvegarde Supabase:', saveErr.message);
    }

    res.json({ success: true, count: resultats.length, resultats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (page) await page.close();
  }
});

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

    res.json({ success: true, count: data.length, historique: data });
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
