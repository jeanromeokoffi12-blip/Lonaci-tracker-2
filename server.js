// ══════════════════════════════════════
// LOTTO-CI SCRAPER — server.js (v2)
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
// /api/debug-network — CAPTURE TOUS LES APPELS API DE LA PAGE
// C'est la route clé : elle nous dit QUEL endpoint le site
// appelle réellement quand on sélectionne un tirage, et ce
// qu'il répond (JSON). Une fois qu'on connaît cet endpoint,
// on peut l'appeler directement sans même passer par Puppeteer.
// ══════════════════════════════════════
app.get('/api/debug-network', async (req, res) => {
  const browser = await getBrowser();
  const page = await browser.newPage();
  const capturedCalls = [];

  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
    );

    // Écoute toutes les réponses réseau, on garde celles qui ressemblent à une API (JSON)
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
        // ignore les réponses qui ne peuvent pas être lues (redirections, etc.)
      }
    });

    await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    // Essaie de cliquer sur le sélecteur de mois/tirage pour déclencher le chargement des données.
    // ⚠️ Sélecteur provisoire — on ajustera une fois qu'on voit le vrai DOM.
    try {
      // Le menu déroulant "Choisir..." est probablement un <select> ou un composant custom.
      const select = await page.$('select');
      if (select) {
        // Sélectionne la 2e option (index 1, la 1ere étant "Choisir...")
        await page.evaluate((sel) => {
          if (sel.options.length > 1) {
            sel.selectedIndex = 1;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, select);
      } else {
        // Sinon, tente un clic générique sur un élément contenant "Choisir"
        const [el] = await page.$x("//*[contains(text(), 'Choisir')]");
        if (el) await el.click();
      }
    } catch (e) {
      // on continue même si l'interaction échoue — on veut quand même voir ce qui a été capturé
    }

    // Laisse le temps aux appels réseau déclenchés de se terminer
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
// /api/debug — renvoie le HTML brut après rendu JS (diagnostic visuel)
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
// /api/resultats — scraper réel (à finaliser une fois l'endpoint connu)
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

    // ⚠️ SÉLECTEURS PROVISOIRES — à ajuster avec /api/debug-network
    const resultats = await page.evaluate(() => {
      const blocs = Array.from(document.querySelectorAll('[class*="draw"], [class*="result"], [class*="tirage"]'));
      return blocs.map(bloc => {
        const nom = bloc.querySelector('[class*="name"], h2, h3')?.textContent?.trim() || 'N/A';
        const nombres = Array.from(bloc.querySelectorAll('[class*="number"], [class*="ball"]'))
          .map(el => parseInt(el.textContent.trim(), 10))
          .filter(n => !isNaN(n));
        return { nom, nombres };
      }).filter(b => b.nom && b.nombres.length > 0);
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
