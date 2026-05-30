const { fetchLiveMatches, fetchFinishedToday, fetchMatchStats } = require('./scores365');
const { analyzeMatch } = require('./analyzer');
const { sendTelegram, buildMessage } = require('./notify');
const { storePrediction, verifyPredictions, printReport } = require('./learn');
const { CONFIG } = require('./config');

let loopCount = 0;

async function analyzeMatchList(matches) {
  const targets = matches.filter(m => {
    if (m.minute < CONFIG.MIN_MINUTE || m.minute > CONFIG.MAX_MINUTE) return false;
    if (m.hasStats === false) return false;
    return true;
  });
  console.log(`  Evaluando: ${targets.length} partidos (${CONFIG.MIN_MINUTE}'-${CONFIG.MAX_MINUTE}')`);

  targets.forEach(m => {
    console.log(`  📊 ${m.homeTeam} vs ${m.awayTeam} (${m.minute}') [${m.league}]`);
  });

  let alertsSent = 0;
  for (const m of targets) {
    const stats = await fetchMatchStats(m.gameId, m.homeId, m.awayId);
    if (!stats) {
      console.log(`  ⚠️ ${m.homeTeam} vs ${m.awayTeam}: sin stats`);
      continue;
    }

    const result = analyzeMatch(m, stats, m.minute);
    if (!result) {
      console.log(`  ⚠️ ${m.homeTeam} vs ${m.awayTeam}: análisis nulo`);
      continue;
    }

    const hasAlerts = result.teamAlerts.length > 0 || result.totalAlerts.length > 0;
    storePrediction(result);

    if (hasAlerts) {
      const msg = buildMessage(result);
      console.log(`  🔔 ${result.match} — ${result.teamAlerts.length + result.totalAlerts.length} alerta(s)`);
      await sendTelegram(msg);
      alertsSent++;
    } else {
      const top = result.teamAlerts.length > 0 ? `team:${result.teamAlerts[0].prob}%` : 'team bajo';
      const totalR = result.totalAlerts.length > 0 ? `total:${result.totalAlerts[0].prob}%` : 'total bajo';
      console.log(`  ${result.match} — Proy: ${result.projected.total} (${result.dataQuality}) — ${top}, ${totalR}`);
    }
  }

  console.log(`  Alertas enviadas: ${alertsSent}`);
  return alertsSent;
}

async function runLoop() {
  console.log('\n' + '='.repeat(60));
  console.log(`  CORNER-AGENT — ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`);
  console.log('='.repeat(60));

  const live = await fetchLiveMatches();
  console.log(`  Partidos en vivo: ${live.length}`);

  await analyzeMatchList(live);

  // Verify past predictions against finished matches
  const verified = await verifyPredictions(live, async (gameId, homeId, awayId) => {
    const stats = await fetchMatchStats(gameId, homeId, awayId);
    return stats ? stats : null;
  });
  if (verified > 0) printReport();
}

async function runCatchup() {
  console.log('\n' + '='.repeat(60));
  console.log(`  CATCHUP — Buscando partidos finalizados hoy`);
  console.log('='.repeat(60));

  const finished = await fetchFinishedToday();
  console.log(`  Partidos finalizados hoy: ${finished.length}`);

  // Filter to those that ended recently (within last 3 hours) and have stats
  const candidates = finished.filter(m => {
    if (m.hasStats === false) return false;
    return true;
  });

  console.log(`  Candidatos con stats: ${candidates.length}`);

  for (const m of candidates) {
    const stats = await fetchMatchStats(m.gameId, m.homeId, m.awayId);
    if (!stats) {
      console.log(`  ⚠️ ${m.homeTeam} vs ${m.awayTeam}: sin stats post-partido`);
      continue;
    }

    console.log(`  ${m.homeTeam} vs ${m.awayTeam} (${m.scoreHome}-${m.scoreAway}) — stats disponibles`);
    // Use match minute = 90 for finished matches (treat as full time analysis)
    const finalMinute = 90;
    m.minute = finalMinute;

    const result = analyzeMatch(m, stats, finalMinute);
    if (!result) continue;

    storePrediction(result);
    console.log(`  ${result.match} — Proy: ${result.projected.total} (${result.dataQuality}) — ${result.teamAlerts.length + result.totalAlerts.length} alerta(s)`);
  }

  console.log(`  Catchup completado — solo aprendizaje, sin alertas`);
}

async function main() {
  const mode = process.argv[2] || 'live';

  if (mode === '--catchup' || mode === 'catchup') {
    console.log('=== CORNER-AGENT — CATCHUP ===');
    await runCatchup();
    await printReport();
    return;
  }

  if (mode === '--once' || mode === 'once') {
    console.log('=== CORNER-AGENT — ONCE ===');
    const live = await fetchLiveMatches();
    await analyzeMatchList(live);
    return;
  }

  if (mode === '--ci' || mode === 'ci') {
    console.log('=== CORNER-AGENT — CI ===');
    await runCatchup();
    const live = await fetchLiveMatches();
    await analyzeMatchList(live);
    await printReport();
    return;
  }

  // === MODO VIVO: mismo patrón que sistema de goles ===
  console.log('=== CORNER-AGENT iniciado ===');
  console.log(`  Ciclo cada ${CONFIG.LOOP_DELAY / 60000}min | Máx ${CONFIG.MAX_LOOPS} ciclos`);
  console.log(`  Horario: ${CONFIG.HOUR_START}:00-${CONFIG.HOUR_END}:00 Colombia`);
  console.log(`  Minuto mínimo: ${CONFIG.MIN_MINUTE}' | Confianza mín: ${CONFIG.MIN_CONFIDENCE}%`);

  for (let loop = 0; loop < CONFIG.MAX_LOOPS; loop++) {
    console.log(`\n  CICLO ${loop + 1}/${CONFIG.MAX_LOOPS} - ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`);
    console.log('='.repeat(60));

    // Validar horario Colombia (7am-10pm) igual que sistema de goles
    const coHour = new Date().toLocaleString('en-US', { timeZone: CONFIG.TIMEZONE });
    const hour = new Date(coHour).getHours();
    if (hour < CONFIG.HOUR_START || hour >= CONFIG.HOUR_END) {
      console.log(`  Fuera de horario Colombia (${hour}:00).`);
      if (loop < CONFIG.MAX_LOOPS - 1) {
        console.log(`  Esperando ${CONFIG.LOOP_DELAY / 60000} min...`);
        await new Promise(r => setTimeout(r, CONFIG.LOOP_DELAY));
      }
      continue;
    }

    await runLoop();

    if (loop < CONFIG.MAX_LOOPS - 1) {
      console.log(`\n  Esperando ${CONFIG.LOOP_DELAY / 60000} min hasta el próximo ciclo...`);
      await new Promise(r => setTimeout(r, CONFIG.LOOP_DELAY));
    }
  }

  console.log('\nCiclos completados. Finalizando.');
}

main().catch(e => console.error('FATAL:', e));
