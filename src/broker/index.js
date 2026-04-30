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
    // Step 1 — Place entry LIMIT order
    const entryResponse = await k.placeOrder('regular', {
      tradingsymbol: tradingSymbol,
      exchange: 'NFO',
      transaction_type: 'BUY',
      order_type: 'LIMIT',
      price: Math.ceil(order.premium * 1.02),
      quantity: qty,
      product: 'MIS',
      validity: 'DAY',
    });

    const entryId = entryResponse?.order_id || entryResponse;
    console.log('Entry order placed:', entryId);

    // Step 1b — Check if order was immediately rejected
    await sleep(2000);
    const allOrders = await k.getOrders();
    const placed = allOrders.find(o => o.order_id === String(entryId));
    if (placed?.status === 'REJECTED') {
      const reason = placed.status_message || placed.status_message_raw || 'Unknown reason';
      if (
        reason.toLowerCase().includes('insufficient') ||
        reason.toLowerCase().includes('margin') ||
        reason.toLowerCase().includes('funds') ||
        reason.toLowerCase().includes('balance')
      ) {
        throw new Error(`⚠️ INSUFFICIENT FUNDS — Zerodha rejected the order: "${reason}". Trade was NOT placed.`);
      }
      throw new Error(`❌ Order REJECTED by Zerodha: "${reason}"`);
    }

    // Step 2 — Wait for entry to fill before placing GTT
    console.log('Waiting for entry to fill...');
    const filled = await waitForOrderFill(k, entryId, 60);

    if (!filled) {
      return {
        orderId: entryId,
        slOrderId: null,
        targetOrderId: null,
        detail: `Entry ${entryId} placed but not filled yet. Place SL/target manually on Zerodha.`,
      };
    }

    // Step 3 — Place GTT OCO for SL + target
    const gttResponse = await k.createGTT({
      trigger_type: 'two-leg',
      tradingsymbol: tradingSymbol,
      exchange: 'NFO',
      trigger_values: [order.slPremium, order.targetPremium],
      last_price: order.premium,
      orders: [
        {
          transaction_type: 'SELL',
          quantity: qty,
          product: 'MIS',
          order_type: 'LIMIT',
          price: Math.floor(order.slPremium * 0.95),
        },
        {
          transaction_type: 'SELL',
          quantity: qty,
          product: 'MIS',
          order_type: 'LIMIT',
          price: order.targetPremium,
        }
      ]
    });

    const gttId = gttResponse?.data?.trigger_id || gttResponse;
    console.log('GTT OCO placed:', gttId);

    console.log(`\n🟢 LIVE ORDER PLACED:`);
    console.log(`   Entry  : ${entryId}`);
    console.log(`   GTT    : ${gttId}\n`);

    return {
      orderId: entryId,
      slOrderId: gttId,
      targetOrderId: gttId,
      detail: `Entry ${entryId} | GTT OCO ${gttId} (SL ₹${order.slPremium} / Target ₹${order.targetPremium})`,
    };

  } catch (err) {
    if (err.message?.includes('Invalid token')) {
      throw new Error('Access token expired. Open http://13.50.143.165:3000 to login again.');
    }
    if (err.message?.includes('not enabled') || err.message?.includes('segment')) {
      throw new Error('F&O trading not enabled on your Zerodha account. Enable it from Zerodha console.');
    }
    if (
      err.message?.toLowerCase().includes('insufficient') ||
      err.message?.toLowerCase().includes('margin') ||
      err.message?.toLowerCase().includes('funds') ||
      err.message?.toLowerCase().includes('balance')
    ) {
      throw new Error('⚠️ INSUFFICIENT FUNDS — Order rejected by Zerodha. Not enough margin in your account. Trade was NOT placed.');
    }
    throw err;
  }
}

async function waitForOrderFill(k, orderId, timeoutSeconds) {
  const maxAttempts = timeoutSeconds / 2;
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(2000);
    try {
      const orders = await k.getOrders();
      const order = orders.find(o => o.order_id === String(orderId));
      if (order?.status === 'COMPLETE') {
        console.log(`Entry filled after ${(i + 1) * 2}s`);
        return true;
      }
      console.log(`Waiting for fill... ${i + 1}, status: ${order?.status}`);
    } catch (e) {
      console.log('Poll error:', e.message);
    }
  }
  return false;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

async function cancelOrder(orderData) {
  const k = getKiteClient();

  const entryId = orderData.orderId;
  const gttId   = orderData.slOrderId; // GTT covers both SL and target

  const results = [];

  // Cancel entry order
  try {
    await k.cancelOrder('regular', entryId);
    results.push(`✅ Entry ${entryId} cancelled`);
  } catch (e) {
    results.push(`⚠️ Entry cancel: ${e.message}`);
  }

  // Cancel GTT (cancels both SL and target together)
  if (gttId) {
    try {
      await k.deleteGTT(gttId);
      results.push(`✅ GTT ${gttId} cancelled (SL + target removed)`);
    } catch (e) {
      results.push(`⚠️ GTT cancel: ${e.message}`);
    }
  }

  return { detail: results.join('\n') };
}

async function getOpenPositionsCount() {
  const k = getKiteClient();
  const positions = await k.getPositions();
  const open = (positions.net || []).filter(p =>
    p.exchange === 'NFO' && Math.abs(p.quantity) > 0
  );
  return open.length;
}

module.exports = { placeOrder, squareOffAll, cancelOrder, getOpenPositionsCount };