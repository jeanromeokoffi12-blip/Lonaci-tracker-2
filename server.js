const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
const PORT = process.env.PORT || 3000;

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
        const titreEl = carte.querySelector('h5');
        const tirageNom = titreEl ? titreEl.textContent.trim() : null;

        const boules = carte.querySelectorAll('.bg-green-700.rounded-full');
        const numeros = Array.from(boules).map((b) => b.textContent.trim());

        if (tirageNom && numeros.length > 0) {
          data.push({ jour: jourLabel, tirage: tirageNom, numeros });
        }
      });
    });

    return data;
  });

  return resultats;
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
    res.json({ success: true, count: resultats.length, resultats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (page) await page.close();
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
