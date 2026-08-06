const { fetchLiveMatches, fetchFinishedToday, fetchMatchStats } = require('./scores365');
const { analyzeMatch } = require('./analyzer');
const { sendTelegram, buildMessage, buildCompactBatch } = require('./notify');
const { storePrediction, verifyPredictions, printReport, getAlertsSent, markAlertsSent, commitData, flushPredictions } = require('./learn');
const { CONFIG } = require('./config');

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

    for (const a of result.teamAlerts) {
      const k = `${a.team}_O${a.line}`;
      if (!sentKeys.includes(k)) allPendingAlerts.push({ alert: a, result, key: k });
    }
    for (const a of result.totalAlerts) {
      const k = `Total_O${a.line}`;
      if (!sentKeys.includes(k)) allPendingAlerts.push({ alert: a, result, key: k });
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

  // Agrupar por partido (match) para aplicar filtros por # de partidos, no # de alertas
  const byMatch = new Map();
  for (const item of allPendingAlerts) {
    if (!byMatch.has(item.result.match)) byMatch.set(item.result.match, []);
    byMatch.get(item.result.match).push(item);
  }
  // Mejor prob de cada partido
  const matchGroups = [...byMatch.values()].sort((a, b) => b[0].alert.prob - a[0].alert.prob);

  // Tope top partidos (todas ya vienen con prob >= MIN_CONFIDENCE)
  let groupsToSend = matchGroups;
  if (groupsToSend.length > CONFIG.MAX_ALERTS_FINAL) {
    const before = groupsToSend.length;
    groupsToSend = groupsToSend.slice(0, CONFIG.MAX_ALERTS_FINAL);
    console.log(`  Tope final: ${before} -> ${groupsToSend.length} partidos (top ${CONFIG.MAX_ALERTS_FINAL})`);
  }

  const alertsToSend = groupsToSend.flat();
  console.log(`  Partidos con alertas: ${matchGroups.length} | Enviando: ${groupsToSend.length} partidos (${alertsToSend.length} alertas)`);

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
  await flushPredictions();
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
    try {
      const stats = await fetchMatchStats(m.gameId, m.homeId, m.awayId);
      if (!stats) {
        console.log(`  ⚠️ ${m.homeTeam} vs ${m.awayTeam}: sin stats post-partido`);
        continue;
      }

      console.log(`  ${m.homeTeam} vs ${m.awayTeam} (${m.scoreHome}-${m.scoreAway}) — stats disponibles`);
      m.minute = 90;
      const result = analyzeMatch(m, stats, 90);
      if (!result) continue;
      storePrediction(result);
      console.log(`  ${result.match} — Proy: ${result.projected.total} (${result.dataQuality}) — ${result.teamAlerts.length + result.totalAlerts.length} alerta(s)`);
    } catch (e) {
      console.error(`  ERROR ${m.homeTeam} vs ${m.awayTeam}:`, e.message);
    }
  }

  // Verify pending predictions against today's finished matches
  const verified = await verifyPredictions([...finished.map(m => ({ ...m, minute: 90 }))], async (gameId, homeId, awayId) => {
    const stats = await fetchMatchStats(gameId, homeId, awayId);
    return stats ? stats : null;
  });
  if (verified > 0) printReport();
  await flushPredictions();
  console.log(`  Catchup completado — aprendizaje y verificación`);
}

async function main() {
  const mode = process.argv[2] || 'live';

  if (mode === '--catchup' || mode === 'catchup') {
    console.log('=== CORNER-AGENT — CATCHUP ===');
    await runCatchup();
    // runCatchup ya llama a flushPredictions y printReport internamente
    return;
  }

  if (mode === '--once' || mode === 'once') {
    console.log('=== CORNER-AGENT — ONCE ===');
    const live = await fetchLiveMatches();
    await analyzeMatchList(live);
    const finished = await fetchFinishedToday();
    if (finished.length > 0) {
      await verifyPredictions([...finished.map(m => ({ ...m, minute: 90 }))], async (gameId, homeId, awayId) => {
        const stats = await fetchMatchStats(gameId, homeId, awayId);
        return stats ? stats : null;
      });
    }
    await flushPredictions();
    return;
  }

  if (mode === '--ci' || mode === 'ci') {
    console.log('=== CORNER-AGENT — CI ===');
    // Ejecutar catchup y live en paralelo para no bloquear alertas
    const catchupPromise = runCatchup();
    const live = await fetchLiveMatches();
    await analyzeMatchList(live);
    await catchupPromise; // esperar que termine catchup también
    await flushPredictions();
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

    // Validar horario Colombia (7am-10pm)
    const formatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: CONFIG.TIMEZONE });
    const hour = parseInt(formatter.format(new Date()), 10);
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
  await flushPredictions();
}

main().catch(e => console.error('FATAL:', e));
