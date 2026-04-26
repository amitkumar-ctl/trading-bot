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
const { placeOrder, closePaperOrder, getPaperOrders, isPaperMode } = require('../broker/index');
const { checkMarketHours, getISTTimeString } = require('../utils/marketHours');
const C = require('../riskGate/constants');

// ── Validate env ──────────────────────────────────────────────
['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',].forEach(k => {
    if (!process.env[k]) { console.error(`❌ Missing ${k} in .env`); process.exit(1); }
});

const MY_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ── Daily state ───────────────────────────────────────────────
const state = {
    dailyPnl: 0,
    openTradesCount: 0,
    tradesTodayCount: 0,
    pendingOrder: null,
    pendingClose: false,
    lastOrderId: null,
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
    const mode = isPaperMode() ? '📄 PAPER TRADE' : '🟢 LIVE TRADE';
    const market = checkMarketHours();
    ctx.replyWithMarkdown([
        `👋 *Nifty Options Bot*`,
        `Mode: ${mode}`,
        `Time: ${getISTTimeString()} IST`,
        `Market: ${market.reason}`,
        ``,
        `Just send your trade idea — I handle the rest:`,
        `_Buy Nifty 24200 CE weekly, entry 100, SL 86_`,
        ``,
        `Target is always auto-set at 1:${C.MIN_REWARD_RATIO} RR ⚡`,
        ``,
        `*/status*  — today's P&L and trades`,
        `*/orders*  — all orders today`,
        `*/close*   — close last open trade`,
        `*/rules*   — your risk rules`,
        `*/cancel*  — cancel pending order`,
    ].join('\n'));
});

// ─────────────────────────────────────────────────────────────
// /status
// ─────────────────────────────────────────────────────────────
bot.command('status', (ctx) => {
    const loss = Math.abs(Math.min(0, state.dailyPnl));
    const remaining = Math.max(0, C.DAILY_LOSS_LIMIT - loss);
    const sign = state.dailyPnl >= 0 ? '+' : '';
    const market = checkMarketHours();
    const mode = isPaperMode() ? '📄 Paper' : '🟢 Live';

    ctx.replyWithMarkdown([
        `📊 *Today's Status* (${mode})`,
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
// /orders
// ─────────────────────────────────────────────────────────────
bot.command('orders', (ctx) => {
    if (!isPaperMode()) { ctx.reply('Live mode — check Zerodha app for orders.'); return; }
    const orders = getPaperOrders();
    if (!orders.length) { ctx.reply('No orders placed yet today.'); return; }
    const lines = orders.map((o, i) => {
        const pnl = o.pnl !== null ? `P&L: ${o.pnl >= 0 ? '+' : ''}₹${o.pnl.toLocaleString('en-IN')}` : 'Open';
        return `${i + 1}. ${o.tradingSymbol} | Entry ₹${o.premium} | SL ₹${o.slPremium} | Tgt ₹${o.targetPremium} | ${pnl}`;
    });
    ctx.replyWithMarkdown(`📋 *Orders Today*\n\n${lines.join('\n')}`);
});

// ─────────────────────────────────────────────────────────────
// /close
// ─────────────────────────────────────────────────────────────
bot.command('close', async (ctx) => {
    if (!isPaperMode()) { ctx.reply('Live mode — close trades from Zerodha app.'); return; }
    if (!state.lastOrderId) { ctx.reply('No open trade to close.'); return; }
    state.pendingClose = true;
    await ctx.reply('At what premium did you exit?\nJust type the number e.g. *142*');
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
    else if (state.pendingClose) { state.pendingClose = false; ctx.reply('❌ Close cancelled.'); }
    else ctx.reply('Nothing to cancel.');
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
            `✅ *Order Placed* (${isPaperMode() ? '📄 Paper' : '🟢 Live'})`,
            ``,
            `Nifty ${order.strike} ${order.optionType} ${order.expiry}`,
            `Entry  : ₹${order.premium}`,
            `SL     : ₹${order.slPremium}`,
            `Target : ₹${order.targetPremium}`,
            `Lots   : ${order.lots}`,
            ``,
            `ID: \`${result.orderId}\``,
            ``,
            isPaperMode() ? `_Use /close when trade exits._` : `_SL + target orders placed on Zerodha._`,
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

    // ── Exit price for /close ──
    if (state.pendingClose) {
        const exitPrice = parseFloat(message);
        if (isNaN(exitPrice) || exitPrice <= 0) {
            await ctx.reply('Enter a valid premium number e.g. 142'); return;
        }
        state.pendingClose = false;
        const result = closePaperOrder(state.lastOrderId, exitPrice, 'MANUAL');
        if (result.pnl !== null) {
            state.dailyPnl += result.pnl;
            state.openTradesCount = Math.max(0, state.openTradesCount - 1);
            state.lastOrderId = null;
            const sign = result.pnl >= 0 ? '+' : '';
            await ctx.replyWithMarkdown([
                `📕 *Trade Closed*`,
                `Exit premium : ₹${exitPrice}`,
                `P&L          : ${sign}₹${result.pnl.toLocaleString('en-IN')}`,
                `Today's P&L  : ${state.dailyPnl >= 0 ? '+' : ''}₹${state.dailyPnl.toLocaleString('en-IN')}`,
            ].join('\n'));
        } else {
            await ctx.reply(result.detail);
        }
        return;
    }

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
const mode = process.env.PAPER_TRADE === 'false' ? '🟢 LIVE' : '📄 PAPER';
bot.launch().then(() => {
    console.log(`🤖 Nifty Options Bot started`);
    console.log(`   Mode     : ${mode}`);
    console.log(`   Window   : 9:45am – 2:30pm IST`);
    console.log(`   Chat ID  : ${MY_CHAT_ID}`);
    console.log(`   Daily limit : ₹${C.DAILY_LOSS_LIMIT.toLocaleString('en-IN')}`);
    console.log(`\n   Send /start in Telegram\n`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));