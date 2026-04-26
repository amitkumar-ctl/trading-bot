# Nifty Options Trading Bot

A semi-automated trading bot for Nifty weekly options on NSE India. You analyse the market every morning and send a simple Telegram message. The bot handles everything else — ITM strike selection, SL, target, risk checks, and order placement on Zerodha.

---

## How it works

```
You send in Telegram: "buy ce 100"
              ↓
Bot detects: CE, entry ₹100
              ↓
Yahoo Finance: fetches Nifty spot price
              ↓
Auto-selects: first ITM strike
              ↓
Auto-sets: SL = ₹86 (14 pts below entry)
           Target = ₹132 (1:2.3 RR)
              ↓
Risk gate: checks all your rules
              ↓
Bot replies with summary + YES / NO buttons
              ↓
You tap YES → order placed on Zerodha
```

---

## What you send every morning

```
buy ce 100       ← bullish, entry ₹100
buy pe 85        ← bearish, entry ₹85
buy ce           ← fetches live market price automatically
buy pe           ← fetches live market price automatically
```

That's it. Nothing else needed.

---

## What the bot auto-sets

| | |
|---|---|
| Strike | First ITM from live Nifty spot price |
| Expiry | Weekly (always) |
| SL | Entry − 14 pts |
| Target | Entry + (14 × 2.3) pts |
| Lots | 1 (say "2 lots" to override) |

---

## Risk rules (hardcoded — cannot be overridden)

| Rule | Value |
|---|---|
| Instrument | Nifty options (CE / PE) only |
| Lot size | 65 units |
| Daily loss limit | ₹1,820 |
| Max trades per day | 2 |
| Max open trades | 1 at a time |
| Min SL distance | 14 pts |
| Min Risk:Reward | 1:2.3 |
| Premium range | ₹30 – ₹500 |
| Trading window | 9:45am – 2:30pm IST only |
| Market days | No weekends, no NSE holidays |

---

## Project structure

```
trading-bot/
  src/
    riskGate/
      constants.js      ← your risk rules (only file you ever edit)
      index.js          ← risk gate logic
    promptParser/
      index.js          ← parses your Telegram message (regex, no API needed)
    broker/
      index.js          ← Zerodha Kite integration (paper + live mode)
    bot/
      index.js          ← Telegram bot entry point
    auth/
      index.js          ← Kite daily login server (token refresh)
    utils/
      marketHours.js    ← market hours, holiday checker, Nifty spot price
  tests/
    riskGate.test.js    ← risk gate tests
  .env.example          ← copy to .env and fill in your keys
  .gitignore
  package.json
  README.md
```

---

## Prerequisites

- [Node.js](https://nodejs.org) v18 or higher
- [Telegram bot token](https://t.me/BotFather) — create via @BotFather
- Your Telegram chat ID — get from @userinfobot
- [Zerodha Kite Connect](https://kite.trade) app — Personal Free plan
- [ngrok](https://ngrok.com) — for Kite daily login (free account)
- AWS EC2 instance (t2.micro free tier) — for 24/7 hosting

---

## One time setup

**1. Clone the repo**
```bash
git clone https://github.com/YOUR_USERNAME/nifty-options-bot.git
cd nifty-options-bot
```

**2. Install dependencies**
```bash
npm install
```

**3. Create .env file**
```bash
cp .env.example .env
nano .env
```

Fill in:
```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id
KITE_API_KEY=your_kite_api_key
KITE_API_SECRET=your_kite_api_secret
KITE_ACCESS_TOKEN=
PAPER_TRADE=true
```

**4. Install PM2**
```bash
sudo npm install -g pm2
```

**5. Install ngrok**
```bash
snap install ngrok
ngrok config add-authtoken YOUR_NGROK_TOKEN
```

**6. Start ngrok tunnel**
```bash
pm2 start "ngrok http 3000" --name "ngrok-tunnel"
pm2 save
pm2 logs ngrok-tunnel   # copy the https URL shown
```

**7. Set redirect URL in Kite app**

Go to kite.trade → your app → set redirect URL to:
```
https://xxxx.ngrok-free.app/callback
```

**8. Start all services**
```bash
pm2 start src/auth/index.js --name "kite-login"
pm2 start src/bot/index.js --name "nifty-bot"
pm2 save
pm2 status
```

You should see 3 processes running:
```
nifty-bot       online
kite-login      online
ngrok-tunnel    online
```

**9. Run risk gate tests**
```bash
npm run test:risk
```

All tests should pass before trading.

---

## Every morning routine

**Step 1 — Refresh Zerodha token**
```
Open browser → https://xxxx.ngrok-free.app
Click "Login with Zerodha"
Enter credentials + TOTP
See green ✅ success page → token saved automatically
```

**Step 2 — Send trade in Telegram**
```
buy ce 100    ← if you know the entry price
buy ce        ← fetches live price automatically
```

**Step 3 — Confirm order**
```
Bot shows trade summary with YES / NO buttons
Tap YES → order placed
```

**Step 4 — Close trade (paper mode)**
```
When SL or target hits on your chart:
Send /close in Telegram
Type exit premium e.g. 132
Bot records P&L
```

---

## Telegram commands

| Command | What it does |
|---|---|
| `/start` | Welcome message |
| `/status` | Today's P&L, trades taken, daily room left |
| `/orders` | All orders placed today |
| `/close` | Close last open trade (paper mode) |
| `/rules` | Your hardcoded risk rules |
| `/cancel` | Cancel pending order confirmation |

---

## Paper trading vs live trading

Bot starts in **paper trade mode** by default (`PAPER_TRADE=true`).
- Orders are simulated — no real money
- Use `/close` to record exits and track P&L
- Everything works exactly like live mode

**To switch to live trading:**
1. Complete morning login flow at `https://xxxx.ngrok-free.app`
2. Set `PAPER_TRADE=false` in `.env`
3. Restart bot: `pm2 restart nifty-bot`

> ⚠️ Paper trade for at least 2 weeks before going live.

---

## Updating code

```bash
# On your Mac — push changes
git add .
git commit -m "your message"
git push

# On AWS server — pull and restart
git pull
npm install
pm2 restart all
```

---

## PM2 commands

```bash
pm2 status                  # check all processes
pm2 logs nifty-bot          # live bot logs
pm2 logs kite-login         # login server logs
pm2 restart nifty-bot       # restart bot
pm2 restart all             # restart everything
pm2 stop all                # stop everything
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Bot framework | Telegraf |
| Spot price | Yahoo Finance API |
| Option price | NSE India API |
| Broker API | Zerodha Kite Connect |
| Runtime | Node.js |
| Hosting | AWS EC2 (t2.micro) |
| Process manager | PM2 |
| HTTPS tunnel | ngrok |

---

## Disclaimer

This is a personal trading tool. It does not guarantee profits. All trading involves risk. You are responsible for your own trades and any losses. This is not financial advice.

You manually confirm every order by tapping YES in Telegram before anything is placed on Zerodha — making this semi-automated, not fully automated.