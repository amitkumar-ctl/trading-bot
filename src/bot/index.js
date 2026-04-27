/**
 * TELEGRAM BOT
 * ─────────────
 * Entry point. Run once — PM2 keeps it alive 24/7.
 * npm start
 */

require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { parsePrompt, formatOrderSummary } = require('../promptParser/index');
const { runRiskGate } = require('../riskGate/index');
const { placeOrder, squareOffAll } = require('../broker/index');
const { checkMarketHours, getISTTimeString } = require('../utils/marketHours');
const C = require('../riskGate/constants');

// ── Validate env ──────────────────────────────────────────────
['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'].forEach(k => {
    if (!process.env[k]) { console.error(`❌ Missing ${k} in .env`); process.exit(1); }
});

const MY_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ── Daily state ───────────────────────────────────────────────
const state = {
    dailyPnl:         0,
    openTradesCount:  0,
    tradesTodayCount: 0,
    pendingOrder:     null,
    lastOrderId:      null,
};

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// ── Security ──────────────────────────────────────────────────
bot.use((ctx, next) => {
    if (String(ctx.chat?.id) !== MY_CHAT_ID) return;
    return next();
});

// ─────────────────────────────────────────────────────────────
// /start
// ─────────────────────────────────────────────────────────────
bot.command('start', (ctx) => {
    const market = checkMarketHours();
    ctx.replyWithMarkdown([
        `👋 *Nifty Options Bot* 🟢 LIVE`,
        `Time: ${getISTTimeString()} IST`,
        `Market: ${market.reason}`,
        ``,
        `Just send your trade idea — I handle the rest:`,
        `_Buy Nifty 24200 CE weekly, entry 100, SL 86_`,
        ``,
        `Target is always auto-set at 1:${C.MIN_REWARD_RATIO} RR ⚡`,
        ``,
        `*/status*     — today's P&L and trades`,
        `*/rules*      — your risk rules`,
        `*/cancel*     — cancel pending order`,
        `*/squareoff*  — 🔴 emergency exit all positions`,
    ].join('\n'));
});

// ─────────────────────────────────────────────────────────────
// /status
// ─────────────────────────────────────────────────────────────
bot.command('status', (ctx) => {
    const loss      = Math.abs(Math.min(0, state.dailyPnl));
    const remaining = Math.max(0, C.DAILY_LOSS_LIMIT - loss);
    const sign      = state.dailyPnl >= 0 ? '+' : '';
    const market    = checkMarketHours();

    ctx.replyWithMarkdown([
        `📊 *Today's Status* 🟢 Live`,
        `🕐 ${getISTTimeString()} IST`,
        ``,
        `P&L          : ${sign}₹${state.dailyPnl.toLocaleString('en-IN')}`,
        `Trades taken : ${state.tradesTodayCount} of ${C.MAX_TRADES_PER_DAY}`,
        `Open trades  : ${state.openTradesCount}`,
        `Daily room   : ₹${remaining.toLocaleString('en-IN')} left of ₹${C.DAILY_LOSS_LIMIT.toLocaleString('en-IN')}`,
        ``,
        market.reason,
    ].join('\n'));
});

// ─────────────────────────────────────────────────────────────
// /rules
// ─────────────────────────────────────────────────────────────
bot.command('rules', (ctx) => {
    ctx.replyWithMarkdown([
        `🛡 *Your Risk Rules*`,
        ``,
        `Instrument   : Nifty options (CE / PE)`,
        `Lot size     : ${C.LOT_SIZE} units`,
        `Expiry       : Weekly only (auto-set)`,
        `Daily limit  : ₹${C.DAILY_LOSS_LIMIT.toLocaleString('en-IN')}`,
        `Max trades   : ${C.MAX_TRADES_PER_DAY}/day`,
        `Max open     : ${C.MAX_OPEN_TRADES} at a time`,
        `Min SL gap   : ${C.MIN_SL_POINTS.NIFTY} pts`,
        `RR           : 1:${C.MIN_REWARD_RATIO} (always auto-set ⚡)`,
        `Premium range: ₹${C.MIN_PREMIUM}–₹${C.MAX_PREMIUM}`,
        `Window       : 9:45am – 2:30pm IST only`,
        ``,
        `_These rules cannot be overridden._`,
    ].join('\n'));
});

// ─────────────────────────────────────────────────────────────
// /cancel
// ─────────────────────────────────────────────────────────────
bot.command('cancel', (ctx) => {
    if (state.pendingOrder) { state.pendingOrder = null; ctx.reply('❌ Pending order cancelled.'); }
    else ctx.reply('Nothing to cancel.');
});

// ─────────────────────────────────────────────────────────────
// /squareoff — emergency exit all positions
// ─────────────────────────────────────────────────────────────
bot.command('squareoff', async (ctx) => {
    await ctx.replyWithMarkdown(
        `⚠️ *EMERGENCY SQUARE OFF*\n\nThis will market-sell ALL open NFO positions immediately.\n\nAre you sure?`,
        Markup.inlineKeyboard([
            Markup.button.callback('🔴 YES — Exit everything NOW', 'CONFIRM_SQUAREOFF'),
            Markup.button.callback('❌ NO  — Cancel', 'CANCEL_SQUAREOFF'),
        ])
    );
});

