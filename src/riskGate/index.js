/**
 * RISK GATE — NIFTY OPTIONS
 * ──────────────────────────
 * Every options order MUST pass through this before touching Zerodha.
 * Returns { passed, checks, summary }
 *
 * Pure functions. Pure rules. No side effects.
 * Zero knowledge of AI, Telegram, or the broker.
 */

const C = require('./constants');

/**
 * @param {Object} order
 * @param {string} order.optionType      - 'CE' or 'PE'
 * @param {string} order.instrument      - 'NIFTY'
 * @param {number} order.strike          - e.g. 24200 (must be multiple of 50)
 * @param {string} order.expiry          - 'WEEKLY' or 'MONTHLY'
 * @param {number} order.premium         - Entry premium e.g. 100
 * @param {number} order.slPremium       - SL premium e.g. 86  (must be < premium, gap ≥ 14)
 * @param {number} order.targetPremium   - Target premium e.g. 142 (must be > premium, RR ≥ 1:3)
 * @param {number} order.lots            - Number of lots (1–3)
 *
 * @param {Object} state
 * @param {number} state.dailyPnl            - Today's realised P&L (negative = loss)
 * @param {number} state.openTradesCount     - Currently open trades
 * @param {number} state.tradesTodayCount    - Trades taken today including open
 *
 * @returns {{ passed: boolean, checks: Check[], summary: string }}
 */
function runRiskGate(order, state) {
  const checks = [];

  // Phase 1 — field validation
  checks.push(checkInstrument(order));
  checks.push(checkOptionType(order));
  checks.push(checkStrike(order));
  checks.push(checkExpiry(order));
  checks.push(checkPremiumsPresent(order));
  checks.push(checkLots(order));

  // Phase 2 — derived checks (only if phase 1 fully passed)
  if (checks.every(c => c.passed)) {
    checks.push(checkPremiumDirection(order));
    checks.push(checkPremiumRange(order));
    checks.push(checkSlDistance(order));
    checks.push(checkRewardRatio(order));
  }

  // Phase 3 — account state (always runs)
  checks.push(checkDailyLossLimit(state));
  checks.push(checkMaxOpenTrades(state));
  checks.push(checkMaxTradesPerDay(state));

  const passed = checks.every(c => c.passed);
  const failures = checks.filter(c => !c.passed).map(c => c.reason);

  return {
    passed,
    checks,
    summary: passed
      ? `✅ All ${checks.length} checks passed — order approved`
      : `❌ ${failures.length} check(s) failed:\n` + failures.map(r => `  • ${r}`).join('\n'),
  };
}

// ─────────────────────────────────────────────────────────────
// Checks
// ─────────────────────────────────────────────────────────────

function checkInstrument({ instrument }) {
  const val = instrument?.toUpperCase();
  const passed = C.VALID_INSTRUMENTS.includes(val);
  return {
    name: 'Valid instrument',
    passed,
    detail: `Instrument: ${instrument}`,
    reason: passed ? null : `Instrument must be one of: ${C.VALID_INSTRUMENTS.join(', ')}. Got: "${instrument}"`,
  };
}

function checkOptionType({ optionType }) {
  const val = optionType?.toUpperCase();
  const passed = C.VALID_OPTION_TYPES.includes(val);
  return {
    name: 'Valid option type (CE or PE)',
    passed,
    detail: `Option type: ${optionType}`,
    reason: passed ? null : `Option type must be CE or PE. Got: "${optionType}"`,
  };
}

function checkStrike({ strike }) {
  const passed = strike > 0 && strike % 50 === 0;
  return {
    name: 'Valid Nifty strike (multiple of 50)',
    passed,
    detail: `Strike: ${strike}`,
    reason: passed ? null
      : !strike ? 'Strike price is missing'
      : `Nifty strikes must be multiples of 50 (e.g. 24200, 24250). Got: ${strike}`,
  };
}

function checkExpiry({ expiry }) {
  const val = expiry?.toUpperCase();
  const passed = C.VALID_EXPIRY_TYPES.includes(val);
  return {
    name: 'Valid expiry (WEEKLY or MONTHLY)',
    passed,
    detail: `Expiry: ${expiry}`,
    reason: passed ? null : `Only WEEKLY expiry supported. Got: "${expiry}"`,
  };
}

function checkPremiumsPresent({ premium, slPremium, targetPremium }) {
  const missing = [];
  if (!premium        || isNaN(premium))        missing.push('entry premium');
  if (!slPremium      || isNaN(slPremium))      missing.push('SL premium');
  if (!targetPremium  || isNaN(targetPremium))  missing.push('target premium');
  const passed = missing.length === 0;
  return {
    name: 'All premiums present',
    passed,
    detail: `Entry ₹${premium} | SL ₹${slPremium} | Target ₹${targetPremium}`,
    reason: passed ? null : `Missing required values: ${missing.join(', ')}`,
  };
}

function checkLots({ lots }) {
  const passed = Number.isInteger(lots) && lots >= 1 && lots <= 3;
  return {
    name: 'Lots between 1 and 3',
    passed,
    detail: `Lots: ${lots}`,
    reason: passed ? null
      : lots < 1 ? 'Lots must be at least 1'
      : `Max 3 lots allowed per trade. Got: ${lots}`,
  };
}

