/**
 * TELEGRAM BOT
 * ─────────────
 * Entry point. Run every morning before market opens.
 *
 * Run:  npm start
 * Stop: Ctrl+C
 */

require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { parsePrompt, formatOrderSummary } = require('../promptParser/index');
const { runRiskGate }                     = require('../riskGate/index');
const { placeOrder, closePaperOrder, getPaperOrders, isPaperMode } = require('../broker/index');
const C = require('../riskGate/constants');

// ── Validate env on startup ───────────────────────────────────
const REQUIRED = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'ANTHROPIC_API_KEY'];
for (const key of REQUIRED) {
  if (!process.env[key]) {
    console.error(`❌  Missing ${key} in .env`);
    process.exit(1);
  }
}

const MY_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ── Daily state (resets when bot restarts each morning) ───────
const state = {
  dailyPnl:         0,
  openTradesCount:  0,
  tradesTodayCount: 0,
  pendingOrder:     null,   // waiting for YES/NO
  lastOrderId:      null,   // most recent placed order (for /close command)
};

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// ── Security: only respond to your chat ID ────────────────────
bot.use((ctx, next) => {
  if (String(ctx.chat?.id) !== MY_CHAT_ID) return;
  return next();
});

// ─────────────────────────────────────────────────────────────
// /start
// ─────────────────────────────────────────────────────────────
bot.command('start', (ctx) => {
  const mode = isPaperMode() ? '📄 PAPER TRADE MODE' : '🟢 LIVE TRADE MODE';
  ctx.replyWithMarkdown([
    `👋 *Nifty Options Trading Bot*`,
    `Mode: ${mode}`,
    ``,
    `Send your morning trade idea in plain English.`,
    ``,
    `*Example:*`,
    `_Buy Nifty 24200 CE weekly, entry 100, SL 86, target 142_`,
    ``,
    `*Commands:*`,
    `/status   — today's P&L and trades`,
    `/orders   — all orders placed today`,
    `/close    — manually close last open trade`,
    `/rules    — your risk rules`,
    `/cancel   — cancel pending confirmation`,
  ].join('\n'));
});

// ─────────────────────────────────────────────────────────────
// /status
// ─────────────────────────────────────────────────────────────
bot.command('status', (ctx) => {
  const loss      = Math.abs(Math.min(0, state.dailyPnl));
  const remaining = Math.max(0, C.DAILY_LOSS_LIMIT - loss);
  const pnlSign   = state.dailyPnl >= 0 ? '+' : '';
  const mode      = isPaperMode() ? '📄 Paper' : '🟢 Live';

  ctx.replyWithMarkdown([
    `📊 *Today's Status* (${mode})`,
    ``,
    `P&L            : ${pnlSign}₹${state.dailyPnl.toLocaleString('en-IN')}`,
    `Trades taken   : ${state.tradesTodayCount} of ${C.MAX_TRADES_PER_DAY}`,
    `Open trades    : ${state.openTradesCount}`,
    `Daily loss room: ₹${remaining.toLocaleString('en-IN')} of ₹${C.DAILY_LOSS_LIMIT.toLocaleString('en-IN')}`,
    ``,
    state.tradesTodayCount >= C.MAX_TRADES_PER_DAY
      ? `🔴 *Max trades reached. Done for today.*`
      : loss >= C.DAILY_LOSS_LIMIT
        ? `🔴 *Daily loss limit hit. Done for today.*`
        : `🟢 *Bot active. Ready for trades.*`,
  ].join('\n'));
});

// ─────────────────────────────────────────────────────────────
// /orders — show all paper orders today
// ─────────────────────────────────────────────────────────────
bot.command('orders', (ctx) => {
  if (!isPaperMode()) {
    ctx.reply('Live mode — check your Zerodha app for orders.');
    return;
  }

  const orders = getPaperOrders();
  if (orders.length === 0) {
    ctx.reply('No orders placed yet today.');
    return;
  }

  const lines = orders.map((o, i) => {
    const pnlStr = o.pnl !== null
      ? `P&L: ${o.pnl >= 0 ? '+' : ''}₹${o.pnl.toLocaleString('en-IN')}`
      : `Open`;
    return `${i + 1}. ${o.tradingSymbol} | Entry ₹${o.premium} | SL ₹${o.slPremium} | Tgt ₹${o.targetPremium} | ${pnlStr}`;
  });

  ctx.replyWithMarkdown(`📋 *Orders Today*\n\n${lines.join('\n')}`);
});