bot.action('CONFIRM_SQUAREOFF', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('⏳ Squaring off all positions...');
    try {
        const result = await squareOffAll();
        state.openTradesCount = 0;
        state.lastOrderId     = null;
        state.pendingOrder    = null;
        await ctx.replyWithMarkdown([
            `🔴 *Square Off Done*`,
            ``,
            `${result.detail}`,
            ``,
            `_Check Zerodha app to confirm exits._`,
        ].join('\n'));
    } catch (err) {
        await ctx.replyWithMarkdown(`❌ *Square off failed*\n\n${err.message}\n\n_Exit manually from Zerodha app immediately._`);
    }
});

bot.action('CANCEL_SQUAREOFF', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Cancelled. Positions unchanged.');
});

// ─────────────────────────────────────────────────────────────
// YES — place order
// ─────────────────────────────────────────────────────────────
bot.action('CONFIRM_ORDER', async (ctx) => {
    await ctx.answerCbQuery();
    if (!state.pendingOrder) { await ctx.reply('No pending order.'); return; }

    const order = state.pendingOrder;
    state.pendingOrder = null;

    try {
        await ctx.reply('⏳ Placing order...');
        const result = await placeOrder(order);

        state.tradesTodayCount++;
        state.openTradesCount++;
        state.lastOrderId = result.orderId;

        await ctx.replyWithMarkdown([
            `✅ *Order Placed* 🟢 Live`,
            ``,
            `Nifty ${order.strike} ${order.optionType} ${order.expiry}`,
            `Entry  : ₹${order.premium}`,
            `SL     : ₹${order.slPremium}`,
            `Target : ₹${order.targetPremium}`,
            `Lots   : ${order.lots}`,
            ``,
            `ID: \`${result.orderId}\``,
            ``,
            `_SL + target orders placed on Zerodha._`,
        ].join('\n'));

    } catch (err) {
        await ctx.replyWithMarkdown(`❌ *Order failed*\n\n${err.message}`);
    }
});

// ─────────────────────────────────────────────────────────────
// NO — cancel
// ─────────────────────────────────────────────────────────────
bot.action('CANCEL_ORDER', async (ctx) => {
    await ctx.answerCbQuery();
    state.pendingOrder = null;
    await ctx.reply('❌ Cancelled. Send a new trade when ready.');
});

// ─────────────────────────────────────────────────────────────
// Text handler
// ─────────────────────────────────────────────────────────────
bot.on('text', async (ctx) => {
    const message = ctx.message.text;
    if (message.startsWith('/')) return;

    // ── Pending order reminder ──
    if (state.pendingOrder) {
        await ctx.reply('Pending order waiting for confirmation.',
            Markup.inlineKeyboard([
                Markup.button.callback('✅ YES — Place order', 'CONFIRM_ORDER'),
                Markup.button.callback('❌ NO  — Cancel', 'CANCEL_ORDER'),
            ]));
        return;
    }

    // ── Step 1: Market hours check ──
    const market = checkMarketHours();
    if (!market.allowed) {
        await ctx.replyWithMarkdown([
            `${market.reason}`,
            ``,
            `_Send your trade idea between 9:45am and 2:30pm IST on market days._`,
        ].join('\n'));
        return;
    }

    // ── Step 2: Parse ──
    await ctx.reply('🔍 Parsing your trade...');
    const { order, error } = await parsePrompt(message);

    if (error || !order) {
        await ctx.replyWithMarkdown([
            `❌ *Could not parse message*`,
            ``,
            `${error || 'Unknown error'}`,
            ``,
            `Example:`,
            `_Buy Nifty 24200 CE weekly, entry 100, SL 86_`,
        ].join('\n'));
        return;
    }

    // ── Step 3: Risk gate ──
    const gate = runRiskGate(order, state);
    if (!gate.passed) {
        const failures = gate.checks
            .filter(c => !c.passed)
            .map(c => `• ${c.reason}`)
            .join('\n');
        await ctx.replyWithMarkdown(`🚫 *Risk gate blocked this trade*\n\n${failures}`);
        return;
    }

    // ── Step 4: Confirm ──
    state.pendingOrder = order;
    await ctx.replyWithMarkdown(
        formatOrderSummary(order),
        Markup.inlineKeyboard([
            Markup.button.callback('✅ YES — Place order', 'CONFIRM_ORDER'),
            Markup.button.callback('❌ NO  — Cancel', 'CANCEL_ORDER'),
        ])
    );
});

// ─────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────
bot.launch().then(() => {
    console.log(`🤖 Nifty Options Bot started — 🟢 LIVE`);
    console.log(`   Window      : 9:45am – 2:30pm IST`);
    console.log(`   Chat ID     : ${MY_CHAT_ID}`);
    console.log(`   Daily limit : ₹${C.DAILY_LOSS_LIMIT.toLocaleString('en-IN')}`);
    console.log(`\n   Send /start in Telegram\n`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));