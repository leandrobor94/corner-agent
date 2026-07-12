const CONFIG = {
  API_PARAMS: 'appTypeId=5&langId=14&timezoneName=America/Bogota&userCountryId=109',

  MIN_MINUTE: 40,
  MAX_MINUTE: 85,
  MIN_CONFIDENCE: 66,
  MIN_QUOTA: 1.70,  // ignora alertas con cuota justa menor a esta
  MAX_LOOPS: 4,
  LOOP_DELAY: 720000,  // 12 min (igual que sistema de goles)

  // Horario Colombia (7am-10pm, igual que sistema de goles)
  TIMEZONE: 'America/Bogota',
  HOUR_START: 7,
  HOUR_END: 22,

  TEAM_LINES: [3.5, 4.5, 5.5, 6.5, 7.5],
  TOTAL_LINES: [8.5, 9.5, 10.5, 11.5, 12.5],

  // Pesos basados en correlacion real con corners finales:
  // base rate (r=0.87), shots (r=0.30), crosses (r=0.20), attacks (r=0.17)
  RATE_WEIGHT: 0.65,
  CROSS_WEIGHT: 0.05,
  SHOTS_BOX_WEIGHT: 0.25,
  ATTACK_WEIGHT: 0.05,

  CORNER_CONVERSION_CROSS: 0.18,
  CORNER_CONVERSION_SHOTS: 0.12,
  CORNER_CONVERSION_ATTACKS: 0.02,

  POS_FACTOR_CAP: 1.25,               // ya no se usa (posesion duplicada en stats)
  POSSESSION_IMBALANCE_THRESHOLD: 1.3, // si ratio > este, usa solo baseRate
  MAX_TEAM_CORNERS: 12,                // techo de seguridad por equipo

  NEED_GOAL_BOOST: 1.25,
  WINNING_REDUCTION: 0.80,

  // Factores de correccion basados en datos reales
  HOME_BOOST: 1.05,                    // home teams generan 11% mas corners
  LATE_GAME_DECAY_MIN: 75,             // a partir de este minuto, reducir proyeccion
  LATE_GAME_DECAY_FACTOR: 0.92,        // factor de reduccion en late game
  MID_GAME_DECAY_MIN: 65,              // a partir de este minuto, reducir leve
  MID_GAME_DECAY_FACTOR: 0.96,         // factor de reduccion leve
  LOW_CORNERS_THRESHOLD: 3,            // si tiene <= corners en este minuto
  LOW_CORNERS_MIN: 45,                 // a partir de este minuto
  LOW_CORNERS_PENALTY: 0.85,           // factor de reduccion
  HIGH_CORNERS_THRESHOLD: 8,           // si tiene >= corners
  HIGH_CORNERS_DECAY: 0.88,            // factor de reduccion

  BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '8607347601:AAGRFH6FCTu9A46qb0Z4inECctY8XE3W-dg',
  CHAT_ID: process.env.TELEGRAM_CHAT_ID || process.env.CHAT_ID || '1226618551',
};

module.exports = { CONFIG };
