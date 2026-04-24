/**
 * PROMPT PARSER TESTS
 * ────────────────────
 * These tests call the real Claude API — needs ANTHROPIC_API_KEY in .env
 *
 * Run: node tests/promptParser.test.js
 */

require('dotenv').config();
const { parsePrompt } = require('../src/promptParser/index');
const { runRiskGate } = require('../src/riskGate/index');

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('❌  ANTHROPIC_API_KEY not set in .env file');
  process.exit(1);
}

let passed = 0; let failed = 0;

async function test(name, message, validator) {
  process.stdout.write(`  Testing: "${message.slice(0, 60)}..."\n`);
  try {
    const { order, error } = await parsePrompt(message);
    if (error) throw new Error(`Parser error: ${error}`);
    validator(order);
    console.log(`  ✅ ${name}\n`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}\n     → ${e.message}\n`);
    failed++;
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ─────────────────────────────────────────────────────────────
async function runTests() {

  console.log('\n━━━ BASIC PARSING ━━━\n');

  await test(
    'Clean structured message',
    'Buy Nifty 24200 CE weekly, premium 100, SL 86, target 142, 1 lot',
    (o) => {
      assert(o.optionType  === 'CE',     `Expected CE, got ${o.optionType}`);
      assert(o.strike      === 24200,    `Expected 24200, got ${o.strike}`);
      assert(o.premium     === 100,      `Expected 100, got ${o.premium}`);
      assert(o.slPremium   === 86,       `Expected 86, got ${o.slPremium}`);
      assert(o.targetPremium === 142,    `Expected 142, got ${o.targetPremium}`);
      assert(o.lots        === 1,        `Expected 1, got ${o.lots}`);
      assert(o.expiry      === 'WEEKLY', `Expected WEEKLY, got ${o.expiry}`);
    }
  );

  await test(
    'Casual language — CE',
    'thinking of going long on nifty. looking at 24250 call, weekly expiry. entry around 90, stop at 76, want to target 132',
    (o) => {
      assert(o.optionType  === 'CE',  `Expected CE, got ${o.optionType}`);
      assert(o.strike      === 24250, `Expected 24250, got ${o.strike}`);
      assert(o.premium     === 90,    `Expected 90, got ${o.premium}`);
      assert(o.slPremium   === 76,    `Expected 76, got ${o.slPremium}`);
      assert(o.targetPremium === 132, `Expected 132, got ${o.targetPremium}`);
    }
  );

  await test(
    'Bearish PE trade',
    'bearish on nifty today. 24000 PE, buy at 80, SL 66, target 122. weekly.',
    (o) => {
      assert(o.optionType  === 'PE',  `Expected PE, got ${o.optionType}`);
      assert(o.strike      === 24000, `Expected 24000, got ${o.strike}`);
      assert(o.premium     === 80,    `Expected 80, got ${o.premium}`);
      assert(o.slPremium   === 66,    `Expected 66, got ${o.slPremium}`);
    }
  );

  await test(
    'Hindi-English mix (common for Indian traders)',
    'aaj nifty mein 24200 CE lena hai, weekly wala. entry 95 ke paas, SL 81, target 137',
    (o) => {
      assert(o.optionType === 'CE',   `Expected CE, got ${o.optionType}`);
      assert(o.strike     === 24200,  `Expected 24200, got ${o.strike}`);
      assert(o.premium    === 95,     `Expected 95, got ${o.premium}`);
      assert(o.slPremium  === 81,     `Expected 81, got ${o.slPremium}`);
    }
  );

  console.log('\n━━━ DEFAULTS & AUTO-FILL ━━━\n');

  await test(
    'Expiry defaults to WEEKLY when not mentioned',
    'Buy 24200 CE, entry 100, SL 86, target 142',
    (o) => {
      assert(o.expiry === 'WEEKLY', `Expected WEEKLY default, got ${o.expiry}`);
    }
  );

  await test(
    'Lots defaults to 1 when not mentioned',
    'Buy 24200 CE weekly, entry 100, SL 86, target 142',
    (o) => {
      assert(o.lots === 1, `Expected lots default 1, got ${o.lots}`);
    }
  );

  await test(
    'Auto-fills target at 1:3 RR when missing',
    'Buy 24200 CE weekly, entry 100, SL 86',
    (o) => {
      // risk = 14, so min target = 100 + 42 = 142
      assert(o.targetPremium === 142,      `Expected auto-target 142, got ${o.targetPremium}`);
      assert(o._targetAutoFilled === true, `Expected _targetAutoFilled flag`);
    }
  );

  await test(
    'Monthly expiry parsed correctly',
    'Nifty 24200 PE monthly expiry, buy at 85, stop 71, target 127',
    (o) => {
      assert(o.expiry     === 'MONTHLY', `Expected MONTHLY, got ${o.expiry}`);
      assert(o.optionType === 'PE',      `Expected PE, got ${o.optionType}`);
    }
  );

  console.log('\n━━━ NULL FIELDS (incomplete messages) ━━━\n');

  await test(
    'Missing SL comes back as null',
    'Buy Nifty 24200 CE weekly, entry 100, target 142',
    (o) => {
      assert(o.slPremium === null, `Expected null SL, got ${o.slPremium}`);
    }
  );

  await test(
    'Missing strike comes back as null',
    'Buy Nifty CE weekly, entry 100, SL 86, target 142',
    (o) => {
      assert(o.strike === null, `Expected null strike, got ${o.strike}`);
    }
  );

  console.log('\n━━━ FULL PIPELINE — PARSER → RISK GATE ━━━\n');

  async function pipelineTest(name, message, expectedPass) {
    process.stdout.write(`  Testing pipeline: "${message.slice(0,55)}..."\n`);
    try {
      const { order, error } = await parsePrompt(message);
      if (error) throw new Error(error);
      const state = { dailyPnl: 0, openTradesCount: 0, tradesTodayCount: 0 };
      const result = runRiskGate(order, state);
      if (expectedPass) {
        assert(result.passed, `Expected PASS but got: ${result.summary}`);
        console.log(`  ✅ ${name} → Risk gate APPROVED\n`);
      } else {
        assert(!result.passed, `Expected BLOCK but gate passed`);
        const reasons = result.checks.filter(c => !c.passed).map(c => c.reason);
        console.log(`  ✅ ${name} → Risk gate BLOCKED\n     Reason: ${reasons[0]}\n`);
      }
      passed++;
    } catch(e) {
      console.log(`  ❌ ${name}\n     → ${e.message}\n`);
      failed++;
    }
  }

  await pipelineTest(
    'Valid trade passes end-to-end',
    'Buy Nifty 24200 CE weekly, entry 100, SL 86, target 142, 1 lot',
    true
  );

  await pipelineTest(
    'RR too low gets blocked by risk gate',
    'Buy Nifty 24200 CE weekly, entry 100, SL 86, target 120, 1 lot',
    false
  );

  await pipelineTest(
    'SL too tight gets blocked by risk gate',
    'Buy Nifty 24200 CE weekly, entry 100, SL 92, target 142, 1 lot',
    false
  );

  // ── Summary ──
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log(`\n🎉 Prompt parser working. Natural language → Risk gate pipeline is solid.`);
    console.log(`\nNext: Telegram bot — connects this pipeline to your phone.`);
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});