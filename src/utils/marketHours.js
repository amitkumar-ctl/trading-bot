/**
 * MARKET HOURS & HOLIDAY CHECKER
 * ────────────────────────────────
 * Blocks trades outside 9:45am–2:30pm IST
 * Blocks trades on weekends and NSE holidays
 */


const NSE_HOLIDAYS_2026 = [
  '2026-01-26', // Republic Day
  '2026-03-20', // Holi (tentative)
  '2026-04-03', // Good Friday (tentative)
  '2026-04-14', // Dr. Ambedkar Jayanti
  '2026-05-01', // Maharashtra Day
  '2026-05-28', // Bakrid
  '2026-06-26', // Muharram
  '2026-09-14', // Ganesh Chaturthi
  '2026-10-02', // Gandhi Jayanti
  '2026-10-20', // Dussehra
  '2026-11-10', // Diwali (tentative)
  '2026-11-24', // Guru Nanak Jayanti
  '2026-12-25', // Christmas
];

const ALL_HOLIDAYS = [...NSE_HOLIDAYS_2026];

// ── Your trading window ───────────────────────────────────────
const OPEN_HOUR  = 9;  const OPEN_MIN  = 45;  // 9:45am IST
const CLOSE_HOUR = 14; const CLOSE_MIN = 30;  // 2:30pm IST

// ─────────────────────────────────────────────────────────────
// Main check
// ─────────────────────────────────────────────────────────────
function checkMarketHours() {
  const now     = getISTTime();
  const day     = now.getDay(); // 0=Sun, 6=Sat
  const dateStr = toDateString(now);
  const currMin = now.getHours() * 60 + now.getMinutes();
  const openMin = OPEN_HOUR  * 60 + OPEN_MIN;   // 585
  const closeMin= CLOSE_HOUR * 60 + CLOSE_MIN;  // 870

  if (day === 0)
    return { allowed: false, reason: `🔴 Sunday — market closed. Come back Monday.` };

  if (day === 6)
    return { allowed: false, reason: `🔴 Saturday — market closed. Come back Monday.` };

  if (ALL_HOLIDAYS.includes(dateStr))
    return { allowed: false, reason: `🔴 NSE holiday today (${dateStr}). No trading.` };

  if (currMin < openMin) {
    const wait = openMin - currMin;
    const h = Math.floor(wait / 60), m = wait % 60;
    return { allowed: false, reason: `🔴 Too early — window opens at 9:45am IST. ${h > 0 ? h+'h ' : ''}${m}m to go.` };
  }

  if (currMin >= closeMin)
    return { allowed: false, reason: `🔴 Window closed at 2:30pm IST. No new trades today.` };

  const remain = closeMin - currMin;
  const h = Math.floor(remain / 60), m = remain % 60;
  return { allowed: true, reason: `🟢 Market open — ${h > 0 ? h+'h ' : ''}${m}m left in window` };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function getISTTime() {
  const now = new Date();
  return new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 5.5 * 3600000);
}

function toDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getISTTimeString() {
  return getISTTime().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// ─────────────────────────────────────────────────────────────
// Fetch current Nifty spot price from NSE (no API key needed)
// ─────────────────────────────────────────────────────────────
async function getNiftySpotPrice() {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'query1.finance.yahoo.com',
      path: '/v8/finance/chart/%5ENSEI?interval=1m&range=1d',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json  = JSON.parse(data);
          const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
          if (!price) return reject(new Error('Nifty spot price not found'));
          resolve(parseFloat(price));
        } catch (e) {
          reject(new Error(`Parse failed: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.end();
  });
}

// Calculate first ITM strike for CE or PE
// CE (bullish) → strike just below spot
// PE (bearish) → strike just above spot
function getITMStrike(spotPrice, optionType) {
  const type = optionType.toUpperCase();
  if (type === 'CE') {
    // Round down to nearest 50
    return Math.floor(spotPrice / 50) * 50;
  } else {
    // Round up to nearest 50
    return Math.ceil(spotPrice / 50) * 50;
  }
}

module.exports = { checkMarketHours, getISTTime, getISTTimeString, getNiftySpotPrice, getITMStrike };