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
  res.status(200).json({ status: 'o
