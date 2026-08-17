/**
 * analyseEtFiltrage.js
 * Module combiné : analyse des sommes de tirages LONACI (5 numéros)
 * + génération/filtrage de lignes de système réduit (4 numéros)
 * Compatible avec le schéma AnalytixLoto PRO (numeros_gagnants / numeros_machine)
 *
 * Usage typique :
 *   import {
 *     analyseSommes, renderSommesChart, filterCombinaisonsParSomme,
 *     calculerScoresChaudFroid, selectionnerPool, filtrerLignes,
 *     classerParChaleur, optimiserTableauAvecHistorique
 *   } from './analyseEtFiltrage.js';
 *
 *   const tirages = await getAllTiragesFromIndexedDB();
 *   const lignesBrutes = [...]; // les 38 lignes issues du générateur de système réduit
 *   const resultat = optimiserTableauAvecHistorique(lignesBrutes, tirages, {
 *     champTirage: 'numeros_gagnants',
 *     fenetreChaudFroid: 20,
 *     topN: 15
 *   });
 *   console.log(resultat.lignes); // lignes finales sélectionnées
 */

// ============================================================
// PARTIE 1 — ANALYSE DES SOMMES (inchangé, ton module existant)
// ============================================================

function computeSum(numeros) {
  if (!Array.isArray(numeros)) return null;
  return numeros.reduce((acc, n) => acc + Number(n), 0);
}

function analyseSommes(tirages, champ = 'numeros_gagnants', tailleBin = 10) {
  const sommes = tirages
    .map(t => computeSum(t[champ]))
    .filter(s => s !== null && !isNaN(s));

  if (sommes.length === 0) {
    return { histogram: [], mostFrequentRange: null, stats: null, total: 0 };
  }

  const min = Math.min(...sommes);
  const max = Math.max(...sommes);
  const avg = sommes.reduce((a, b) => a + b, 0) / sommes.length;
  const sorted = [...sommes].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  const binStart = Math.floor(min / tailleBin) * tailleBin;
  const binEnd = Math.ceil(max / tailleBin) * tailleBin;
  const bins = {};
  for (let b = binStart; b < binEnd; b += tailleBin) {
    bins[b] = 0;
  }
  sommes.forEach(s => {
    const bin = Math.floor(s / tailleBin) * tailleBin;
    bins[bin] = (bins[bin] || 0) + 1;
  });

  const histogram = Object.entries(bins)
    .map(([bin, count]) => ({
      rangeStart: Number(bin),
      rangeEnd: Number(bin) + tailleBin - 1,
      count,
      pourcentage: +((count / sommes.length) * 100).toFixed(2)
    }))
    .sort((a, b) => a.rangeStart - b.rangeStart);

  const mostFrequentBin = histogram.reduce((max, cur) => (cur.count > max.count ? cur : max), histogram[0]);

  return {
    histogram,
    mostFrequentRange: mostFrequentBin,
    stats: { min, max, avg: +avg.toFixed(2), median, echantillon: sommes.length },
    total: sommes.length
  };
}

