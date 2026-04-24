/**
 * BROKER — ZERODHA KITE
 * ──────────────────────
 * Handles all communication with Zerodha.
 * When PAPER_TRADE=true in .env → simulates everything, no real orders.
 * When PAPER_TRADE=false         → places real orders on your account.
 *
 * One line in .env switches between paper and live.
 */

require('dotenv').config();
const { KiteConnect } = require('kiteconnect');

const IS_PAPER = process.env.PAPER_TRADE !== 'false'; // default to paper

// ── Paper trade order store (in-memory) ──────────────────────
const paperOrders = [];
let   paperOrderId = 1000;

// ── Kite client (only used in live mode) ─────────────────────
let kite = null;

function getKiteClient() {
  if (!kite) {
    kite = new KiteConnect({ api_key: process.env.KITE_API_KEY });
    kite.setAccessToken(process.env.KITE_ACCESS_TOKEN);
  }
  return kite;
}

// ─────────────────────────────────────────────────────────────
// Place an options order
// ─────────────────────────────────────────────────────────────

/**
 * @param {Object} order - Validated order from risk gate
 * @returns {Promise<{ orderId, mode, detail }>}
 */
async function placeOrder(order) {
  const tradingSymbol = buildTradingSymbol(order);

  if (IS_PAPER) {
    return placePaperOrder(order, tradingSymbol);
  } else {
    return placeLiveOrder(order, tradingSymbol);
  }
}

// ─────────────────────────────────────────────────────────────
// Paper trade — simulates the order
// ─────────────────────────────────────────────────────────────
function placePaperOrder(order, tradingSymbol) {
  const orderId = `PAPER-${paperOrderId++}`;
  const qty     = order.lots * 65; // lot size

  const record = {
    orderId,
    tradingSymbol,
    optionType:    order.optionType,
    strike:        order.strike,
    expiry:        order.expiry,
    premium:       order.premium,
    slPremium:     order.slPremium,
    targetPremium: order.targetPremium,
    lots:          order.lots,
    qty,
    status:        'OPEN',
    placedAt:      new Date().toISOString(),
    closedAt:      null,
    exitPremium:   null,
    pnl:           null,
  };

  paperOrders.push(record);

  console.log(`\n📄 PAPER ORDER PLACED:`);
  console.log(`   ID       : ${orderId}`);
  console.log(`   Symbol   : ${tradingSymbol}`);
  console.log(`   Entry    : ₹${order.premium}`);
  console.log(`   SL       : ₹${order.slPremium}`);
  console.log(`   Target   : ₹${order.targetPremium}`);
  console.log(`   Qty      : ${qty} units (${order.lots} lot)\n`);

  return {
    orderId,
    mode:   'PAPER',
    detail: `Paper order placed for ${tradingSymbol} at ₹${order.premium}`,
  };
}

// ─────────────────────────────────────────────────────────────
// Live trade — places real order on Zerodha
// ─────────────────────────────────────────────────────────────
async function placeLiveOrder(order, tradingSymbol) {
  const k   = getKiteClient();
  const qty = order.lots * 65;

  // Place the entry order (market buy)
  const entryOrderId = await k.placeOrder('nfo', {
    tradingsymbol:   tradingSymbol,
    exchange:        'NFO',
    transaction_type: 'BUY',
    order_type:      'MARKET',
    quantity:        qty,
    product:         'MIS',           // intraday
    validity:        'DAY',
  });

  // Place SL order immediately after entry
  const slOrderId = await k.placeOrder('nfo', {
    tradingsymbol:   tradingSymbol,
    exchange:        'NFO',
    transaction_type: 'SELL',
    order_type:      'SL-M',
    trigger_price:   order.slPremium,
    quantity:        qty,
    product:         'MIS',
    validity:        'DAY',
  });

  // Place target order
  const targetOrderId = await k.placeOrder('nfo', {
    tradingsymbol:   tradingSymbol,
    exchange:        'NFO',
    transaction_type: 'SELL',
    order_type:      'LIMIT',
    price:           order.targetPremium,
    quantity:        qty,
    product:         'MIS',
    validity:        'DAY',
  });

  console.log(`\n🟢 LIVE ORDER PLACED:`);
  console.log(`   Entry order ID  : ${entryOrderId}`);
  console.log(`   SL order ID     : ${slOrderId}`);
  console.log(`   Target order ID : ${targetOrderId}\n`);

  return {
    orderId: entryOrderId,
    mode:    'LIVE',
    detail:  `Live orders placed — entry ${entryOrderId}, SL ${slOrderId}, target ${targetOrderId}`,
  };
}

// ─────────────────────────────────────────────────────────────
// Close a paper trade manually (SL hit or target hit)
// ─────────────────────────────────────────────────────────────

/**
 * @param {string} orderId   - The paper order ID
 * @param {number} exitPrice - The premium at which you exited
 * @param {'SL'|'TARGET'|'MANUAL'} reason
 * @returns {{ pnl, detail }}
 */
function closePaperOrder(orderId, exitPrice, reason = 'MANUAL') {
  const order = paperOrders.find(o => o.orderId === orderId);
  if (!order) return { pnl: null, detail: `Order ${orderId} not found` };
  if (order.status !== 'OPEN') return { pnl: order.pnl, detail: `Already closed` };

  const pnl = (exitPrice - order.premium) * order.qty;

  order.status      = 'CLOSED';
  order.closedAt    = new Date().toISOString();
  order.exitPremium = exitPrice;
  order.pnl         = pnl;
  order.closeReason = reason;

  console.log(`\n📕 PAPER ORDER CLOSED:`);
  console.log(`   ID     : ${orderId}`);
  console.log(`   Reason : ${reason}`);
  console.log(`   Exit   : ₹${exitPrice}`);
  console.log(`   P&L    : ${pnl >= 0 ? '+' : ''}₹${pnl.toLocaleString('en-IN')}\n`);

  return { pnl, detail: `Closed at ₹${exitPrice} | P&L: ${pnl >= 0 ? '+' : ''}₹${pnl}` };
}

// ─────────────────────────────────────────────────────────────
// Get all paper orders for today
// ─────────────────────────────────────────────────────────────
function getPaperOrders() {
  return paperOrders;
}

// ─────────────────────────────────────────────────────────────
// Build the Zerodha trading symbol for Nifty options
// Format: NIFTY{DDMMMYY}{STRIKE}{CE/PE}
// e.g.  : NIFTY25JAN24200CE
// ─────────────────────────────────────────────────────────────
function buildTradingSymbol(order) {
  const now     = new Date();
  const day     = String(now.getDate()).padStart(2, '0');
  const months  = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const month   = months[now.getMonth()];
  const year    = String(now.getFullYear()).slice(2);
  return `NIFTY${day}${month}${year}${order.strike}${order.optionType}`;
}

// ─────────────────────────────────────────────────────────────
// Mode check helper
// ─────────────────────────────────────────────────────────────
function isPaperMode() { return IS_PAPER; }

module.exports = { placeOrder, closePaperOrder, getPaperOrders, isPaperMode };