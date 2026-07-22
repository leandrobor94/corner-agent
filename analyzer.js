const { CONFIG } = require('./config');

function factorial(n) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }

function poissonOver(lambda, k) {
  let cum = 0;
  for (let i = 0; i <= Math.floor(k); i++) {
    cum += Math.exp(-lambda) * Math.pow(lambda, i) / factorial(i);
  }
  return Math.min(95, Math.max(5, Math.round((1 - cum) * 100)));
}

/** Estimate missing stats when 365scores doesn't provide them */
function enrichStats(stats) {
  const h = stats.home, a = stats.away;
  if ((!h.shotsInsideBox || h.shotsInsideBox === 0) && h.totalShots > 0) {
    h.shotsInsideBox = Math.round(h.totalShots * 0.60);
  }
  if ((!a.shotsInsideBox || a.shotsInsideBox === 0) && a.totalShots > 0) {
    a.shotsInsideBox = Math.round(a.totalShots * 0.60);
  }
  if ((!h.crosses || h.crosses === 0) && h.attacks > 0) {
    h.crosses = Math.round(h.attacks * 0.25);
  }
  if ((!a.crosses || a.crosses === 0) && a.attacks > 0) {
    a.crosses = Math.round(a.attacks * 0.25);
  }
  if ((!h.crosses || h.crosses === 0) && h.totalShots > 0) {
    h.crosses = Math.round(h.totalShots * 1.8);
  }
  if ((!a.crosses || a.crosses === 0) && a.totalShots > 0) {
    a.crosses = Math.round(a.totalShots * 1.8);
  }
}

// Línea mínima de equipo según minuto y corners actuales (tabla del usuario)
function minTeamLine(minute, current) {
  if (minute >= 55 && minute <= 59) {
    if (current >= 3) return 5.5;
    if (current >= 2) return 4.5;
    return 999; // no alerta
  }
  if (minute >= 60 && minute <= 70) {
    if (current >= 4) return 5.5;
    if (current >= 3) return 4.5;
    if (current >= 2) return 3.5;
    return 999;
  }
  if (minute >= 70 && minute <= 80) {
    if (current >= 5) return 6.5;
    if (current >= 4) return 5.5;
    if (current >= 3) return 4.5;
    return 999;
  }
  if (minute >= 80 && minute <= 85) {
    if (current >= 5) return 5.5;
    if (current >= 4) return 4.5;
    if (current >= 3) return 3.5;
    return 999;
  }
  return 999;
}

// Línea mínima de total según minuto y corners acumulados (tabla del usuario)
function minTotalLine(minute, current) {
  if (minute >= 55 && minute <= 59) {
    if (current >= 4) return 7.5;
    return 999;
  }
  if (minute >= 80 && minute <= 85) {
    if (current >= 7) return 8.5;
    return 999;
  }
  if (minute >= 70 && minute <= 80) {
    if (current >= 6) return 8.5;
    return 999;
  }
  if (minute >= 60 && minute <= 70) {
    if (current >= 5) return 8.5;
    return 999;
  }
  return 999;
}

