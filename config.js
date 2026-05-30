const CONFIG = {
  API_PARAMS: 'appTypeId=5&langId=14&timezoneName=America/Bogota&userCountryId=109',

  MIN_MINUTE: 40,
  MAX_MINUTE: 85,
  MIN_CONFIDENCE: 60,
  MAX_LOOPS: 4,
  LOOP_DELAY: 720000,  // 12 min (igual que sistema de goles)

  // Horario Colombia (7am-10pm, igual que sistema de goles)
  TIMEZONE: 'America/Bogota',
  HOUR_START: 7,
  HOUR_END: 22,

  TEAM_LINES: [3.5, 4.5, 5.5, 6.5, 7.5],
  TOTAL_LINES: [8.5, 9.5, 10.5, 11.5, 12.5],

  RATE_WEIGHT: 0.30,
  CROSS_WEIGHT: 0.35,
  SHOTS_BOX_WEIGHT: 0.25,
  ATTACK_WEIGHT: 0.10,

  CORNER_CONVERSION_CROSS: 0.32,
  CORNER_CONVERSION_SHOTS: 0.18,
  CORNER_CONVERSION_ATTACKS: 0.08,

  NEED_GOAL_BOOST: 1.25,
  WINNING_REDUCTION: 0.90,

  BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '8607347601:AAGRFH6FCTu9A46qb0Z4inECctY8XE3W-dg',
  CHAT_ID: process.env.TELEGRAM_CHAT_ID || process.env.CHAT_ID || '1226618551',
};

module.exports = { CONFIG };