// ─────────────────────────────────────────────────────────────
// /close — manually close last open paper trade
// ─────────────────────────────────────────────────────────────
bot.command('close', async (ctx) => {
  if (!isPaperMode()) {
    ctx.reply('Live mode — close trades from your Zerodha app.');
    return;
  }

  if (!state.lastOrderId) {
    ctx.reply('No open trade to close.');
    return;
  }

  // Ask for exit price
  state.pendingClose = true;
  await ctx.reply(
    'At what premium did you exit? Reply with just the number.\nExample: 145',
  );
});

// ─────────────────────────────────────────────────────────────
// /rules
// ─────────────────────────────────────────────────────────────
bot.command('rules', (ctx) => {
  ctx.replyWithMarkdown([
    `🛡 *Your Risk Rules*`,
    ``,
    `Instrument      : Nifty options (CE / PE)`,
    `Lot size        : ${C.LOT_SIZE} units`,
    `Daily loss limit: ₹${C.DAILY_LOSS_LIMIT.toLocaleString('en-IN')}`,
    `Max trades/day  : ${C.MAX_TRADES_PER_DAY}`,
    `Max open trades : ${C.MAX_OPEN_TRADES}`,
    `Min SL distance : ${C.MIN_SL_POINTS.NIFTY} pts`,
    `Min RR          : 1:${C.MIN_REWARD_RATIO}`,
    `Premium range   : ₹${C.MIN_PREMIUM}–₹${C.MAX_PREMIUM}`,
    ``,
    `_These rules cannot be overridden by any message._`,
  ].join('\n'));
});

// ─────────────────────────────────────────────────────────────
// /cancel
// ─────────────────────────────────────────────────────────────
bot.command('cancel', (ctx) => {
  if (state.pendingOrder) {
    state.pendingOrder = null;
    ctx.reply('❌ Pending order cancelled.');
  } else if (state.pendingClose) {
    state.pendingClose = false;
    ctx.reply('❌ Close cancelled.');
  } else {
    ctx.reply('Nothing to cancel.');
  }
});

// ─────────────────────────────────────────────────────────────
// YES — confirm and place order
// ─────────────────────────────────────────────────────────────
bot.action('CONFIRM_ORDER', async (ctx) => {
  await ctx.answerCbQuery();

  if (!state.pendingOrder) {
    await ctx.reply('No pending order. Send a trade first.');
    return;
  }

  const order = state.pendingOrder;
  state.pendingOrder = null;

  try {
    await ctx.reply('⏳ Placing order...');
    const result = await placeOrder(order);

    // Update state
    state.tradesTodayCount++;
    state.openTradesCount++;
    state.lastOrderId = result.orderId;

    const mode = isPaperMode() ? '📄 Paper' : '🟢 Live';
    await ctx.replyWithMarkdown([
      `✅ *Order Placed* (${mode})`,
      ``,
      `Symbol  : Nifty ${order.strike} ${order.optionType} ${order.expiry}`,
      `Entry   : ₹${order.premium}`,
      `SL      : ₹${order.slPremium}`,
      `Target  : ₹${order.targetPremium}`,
      `Lots    : ${order.lots}`,
      ``,
      `Order ID: \`${result.orderId}\``,
      ``,
      isPaperMode()
        ? `_Use /close when trade exits (SL hit or target hit)_`
        : `_Monitor on Zerodha app. SL + target orders also placed._`,
    ].join('\n'));

  } catch (err) {
    await ctx.replyWithMarkdown(`❌ *Order failed*\n\n${err.message}`);
  }
});

