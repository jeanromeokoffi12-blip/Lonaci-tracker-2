// ══════════════════════════════════════
// LOTTO-CI SCRAPER — server.js
// Scrape lotobonheur.ci (Next.js SPA) avec Puppeteer
// ══════════════════════════════════════
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const TARGET_URL = 'https://lotobonheur.ci/resultats';

// Options de lancement compatibles avec l'environnement Render.com
const LAUNCH_OPTIONS = {
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu'
  ]
};

// ── Fonction utilitaire : ouvre une page et attend le rendu JS ──
async function chargerPage(url, selectorAttendu) {
  const browser = await puppeteer.launch(LAUNCH_OPTIONS);
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
  try {
    const browser = await puppeteer.launch(LAUNCH_OPTIONS);
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
    );
    await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    // ⚠️ SÉLECTEURS PROVISOIRES — à ajuster avec ce que /api/debug révèle.
    // Idée générale : chaque bloc de tirage contient un nom de jeu + une liste
    // de numéros gagnants + une liste de numéros machine.
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

    await browser.close();
    res.json({ source: TARGET_URL, recupere_le: new Date().toISOString(), resultats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Page d'accueil simple pour vérifier que le serveur tourne ──
app.get('/', (req, res) => {
  res.send('Lotto-CI Scraper actif. Routes : /api/debug, /api/resultats');
});

app.listen(PORT, () => {
  console.log(`Serveur lancé sur le port ${PORT}`);
});
