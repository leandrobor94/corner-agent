const { fetchLiveMatches, fetchFinishedToday, fetchMatchStats } = require('./scores365');
const { analyzeMatch } = require('./analyzer');
const { sendTelegram, buildMessage, buildCompactBatch } = require('./notify');
const { storePrediction, verifyPredictions, printReport, getAlertsSent, markAlertsSent, commitData } = require('./learn');
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

  // Recopilar TODAS las alertas pendientes de todos los partidos
  const allPendingAlerts = [];

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

    // Solo 1 alerta por partido: la de mayor probabilidad (team o total)
    const allAlerts = [...result.teamAlerts.map(a => ({ alert: a, result, key: `${a.team}_O${a.line}` })),
                       ...result.totalAlerts.map(a => ({ alert: a, result, key: `Total_O${a.line}` }))];
    const newAlerts = allAlerts.filter(a => !sentKeys.includes(a.key));
    if (newAlerts.length > 0) {
      const best = newAlerts.sort((a, b) => b.alert.prob - a.alert.prob)[0];
      allPendingAlerts.push(best);
    }

    const top = result.teamAlerts.length > 0 ? `team:${result.teamAlerts[0].prob}%` : 'team bajo';
    const totalR = result.totalAlerts.length > 0 ? `total:${result.totalAlerts[0].prob}%` : 'total bajo';
    console.log(`  ${result.match} — Proy: ${result.projected.total} (${result.dataQuality}) — ${top}, ${totalR}`);
  }

  if (allPendingAlerts.length === 0) {
    console.log(`  Alertas pendientes: 0`);
    return 0;
  }

  // Ordenar de mayor a menor probabilidad
  allPendingAlerts.sort((a, b) => b.alert.prob - a.alert.prob);

  // Si hay más de 5 alertas, filtrar solo las de prob >= 80% (calidad sobre cantidad)
  let alertsToSend = allPendingAlerts;
  if (allPendingAlerts.length > 5) {
    const highConf = allPendingAlerts.filter(a => a.alert.prob >= 80);
    if (highConf.length > 0) {
      alertsToSend = highConf;
      console.log(`  Filtrado: ${allPendingAlerts.length} -> ${alertsToSend.length} (solo prob >= 80%)`);
    }
  }

  // Tope final: si aún quedan demasiadas, quedarse solo con las top por probabilidad
  if (alertsToSend.length > CONFIG.MAX_ALERTS_FINAL) {
    const before = alertsToSend.length;
    alertsToSend = alertsToSend.slice(0, CONFIG.MAX_ALERTS_FINAL);
    console.log(`  Tope final: ${before} -> ${alertsToSend.length} (top ${CONFIG.MAX_ALERTS_FINAL} por probabilidad)`);
  }

  console.log(`  Alertas pendientes: ${allPendingAlerts.length} | Enviando: ${alertsToSend.length}`);

  // Enviar alertas en un solo mensaje, ordenadas por probabilidad
  const msg = buildCompactBatch(alertsToSend);
  if (msg) {
    await sendTelegram(msg);
    // Marcar las enviadas como enviadas
    for (const item of alertsToSend) {
      const alertKey = item.alert.team ? `${item.alert.team}_O${item.alert.line}` : `Total_O${item.alert.line}`;
      markAlertsSent(item.result.match, item.result.minute, [alertKey]);
    }
    console.log(`  ✅ ${alertsToSend.length} alerta(s) enviada(s) — mayor prob: ${alertsToSend[0].alert.prob}%`);
  }

  return allPendingAlerts.length;
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

  // Verify pending predictions against today's finished matches
  const verified = await verifyPredictions([...finished.map(m => ({ ...m, minute: 90 }))], async (gameId, homeId, awayId) => {
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
    await commitData();
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
