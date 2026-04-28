require('dotenv').config();
const { minTarget } = require('../riskGate/index');
const { getNiftySpotPrice, getITMStrike } = require('../utils/marketHours');
const C = require('../riskGate/constants');

async function parsePrompt(message) {
  const txt = message.toLowerCase().trim();

  // Detect CE or PE
  let optionType = null;
  if (txt.includes('ce') || txt.includes('call') || txt.includes('bullish') || txt.includes('long')) {
    optionType = 'CE';
  } else if (txt.includes('pe') || txt.includes('put') || txt.includes('bearish') || txt.includes('short')) {
    optionType = 'PE';
  }

  // Extract lots first
  const lotsMatch = txt.match(/(\d+)\s*lot/);
  const lots = lotsMatch ? parseInt(lotsMatch[1]) : 1;

  // Remove "2 lots" from string before finding premium
  const cleanTxt = txt.replace(/\d+\s*lots?/, '').trim();
  const numbers = cleanTxt.match(/\d+(\.\d+)?/g)?.map(Number) || [];
  const premium = numbers[0] || null;

  if (!optionType || !premium) {
    return {
      order: null,
      raw: message,
      error: !optionType
        ? 'Could not detect CE or PE. Say "buy CE 100" or "buy PE 85"'
        : 'Could not detect entry premium. Say "buy CE 100"',
    };
  }

  // Auto-set SL and target
  const slPremium = premium - C.MIN_SL_POINTS.NIFTY;
  const targetPremium = minTarget(premium, slPremium);

  const order = {
    instrument: 'NIFTY',
    optionType,
    expiry: C.DEFAULT_EXPIRY,
    premium,
    slPremium,
    targetPremium,
    lots,
    _slAutoFilled: true,
    _targetAutoFilled: true,
  };

  // Auto-fetch ITM strike
  try {
    const spot = await getNiftySpotPrice();
    order.strike = getITMStrike(spot, optionType);
    order._spotPrice = spot;
    order._strikeAuto = true;
  } catch (e) {
    order.strike = null;
    order._strikeError = e.message;
    console.error('Spot price fetch failed:', e.message);
  }
  if (!premium) {
    return {
      order: null,
      raw: message,
      error: 'No entry price given. Say "buy CE 100" with the premium price.',
    };
  }

  return { order, raw: message, error: null };
}

/**
 * Format a parsed order as a readable confirmation message (for Telegram).
 * @param {Object} order
 * @returns {string}
 */
function formatOrderSummary(order) {
  const slGap = order.premium - order.slPremium;
  const tgtGap = order.targetPremium - order.premium;
  const rr = (tgtGap / slGap).toFixed(1);
  const maxLoss = (slGap * order.lots * C.LOT_SIZE).toLocaleString('en-IN');

  return [
    `📋 *Parsed Trade*`,
    ``,
    `Nifty ${order.strike} ${order.optionType} — Weekly`,
    `Spot   : ₹${order._spotPrice ? order._spotPrice.toLocaleString('en-IN') : 'unavailable'}`,
    `Strike : Auto ITM ⚡`,
    `Entry      : ₹${order.premium}`,
    `SL     : ₹${order.slPremium}  (−${slGap} pts)${order._slAutoFilled ? '  ⚡ auto' : ''}`,
    `Target     : ₹${order.targetPremium}  (${tgtGap} pts above entry)${order._targetAutoFilled ? '  ⚡ auto-set for 1:2.3' : ''}`,
    `Lots       : ${order.lots} × 65 units`,
    `RR         : 1:${rr}`,
    ``,
    `Max loss if SL hit : ₹${maxLoss}`,
    ``,
    `Reply *YES* to send order  |  *NO* to cancel`,
  ].join('\n');
}

module.exports = { parsePrompt, formatOrderSummary };