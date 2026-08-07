const { CONFIG } = require('./config');
const fs = require('fs');
const path = require('path');

// Cache para promedios históricos de corners por equipo (pre-match prior)
let _teamAvgCache = null;
let _teamAvgCacheTime = 0;

function getTeamAvgCorners(teamName) {
  if (!teamName) return 0;
  const now = Date.now();
  if (!_teamAvgCache || now - _teamAvgCacheTime > 10 * 60 * 1000) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(__dirname, 'predictions.json'), 'utf8'));
      _teamAvgCache = new Map();
      const byTeam = {};
      for (const pred of p) {
        if (pred.correct === null) continue;
        const actual = (pred.finalCorners?.home?.corners || 0) + (pred.finalCorners?.away?.corners || 0);
        const parts = pred.match.split(' vs ');
        for (const t of parts) {
          if (!t) continue;
          if (!byTeam[t]) byTeam[t] = { c: 0, t: 0 };
          byTeam[t].c += actual;
          byTeam[t].t++;
        }
      }
      for (const [name, data] of Object.entries(byTeam)) {
        if (data.t >= 3) _teamAvgCache.set(name.toLowerCase(), data.c / data.t);
      }
    } catch { _teamAvgCache = new Map(); }
    _teamAvgCacheTime = now;
  }
  return _teamAvgCache.get(teamName.toLowerCase()) || 0;
}

// Cache para promedios de corners por liga (pre-match prior)
function getLeagueAvgCorners(leagueName) {
  if (!leagueName) return 0;
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'leagues.json'), 'utf8');
    const data = JSON.parse(raw);
    const l = data[leagueName];
    if (l && l.matches >= 5) return l.totalCorners / l.matches;
  } catch { return 0; }
  return 0;
}

// Cache para corrección por bias histórico de liga
let _leagueBiasCache = null;
let _leagueBiasTime = 0;

function getLeagueBias(leagueName) {
  const now = Date.now();
  if (!_leagueBiasCache || now - _leagueBiasTime > 5 * 60 * 1000) {
    try {
      const raw = fs.readFileSync(path.join(__dirname, 'leagues.json'), 'utf8');
      const data = JSON.parse(raw);
      _leagueBiasCache = new Map();
      for (const [name, stats] of Object.entries(data)) {
        if (stats.matches >= 10 && stats.totalProjected > 0) {
          const bias = (stats.totalCorners - stats.totalProjected) / stats.matches;
          if (isNaN(bias) || !isFinite(bias)) continue; // ignorar datos corruptos
          // Guardar bias (negativo = sobre-proyectamos, positivo = sub-proyectamos)
          _leagueBiasCache.set(name.toLowerCase(), { bias, matches: stats.matches });
        }
      }
    } catch { _leagueBiasCache = new Map(); }
    _leagueBiasTime = now;
  }

  if (!leagueName) return 0;
  const info = _leagueBiasCache.get(leagueName.toLowerCase());
  if (!info || isNaN(info.bias)) return 0;
  
  // Aplicar bias, limitado a ±3 y escalado por cantidad de datos
  const confidence = Math.min(1, info.matches / 50); // más matches = más confianza
  return Math.max(-3, Math.min(3, info.bias * confidence));
}

// Factorial memoizado (n <= 15 es suficiente para Poisson con lambda <= 16)
const _fact = [1];
function factorial(n) {
  while (_fact.length <= n) _fact.push(_fact[_fact.length - 1] * _fact.length);
  return _fact[n];
}

// Poisson: eventos independientes. Subestima colas (sobredispersión 1.71x).
function poissonOver(lambda, k) {
  let cum = 0;
  for (let i = 0; i <= Math.floor(k); i++) {
    cum += Math.exp(-lambda) * Math.pow(lambda, i) / factorial(i);
  }
  return clampProb(Math.round((1 - cum) * 100));
}

// Binomial Negativa: modela corners en ráfagas (mejor para líneas altas).
// r = 2*lambda (sobredispersión ~1.5x), p = 0.667
function negBinOver(lambda, k) {
  const r = 2 * lambda;
  const p = 0.667;
  if (r <= 0 || p <= 0 || p >= 1) return poissonOver(lambda, k);
  let cum = 0;
  for (let i = 0; i <= Math.floor(k); i++) {
    // P(X=i) = C(i+r-1, i) * p^r * (1-p)^i
    // Usar log para estabilidad numérica
    let logP = r * Math.log(p) + i * Math.log(1 - p);
    // log(C(i+r-1, i)) = logGamma(i+r) - logGamma(i+1) - logGamma(r)
    // Aproximación iterativa del coeficiente binomial
    let combLog = 0;
    for (let j = 1; j <= i; j++) combLog += Math.log((r + j - 1) / j);
    cum += Math.exp(combLog + logP);
  }
  return clampProb(Math.round((1 - Math.min(1, cum)) * 100));
}

