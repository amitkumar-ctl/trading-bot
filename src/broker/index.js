/**
 * BROKER — ZERODHA KITE
 * ──────────────────────
 * Live orders only. No paper trading.
 */

require('dotenv').config();
const { KiteConnect } = require('kiteconnect');

// ── Kite client — reads token fresh each time ─────────────────
function getKiteClient() {
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
  const k = getKiteClient();
  const qty = order.lots * 65;

  try {
    // Entry order
    const entryOrderId = await k.placeOrder('regular', {
      tradingsymbol: tradingSymbol,
      exchange: 'NFO',
      transaction_type: 'BUY',
      order_type: 'LIMIT',
      price: Math.ceil(order.premium * 1.02), // 2% above entry to ensure fill
      quantity: qty,
      product: 'MIS',
      validity: 'DAY',
    });

    // SL order
    const slOrderId = await k.placeOrder('regular', {
      tradingsymbol: tradingSymbol,
      exchange: 'NFO',
      transaction_type: 'SELL',
      order_type: 'SL',
      trigger_price: order.slPremium,
      price: Math.floor(order.slPremium * 0.98), // 2% below SL to ensure fill
      quantity: qty,
      product: 'MIS',
      validity: 'DAY',
    });

    // Target order
    const targetOrderId = await k.placeOrder('regular', {
      tradingsymbol: tradingSymbol,
      exchange: 'NFO',
      transaction_type: 'SELL',
      order_type: 'LIMIT',
      price: order.targetPremium,
      quantity: qty,
      product: 'MIS',
      validity: 'DAY',
    });

    console.log(`\n🟢 LIVE ORDER PLACED:`);
    console.log(`   Entry  : ${entryOrderId}`);
    console.log(`   SL     : ${slOrderId}`);
    console.log(`   Target : ${targetOrderId}\n`);

    return {
      orderId: entryOrderId,
      detail: `Entry ${entryOrderId} | SL ${slOrderId} | Target ${targetOrderId}`,
    };

  } catch (err) {
    if (err.message?.includes('Invalid token')) {
      throw new Error('Access token expired. Open http://13.50.143.165:3000 to login again.');
    }
    if (err.message?.includes('not enabled') || err.message?.includes('segment')) {
      throw new Error('F&O trading not enabled on your Zerodha account. Enable it from Zerodha console.');
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
// Square off ALL open NFO positions (emergency exit)
// ─────────────────────────────────────────────────────────────
async function squareOffAll() {
  const k = getKiteClient();
  const positions = await k.getPositions();
  const nfo = (positions.net || []).filter(p => p.exchange === 'NFO' && p.quantity > 0);

  if (!nfo.length) return { count: 0, detail: 'No open NFO positions found on Zerodha.' };

  const results = await Promise.allSettled(
    nfo.map(p =>
      k.placeOrder('regular', {
        tradingsymbol: p.tradingsymbol,
        exchange: 'NFO',
        transaction_type: 'SELL',
        order_type: 'MARKET',
        quantity: p.quantity,
        product: p.product,
        validity: 'DAY',
      })
    )
  );

  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;

  return {
    count: succeeded,
    detail: `Squared off ${succeeded} position(s)${failed ? `, ${failed} failed — check Zerodha app.` : '.'}`,
  };
}

// Get this week's expiry Thursday
function getExpiryDate() {
  // Get current IST time
  const now = new Date();
  const ist = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 5.5 * 3600000);
  const day = ist.getDay(); // 0=Sun, 1=Mon, 2=Tue

  const expiry = new Date(ist);

  // Nifty weekly expiry is every Tuesday
  // If today is Tuesday → use today
  // If past Tuesday → find next Tuesday
  if (day === 2) {
    // Today is Tuesday — use today
  } else if (day < 2) {
    // Sun(0) or Mon(1) → this Tuesday
    expiry.setDate(ist.getDate() + (2 - day));
  } else {
    // Wed(3) Thu(4) Fri(5) Sat(6) → next Tuesday
    expiry.setDate(ist.getDate() + (9 - day));
  }
  return expiry;
}

function buildTradingSymbol(order) {
  const expiry = getExpiryDate();
  const year = String(expiry.getFullYear()).slice(2);  // "26"
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const month = months[expiry.getMonth()];             // "APR"

  // Format: NIFTY26APR24200CE
  const symbol = `NIFTY${year}${month}${order.strike}${order.optionType}`;
  console.log('Trading symbol:', symbol);
  return symbol;
}

module.exports = { placeOrder, squareOffAll };