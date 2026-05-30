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
  const medal = (result.teamAlerts.length > 0 || result.totalAlerts.length > 0) ? '🔔' : '📋';
  let msg = `<b>${medal} CORNER ALERT — ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}</b>\n\n`;
  msg += `<b>${result.match}</b>\n`;
  msg += `🏆 ${result.league} | ⏱ ${result.minute}' | ${result.score}\n`;
  msg += `📊 Córners: ${result.corners.home}-${result.corners.away} (Total: ${result.corners.total})\n`;
  msg += `   Centros: ${result.stats.crosses} | T.área: ${result.stats.shotsInsideBox} | Ataques: ${result.stats.attacks}\n`;
  msg += `   Proy: ${result.projected.home}-${result.projected.away} (~${result.projected.total})\n`;

  if (result.teamAlerts.length > 0) {
    msg += `\n<b>🎯 POR EQUIPO:</b>\n`;
    for (const a of result.teamAlerts.slice(0, 3)) {
      msg += `✅ ${a.team} O${a.line} (${a.prob}%)\n`;
      msg += `   ${a.reasoning}\n`;
    }
  }
  if (result.totalAlerts.length > 0) {
    msg += `\n<b>🎯 TOTAL:</b>\n`;
    for (const a of result.totalAlerts.slice(0, 2)) {
      msg += `✅ Over ${a.line} (${a.prob}%)\n`;
    }
  }
  msg += `\n<i>🤖 corner-agent</i>`;
  return msg;
}

module.exports = { sendTelegram, buildMessage };