function clampProb(p) {
  return Math.min(CONFIG.POISSON_MAX_PROB, Math.max(CONFIG.POISSON_MIN_PROB, p));
}

/** Estimate missing stats when 365scores doesn't provide them */
function enrichStats(stats) {
  const h = stats.home, a = stats.away;
  // Solo estimar si el valor está ausente o es 0
  if ((!h.shotsInsideBox) && h.totalShots > 0) {
    h.shotsInsideBox = Math.round(h.totalShots * CONFIG.ENRICH_SHOTS_RATIO);
  }
  if ((!a.shotsInsideBox) && a.totalShots > 0) {
    a.shotsInsideBox = Math.round(a.totalShots * CONFIG.ENRICH_SHOTS_RATIO);
  }
  if ((!h.crosses) && h.attacks > 0) {
    h.crosses = Math.round(h.attacks * CONFIG.ENRICH_CROSSES_ATK_RATIO);
  }
  if ((!a.crosses) && a.attacks > 0) {
    a.crosses = Math.round(a.attacks * CONFIG.ENRICH_CROSSES_ATK_RATIO);
  }
  if ((!h.crosses) && h.totalShots > 0) {
    h.crosses = Math.round(h.totalShots * CONFIG.ENRICH_CROSSES_SHOTS_RATIO);
  }
  if ((!a.crosses) && a.totalShots > 0) {
    a.crosses = Math.round(a.totalShots * CONFIG.ENRICH_CROSSES_SHOTS_RATIO);
  }
}

