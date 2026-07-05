// ══════════════════════════════════════
// LOTTO-CI SCRAPER — server.js (v3 - sélecteurs corrigés)
// Scrape lotobonheur.ci (Next.js SPA) avec Puppeteer
// ══════════════════════════════════════
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const TARGET_URL = 'https://lotobonheur.ci/resultats';

// ── Singleton navigateur ──
let browserInstance = null;
let launchingPromise = null;

async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }
  if (launchingPromise) {
    return launchingPromise;
  }
  launchingPromise = (async () => {
    const executablePath = await chromium.executablePath();
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless,
    });
    browserInstance = browser;
    launchingPromise = null;
    return browser;
  })();
  return launchingPromise;
}

// ══════════════════════════════════════
// /api/debug-network — capture les appels JSON réseau de la page
// ══════════════════════════════════════
app.get('/api/debug-network', async (req, res) => {
  const browser = await getBrowser();
  const page = await browser.newPage();
  const capturedCalls = [];

  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
    );

    page.on('response', async (response) => {
      try {
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('application/json') && !url.includes('_next/static')) {
          const status = response.status();
          let body = null;
          try {
            body = await response.json();
          } catch (e) {
            body = '[corps non-JSON ou vide]';
          }
          capturedCalls.push({ url, status, body });
        }
      } catch (e) {
        // ignore
      }
    });

    await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    try {
      const select = await page.$('select');
      if (select) {
        await page.evaluate((sel) => {
          if (sel.options.length > 1) {
            sel.selectedIndex = 1;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, select);
      } else {
        const [el] = await page.$x("//*[contains(text(), 'Choisir')]");
        if (el) await el.click();
      }
    } catch (e) {
      // continue
    }

    await new Promise(resolve => setTimeout(resolve, 4000));

    res.json({
      note: 'Liste de tous les appels JSON capturés pendant le chargement + interaction',
      nombre_appels: capturedCalls.length,
      appels: capturedCalls,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    await page.close();
  }
});

// ══════════════════════════════════════
// /api/debug — renvoie le HTML brut après rendu JS
// ══════════════════════════════════════
app.get('/api/debug', async (req, res) => {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
    );
    await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 3000));
    const html = await page.content();
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(html.slice(0, 50000));
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    await page.close();
  }
});

// ══════════════════════════════════════
// /api/resultats — scraper réel avec sélecteurs calibrés
// sur la vraie structure Tailwind de lotobonheur.ci
// ══════════════════════════════════════
app.get('/api/resultats', async (req, res) => {
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
    );
    await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Sélecteurs calibrés sur la structure réelle (classes Tailwind génériques,
    // pas de classes sémantiques comme "draw" ou "result")
    const resultats = await page.evaluate(() => {
      // Chaque tirage = un div.flex.flex-col.space-y-2 qui contient un nom en gras
      // ET au moins une boule verte (bg-green-700). On filtre sur ces deux critères
      // pour éviter d'attraper d'autres blocs similaires ailleurs sur la page.
      const candidats = Array.from(document.querySelectorAll('div.flex.flex-col.space-y-2'));

      const blocs = candidats.filter(bloc =>
        bloc.querySelector('div.mt-2.font-bold.text-sm') &&
        bloc.querySelector('div.bg-green-700')
      );

      return blocs.map(bloc => {
        const nom = bloc.querySelector('div.mt-2.font-bold.text-sm')?.textContent?.trim() || 'N/A';

        // Chaque ligne "Gagnants :" / "Machine :" est un
        // div.flex.flex-row.space-x-2.justify-start.items-center
        const lignes = Array.from(
          bloc.querySelectorAll('div.flex.flex-row.space-x-2.justify-start.items-center')
        );

        const extraireNumeros = (ligne) =>
          Array.from(ligne.querySelectorAll('div.bg-green-700 p'))
            .map(p => parseInt(p.textContent.trim(), 10))
            .filter(n => !isNaN(n));

        let gagnants = [];
        let machine = [];

        lignes.forEach(ligne => {
          const label = ligne.querySelector('h5')?.textContent?.trim().toLowerCase() || '';
          const nums = extraireNumeros(ligne);
          if (label.includes('gagnant')) gagnants = nums;
          else if (label.includes('machine')) machine = nums;
        });

        return { nom, gagnants, machine };
      }).filter(b => b.nom !== 'N/A' && b.gagnants.length > 0);
    });

    res.json({ source: TARGET_URL, recupere_le: new Date().toISOString(), resultats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    if (page) await page.close();
  }
});

app.get('/', (req, res) => {
  res.send('Lotto-CI Scraper actif. Routes : /api/debug, /api/debug-network, /api/resultats');
});

app.listen(PORT, () => {
  console.log(`Serveur lancé sur le port ${PORT}`);
});

process.on('SIGTERM', async () => {
  if (browserInstance) await browserInstance.close();
  process.exit(0);
});