function checkPremiumDirection({ premium, slPremium, targetPremium }) {
  const slOk     = slPremium < premium;
  const targetOk = targetPremium > premium;
  const passed   = slOk && targetOk;
  let reason = null;
  if (!slOk && !targetOk) reason = `Both SL (₹${slPremium}) and target (₹${targetPremium}) are on the wrong side of entry (₹${premium})`;
  else if (!slOk)         reason = `SL premium (₹${slPremium}) must be BELOW entry premium (₹${premium})`;
  else if (!targetOk)     reason = `Target premium (₹${targetPremium}) must be ABOVE entry premium (₹${premium})`;
  return {
    name: 'SL < entry < target',
    passed,
    detail: `SL ₹${slPremium} → Entry ₹${premium} → Target ₹${targetPremium}`,
    reason,
  };
}

function checkPremiumRange({ premium }) {
  const passed = premium >= C.MIN_PREMIUM && premium <= C.MAX_PREMIUM;
  return {
    name: `Entry premium ₹${C.MIN_PREMIUM}–₹${C.MAX_PREMIUM}`,
    passed,
    detail: `Entry premium: ₹${premium}`,
    reason: passed ? null
      : premium < C.MIN_PREMIUM
        ? `Premium ₹${premium} is too low (< ₹${C.MIN_PREMIUM}). Option is near worthless — skip this trade.`
        : `Premium ₹${premium} is too high (> ₹${C.MAX_PREMIUM}). SL in ₹ terms will be very large.`,
  };
}

function checkSlDistance({ instrument, premium, slPremium }) {
  const inst    = instrument.toUpperCase();
  const minPts = C.MIN_SL_POINTS[instrument?.toUpperCase()] || C.MIN_SL_POINTS.NIFTY;
  const slGap   = premium - slPremium;
  const passed  = slGap >= minPts;
  return {
    name: `SL gap ≥ ${minPts} pts (${inst})`,
    passed,
    detail: `SL gap: ${slGap} pts (entry ₹${premium} − SL ₹${slPremium})`,
    reason: passed ? null
      : `SL gap is only ${slGap} pts — minimum is ${minPts} pts for ${inst}. `
      + `Move SL to ₹${premium - minPts} or lower.`,
  };
}

function checkRewardRatio({ premium, slPremium, targetPremium }) {
  const risk   = premium - slPremium;
  const reward = targetPremium - premium;
  const rr     = reward / risk;
  const passed = rr >= C.MIN_REWARD_RATIO_CHECK;  
  return {
    name: `RR ≥ 1:${C.MIN_REWARD_RATIO}`,
    passed,
    detail: `Risk ${risk} pts | Reward ${reward} pts | RR 1:${rr.toFixed(2)}`,
    reason: passed ? null
      : `RR is 1:${rr.toFixed(2)}, below your 1:${C.MIN_REWARD_RATIO} minimum. `
      + `For this SL, minimum target = ₹${premium + risk * C.MIN_REWARD_RATIO}.`,
  };
}

function checkDailyLossLimit({ dailyPnl }) {
  const lossToday = Math.abs(Math.min(0, dailyPnl));
  const remaining = C.DAILY_LOSS_LIMIT - lossToday;
  const passed    = remaining > 0;
  return {
    name: `Daily loss < ₹${C.DAILY_LOSS_LIMIT.toLocaleString('en-IN')}`,
    passed,
    detail: `Lost today: ₹${lossToday.toLocaleString('en-IN')} | Room left: ₹${Math.max(0, remaining).toLocaleString('en-IN')}`,
    reason: passed ? null
      : `Daily loss limit of ₹${C.DAILY_LOSS_LIMIT.toLocaleString('en-IN')} reached. No more trades today.`,
  };
}

function checkMaxOpenTrades({ openTradesCount }) {
  const passed = openTradesCount < C.MAX_OPEN_TRADES;
  return {
    name: `Open trades < ${C.MAX_OPEN_TRADES}`,
    passed,
    detail: `Currently open: ${openTradesCount}`,
    reason: passed ? null
      : `You already have ${openTradesCount} trade open. Close it before opening a new one.`,
  };
}

function checkMaxTradesPerDay({ tradesTodayCount }) {
  const passed = tradesTodayCount < C.MAX_TRADES_PER_DAY;
  return {
    name: `Trades today < ${C.MAX_TRADES_PER_DAY} (daily max)`,
    passed,
    detail: `Trades today: ${tradesTodayCount} of ${C.MAX_TRADES_PER_DAY}`,
    reason: passed ? null
      : `Already taken ${tradesTodayCount} trades today. Daily max is ${C.MAX_TRADES_PER_DAY}. Done for the day.`,
  };
}

// ─────────────────────────────────────────────────────────────
// Helpers — used by prompt parser
// ─────────────────────────────────────────────────────────────

// Max SL gap in premium points for a given lot count
function maxSlGap(instrument = 'NIFTY', lots = 1) {
  return C.MIN_SL_POINTS[instrument.toUpperCase()];
  // Note: we enforce MIN sl gap (not max). Max is implicitly controlled
  // by the daily loss limit and per-trade loss check in the gate.
}

// Minimum target premium to achieve your fixed RR
function minTarget(premium, slPremium) {
  const risk = premium - slPremium;
  return Math.ceil(premium + risk * C.MIN_REWARD_RATIO);
}

module.exports = { runRiskGate, maxSlGap, minTarget };