function analyzeMatch(match, stats, minute) {
  const home = stats.home, away = stats.away;

  // Catchup/finished match: no necesita análisis
  if (minute >= 90) {
    const hc = home.corners || 0, ac = away.corners || 0;
    return {
      match: `${match.homeTeam} vs ${match.awayTeam}`,
      league: match.league, gameId: match.gameId, homeId: match.homeId, awayId: match.awayId,
      date: match.date || new Date().toISOString().slice(0, 10), minute,
      score: `${match.scoreHome}-${match.scoreAway}`,
      dataQuality: 'finished',
      corners: { home: hc, away: ac, total: hc + ac },
      projected: { home: hc, away: ac, total: hc + ac },
      stats: {
        crosses: (home.crosses||0) + (away.crosses||0),
        shotsInsideBox: (home.shotsInsideBox||0) + (away.shotsInsideBox||0),
        attacks: (home.attacks||0) + (away.attacks||0),
        possession: { home: home.possession||50, away: away.possession||50 },
        totalShots: (home.totalShots||0) + (away.totalShots||0),
      },
      teams: {
        home: { corners: hc, crosses: home.crosses||0, shotsInsideBox: home.shotsInsideBox||0, attacks: home.attacks||0, totalShots: home.totalShots||0 },
        away: { corners: ac, crosses: away.crosses||0, shotsInsideBox: away.shotsInsideBox||0, attacks: away.attacks||0, totalShots: away.totalShots||0 },
      },
      teamAlerts: [], totalAlerts: [],
    };
  }

  enrichStats(stats);

  const homeCorners = home.corners || 0;
  const awayCorners = away.corners || 0;
  const totalCorners = homeCorners + awayCorners;
  const hasActualCrosses = (home.crosses > 0 || away.crosses > 0);
  const hasActualShotsBox = (home.shotsInsideBox > 0 || away.shotsInsideBox > 0);
  const dataQuality = (hasActualCrosses && hasActualShotsBox) ? 'real' : 'estimated';
  const remaining = 90 - minute;
  const extraTime = minute >= 45 ? Math.max(1, Math.round(remaining * 0.08)) : 0;
  const minsLeft = (90 + extraTime) - minute;

  const goalDiff = match.scoreHome - match.scoreAway;

  function projectTeam(teamCurrent, teamStats, oppStats, needsGoal, isHome) {
    if (minute <= 0) return teamCurrent;
    const rate = teamCurrent / minute;
    const baseProj = teamCurrent + rate * minsLeft;

    const crossRate = (teamStats.crosses || 0) / minute;
    const shotRate = (teamStats.shotsInsideBox || 0) / minute;
    const attackRate = (teamStats.attacks || 0) / minute;

    const projFromCrosses = teamCurrent + crossRate * minsLeft * CONFIG.CORNER_CONVERSION_CROSS;
    const projFromShots = teamCurrent + shotRate * minsLeft * CONFIG.CORNER_CONVERSION_SHOTS;
    const projFromAttacks = teamCurrent + attackRate * minsLeft * CONFIG.CORNER_CONVERSION_ATTACKS;
    
    // Pases clave: buen predictor de peligro ofensivo
    const keyPassRate = (teamStats.keyPasses || 0) / minute;
    const projFromKeyPasses = teamCurrent + keyPassRate * minsLeft * CONFIG.CORNER_CONVERSION_KEYPASS;
    
    // Grandes chances: cada una suele generar peligro que resulta en corners
    const bigChanceBonus = (teamStats.bigChances || 0) * CONFIG.BIG_CHANCE_BOOST;

    const needFactor = needsGoal ? CONFIG.NEED_GOAL_BOOST : (Math.abs(goalDiff) >= 2 ? CONFIG.WINNING_REDUCTION : 1.0);

    const pf = (teamStats.possession > 0 && oppStats.possession > 0) ? Math.max(teamStats.possession, oppStats.possession) / Math.min(teamStats.possession, oppStats.possession) : 1;
    const imbalanced = pf > CONFIG.POSSESSION_IMBALANCE_THRESHOLD;

    // Dos modos: con keyPasses (pesos de CONFIG) o sin (fallback calibrado)
    const hasKeyPasses = (teamStats.keyPasses || 0) > 0;
    const rateW = hasKeyPasses ? CONFIG.RATE_WEIGHT : CONFIG.RATE_WEIGHT_NO_KP;
    const shotsW = hasKeyPasses ? CONFIG.SHOTS_BOX_WEIGHT : CONFIG.SHOTS_BOX_WEIGHT_NO_KP;
    const keyW  = hasKeyPasses ? CONFIG.KEYPASS_WEIGHT : 0;

    let blended = Math.round((
      baseProj * rateW +
      (imbalanced ? baseProj : projFromCrosses) * CONFIG.CROSS_WEIGHT +
      (imbalanced ? baseProj : projFromShots) * shotsW +
      (imbalanced ? baseProj : projFromAttacks) * CONFIG.ATTACK_WEIGHT +
      (imbalanced ? baseProj : projFromKeyPasses) * keyW +
      bigChanceBonus
    ) * needFactor);

    // Home boost
    if (isHome) blended = Math.round(blended * CONFIG.HOME_BOOST);

    // Decay factors
    if (minute >= CONFIG.LATE_GAME_DECAY_MIN) {
      blended = Math.round(blended * CONFIG.LATE_GAME_DECAY_FACTOR);
    } else if (minute >= CONFIG.MID_GAME_DECAY_MIN) {
      blended = Math.round(blended * CONFIG.MID_GAME_DECAY_FACTOR);
    }

    // Low corners penalty (solo si está activo)
    if (teamCurrent <= CONFIG.LOW_CORNERS_THRESHOLD && minute >= CONFIG.LOW_CORNERS_MIN && CONFIG.LOW_CORNERS_PENALTY !== 1.0) {
      blended = Math.round(blended * CONFIG.LOW_CORNERS_PENALTY);
    }

    // High corners decay (solo si está activo)
    if (teamCurrent >= CONFIG.HIGH_CORNERS_THRESHOLD && CONFIG.HIGH_CORNERS_DECAY !== 1.0) {
      blended = Math.round(blended * CONFIG.HIGH_CORNERS_DECAY);
    }

    // Floor = teamCurrent: la proyección nunca baja de los corners ya conseguidos
    // Esto intencionalmente anula decay cuando teamCurrent es alto (el partido ya tiene ritmo)
    return Math.min(Math.max(teamCurrent, blended), CONFIG.MAX_TEAM_CORNERS);
  }

  // En empate (goalDiff=0), ambos equipos reciben NEED_GOAL_BOOST (ambos buscan ganar)
    // Backtest confirmó que este double-boost es correcto (84.3% WR en empates)
    const homeProjected = projectTeam(homeCorners, home, away, goalDiff <= 0, true);
  const awayProjected = projectTeam(awayCorners, away, home, goalDiff >= 0, false);
  const leagueBias = getLeagueBias(match.league);
  const rawTotal = homeProjected + awayProjected + leagueBias;
  let projectedTotal = isNaN(rawTotal) || !isFinite(rawTotal)
    ? Math.min(Math.max(totalCorners, homeProjected + awayProjected), CONFIG.MAX_PROJECTED_TOTAL)
    : Math.min(Math.max(totalCorners, Math.round(rawTotal)), CONFIG.MAX_PROJECTED_TOTAL);

  // Bayesian prior: combinar proyección live con promedio histórico del equipo/liga
  const teamPrior = (getTeamAvgCorners(match.homeTeam) + getTeamAvgCorners(match.awayTeam)) / 2;
  const leaguePrior = getLeagueAvgCorners(match.league);
  const prior = teamPrior > 0 ? teamPrior : leaguePrior > 0 ? leaguePrior : 0;
  if (prior > 0) {
    const liveWeight = Math.min(1, Math.max(0, (minute - 45) / 45)); // 0 en min 45, 1 en min 90
    const priorWeight = 1 - liveWeight;
    projectedTotal = Math.round(projectedTotal * liveWeight + prior * priorWeight);
    projectedTotal = Math.min(Math.max(totalCorners, projectedTotal), CONFIG.MAX_PROJECTED_TOTAL);
  }

  // Tarjeta roja: el equipo con 11 ataca más, más corners totales
  const totalRedCards = (home.redCards || 0) + (away.redCards || 0);
  if (totalRedCards > 0) {
    projectedTotal = Math.min(projectedTotal + 1, CONFIG.MAX_PROJECTED_TOTAL);
  }

  const teamAlerts = [];
  for (const t of [
    { name: match.homeTeam, current: homeCorners, projected: homeProjected, side: 'home', stats: home, oppStats: away },
    { name: match.awayTeam, current: awayCorners, projected: awayProjected, side: 'away', stats: away, oppStats: home },
  ]) {
    if (t.current < 1) continue;
    for (const line of CONFIG.TEAM_LINES) {
      if (line <= t.current || t.projected <= line) continue;
      const prob = negBinOver(t.projected, line);
      if (prob >= CONFIG.MIN_CONFIDENCE) {
        teamAlerts.push({
          team: t.name, line, prob,
          current: t.current, projected: t.projected, side: t.side,
          reasoning: buildReasoning(t.name, t.side, match, t.stats, goalDiff),
        });
      }
    }
  }

  const totalAlerts = [];
  for (const line of CONFIG.TOTAL_LINES) {
    if (line <= totalCorners || projectedTotal <= line) continue;
    const prob = negBinOver(projectedTotal, line);
    if (prob >= CONFIG.MIN_CONFIDENCE) {
      totalAlerts.push({ line, prob, current: totalCorners, projected: projectedTotal });
    }
  }

  return {
    match: `${match.homeTeam} vs ${match.awayTeam}`,
    league: match.league,
    gameId: match.gameId,
    homeId: match.homeId,
    awayId: match.awayId,
    date: match.date || new Date().toISOString().slice(0, 10),
    minute,
    score: `${match.scoreHome}-${match.scoreAway}`,
    dataQuality,
    corners: { home: homeCorners, away: awayCorners, total: totalCorners },
    projected: { home: homeProjected, away: awayProjected, total: projectedTotal },
    stats: {
        crosses: home.crosses + away.crosses,
        shotsInsideBox: home.shotsInsideBox + away.shotsInsideBox,
        shotsOnTarget: (home.shotsOnTarget || 0) + (away.shotsOnTarget || 0),
        keyPasses: (home.keyPasses || 0) + (away.keyPasses || 0),
        bigChances: (home.bigChances || 0) + (away.bigChances || 0),
        attacks: home.attacks + away.attacks,
        possession: { home: home.possession, away: away.possession },
        totalShots: (home.totalShots || 0) + (away.totalShots || 0),
      },
      teams: {
        home: { corners: homeCorners, crosses: home.crosses, shotsInsideBox: home.shotsInsideBox, shotsOnTarget: home.shotsOnTarget || 0, keyPasses: home.keyPasses || 0, bigChances: home.bigChances || 0, attacks: home.attacks, totalShots: home.totalShots || 0 },
        away: { corners: awayCorners, crosses: away.crosses, shotsInsideBox: away.shotsInsideBox, shotsOnTarget: away.shotsOnTarget || 0, keyPasses: away.keyPasses || 0, bigChances: away.bigChances || 0, attacks: away.attacks, totalShots: away.totalShots || 0 },
      },
      teamAlerts, totalAlerts,
    };
  }

function buildReasoning(name, side, match, stats, goalDiff) {
  const isHome = side === 'home';
  const teamScore = isHome ? match.scoreHome : match.scoreAway;
  const oppScore = isHome ? match.scoreAway : match.scoreHome;
  const losing = teamScore < oppScore;
  const parts = [`${name} ${stats.crosses} centros, ${stats.shotsInsideBox} tiros área, ${Math.round(stats.possession)}% posesión`];
  if (losing) parts.push('va perdiendo, necesita atacar');
  else if (teamScore === oppScore) parts.push('empate, busca el gol');
  return parts.join(' | ');
}

module.exports = { analyzeMatch };
