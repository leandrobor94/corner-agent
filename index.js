const { fetchLiveMatches, fetchFinishedToday, fetchMatchStats } = require('./scores365');
const { analyzeMatch } = require('./analyzer');
const { sendTelegram, buildMessage } = require('./notify');
const { storePrediction, verifyPredictions, printReport, getAlertsSent, markAlertsSent } = require('./learn');
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

    storePrediction(result);
    const sentKeys = getAlertsSent(result.match, result.minute);
    const newAlerts = [];
    for (const a of result.teamAlerts) {
      const k = `${a.team}_O${a.line}`;
      if (!sentKeys.includes(k)) newAlerts.push(a);
    }
    for (const a of result.totalAlerts) {
      const k = `Total_O${a.line}`;
      if (!sentKeys.includes(k)) newAlerts.push(a);
    }

    if (newAlerts.length > 0) {
      const msg = buildMessage(result);
      console.log(`  🔔 ${result.match} — ${newAlerts.length} nueva(s)`);
      await sendTelegram(msg);
      markAlertsSent(result.match, result.minute, newAlerts.map(a => a.team ? `${a.team}_O${a.line}` : `Total_O${a.line}`));
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
  const finished = await fetchFinishedToday();
  const allEnded = [...live.filter(m => m.minute >= 90), ...finished.map(m => ({ ...m, minute: 90 }))];
  const verified = await verifyPredictions(allEnded, async (gameId, homeId, awayId) => {
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

  // Verificar predicciones previas contra estos finalizados
  const verified = await verifyPredictions(finished.map(m => ({ ...m, minute: 90 })), async (gameId, homeId, awayId) => {
    const stats = await fetchMatchStats(gameId, homeId, awayId);
    return stats ? stats : null;
  });
  if (verified > 0) printReport();
  console.log(`  Catchup completado — aprendizaje y verificación`);
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
