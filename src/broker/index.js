/**
 * BROKER — ZERODHA KITE
 * ──────────────────────
 * PAPER_TRADE=true  → simulates orders, no real money
 * PAPER_TRADE=false → places real orders on Zerodha
 */

require('dotenv').config();
const { KiteConnect } = require('kiteconnect');

const IS_PAPER = process.env.PAPER_TRADE !== 'false';

// Paper order store
const paperOrders  = [];
let   paperOrderId = 1000;

// ── Kite client — reads token fresh each time ─────────────────
function getKiteClient() {
  // Re-read .env each time so fresh token is always used
  require('dotenv').config({ override: true });
  const kite = new KiteConnect({ api_key: process.env.KITE_API_KEY });
  kite.setAccessToken(process.env.KITE_ACCESS_TOKEN);
  return kite;
}

// ─────────────────────────────────────────────────────────────
// Place order
// ─────────────────────────────────────────────────────────────
async function placeOrder(order) {
  const tradingSymbol = buildTradingSymbol(order);
  return IS_PAPER
    ? placePaperOrder(order, tradingSymbol)
    : placeLiveOrder(order, tradingSymbol);
}

// ─────────────────────────────────────────────────────────────
// Paper trade
// ─────────────────────────────────────────────────────────────
function placePaperOrder(order, tradingSymbol) {
  const orderId = `PAPER-${paperOrderId++}`;
  const qty     = order.lots * 65;

  const record = {
    orderId, tradingSymbol,
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

  console.log(`\n📄 PAPER ORDER:`);
  console.log(`   ID     : ${orderId}`);
  console.log(`   Symbol : ${tradingSymbol}`);
  console.log(`   Entry  : ₹${order.premium}`);
  console.log(`   SL     : ₹${order.slPremium}`);
  console.log(`   Target : ₹${order.targetPremium}`);
  console.log(`   Qty    : ${qty} units (${order.lots} lot)\n`);

  return { orderId, mode: 'PAPER', detail: `Paper order placed for ${tradingSymbol}` };
}

// ─────────────────────────────────────────────────────────────
// Live trade
// ─────────────────────────────────────────────────────────────
async function placeLiveOrder(order, tradingSymbol) {
  const k   = getKiteClient();
  const qty = order.lots * 65;

  try {
    // Entry order
    const entryOrderId = await k.placeOrder('nfo', {
      tradingsymbol:    tradingSymbol,
      exchange:         'NFO',
      transaction_type: 'BUY',
      order_type:       'MARKET',
      quantity:         qty,
      product:          'MIS',
      validity:         'DAY',
    });

    // SL order
    const slOrderId = await k.placeOrder('nfo', {
      tradingsymbol:    tradingSymbol,
      exchange:         'NFO',
      transaction_type: 'SELL',
      order_type:       'SL-M',
      trigger_price:    order.slPremium,
      quantity:         qty,
      product:          'MIS',
      validity:         'DAY',
    });

    // Target order
    const targetOrderId = await k.placeOrder('nfo', {
      tradingsymbol:    tradingSymbol,
      exchange:         'NFO',
      transaction_type: 'SELL',
      order_type:       'LIMIT',
      price:            order.targetPremium,
      quantity:         qty,
      product:          'MIS',
      validity:         'DAY',
    });

    console.log(`\n🟢 LIVE ORDER PLACED:`);
    console.log(`   Entry  : ${entryOrderId}`);
    console.log(`   SL     : ${slOrderId}`);
    console.log(`   Target : ${targetOrderId}\n`);

    return {
      orderId: entryOrderId,
      mode:    'LIVE',
      detail:  `Entry ${entryOrderId} | SL ${slOrderId} | Target ${targetOrderId}`,
    };

  } catch (err) {
    // Handle common Kite errors cleanly
    if (err.message?.includes('Invalid token')) {
      throw new Error('Access token expired. Open http://YOUR_ELASTIC_IP:3000 to login again.');
    }
    if (err.message?.includes('not enabled') || err.message?.includes('segment')) {
      throw new Error('F&O trading not enabled on your Zerodha account. Enable it from Zerodha console.');
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
// Close paper trade
// ─────────────────────────────────────────────────────────────
function closePaperOrder(orderId, exitPrice, reason = 'MANUAL') {
  const order = paperOrders.find(o => o.orderId === orderId);
  if (!order)               return { pnl: null, detail: `Order ${orderId} not found` };
  if (order.status !== 'OPEN') return { pnl: order.pnl, detail: 'Already closed' };

  const pnl = (exitPrice - order.premium) * order.qty;
  order.status      = 'CLOSED';
  order.closedAt    = new Date().toISOString();
  order.exitPremium = exitPrice;
  order.pnl         = pnl;
  order.closeReason = reason;

  console.log(`\n📕 PAPER CLOSED: ${orderId} | Exit ₹${exitPrice} | P&L ₹${pnl}`);
  return { pnl, detail: `Closed at ₹${exitPrice} | P&L: ${pnl >= 0 ? '+' : ''}₹${pnl}` };
}

// ─────────────────────────────────────────────────────────────
// Build Zerodha trading symbol
// Format: NIFTY{DDMMMYY}{STRIKE}{CE/PE}
// e.g.  : NIFTY25JAN2524200CE
// ─────────────────────────────────────────────────────────────
function buildTradingSymbol(order) {
  // For weekly options Zerodha uses a special short format
  // NIFTY + YY + M (single char month for Apr-Sep) + DD + STRIKE + CE/PE
  // e.g. NIFTY2541724200CE = 2025, Apr(4), 17th, 24200 CE
  // For simplicity using monthly format — update when adding weekly expiry date tracking
  const now    = new Date();
  const day    = String(now.getDate()).padStart(2, '0');
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const month  = months[now.getMonth()];
  const year   = String(now.getFullYear()).slice(2);
  return `NIFTY${year}${month}${order.strike}${order.optionType}`;
}

function getPaperOrders() { return paperOrders; }
function isPaperMode()    { return IS_PAPER; }

module.exports = { placeOrder, closePaperOrder, getPaperOrders, isPaperMode };