// ─────────────────────────────────────────────────────────────
// NO — cancel order
// ─────────────────────────────────────────────────────────────
bot.action('CANCEL_ORDER', async (ctx) => {
  await ctx.answerCbQuery();
  state.pendingOrder = null;
  await ctx.reply('❌ Order cancelled. Send a new trade when ready.');
});

// ─────────────────────────────────────────────────────────────
// Main text handler
// ─────────────────────────────────────────────────────────────
bot.on('text', async (ctx) => {
  const message = ctx.message.text;
  if (message.startsWith('/')) return;

  // ── Handle exit price for /close ──
  if (state.pendingClose) {
    const exitPrice = parseFloat(message);
    if (isNaN(exitPrice) || exitPrice <= 0) {
      await ctx.reply('Please enter a valid premium number, e.g. 145');
      return;
    }

    state.pendingClose = false;
    const result = closePaperOrder(state.lastOrderId, exitPrice, 'MANUAL');

    if (result.pnl !== null) {
      state.dailyPnl        += result.pnl;
      state.openTradesCount  = Math.max(0, state.openTradesCount - 1);
      state.lastOrderId      = null;

      const sign = result.pnl >= 0 ? '+' : '';
      await ctx.replyWithMarkdown([
        `📕 *Trade Closed*`,
        ``,
        `Exit premium : ₹${exitPrice}`,
        `P&L          : ${sign}₹${result.pnl.toLocaleString('en-IN')}`,
        `Today's P&L  : ${state.dailyPnl >= 0 ? '+' : ''}₹${state.dailyPnl.toLocaleString('en-IN')}`,
      ].join('\n'));
    } else {
      await ctx.reply(result.detail);
    }
    return;
  }

  // ── Handle pending confirmation reminder ──
  if (state.pendingOrder) {
    await ctx.reply(
      'You have a pending order waiting for confirmation.',
      Markup.inlineKeyboard([
        Markup.button.callback('✅ YES — Place order', 'CONFIRM_ORDER'),
        Markup.button.callback('❌ NO  — Cancel',      'CANCEL_ORDER'),
      ])
    );
    return;
  }

  // ── Parse new trade message ──
  await ctx.reply('🔍 Parsing your trade...');

  const { order, error } = await parsePrompt(message);

  if (error || !order) {
    await ctx.replyWithMarkdown([
      `❌ *Could not parse your message*`,
      ``,
      `${error || 'Unknown error'}`,
      ``,
      `Try:`,
      `_Buy Nifty 24200 CE weekly, entry 100, SL 86, target 142_`,
    ].join('\n'));
    return;
  }

  // ── Risk gate ──
  const gate = runRiskGate(order, state);

  if (!gate.passed) {
    const failures = gate.checks
      .filter(c => !c.passed)
      .map(c => `• ${c.reason}`)
      .join('\n');
    await ctx.replyWithMarkdown(`🚫 *Risk gate blocked this trade*\n\n${failures}`);
    return;
  }

  // ── All good — show summary and ask for confirmation ──
  state.pendingOrder = order;

  await ctx.replyWithMarkdown(
    formatOrderSummary(order),
    Markup.inlineKeyboard([
      Markup.button.callback('✅ YES — Place order', 'CONFIRM_ORDER'),
      Markup.button.callback('❌ NO  — Cancel',      'CANCEL_ORDER'),
    ])
  );
});

// ─────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────
const mode = process.env.PAPER_TRADE === 'false' ? '🟢 LIVE' : '📄 PAPER';

bot.launch().then(() => {
  console.log(`🤖 Trading bot started`);
  console.log(`   Mode          : ${mode}`);
  console.log(`   Chat ID       : ${MY_CHAT_ID}`);
  console.log(`   Daily limit   : ₹${C.DAILY_LOSS_LIMIT.toLocaleString('en-IN')}`);
  console.log(`   Max trades/day: ${C.MAX_TRADES_PER_DAY}`);
  console.log(`\n   Send /start in Telegram to begin\n`);
});

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));