const CONFIG = {
  API_PARAMS: 'appTypeId=5&langId=14&timezoneName=America/Bogota&userCountryId=109',

  MIN_MINUTE: 55,
  MAX_MINUTE: 85,
  MIN_CONFIDENCE: 65,
  MAX_LOOPS: 4,
  LOOP_DELAY: 720000,  // 12 min (igual que sistema de goles)

  // Horario Colombia (7am-10pm, igual que sistema de goles)
  TIMEZONE: 'America/Bogota',
  HOUR_START: 7,
  HOUR_END: 22,

  TEAM_LINES: [3.5, 4.5, 5.5, 6.5, 7.5],
  TOTAL_LINES: [10.5, 11.5, 12.5, 13.5],

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
  MAX_PROJECTED_TOTAL: 16,             // techo de proyección total (evita sobre-proyecciones erróneas)

  NEED_GOAL_BOOST: 1.25,
  WINNING_REDUCTION: 0.80,

  // Factores de correccion basados en datos reales
  HOME_BOOST: 1.05,                    // home teams generan 11% mas corners
  LATE_GAME_DECAY_MIN: 80,             // a partir de este minuto, reducir proyeccion
  LATE_GAME_DECAY_FACTOR: 0.97,        // factor de reduccion en late game
  MID_GAME_DECAY_MIN: 70,              // a partir de este minuto, reducir leve
  MID_GAME_DECAY_FACTOR: 0.99,         // factor de reduccion leve
  LOW_CORNERS_THRESHOLD: 3,            // si tiene <= corners en este minuto
  LOW_CORNERS_MIN: 45,                 // a partir de este minuto
  LOW_CORNERS_PENALTY: 0.90,           // factor de reduccion
  HIGH_CORNERS_THRESHOLD: 12,          // si tiene >= corners (desactivado)
  HIGH_CORNERS_DECAY: 1.0,            // sin penalización por corners altos

  MAX_ALERTS_FINAL: 4,  // tope final: solo enviar las top 4 por probabilidad

  // Seguridad: tokens SOLO por variables de entorno (nunca hardcodeados)
  BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || null,
  CHAT_ID: process.env.TELEGRAM_CHAT_ID || process.env.CHAT_ID || null,
};

module.exports = { CONFIG };
