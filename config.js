const CONFIG = {
  API_PARAMS: 'appTypeId=5&langId=14&timezoneName=America/Bogota&userCountryId=109',

  MIN_MINUTE: 55,
  MAX_MINUTE: 85,
  MIN_CONFIDENCE: 70,
  MAX_LOOPS: 4,
  LOOP_DELAY: 720000,  // 12 min (igual que sistema de goles)

  // Horario Colombia (7am-10pm, igual que sistema de goles)
  TIMEZONE: 'America/Bogota',
  HOUR_START: 7,
  HOUR_END: 22,

  TEAM_LINES: [3.5, 4.5, 5.5, 6.5, 7.5],
  TOTAL_LINES: [10.5, 11.5, 12.5, 13.5],

  // Pesos: con keyPasses (60/5/20/5/10) y sin keyPasses (65/5/25/5/0)
  RATE_WEIGHT: 0.60,
  CROSS_WEIGHT: 0.05,
  SHOTS_BOX_WEIGHT: 0.20,
  ATTACK_WEIGHT: 0.05,
  KEYPASS_WEIGHT: 0.10,
  // Fallback cuando no hay keyPasses del API
  RATE_WEIGHT_NO_KP: 0.65,
  SHOTS_BOX_WEIGHT_NO_KP: 0.25,

  CORNER_CONVERSION_CROSS: 0.18,
  CORNER_CONVERSION_SHOTS: 0.12,
  CORNER_CONVERSION_ATTACKS: 0.02,
  CORNER_CONVERSION_KEYPASS: 0.15,     // pases clave → corners
  BIG_CHANCE_BOOST: 0.35,              // cada gran chance añade ~0.35 corners

  POSSESSION_IMBALANCE_THRESHOLD: 1.3, // si ratio > este, usa solo baseRate
  MAX_TEAM_CORNERS: 12,                // techo de seguridad por equipo
  MAX_PROJECTED_TOTAL: 14,             // techo de proyección total (evita sobre-proyecciones erróneas)

  NEED_GOAL_BOOST: 1.25,
  WINNING_REDUCTION: 0.95,

  // Factores de correccion basados en datos reales
  HOME_BOOST: 1.05,                    // home teams generan 11% mas corners
  LATE_GAME_DECAY_MIN: 75,             // a partir de este minuto, reducir proyeccion
  LATE_GAME_DECAY_FACTOR: 0.95,        // factor de reduccion en late game
  MID_GAME_DECAY_MIN: 65,              // a partir de este minuto, reducir leve
  MID_GAME_DECAY_FACTOR: 0.96,         // factor de reduccion leve
  LOW_CORNERS_THRESHOLD: 3,            // si tiene <= corners en este minuto
  LOW_CORNERS_MIN: 45,                 // a partir de este minuto
  LOW_CORNERS_PENALTY: 1.0,           // sin penalización (backtest: +20 aciertos)
  HIGH_CORNERS_THRESHOLD: 8,           // si tiene >= corners
  HIGH_CORNERS_DECAY: 1.0,            // sin penalización (backtest: +5 aciertos)

  MAX_ALERTS_FINAL: 4,  // tope final: solo enviar las top 4 por probabilidad

  POISSON_MIN_PROB: 5,
  POISSON_MAX_PROB: 95,

  MODEL_VERSION: 4,  // incremental: comparar rendimiento entre versiones

  // Estimación de stats faltantes del API
  ENRICH_SHOTS_RATIO: 0.60,       // shotsInsideBox = totalShots * ratio
  ENRICH_CROSSES_ATK_RATIO: 0.25,  // crosses = attacks * ratio
  ENRICH_CROSSES_SHOTS_RATIO: 1.8, // crosses = totalShots * ratio (fallback)

  // Seguridad: tokens SOLO por variables de entorno (nunca hardcodeados)
  BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || null,
  CHAT_ID: process.env.TELEGRAM_CHAT_ID || process.env.CHAT_ID || null,
};

module.exports = { CONFIG };
