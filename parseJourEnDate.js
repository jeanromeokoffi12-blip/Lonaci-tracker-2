/**
 * Convertit une chaîne "Jour JJ/MM" (ex: "Mardi 07/07") en date complète
 * au format "YYYY-MM-DD", en gérant le changement d'année (ex: un tirage
 * de décembre scrapé en janvier).
 *
 * @param {string} jourStr - ex: "Mardi 07/07"
 * @returns {string|null} - ex: "2026-07-07", ou null si le format est invalide
 */
function parseJourEnDate(jourStr) {
  const match = jourStr.match(/(\d{2})\/(\d{2})/);
  if (!match) return null;
  const [, jour, mois] = match;
  const aujourdHui = new Date();
  let annee = aujourdHui.getFullYear();

  let dateCalculee = new Date(`${annee}-${mois}-${jour}`);
  const diffJours = (dateCalculee - aujourdHui) / (1000 * 60 * 60 * 24);

  // Si la date calculée est plus de 7 jours dans le futur,
  // c'est un tirage de l'année précédente (ex: décembre vu en janvier)
  if (diffJours > 7) {
    annee -= 1;
    dateCalculee = new Date(`${annee}-${mois}-${jour}`);
  }

  return `${annee}-${mois}-${jour}`;
}

module.exports = { parseJourEnDate };
