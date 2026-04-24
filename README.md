# Nifty Options Trading Bot

A semi-automated trading bot for Nifty options on NSE India. You do the analysis every morning and send a plain English trade idea via Telegram. The bot parses it with Claude AI, enforces your risk rules, asks for confirmation, and places the order on Zerodha.

---

## How it works

```
You (Telegram message)
        ↓
Claude AI — parses plain English into structured order
        ↓
Risk Gate — enforces your hardcoded rules (no exceptions)
        ↓
YES / NO buttons — you confirm before anything is placed
        ↓
Zerodha Kite API — places entry + SL + target orders
```

### Example morning message
```
Bearish on nifty today. 24000 PE weekly, entry around 90, SL 76, target 132
```

The bot extracts all parameters, checks your rules, and replies with a summary + confirmation buttons. You tap YES — order is placed. You tap NO — nothing happens.

---

## Risk rules (hardcoded)

These are enforced on every trade. The AI cannot override them.

| Rule | Value |
|---|---|
| Instrument | Nifty options (CE / PE) only |
| Lot size | 65 units |
| Daily loss limit | ₹1,820 |
| Max trades per day | 2 |
| Max open trades | 1 |
| Min SL distance | 14 pts |
| Min Risk:Reward | 1:3 |
| Premium range | ₹30 – ₹500 |

---

## Project structure

```
trading-bot/
  src/
    riskGate/
      constants.js      ← your risk rules (edit only this to change rules)
      index.js          ← risk gate logic (47 tests)
    promptParser/
      index.js          ← Claude AI parses your Telegram message
    broker/
      index.js          ← Zerodha Kite integration (paper + live mode)
    bot/
      index.js          ← Telegram bot (entry point)
  tests/
    riskGate.test.js    ← 47 tests for risk gate
    promptParser.test.js← tests for prompt parser (needs API key)
  .env.example          ← copy to .env and fill in your keys
  .gitignore
  package.json
  README.md
```

---

## Prerequisites

- [Node.js](https://nodejs.org) v18 or higher
- [Telegram bot token](https://t.me/BotFather) — create a bot via @BotFather
- Your Telegram chat ID — get it from @userinfobot
- [Anthropic API key](https://console.anthropic.com) — for Claude AI prompt parsing
- [Zerodha Kite Connect](https://kite.trade) subscription — for live trading (₹2,000/month)

---

## Setup

**1. Clone the repo**
```bash
git clone https://github.com/YOUR_USERNAME/nifty-options-bot.git
cd nifty-options-bot
```

**2. Install dependencies**
```bash
npm install
```

**3. Create your `.env` file**
```bash
cp .env.example .env
```

Open `.env` and fill in your values:
```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
TELEGRAM_BOT_TOKEN=7123456789:AAFxxx
TELEGRAM_CHAT_ID=912345678
KITE_API_KEY=your_kite_api_key
KITE_API_SECRET=your_kite_api_secret
KITE_ACCESS_TOKEN=your_daily_access_token
PAPER_TRADE=true
```

**4. Run the risk gate tests**
```bash
npm run test:risk
```

All 47 tests should pass before you run the bot.

**5. Start the bot**
```bash
npm start
```

The terminal will hang — that's normal. The bot is listening. Open Telegram and send `/start` to your bot.

---

## Telegram commands

| Command | What it does |
|---|---|
| `/start` | Welcome message and instructions |
| `/status` | Today's P&L, trades taken, daily room left |
| `/orders` | All orders placed today (paper mode) |
| `/close` | Manually close last open trade (paper mode) |
| `/rules` | Your hardcoded risk rules |
| `/cancel` | Cancel a pending order confirmation |

---

## Paper trading vs live trading

The bot starts in **paper trade mode** by default (`PAPER_TRADE=true`). In this mode:
- Orders are simulated and logged — no real money involved
- Use `/close` to record your exit price and track P&L
- Everything else works exactly as it would in live mode

**To switch to live trading:**
1. Get Kite Connect API credentials from [kite.trade](https://kite.trade)
2. Set `PAPER_TRADE=false` in your `.env`
3. Fill in `KITE_API_KEY`, `KITE_API_SECRET`, `KITE_ACCESS_TOKEN`

> ⚠️ Paper trade for at least 2 weeks before going live. Understand how the bot behaves before real money is involved.

---

## Daily workflow

**Before market opens:**
```bash
npm start
```

**Send your trade idea in Telegram:**
```
Buy Nifty 24200 CE weekly, entry 100, SL 86, target 142
```

**When trade exits (SL or target hit):**
```
/close
→ Bot asks: at what premium did you exit?
→ Type: 142
→ Bot shows P&L and updates daily total
```

**End of day:**
```
/status   → check final P&L
Ctrl+C    → stop the bot
```

---

## Kite access token — daily refresh

Zerodha's access token expires every day at 6am. For paper trading this doesn't matter. For live trading you'll need to refresh it each morning. A login helper script will be added in a future update.

---

## Tech stack

| Layer | Technology |
|---|---|
| Bot framework | [Telegraf](https://telegraf.js.org) |
| AI parsing | [Anthropic Claude](https://anthropic.com) (`claude-opus-4-5`) |
| Broker API | [Kite Connect](https://kite.trade/docs/connect) |
| Runtime | Node.js |
| Language | JavaScript (CommonJS) |

---

## Disclaimer

This bot is a personal trading tool. It does not guarantee profits. All trading involves risk. You are responsible for your own trades and any losses incurred. This is not financial advice.

Automated trading on Zerodha requires compliance with SEBI regulations. Semi-automated trading (human confirms every order) is what this bot does — you tap YES before every order is placed.
