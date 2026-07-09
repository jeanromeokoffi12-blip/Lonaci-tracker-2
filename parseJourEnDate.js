
function parseJourEnDate(jourStr) {
  // Ex: "Mardi 07/07" -> "2026-07-07"
  const match = jourStr.match(/(\d{2})\/(\d{2})/);
  if (!match) return null;

  const jour = match[1];
  const mois = match[2];
  const anneeActuelle = new Date().getFullYear();

  return `${anneeActuelle}-${mois}-${jour}`;
}

module.exports = parseJourEnDate;
