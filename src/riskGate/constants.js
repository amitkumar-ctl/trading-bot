/**
 * RISK CONSTANTS — NIFTY OPTIONS
 * ────────────────────────────────
 * These are YOUR rules. Hardcoded on purpose.
 * The AI agent NEVER reads or modifies this file.
 * Only you change these — consciously, not in the heat of a trade.
 */

const RISK_CONSTANTS = {

  // ── Capital ────────────────────────────────────────────────
  TOTAL_CAPITAL: 25000,               // ₹25,000

  // ── Instrument ────────────────────────────────────────────
  INSTRUMENT: 'NIFTY',
  LOT_SIZE: {
    NIFTY: 65,                        // 1 lot Nifty options = 65 units
  },

  // ── Daily loss limit ──────────────────────────────────────
  DAILY_LOSS_LIMIT: 1820,             // Stop trading if loss hits ₹1,820 (2 full-loss trades)

  // ── Max trades per day ────────────────────────────────────
  MAX_TRADES_PER_DAY: 2,

  // ── Max open trades at once ───────────────────────────────
  MAX_OPEN_TRADES: 1,

  // ── Risk : Reward ─────────────────────────────────────────
  MIN_REWARD_RATIO: 3.0,              // Minimum RR = 1:3

  // ── Minimum SL distance in premium points ─────────────────
  MIN_SL_POINTS: {
    NIFTY: 14,                        // SL must be at least 14 pts below entry premium
  },

  // ── Option type ───────────────────────────────────────────
  VALID_OPTION_TYPES: ['CE', 'PE'],

  // ── Valid instruments ─────────────────────────────────────
  VALID_INSTRUMENTS: ['NIFTY'],

  // ── Valid directions ──────────────────────────────────────
  VALID_DIRECTIONS: ['LONG', 'SHORT'],

  // ── Premium guard rails ───────────────────────────────────
  MIN_PREMIUM: 30,                    // Don't buy below ₹30
  MAX_PREMIUM: 500,                   // Don't buy above ₹500

  // ── Expiry ────────────────────────────────────────────────
  VALID_EXPIRY_TYPES: ['WEEKLY', 'MONTHLY'],

};

module.exports = RISK_CONSTANTS;