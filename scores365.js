const https = require('https');
const { CONFIG } = require('./config');

const API_BASE = 'https://webws.365scores.com/web';

function fetch(url) {
  return new Promise((ok, fail) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => ok(d));
    }).on('error', fail);
  });
}

function sanitizeLeague(league) {
  if (!league) return '';
  return league.replace(/\s+[A-Z0-9]{6,}$/i, '').trim() || league;
}

async function fetchTodayMatches(onlyLive = true) {
  const today = new Date();
  const dateStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
  let body;
  try {
    const liveParam = onlyLive ? '&onlyLiveGames=true' : '';
    body = await fetch(`${API_BASE}/games/allscores/?${CONFIG.API_PARAMS}&sports=1&startDate=${dateStr}&endDate=${dateStr}&showOdds=true&withTop=true&topBookmaker=4${liveParam}`);
  } catch { return []; }
  const j = JSON.parse(body);
  if (!j.games) return [];
  return j.games.map(g => ({
    gameId: g.id,
    homeTeam: g.homeCompetitor?.name || '?',
    awayTeam: g.awayCompetitor?.name || '?',
    homeId: g.homeCompetitor?.id,
    awayId: g.awayCompetitor?.id,
    scoreHome: g.homeCompetitor?.score ?? 0,
    scoreAway: g.awayCompetitor?.score ?? 0,
    minute: g.gameTime || 0,
    league: sanitizeLeague(g.competitionDisplayName || ''),
    competitionId: g.competitionId,
    hasStats: g.hasStats,
    statusGroup: g.statusGroup,
    statusText: g.statusText,
  }));
}

async function fetchLiveMatches() {
  const all = await fetchTodayMatches(true);
  return all.filter(g => g.statusGroup === 3 && g.minute > 0 && g.minute < 90);
}

async function fetchFinishedToday() {
  const all = await fetchTodayMatches(false);
  return all.filter(g => g.statusGroup === 4 || g.statusText === 'Finalizado');
}

async function fetchMatchStats(gameId, homeId, awayId) {
  let body;
  try {
    body = await fetch(`${API_BASE}/game/stats/?${CONFIG.API_PARAMS}&games=${gameId}`);
  } catch { return null; }
  const j = JSON.parse(body);
  if (!j.statistics || j.statistics.length === 0) return null;

  const stats = { home: {}, away: {}, raw: j.statistics };
  const map = {
    'Posesión': 'possession',
    'Saques de Esquina': 'corners',
    'Centros': 'crosses',
    'Remates dentro del área': 'shotsInsideBox',
    'Total Remates': 'totalShots',
    'Remates a Puerta': 'shotsOnTarget',
    'Remates Fuera': 'shotsOffTarget',
    'Remates bloqueados': 'blockedShots',
    'Grandes chances': 'bigChances',
    'Ataques': 'attacks',
    'Saques de falta': 'freeKicks',
    'Total de pases': 'totalPasses',
    'Pases completados': 'passesCompleted',
    'Pases claves': 'keyPasses',
    'Pases en el último tercio': 'passesFinalThird',
    'Saques de banda': 'throwIns',
    'Faltas': 'fouls',
    'Intercepciones': 'interceptions',
    'Despejes': 'clearances',
    'Barridas ganadas': 'tacklesWon',
    'Regates': 'dribbles',
    'Duelos ganados': 'duelsWon',
    'Duelos aéreos (ganados)': 'aerialDuelsWon',
  };

  function parseStatValue(val) {
    if (!val) return 0;
    const s = String(val);
    // Format: "6/19 (32%)" → extract total (19)
    const slash = s.indexOf('/');
    if (slash !== -1) {
      const afterSlash = s.slice(slash + 1).trim();
      const space = afterSlash.indexOf(' ');
      return parseFloat(space !== -1 ? afterSlash.slice(0, space) : afterSlash) || 0;
    }
    // Format: "52%" → strip % and parse
    return parseFloat(s) || 0;
  }

  for (const s of j.statistics) {
    let side;
    if (s.competitorId === homeId) side = 'home';
    else if (s.competitorId === awayId) side = 'away';
    else continue;
    const key = map[s.name];
    if (key) stats[side][key] = parseStatValue(s.value);
  }

  for (const side of ['home', 'away']) {
    if (stats[side].possession === undefined) stats[side].possession = 50;
    if (stats[side].corners === undefined) stats[side].corners = 0;
    if (stats[side].attacks === undefined) stats[side].attacks = 0;
    if (stats[side].crosses === undefined) stats[side].crosses = 0;
    if (stats[side].shotsInsideBox === undefined) stats[side].shotsInsideBox = 0;
    if (stats[side].totalShots === undefined) stats[side].totalShots = 0;
    if (stats[side].shotsOnTarget === undefined) stats[side].shotsOnTarget = 0;
  }

  return stats;
}

module.exports = { fetchLiveMatches, fetchFinishedToday, fetchMatchStats };
