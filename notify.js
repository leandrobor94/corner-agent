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

function formatProb(prob) {
  const quota = (100 / prob).toFixed(2);
  return `${prob}% / @${quota}`;
}

function buildMessage(result) {
  let msg = `<b>🔔 ${result.match}</b>\n`;
  msg += `⏱ ${result.minute}' | ${result.score} | 📊 ${result.corners.total} → ~${result.projected.total}\n`;

  if (result.teamAlerts.length > 0) {
    const a = result.teamAlerts[0];
    msg += `🎯 ${a.team} O${a.line} (${formatProb(a.prob)})`;
    if (result.teamAlerts.length > 1) {
      const b = result.teamAlerts[1];
      msg += ` | ${b.team} O${b.line} (${formatProb(b.prob)})`;
    }
    msg += `\n`;
  }
  if (result.totalAlerts.length > 0) {
    const a = result.totalAlerts[0];
    msg += `🎯 Over ${a.line} (${formatProb(a.prob)})`;
    if (result.totalAlerts.length > 1) {
      const b = result.totalAlerts[1];
      msg += ` | Over ${b.line} (${formatProb(b.prob)})`;
    }
    msg += `\n`;
  }
  msg += `<i>🤖 ${CONFIG.TIMEZONE}</i>`;
  return msg;
}

module.exports = { sendTelegram, buildMessage };
