/**
 * PROMPT PARSER — Claude AI
 * ──────────────────────────
 * Takes your plain English morning message and extracts
 * a structured trade order using Claude AI.
 *
 * Input  : "thinking of buying 24200 CE weekly, entry around 100, SL 86, target 142"
 * Output : { instrument, optionType, strike, expiry, premium, slPremium, targetPremium, lots }
 *
 * If Claude cannot confidently extract any field → returns null for that field.
 * The risk gate then catches any missing fields.
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { minTarget } = require('../riskGate/index');
const C = require('../riskGate/constants');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── System prompt ──────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `
You are a trade parser for a Nifty options trading bot.

Your ONLY job is to extract trade parameters from the user's message and return valid JSON.
You never give trading advice. You never add fields that are not in the message.
You never guess prices — if something is missing, set it to null.

The trader trades ONLY Nifty options (CE or PE) on NSE India.
Lot size is 65 units. Strikes are always multiples of 50 (e.g. 24200, 24250, 24300).

Extract these fields and return ONLY a raw JSON object — no markdown, no explanation:

{
  "instrument": "NIFTY",
  "optionType": "CE" or "PE",
  "strike": number (multiple of 50) or null,
  "expiry": "WEEKLY" or "MONTHLY",
  "premium": number (entry premium) or null,
  "slPremium": number (stop loss premium, must be below entry) or null,
  "targetPremium": number (target premium, must be above entry) or null,
  "lots": integer
}

Parsing rules:
- "call", "CE", "bullish", "buy call" → optionType CE
- "put", "PE", "bearish", "buy put"   → optionType PE
- "SL", "stop", "stop loss"           → slPremium
- "target", "tp", "tgt"               → targetPremium
- "entry", "premium", "buy at"        → premium
- If lots not mentioned               → default 1
- If expiry not mentioned             → default WEEKLY
- Return raw JSON only. No backticks. No text before or after.
`.trim();

// ─────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────

/**
 * Parse a natural language trade message into a structured order object.
 * @param {string} message - Your morning trade message
 * @returns {Promise<{ order: Object|null, raw: string, error: string|null }>}
 */
async function parsePrompt(message) {
  if (!message || message.trim().length < 5) {
    return { order: null, raw: message, error: 'Message too short to parse' };
  }

  let raw = '';
  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: message.trim() }],
    });

    raw = response.content[0]?.text?.trim() || '';

    // Strip any accidental markdown fences
    const cleaned = raw.replace(/```json|```/gi, '').trim();
    const order   = JSON.parse(cleaned);

    // Normalise strings to uppercase
    if (order.instrument) order.instrument = order.instrument.toUpperCase();
    if (order.optionType)  order.optionType  = order.optionType.toUpperCase();
    if (order.expiry)      order.expiry      = order.expiry.toUpperCase();

    // Ensure lots is an integer, default 1
    order.lots = order.lots ? Math.round(order.lots) : 1;

    // Auto-suggest minimum target (1:3 RR) if user didn't provide one
    if (!order.targetPremium && order.premium && order.slPremium) {
      order.targetPremium      = minTarget(order.premium, order.slPremium);
      order._targetAutoFilled  = true;
    }

    return { order, raw, error: null };

  } catch (err) {
    return {
      order: null,
      raw,
      error: `Parse failed: ${err.message}. Raw Claude output: "${raw}"`,
    };
  }
}

/**
 * Format a parsed order as a readable confirmation message (for Telegram).
 * @param {Object} order
 * @returns {string}
 */
function formatOrderSummary(order) {
  const slGap    = order.premium - order.slPremium;
  const tgtGap   = order.targetPremium - order.premium;
  const rr       = (tgtGap / slGap).toFixed(1);
  const maxLoss  = (slGap * order.lots * C.LOT_SIZE).toLocaleString('en-IN');

  return [
    `📋 *Parsed Trade*`,
    ``,
    `Instrument : Nifty ${order.strike} ${order.optionType}`,
    `Expiry     : ${order.expiry}`,
    `Entry      : ₹${order.premium}`,
    `SL         : ₹${order.slPremium}  (${slGap} pts below entry)`,
    `Target     : ₹${order.targetPremium}  (${tgtGap} pts above entry)${order._targetAutoFilled ? '  ⚡ auto-set for 1:3' : ''}`,
    `Lots       : ${order.lots} × 65 units`,
    `RR         : 1:${rr}`,
    ``,
    `Max loss if SL hit : ₹${maxLoss}`,
    ``,
    `Reply *YES* to send order  |  *NO* to cancel`,
  ].join('\n');
}

module.exports = { parsePrompt, formatOrderSummary };