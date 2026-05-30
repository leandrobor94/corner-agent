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
  // Estimate shotsInsideBox from totalShots if missing
  if ((!h.shotsInsideBox || h.shotsInsideBox === 0) && h.totalShots > 0) {
    h.shotsInsideBox = Math.round(h.totalShots * 0.60);
  }
  if ((!a.shotsInsideBox || a.shotsInsideBox === 0) && a.totalShots > 0) {
    a.shotsInsideBox = Math.round(a.totalShots * 0.60);
  }
  // Estimate crosses from attacks if missing
  if ((!h.crosses || h.crosses === 0) && h.attacks > 0) {
    h.crosses = Math.round(h.attacks * 0.25);
  }
  if ((!a.crosses || a.crosses === 0) && a.attacks > 0) {
    a.crosses = Math.round(a.attacks * 0.25);
  }
  // Fallback: estimate from totalShots
  if ((!h.crosses || h.crosses === 0) && h.totalShots > 0) {
    h.crosses = Math.round(h.totalShots * 1.8);
  }
  if ((!a.crosses || a.crosses === 0) && a.totalShots > 0) {
    a.crosses = Math.round(a.totalShots * 1.8);
  }
}

function analyzeMatch(match, stats, minute) {
  const home = stats.home, away = stats.away;

  const hasActualCrosses = (home.crosses > 0 || away.crosses > 0);
  const hasActualShotsBox = (home.shotsInsideBox > 0 || away.shotsInsideBox > 0);
  const dataQuality = (hasActualCrosses && hasActualShotsBox) ? 'real' : 'estimated';

  enrichStats(stats);

  const homeCorners = home.corners || 0;
  const awayCorners = away.corners || 0;
  const totalCorners = homeCorners + awayCorners;
  const remaining = 90 - minute;
  const extraTime = minute >= 45 ? Math.max(1, Math.round(remaining * 0.08)) : 0;
  const minsLeft = (90 + extraTime) - minute;

  const goalDiff = match.scoreHome - match.scoreAway;

  function projectTeam(teamCurrent, teamStats, oppStats, needsGoal) {
    const rate = teamCurrent / minute;
    const baseProj = teamCurrent + rate * minsLeft;

    const crossRate = (teamStats.crosses || 0) / minute;
    const shotRate = (teamStats.shotsInsideBox || 0) / minute;
    const attackRate = (teamStats.attacks || 0) / minute;

    // All four methods project the TOTAL final corners (current + additional)
    const projFromCrosses = teamCurrent + crossRate * minsLeft * CONFIG.CORNER_CONVERSION_CROSS;
    const projFromShots = teamCurrent + shotRate * minsLeft * CONFIG.CORNER_CONVERSION_SHOTS;
    const projFromAttacks = teamCurrent + attackRate * minsLeft * CONFIG.CORNER_CONVERSION_ATTACKS;

    const possFactor = oppStats.possession > 0 ? teamStats.possession / oppStats.possession : 1;
    const needFactor = needsGoal ? CONFIG.NEED_GOAL_BOOST : (Math.abs(goalDiff) >= 2 ? CONFIG.WINNING_REDUCTION : 1.0);

    const blended = Math.round((
      baseProj * CONFIG.RATE_WEIGHT +
      projFromCrosses * CONFIG.CROSS_WEIGHT +
      projFromShots * CONFIG.SHOTS_BOX_WEIGHT +
      projFromAttacks * CONFIG.ATTACK_WEIGHT
    ) * needFactor * possFactor);

    return Math.max(teamCurrent, blended);
  }

  const homeProjected = projectTeam(homeCorners, home, away, goalDiff <= 0);
  const awayProjected = projectTeam(awayCorners, away, home, goalDiff >= 0);
  const projectedTotal = homeProjected + awayProjected;

  const teamAlerts = [];
  for (const t of [
    { name: match.homeTeam, current: homeCorners, projected: homeProjected, side: 'home', stats: home, oppStats: away },
    { name: match.awayTeam, current: awayCorners, projected: awayProjected, side: 'away', stats: away, oppStats: home },
  ]) {
    if (t.current < 1) continue;
    for (const line of CONFIG.TEAM_LINES) {
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
  for (const line of CONFIG.TOTAL_LINES) {
    if (line <= totalCorners || projectedTotal <= line) continue;
    const prob = poissonOver(projectedTotal, line);
    if (prob >= CONFIG.MIN_CONFIDENCE) {
      totalAlerts.push({ line, prob, current: totalCorners, projected: projectedTotal });
    }
  }

  return {
    match: `${match.homeTeam} vs ${match.awayTeam}`,
    league: match.league,
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