function renderSommesChart(containerId, resultat) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!resultat || resultat.total === 0) {
    container.innerHTML = '<p>Aucune donnée disponible.</p>';
    return;
  }

  const { histogram, mostFrequentRange, stats } = resultat;
  const maxCount = Math.max(...histogram.map(h => h.count));

  let html = `
    <div class="sommes-stats">
      <p><strong>Échantillon :</strong> ${stats.echantillon} tirages</p>
      <p><strong>Min :</strong> ${stats.min} | <strong>Max :</strong> ${stats.max} | <strong>Moyenne :</strong> ${stats.avg} | <strong>Médiane :</strong> ${stats.median}</p>
      <p><strong>Zone la plus fréquente :</strong> ${mostFrequentRange.rangeStart}–${mostFrequentRange.rangeEnd}
      (${mostFrequentRange.count} tirages, ${mostFrequentRange.pourcentage}%)</p>
    </div>
    <div class="sommes-histogram">
  `;

  histogram.forEach(bin => {
    const largeur = maxCount > 0 ? Math.round((bin.count / maxCount) * 100) : 0;
    const isTop = bin.rangeStart === mostFrequentRange.rangeStart;
    html += `
      <div class="bin-row" style="display:flex;align-items:center;margin:2px 0;font-size:12px;">
        <span style="width:70px;">${bin.rangeStart}-${bin.rangeEnd}</span>
        <div style="background:${isTop ? '#22c55e' : '#60a5fa'};height:14px;width:${largeur}%;min-width:2px;margin-right:6px;border-radius:2px;"></div>
        <span>${bin.count} (${bin.pourcentage}%)</span>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
}

function filterCombinaisonsParSomme(combinaisons, minSum, maxSum) {
  return combinaisons.filter(combo => {
    const s = computeSum(combo);
    return s >= minSum && s <= maxSum;
  });
}

// ============================================================
// PARTIE 2 — SCORING CHAUD/FROID ET SÉLECTION DE POOL
// ============================================================

/**
 * Calcule un score de "chaleur" pour chaque numéro 1-90 à partir de l'historique.
 * @param {Array} tirages - tes objets tirages (schéma AnalytixLoto)
 * @param {string} champ - 'numeros_gagnants' ou 'numeros_machine'
 * @param {number} fenetre - nombre de derniers tirages à considérer
 */
function calculerScoresChaudFroid(tirages, champ = 'numeros_gagnants', fenetre = 20) {
  const recents = tirages.slice(-fenetre);
  const scores = {};

  for (let n = 1; n <= 90; n++) {
    let frequence = 0;
    let dernierVu = -1;

    recents.forEach((t, idx) => {
      const numeros = t[champ];
      if (Array.isArray(numeros) && numeros.map(Number).includes(n)) {
        frequence++;
        dernierVu = idx;
      }
    });

    const ecart = dernierVu === -1 ? recents.length : (recents.length - 1 - dernierVu);
    const score = frequence * 2 + Math.max(0, 5 - Math.abs(ecart - 3));

    scores[n] = { frequence, ecart, score };
  }

  return scores;
}

/**
 * Sélectionne un pool de N numéros en combinant chauds + numéros en écart critique.
 */
function selectionnerPool(scores, n = 10, ratioChauds = 0.7) {
  const entries = Object.entries(scores).map(([num, s]) => ({ num: parseInt(num), ...s }));

  const nbChauds = Math.round(n * ratioChauds);
  const nbEcart = n - nbChauds;

  const chauds = [...entries].sort((a, b) => b.frequence - a.frequence).slice(0, nbChauds);
  const enEcart = [...entries]
    .filter(e => !chauds.find(c => c.num === e.num))
    .sort((a, b) => b.ecart - a.ecart)
    .slice(0, nbEcart);

  return [...chauds, ...enEcart].map(e => e.num).sort((a, b) => a - b);
}

// ============================================================
// PARTIE 3 — FILTRAGE DES LIGNES DU SYSTÈME RÉDUIT
// ============================================================

/**
 * Adapte une zone de somme calculée sur des tirages de 5 numéros
 * à une échelle de lignes de 4 numéros (mise à l'échelle proportionnelle).
 * @param {Object} stats - stats.min / stats.max / stats.avg issus de analyseSommes()
 * @param {number} tailleLigne - taille des lignes du système réduit (4)
 * @param {number} tailleTirage - taille des tirages LONACI (5)
 */
function adapterSommeRange(stats, tailleLigne = 4, tailleTirage = 5) {
  const ratio = tailleLigne / tailleTirage;
  return {
    sommeMin: Math.round(stats.min * ratio * 0.85), // marge de tolérance -15%
    sommeMax: Math.round(stats.max * ratio * 1.15)  // marge de tolérance +15%
  };
}

/**
 * Filtre les lignes du système réduit selon des critères statistiques.
 * @param {Array} lignes - array de lignes [n1,n2,n3,n4]
 */
function filtrerLignes(lignes, criteres = {}) {
  const {
    sommeMin = 0,
    sommeMax = 360,
    parites = [1, 2, 3],
    desinencesMin = 2,
    etalementMax = 90
  } = criteres;

  return lignes.filter(ligne => {
    const somme = ligne.reduce((a, b) => a + b, 0);
    if (somme < sommeMin || somme > sommeMax) return false;

    const nbPairs = ligne.filter(n => n % 2 === 0).length;
    if (!parites.includes(nbPairs)) return false;

    const desinences = new Set(ligne.map(n => n % 10));
    if (desinences.size < desinencesMin) return false;

    const etalement = Math.max(...ligne) - Math.min(...ligne);
    if (etalement > etalementMax) return false;

    return true;
  });
}

/**
 * Classe les lignes restantes par score de "chaleur" cumulé et retourne le top N.
 */
function classerParChaleur(lignes, scores, topN = 15) {
  const lignesAvecScore = lignes.map(ligne => {
    const scoreTotal = ligne.reduce((sum, n) => sum + (scores[n]?.score || 0), 0);
    return { ligne, scoreTotal };
  });

  lignesAvecScore.sort((a, b) => b.scoreTotal - a.scoreTotal);

  return lignesAvecScore.slice(0, topN).map(l => l.ligne);
}

// ============================================================
// PARTIE 4 — PIPELINE COMPLET (pont entre les deux modules)
// ============================================================

/**
 * Pipeline complet : analyse des sommes historiques -> adaptation d'échelle
 * -> scoring chaud/froid -> filtrage des lignes -> classement final.
 *
 * @param {Array} lignesBrutes - les lignes générées par le système réduit (ex: 38 lignes de 4 numéros)
 * @param {Array} tirages - historique complet des tirages (schéma AnalytixLoto)
 * @param {Object} options
 * @param {string} options.champTirage - 'numeros_gagnants' ou 'numeros_machine'
 * @param {number} options.fenetreChaudFroid - fenêtre pour le scoring chaud/froid
 * @param {Object} options.criteresManuels - si fourni, override le calcul auto de sommeMin/Max
 * @param {number} options.topN - nombre de lignes finales à garder
 */
function optimiserTableauAvecHistorique(lignesBrutes, tirages, options = {}) {
  const {
    champTirage = 'numeros_gagnants',
    fenetreChaudFroid = 20,
    criteresManuels = null,
    topN = 15
  } = options;

  // 1. Analyse des sommes sur l'historique complet (tirages de 5 numéros)
  const analyseSommeResult = analyseSommes(tirages, champTirage, 10);

  // 2. Adaptation de la zone de somme à l'échelle 4 numéros
  const sommeRange = analyseSommeResult.stats
    ? adapterSommeRange(analyseSommeResult.stats)
    : { sommeMin: 0, sommeMax: 360 };

  const criteres = criteresManuels || {
    sommeMin: sommeRange.sommeMin,
    sommeMax: sommeRange.sommeMax,
    parites: [1, 2, 3],
    desinencesMin: 2,
    etalementMax: 90
  };

  // 3. Scoring chaud/froid
  const scores = calculerScoresChaudFroid(tirages, champTirage, fenetreChaudFroid);

  // 4. Filtrage des lignes
  const lignesFiltrees = filtrerLignes(lignesBrutes, criteres);

  // 5. Classement final par chaleur
  const lignesFinales = classerParChaleur(lignesFiltrees, scores, topN);

  return {
    analyseSommeResult,
    sommeRangeAdaptee: sommeRange,
    criteresUtilises: criteres,
    nbLignesInitial: lignesBrutes.length,
    nbLignesApresFiltre: lignesFiltrees.length,
    nbLignesFinal: lignesFinales.length,
    lignes: lignesFinales
  };
}

// ============================================================
// EXPORTS
// ============================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    // sommes
    computeSum,
    analyseSommes,
    renderSommesChart,
    filterCombinaisonsParSomme,
    // chaud/froid + pool
    calculerScoresChaudFroid,
    selectionnerPool,
    // filtrage lignes
    adapterSommeRange,
    filtrerLignes,
    classerParChaleur,
    // pipeline
    optimiserTableauAvecHistorique
  };
}
