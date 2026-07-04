// ══════════════════════════════════════
// LOTTO-CI SCRAPER — server.js
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

// ── Singleton navigateur : évite de relancer/extraire Chromium
// à chaque requête (cause principale de l'erreur ETXTBSY) ──
let browserInstance = null;
let launchingPromise = null; // empêche deux lancements simultanés

async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  // Si un lancement est déjà en cours, on attend son résultat
  // au lieu d'en démarrer un deuxième en parallèle.
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

// ── Fonction utilitaire : ouvre une page et attend le rendu JS ──
async function chargerPage(url, selectorAttendu) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
    );
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    if (selectorAttendu) {
      try {
        await page.waitForSelector(selectorAttendu, { timeout: 10000 });
      } catch (e) {
        // On continue même si le sélecteur précis n'est pas trouvé,
        // pour pouvoir inspecter le HTML reçu dans /api/debug
      }
    }

    const html = await page.content();
    return html;
  } finally {
    await page.close(); // on ferme la PAGE, pas le navigateur (qui est réutilisé)
  }
}

// ══════════════════════════════════════
// /api/debug — renvoie le HTML brut après rendu JS
// ══════════════════════════════════════
app.get('/api/debug', async (req, res) => {
  try {
    const html = await chargerPage(TARGET_URL, null);
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(html.slice(0, 50000));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
// /api/resultats — scraper réel
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

    // Laisse le JS Next.js finir de charger les résultats
    await new Promise(resolve => setTimeout(resolve, 5000));

    // ⚠️ SÉLECTEURS PROVISOIRES — à ajuster avec ce que /api/debug révèle.
    const resultats = await page.evaluate(() => {
      const blocs = Array.from(document.querySelectorAll('[class*="draw"], [class*="result"], [class*="tirage"]'));
      return blocs.map(bloc => {
        const nom = bloc.querySelector('[class*="name"], h2, h3')?.textContent?.trim() || null;
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

// ── Page d'accueil simple pour vérifier que le serveur tourne ──
app.get('/', (req, res) => {
  res.send('Lotto-CI Scraper actif. Routes : /api/debug, /api/resultats');
});

app.listen(PORT, () => {
  console.log(`Serveur lancé sur le port ${PORT}`);
});

// Ferme proprement le navigateur si le process s'arrête
process.on('SIGTERM', async () => {
  if (browserInstance) await browserInstance.close();
  process.exit(0);
});

// ══════════════════════════════════════
// LOTTO-CI SCRAPER — server.js
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

// Options de lancement compatibles avec l'environnement Render.com
async function getLaunchOptions() {
  return {
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  };
}

// ── Fonction utilitaire : ouvre une page et attend le rendu JS ──
async function chargerPage(url, selectorAttendu) {
  const browser = await puppeteer.launch(await getLaunchOptions());
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
    );
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    if (selectorAttendu) {
      try {
        await page.waitForSelector(selectorAttendu, { timeout: 10000 });
      } catch (e) {
        // On continue même si le sélecteur précis n'est pas trouvé,
        // pour pouvoir inspecter le HTML reçu dans /api/debug
      }
    }

    const html = await page.content();
    return html;
  } finally {
    await browser.close();
  }
}

// ══════════════════════════════════════
// /api/debug — renvoie le HTML brut après rendu JS
// Sert UNIQUEMENT à inspecter la structure réelle de la page
// pour calibrer les sélecteurs CSS du vrai scraper ci-dessous.
// ══════════════════════════════════════
app.get('/api/debug', async (req, res) => {
  try {
    const html = await chargerPage(TARGET_URL, null);
    res.set('Content-Type', 'text/plain; charset=utf-8');
    // On limite la taille pour éviter de saturer la réponse
    res.send(html.slice(0, 50000));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
// /api/resultats — scraper réel (À CALIBRER après inspection /api/debug)
// ══════════════════════════════════════
app.get('/api/resultats', async (req, res) => {
  let browser;
  try {
    browser = await puppeteer.launch(await getLaunchOptions());
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
    );
    await page.goto('https://lotobonheur.ci/resultats', { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForTimeout(5000); // laisse le JS Next.js finir de charger les résultats
const html = await page.content(); // capture le HTML APRÈS rendu
res.send(html);

    // ⚠️ SÉLECTEURS PROVISOIRES — à ajuster avec ce que /api/debug révèle.
    // Idée générale : chaque bloc de tirage contient un nom de jeu + une liste
    // de numéros gagnants + une liste de numéros machine.
    const resultats = await page.evaluate(() => {
      const blocs = Array.from(document.querySelectorAll('[class*="draw"], [class*="result"], [class*="tirage"]'));
      return blocs.map(bloc => {
        const nom = bloc.querySelector('[class*="name"], h2, h3')?.textContent?.trim() || 
