const fs = require('fs');
const path = require('path');

const PREDICTIONS_FILE = path.join(__dirname, 'predictions.json');
const WEIGHTS_FILE = path.join(__dirname, 'weights.json');
const LEAGUES_FILE = path.join(__dirname, 'leagues.json');

function loadJSON(file, def) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  return def;
}
function saveJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

function loadPredictions() { return loadJSON(PREDICTIONS_FILE, []); }
function savePredictions(p) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const filtered = p.filter(pred => {
    if (pred.correct === null) return true;
    if (pred.timestamp) { const t = new Date(pred.timestamp).getTime(); if (t > cutoff) return true; }
    return false;
  });
  saveJSON(PREDICTIONS_FILE, filtered);
}
function loadWeights() { return loadJSON(WEIGHTS_FILE, { version: 1, learningRate: 0.05, global: {}, byLeague: {}, stats: { predictionsCount: 0, correctCount: 0 } }); }
function saveWeights(w) { w.lastUpdated = new Date().toISOString(); saveJSON(WEIGHTS_FILE, w); }
function loadLeagues() { return loadJSON(LEAGUES_FILE, {}); }
function saveLeagues(l) { saveJSON(LEAGUES_FILE, l); }

function getAlertsSent(match, minute) {
  const predictions = loadPredictions();
  const key = `${match}_${minute}`;
  const existing = predictions.find(p => p.key === key);
  return existing ? (existing._sentAlerts || []) : [];
}

function markAlertsSent(match, minute, alertKeys) {
  const predictions = loadPredictions();
  const key = `${match}_${minute}`;
  const existing = predictions.find(p => p.key === key);
  if (existing) {
    existing._sentAlerts = [...new Set([...(existing._sentAlerts || []), ...alertKeys])];
    savePredictions(predictions);
  }
}

function storePrediction(result) {
  const predictions = loadPredictions();
  const key = `${result.match}_${result.minute}`;
  const existing = predictions.find(p => p.key === key);
  if (existing) {
    Object.assign(existing, { result, timestamp: new Date().toISOString(), match: result.match, league: result.league, minute: result.minute, score: result.score, corners: result.corners, projected: result.projected, stats: result.stats, teamAlerts: result.teamAlerts, totalAlerts: result.totalAlerts, key, correct: null, finalScore: null, finalCorners: null });
    return;
  }
  predictions.push({ result, timestamp: new Date().toISOString(), match: result.match, league: result.league, minute: result.minute, score: result.score, corners: result.corners, projected: result.projected, stats: result.stats, teamAlerts: result.teamAlerts, totalAlerts: result.totalAlerts, key, correct: null, finalScore: null, finalCorners: null, _sentAlerts: [] });
  savePredictions(predictions);
}

async function verifyPredictions(liveMatches, verifyFn) {
  const predictions = loadPredictions();
  const weights = loadWeights();
  const leagues = loadLeagues();
  let verified = 0;

  for (const pred of predictions) {
    if (pred.correct !== null) continue;

    const match = liveMatches.find(m => {
      const n = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const [home, away] = pred.match.split(' vs ');
      return (n(m.homeTeam).includes(n(home)) || n(home).includes(n(m.homeTeam))) &&
             (n(m.awayTeam).includes(n(away)) || n(away).includes(n(m.awayTeam)));
    });

    if (match && match.minute >= 90) {
      const finalCorners = await verifyFn(match.gameId, match.homeId, match.awayId);
      if (!finalCorners) continue;
      pred.finalScore = { home: match.scoreHome, away: match.scoreAway };
      pred.finalCorners = finalCorners;

      const totalPredicted = pred.projected.total;
      const totalActual = finalCorners.home + finalCorners.away;
      const diff = Math.abs(totalActual - totalPredicted);
      pred.correct = diff <= 3;
      if (pred.correct) weights.stats.correctCount++;
      weights.stats.predictionsCount++;
      verified++;

      if (!leagues[pred.league]) leagues[pred.league] = { matches: 0, totalCorners: 0, totalProjected: 0, totalCrosses: 0, totalShotsBox: 0 };
      const lp = leagues[pred.league];
      lp.matches++;
      lp.totalCorners += totalActual;
      lp.totalProjected += totalPredicted;
      lp.totalCrosses += pred.stats.crosses;
      lp.totalShotsBox += pred.stats.shotsInsideBox;

      console.log(`  VERIFIED: ${pred.match} — Actual: ${totalActual} vs Proy: ${totalPredicted} (${pred.correct ? '✓' : '✗'})`);
    }
  }

  if (verified > 0) {
    savePredictions(predictions);
    saveWeights(weights);
    saveLeagues(leagues);
  }

  return verified;
}

function printReport() {
  const predictions = loadPredictions();
  const weights = loadWeights();
  const leagues = loadLeagues();

  let total = 0, correct = 0;
  for (const p of predictions) {
    if (p.correct === true) { correct++; total++; }
    else if (p.correct === false) total++;
  }
  const accuracy = total > 0 ? (correct / total * 100).toFixed(1) : '-';

  console.log('');
  console.log('='.repeat(50));
  console.log('  APRENDIZAJE — REPORTE');
  console.log('='.repeat(50));
  console.log(`  Predicciones: ${predictions.length} | Verificadas: ${total} | Precision: ${accuracy}%`);
  console.log(`  Aciertos: ${correct} | Fallos: ${total - correct}`);

  const leagueEntries = Object.entries(leagues).filter(([, l]) => l.matches >= 2);
  if (leagueEntries.length > 0) {
    console.log('\n  --- LIGAS ---');
    leagueEntries.sort((a, b) => b[1].matches - a[1].matches).slice(0, 5).forEach(([name, l]) => {
      const avgC = (l.totalCorners / l.matches).toFixed(1);
      const avgP = (l.totalProjected / l.matches).toFixed(1);
      const err = (Math.abs(l.totalCorners - l.totalProjected) / l.matches).toFixed(1);
      console.log(`  ${name.slice(0, 30).padEnd(30)} ${l.matches} part | Prom ${avgC} | Proy ${avgP} | Error ${err}`);
    });
  }
  console.log('');
}

module.exports = { storePrediction, verifyPredictions, printReport, getAlertsSent, markAlertsSent };
