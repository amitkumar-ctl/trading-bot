/**
 * RISK GATE TESTS — NIFTY OPTIONS
 * ─────────────────────────────────
 * Constants in effect:
 *   DAILY_LOSS_LIMIT : ₹1,820
 *   MIN_SL_POINTS    : 14 pts
 *   LOT_SIZE         : 65 units
 *   MIN_REWARD_RATIO : 1:3
 *   MAX_TRADES/DAY   : 2
 *   MAX_OPEN_TRADES  : 1
 *
 * Run: node tests/riskGate.test.js
 */

const { runRiskGate, minTarget } = require('../src/riskGate/index');
const C = require('../src/riskGate/constants');

let passed = 0; let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.log(`  ❌ ${name}\n     → ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

// ── Helpers ──
const freshDay  = { dailyPnl: 0, openTradesCount: 0, tradesTodayCount: 0 };

// Valid CE: entry ₹100, SL ₹86 (gap=14 ✅), target ₹142 (reward=42, RR=3.0 ✅)
const validCE = {
  instrument: 'NIFTY', optionType: 'CE', strike: 24200, expiry: 'WEEKLY',
  premium: 100, slPremium: 86, targetPremium: 142, lots: 1,
};

// Valid PE: entry ₹90, SL ₹76 (gap=14 ✅), target ₹132 (reward=42, RR=3.0 ✅)
const validPE = {
  instrument: 'NIFTY', optionType: 'PE', strike: 24000, expiry: 'WEEKLY',
  premium: 90, slPremium: 76, targetPremium: 132, lots: 1,
};

// ─────────────────────────────────────────────────────────────
console.log('\n━━━ VALID TRADES ━━━');

test('Valid CE trade passes all checks', () => {
  const r = runRiskGate(validCE, freshDay);
  assert(r.passed, r.summary);
});

test('Valid PE trade passes all checks', () => {
  const r = runRiskGate(validPE, freshDay);
  assert(r.passed, r.summary);
});

test('MONTHLY expiry is valid', () => {
  const r = runRiskGate({ ...validCE, expiry: 'MONTHLY' }, freshDay);
  assert(r.passed, r.summary);
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━━ INSTRUMENT & OPTION TYPE ━━━');

test('Invalid instrument "BANKNIFTY" is blocked', () => {
  const r = runRiskGate({ ...validCE, instrument: 'BANKNIFTY' }, freshDay);
  assert(!r.passed, 'Should block BANKNIFTY');
});

test('Invalid option type "CALL" is blocked', () => {
  const r = runRiskGate({ ...validCE, optionType: 'CALL' }, freshDay);
  assert(!r.passed, 'Should block invalid type');
});

test('Invalid expiry "DAILY" is blocked', () => {
  const r = runRiskGate({ ...validCE, expiry: 'DAILY' }, freshDay);
  assert(!r.passed, 'Should block invalid expiry');
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━━ STRIKE VALIDATION ━━━');

test('Strike 24200 (multiple of 50) passes', () => {
  const r = runRiskGate({ ...validCE, strike: 24200 }, freshDay);
  assert(r.passed, r.summary);
});

test('Strike 24215 (not multiple of 50) is blocked', () => {
  const r = runRiskGate({ ...validCE, strike: 24215 }, freshDay);
  assert(!r.passed, 'Should block non-50 strike');
});

test('Strike 24250 (multiple of 50) passes', () => {
  const r = runRiskGate({ ...validCE, strike: 24250 }, freshDay);
  assert(r.passed, r.summary);
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━━ PREMIUM DIRECTION ━━━');

test('SL premium above entry is blocked', () => {
  const r = runRiskGate({ ...validCE, slPremium: 110 }, freshDay);
  assert(!r.passed, 'SL above entry should be blocked');
});

test('Target premium below entry is blocked', () => {
  const r = runRiskGate({ ...validCE, targetPremium: 90 }, freshDay);
  assert(!r.passed, 'Target below entry should be blocked');
});

test('Both SL and target on wrong side is blocked', () => {
  const r = runRiskGate({ ...validCE, slPremium: 110, targetPremium: 80 }, freshDay);
  assert(!r.passed, 'Both wrong sides should be blocked');
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━━ PREMIUM RANGE GUARD ━━━');

test('Premium ₹29 (below ₹30 min) is blocked', () => {
  const r = runRiskGate({ ...validCE, premium: 29, slPremium: 15, targetPremium: 71 }, freshDay);
  assert(!r.passed, 'Should block low premium');
});

test('Premium ₹30 (at min) passes', () => {
  // gap=14, target = 30 + 14×3 = 72
  const r = runRiskGate({ ...validCE, premium: 30, slPremium: 16, targetPremium: 72 }, freshDay);
  assert(r.passed, r.summary);
});

test('Premium ₹501 (above ₹500 max) is blocked', () => {
  const r = runRiskGate({ ...validCE, premium: 501, slPremium: 487, targetPremium: 543 }, freshDay);
  assert(!r.passed, 'Should block very high premium');
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━━ SL DISTANCE — MIN 14 PTS ━━━');

test('SL gap of 13 pts is blocked (below 14 min)', () => {
  // entry 100, SL 87 → gap 13 → blocked
  // target needs 1:3 RR = 100 + 13×3 = 139
  const r = runRiskGate({ ...validCE, slPremium: 87, targetPremium: 139 }, freshDay);
  assert(!r.passed, 'Gap 13 should be blocked');
});

test('SL gap of exactly 14 pts passes', () => {
  // entry 100, SL 86 → gap 14 ✅, target = 100 + 42 = 142
  const r = runRiskGate({ ...validCE, slPremium: 86, targetPremium: 142 }, freshDay);
  assert(r.passed, r.summary);
});

test('SL gap of 20 pts passes', () => {
  // entry 100, SL 80 → gap 20 ✅, target = 100 + 60 = 160
  const r = runRiskGate({ ...validCE, slPremium: 80, targetPremium: 160 }, freshDay);
  assert(r.passed, r.summary);
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━━ REWARD RATIO 1:3 ━━━');

test('RR of 1:2 is blocked', () => {
  // gap=14, reward needs to be 42 for 1:3. Target 128 → reward 28 → RR 2.0
  const r = runRiskGate({ ...validCE, targetPremium: 128 }, freshDay);
  assert(!r.passed, 'RR 1:2 should be blocked');
});

test('RR of exactly 1:3 passes', () => {
  // gap=14, target=100+42=142 → RR 3.0
  const r = runRiskGate({ ...validCE, targetPremium: 142 }, freshDay);
  assert(r.passed, r.summary);
});

test('RR of 1:4 passes', () => {
  // gap=14, target=100+56=156 → RR 4.0
  const r = runRiskGate({ ...validCE, targetPremium: 156 }, freshDay);
  assert(r.passed, r.summary);
});

test('minTarget helper: entry 100, SL 86 → target must be 142', () => {
  const t = minTarget(100, 86);
  assert(t === 142, `Expected 142, got ${t}`);
});

test('minTarget helper: entry 60, SL 46 → target must be 102', () => {
  const t = minTarget(60, 46);
  assert(t === 102, `Expected 102, got ${t}`);
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━━ DAILY LOSS LIMIT ₹1,900 ━━━');

test('Blocked when daily loss = ₹1,820 exactly', () => {
  const r = runRiskGate(validCE, { ...freshDay, dailyPnl: -1820 });
  assert(!r.passed, 'Should block at limit');
});

test('Blocked when daily loss = ₹2,200 (over limit)', () => {
  const r = runRiskGate(validCE, { ...freshDay, dailyPnl: -2200 });
  assert(!r.passed, 'Should block over limit');
});

test('Allowed when daily loss = ₹1,819', () => {
  const r = runRiskGate(validCE, { ...freshDay, dailyPnl: -1819 });
  assert(r.passed, r.summary);
});

test('Profitable day — trading allowed', () => {
  const r = runRiskGate(validCE, { ...freshDay, dailyPnl: 1200 });
  assert(r.passed, r.summary);
});

test('Zero P&L — trading allowed', () => {
  const r = runRiskGate(validCE, { ...freshDay, dailyPnl: 0 });
  assert(r.passed, r.summary);
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━━ MAX OPEN TRADES ━━━');

test('Blocked when 1 trade already open', () => {
  const r = runRiskGate(validCE, { ...freshDay, openTradesCount: 1 });
  assert(!r.passed, 'Should block — 1 already open');
});

test('Allowed when 0 trades open', () => {
  const r = runRiskGate(validCE, { ...freshDay, openTradesCount: 0 });
  assert(r.passed, r.summary);
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━━ MAX 3 TRADES PER DAY ━━━');

test('1st trade of the day allowed', () => {
  const r = runRiskGate(validCE, { ...freshDay, tradesTodayCount: 0 });
  assert(r.passed, r.summary);
});

test('2nd trade allowed', () => {
  const r = runRiskGate(validCE, { ...freshDay, tradesTodayCount: 1 });
  assert(r.passed, r.summary);
});

test('3rd trade blocked (max 2/day)', () => {
  const r = runRiskGate(validCE, { ...freshDay, tradesTodayCount: 2 });
  assert(!r.passed, 'Should block 3rd trade');
});

test('4th trade blocked (max 3/day)', () => {
  const r = runRiskGate(validCE, { ...freshDay, tradesTodayCount: 3 });
  assert(!r.passed, 'Should block 4th trade');
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━━ LOTS ━━━');

test('0 lots blocked', () => {
  const r = runRiskGate({ ...validCE, lots: 0 }, freshDay);
  assert(!r.passed, 'Should block 0 lots');
});

test('1 lot passes', () => {
  const r = runRiskGate({ ...validCE, lots: 1 }, freshDay);
  assert(r.passed, r.summary);
});

test('3 lots passes (max allowed)', () => {
  const r = runRiskGate({ ...validCE, lots: 3 }, freshDay);
  assert(r.passed, r.summary);
});

test('4 lots blocked', () => {
  const r = runRiskGate({ ...validCE, lots: 4 }, freshDay);
  assert(!r.passed, 'Should block 4 lots');
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━━ MISSING FIELDS ━━━');

test('Missing SL premium blocked', () => {
  const r = runRiskGate({ ...validCE, slPremium: null }, freshDay);
  assert(!r.passed, 'Should block missing SL');
});

test('Missing target premium blocked', () => {
  const r = runRiskGate({ ...validCE, targetPremium: undefined }, freshDay);
  assert(!r.passed, 'Should block missing target');
});

test('Missing entry premium blocked', () => {
  const r = runRiskGate({ ...validCE, premium: null }, freshDay);
  assert(!r.passed, 'Should block missing entry');
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━━ REALISTIC MORNING SCENARIOS ━━━');

test('Scenario A: Fresh day, clean trade → APPROVED', () => {
  const r = runRiskGate(validCE, { dailyPnl: 0, openTradesCount: 0, tradesTodayCount: 0 });
  assert(r.passed, r.summary);
});

test('Scenario B: 1 loss taken (₹910), 2nd trade → APPROVED', () => {
  // Trade 1 hit SL: loss = 14 × 1 × 65 = ₹910
  const r = runRiskGate(validCE, { dailyPnl: -910, openTradesCount: 0, tradesTodayCount: 1 });
  assert(r.passed, r.summary);
});

test('Scenario C: 2 losses hit (₹1,820) — daily limit reached → BLOCKED', () => {
  // 2 × ₹910 = ₹1,820 = daily limit. No more trades.
  const r = runRiskGate(validCE, { dailyPnl: -1820, openTradesCount: 0, tradesTodayCount: 2 });
  assert(!r.passed, 'Daily limit + trade count both hit → block');
});

test('Scenario D: 2 trades done, no more regardless of P&L → BLOCKED', () => {
  const r = runRiskGate(validCE, { dailyPnl: 3000, openTradesCount: 0, tradesTodayCount: 2 });
  assert(!r.passed, 'Max 2 trades hit → block');
});

test('Scenario E: 1 loss taken (₹910), daily room ₹910 left, 2nd trade → APPROVED', () => {
  const r = runRiskGate(validCE, { dailyPnl: -910, openTradesCount: 0, tradesTodayCount: 1 });
  assert(r.passed, r.summary);
});

test('Scenario F: Trade open, trying to open another → BLOCKED', () => {
  const r = runRiskGate(validCE, { dailyPnl: 0, openTradesCount: 1, tradesTodayCount: 1 });
  assert(!r.passed, 'Already open trade → block');
});

// ─────────────────────────────────────────────────────────────
// Summary
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log(`\n🎉 Risk gate is solid.\n`);
  console.log(`Your rules:`);
  console.log(`  Instrument      : Nifty options (CE / PE)`);
  console.log(`  Lot size        : 65 units`);
  console.log(`  Daily loss limit: ₹${C.DAILY_LOSS_LIMIT.toLocaleString('en-IN')}`);
  console.log(`  Min SL distance : ${C.MIN_SL_POINTS.NIFTY} pts`);
  console.log(`  Min RR          : 1:${C.MIN_REWARD_RATIO}`);
  console.log(`  Max trades/day  : ${C.MAX_TRADES_PER_DAY}`);
  console.log(`  Max open        : ${C.MAX_OPEN_TRADES}`);
  console.log(`\n  Min target example: entry ₹100, SL ₹86 → target ≥ ₹142`);
} else {
  process.exit(1);
}