function analyzeMatch(match, stats, minute) {
  const home = stats.home, away = stats.away;

  enrichStats(stats);

  const homeCorners = home.corners || 0;
  const awayCorners = away.corners || 0;
  const totalCorners = homeCorners + awayCorners;

  const hasActualCrosses = (home.crosses > 0 || away.crosses > 0);
  const hasActualShotsBox = (home.shotsInsideBox > 0 || away.shotsInsideBox > 0);
  const dataQuality = (hasActualCrosses && hasActualShotsBox) ? 'real' : 'estimated';

  // Catchup/finished match: usar corners finales como proyección, no aplicar decay/boosts
  if (minute >= 90) {
    return {
      match: `${match.homeTeam} vs ${match.awayTeam}`,
      league: match.league, gameId: match.gameId, homeId: match.homeId, awayId: match.awayId,
      date: match.date || new Date().toISOString().slice(0, 10), minute,
      score: `${match.scoreHome}-${match.scoreAway}`, dataQuality,
      corners: { home: homeCorners, away: awayCorners, total: totalCorners },
      projected: { home: homeCorners, away: awayCorners, total: totalCorners },
      stats: {
        crosses: home.crosses + away.crosses,
        shotsInsideBox: home.shotsInsideBox + away.shotsInsideBox,
        attacks: home.attacks + away.attacks,
        possession: { home: home.possession, away: away.possession },
        totalShots: (home.totalShots || 0) + (away.totalShots || 0),
      },
      teamAlerts: [], totalAlerts: [],
    };
  }
  const remaining = 90 - minute;
  const extraTime = minute >= 45 ? Math.max(1, Math.round(remaining * 0.08)) : 0;
  const minsLeft = (90 + extraTime) - minute;

  const goalDiff = match.scoreHome - match.scoreAway;

  function projectTeam(teamCurrent, teamStats, oppStats, needsGoal, isHome) {
    const rate = teamCurrent / minute;
    const baseProj = teamCurrent + rate * minsLeft;

    const crossRate = (teamStats.crosses || 0) / minute;
    const shotRate = (teamStats.shotsInsideBox || 0) / minute;
    const attackRate = (teamStats.attacks || 0) / minute;

    const projFromCrosses = teamCurrent + crossRate * minsLeft * CONFIG.CORNER_CONVERSION_CROSS;
    const projFromShots = teamCurrent + shotRate * minsLeft * CONFIG.CORNER_CONVERSION_SHOTS;
    const projFromAttacks = teamCurrent + attackRate * minsLeft * CONFIG.CORNER_CONVERSION_ATTACKS;

    const needFactor = needsGoal ? CONFIG.NEED_GOAL_BOOST : (Math.abs(goalDiff) >= 2 ? CONFIG.WINNING_REDUCTION : 1.0);

    const pf = (teamStats.possession > 0 && oppStats.possession > 0) ? Math.max(teamStats.possession, oppStats.possession) / Math.min(teamStats.possession, oppStats.possession) : 1;
    const imbalanced = pf > CONFIG.POSSESSION_IMBALANCE_THRESHOLD;

    let blended = (
      baseProj * CONFIG.RATE_WEIGHT +
      (imbalanced ? baseProj : projFromCrosses) * CONFIG.CROSS_WEIGHT +
      (imbalanced ? baseProj : projFromShots) * CONFIG.SHOTS_BOX_WEIGHT +
      (imbalanced ? baseProj : projFromAttacks) * CONFIG.ATTACK_WEIGHT
    ) * needFactor;

    // Home boost
    if (isHome) blended *= CONFIG.HOME_BOOST;

    // Decay factors
    if (minute >= CONFIG.LATE_GAME_DECAY_MIN) {
      blended *= CONFIG.LATE_GAME_DECAY_FACTOR;
    } else if (minute >= CONFIG.MID_GAME_DECAY_MIN) {
      blended *= CONFIG.MID_GAME_DECAY_FACTOR;
    }

    // Low corners penalty
    if (teamCurrent <= CONFIG.LOW_CORNERS_THRESHOLD && minute >= CONFIG.LOW_CORNERS_MIN) {
      blended *= CONFIG.LOW_CORNERS_PENALTY;
    }

    // High corners decay
    if (teamCurrent >= CONFIG.HIGH_CORNERS_THRESHOLD) {
      blended *= CONFIG.HIGH_CORNERS_DECAY;
    }

    return Math.min(Math.max(teamCurrent, Math.round(blended)), CONFIG.MAX_TEAM_CORNERS);
  }

  const homeProjected = projectTeam(homeCorners, home, away, goalDiff <= 0, true);
  const awayProjected = projectTeam(awayCorners, away, home, goalDiff >= 0, false);
  const projectedTotal = Math.min(homeProjected + awayProjected, CONFIG.MAX_PROJECTED_TOTAL);

  const teamAlerts = [];
  for (const t of [
    { name: match.homeTeam, current: homeCorners, projected: homeProjected, side: 'home', stats: home, oppStats: away },
    { name: match.awayTeam, current: awayCorners, projected: awayProjected, side: 'away', stats: away, oppStats: home },
  ]) {
    if (t.current < 1) continue;
    const minLine = minTeamLine(minute, t.current);
    for (const line of CONFIG.TEAM_LINES) {
      if (line < minLine) continue; // filtrar líneas debajo del mínimo de la tabla
      if (line <= t.current || t.projected <= line) continue;
      const prob = poissonOver(t.projected, line);
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
  const minTotal = minTotalLine(minute, totalCorners);
  for (const line of CONFIG.TOTAL_LINES) {
    if (line < minTotal) continue; // filtrar líneas debajo del mínimo de la tabla
    if (line <= totalCorners || projectedTotal <= line) continue;
    const prob = poissonOver(projectedTotal, line);
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
      attacks: home.attacks + away.attacks,
      possession: { home: home.possession, away: away.possession },
      totalShots: (home.totalShots || 0) + (away.totalShots || 0),
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
