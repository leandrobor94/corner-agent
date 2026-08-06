const https = require('https');
const { CONFIG } = require('./config');

function sendTelegram(message) {
  return new Promise(resolve => {
    if (!CONFIG.BOT_TOKEN || !CONFIG.CHAT_ID) {
      console.log('  TELEGRAM SKIP: BOT_TOKEN or CHAT_ID not configured');
      return resolve(false);
    }
    const text = encodeURIComponent(message.slice(0, 4000));
    const url = `https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/sendMessage?chat_id=${CONFIG.CHAT_ID}&text=${text}&parse_mode=HTML`;
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.ok) { console.log('  TELEGRAM OK'); resolve(true); }
          else { console.log('  TELEGRAM ERR:', j.description); resolve(false); }
        } catch { resolve(false); }
      });
    }).on('error', e => { console.log('  TELEGRAM FAIL:', e.message); resolve(false); });
  });
}

function buildMessage(result) {
  let msg = `<b>🔔 ${result.match}</b>\n`;
  msg += `⏱ ${result.minute}' | ${result.score} | 📊 ${result.corners.total} → ~${result.projected.total}\n`;

  if (result.teamAlerts.length > 0) {
    const a = result.teamAlerts[0];
    msg += `🎯 ${a.team} O${a.line} (${a.prob}%)`;
    if (result.teamAlerts.length > 1) {
      const b = result.teamAlerts[1];
      msg += ` | ${b.team} O${b.line} (${b.prob}%)`;
    }
    msg += `\n`;
  }
  if (result.totalAlerts.length > 0) {
    const a = result.totalAlerts[0];
    msg += `🎯 Over ${a.line} (${a.prob}%)`;
    if (result.totalAlerts.length > 1) {
      const b = result.totalAlerts[1];
      msg += ` | Over ${b.line} (${b.prob}%)`;
    }
    msg += `\n`;
  }
  msg += `<i>🤖 corner-agent</i>`;
  return msg;
}

function buildMatchBlock(grp) {
  const r = grp.result;
  let block = `\n<b>${r.match}</b>\n`;
  block += `${r.minute}' | ${r.score} | ${r.corners.total}→~${r.projected.total} | ${r.league}\n`;
  const teams = grp.alerts.filter(a => a.team).sort((a, b) => b.prob - a.prob);
  const totals = grp.alerts.filter(a => !a.team).sort((a, b) => b.prob - a.prob);
  if (teams.length > 0) {
    block += `🎯 Equipos: `;
    block += teams.map(a => `${a.team} O${a.line} (${a.prob}%)`).join(' | ');
    block += `\n`;
  }
  if (totals.length > 0) {
    block += `🎯 Esquinas: `;
    block += totals.map(a => `O${a.line} (${a.prob}%)`).join(' | ');
    block += `\n`;
  }
  return block;
}

/**
 * Mensaje compacto: alertas agrupadas por partido para revisión rápida.
 */
function buildCompactBatch(alertList) {
  if (alertList.length === 0) return '';
  if (alertList.length === 1) return buildMessage(alertList[0].result);

  // Agrupar por partido preservando el orden (alertList ya viene ordenado por prob desc)
  const matchOrder = [];
  const byMatch = new Map();
  for (const item of alertList) {
    const key = item.result.match + '|' + item.result.minute + '|' + item.result.score;
    if (!byMatch.has(key)) { byMatch.set(key, { result: item.result, alerts: [] }); matchOrder.push(key); }
    byMatch.get(key).alerts.push(item.alert);
  }

  // Contar partidos y alertas para el header
  const matchCount = matchOrder.length;
  let msg = `<b>🔔 ${alertList.length} alertas en ${matchCount} partidos</b>\n`;

  for (const key of matchOrder) {
    const grp = byMatch.get(key);
    const block = buildMatchBlock(grp);
    // Si agregar este bloque excede 3900 chars, parar (deja margen para el footer)
    if ((msg + block).length > 3900) {
      const remaining = matchOrder.length - matchOrder.indexOf(key);
      if (remaining > 0) msg += `\n<i>... y ${remaining} partido(s) más</i>\n`;
      break;
    }
    msg += block;
  }

  msg += `<i>🤖 corner-agent</i>`;
  return msg;
}

module.exports = { sendTelegram, buildMessage, buildCompactBatch };
