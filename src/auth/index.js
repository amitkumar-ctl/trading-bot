/**
 * KITE DAILY LOGIN SERVER
 * ────────────────────────
 * Run this every morning to refresh your Zerodha access token.
 * 
 * Usage: node src/auth/index.js
 * Then open: http://YOUR_ELASTIC_IP:3000/login
 */

require('dotenv').config();
const http     = require('http');
const https    = require('https');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');

const API_KEY    = process.env.KITE_API_KEY;
const API_SECRET = process.env.KITE_API_SECRET;
const PORT       = 3000;
const ENV_PATH   = path.resolve(__dirname, '../../.env');

if (!API_KEY || !API_SECRET) {
  console.error('❌ KITE_API_KEY or KITE_API_SECRET missing in .env');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────
// Generate Kite login URL
// ─────────────────────────────────────────────────────────────
function getLoginUrl() {
  return `https://kite.zerodha.com/connect/login?api_key=${API_KEY}&v=3`;
}

// ─────────────────────────────────────────────────────────────
// Exchange request_token for access_token
// ─────────────────────────────────────────────────────────────
function generateChecksum(requestToken) {
  return crypto
    .createHash('sha256')
    .update(`${API_KEY}${requestToken}${API_SECRET}`)
    .digest('hex');
}

async function getAccessToken(requestToken) {
  const checksum  = generateChecksum(requestToken);
  const postData  = `api_key=${API_KEY}&request_token=${requestToken}&checksum=${checksum}`;

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.kite.trade',
      path:     '/session/token',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'X-Kite-Version': '3',
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json?.data?.access_token) {
            resolve(json.data.access_token);
          } else {
            reject(new Error(json?.message || 'No access token in response'));
          }
        } catch (e) {
          reject(new Error(`Parse failed: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────
// Save access token to .env file
// ─────────────────────────────────────────────────────────────
function saveTokenToEnv(token) {
  let content = fs.readFileSync(ENV_PATH, 'utf8');

  if (content.includes('KITE_ACCESS_TOKEN=')) {
    // Replace existing line
    content = content.replace(
      /KITE_ACCESS_TOKEN=.*/,
      `KITE_ACCESS_TOKEN=${token}`
    );
  } else {
    // Add new line
    content += `\nKITE_ACCESS_TOKEN=${token}`;
  }

  fs.writeFileSync(ENV_PATH, content);
  console.log('✅ Access token saved to .env');
}

// ─────────────────────────────────────────────────────────────
// HTTP server
// ─────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── /login → redirect to Zerodha ──
  if (url.pathname === '/login') {
    res.writeHead(302, { Location: getLoginUrl() });
    res.end();
    return;
  }

  // ── /callback → Zerodha redirects here with request_token ──
  if (url.pathname === '/callback') {
    const requestToken = url.searchParams.get('request_token');
    const status       = url.searchParams.get('status');

    if (status !== 'success' || !requestToken) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(errorPage('Login failed or was cancelled. Please try again.'));
      return;
    }

    try {
      console.log('🔄 Exchanging request token for access token...');
      const accessToken = await getAccessToken(requestToken);

      // Save to .env
      saveTokenToEnv(accessToken);

      // Reload env so bot picks it up
      process.env.KITE_ACCESS_TOKEN = accessToken;

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(successPage(accessToken));

      console.log('✅ Login successful. Access token saved.');
      console.log('   Bot is now ready to place live orders.');
      console.log('   You can close this browser tab.\n');

    } catch (err) {
      console.error('❌ Token exchange failed:', err.message);
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(errorPage(`Token exchange failed: ${err.message}`));
    }
    return;
  }

  // ── / → simple status page ──
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(homePage());
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n🔐 Kite Login Server running`);
  console.log(`   Open this in your browser:`);
  console.log(`   http://${process.env.ELASTIC_IP}:${PORT}/login\n`);
});

// ─────────────────────────────────────────────────────────────
// HTML pages
// ─────────────────────────────────────────────────────────────
function homePage() {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Nifty Bot — Login</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: sans-serif; max-width: 400px; margin: 80px auto; padding: 20px; text-align: center; }
    h2 { color: #333; }
    a.btn { display: inline-block; background: #387ed1; color: white; padding: 14px 32px;
            border-radius: 8px; text-decoration: none; font-size: 16px; margin-top: 20px; }
    a.btn:hover { background: #2c6bb5; }
    p { color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <h2>🤖 Nifty Options Bot</h2>
  <p>Click below to login to Zerodha and activate today's trading session.</p>
  <a class="btn" href="/login">Login with Zerodha</a>
  <p style="margin-top:30px; font-size:12px; color:#999;">
    Token refreshes daily at 6am IST.<br>Login once each morning before trading.
  </p>
</body>
</html>`;
}

function successPage(token) {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Login Successful</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: sans-serif; max-width: 400px; margin: 80px auto; padding: 20px; text-align: center; }
    .tick { font-size: 60px; }
    h2 { color: #2e7d32; }
    p { color: #555; font-size: 14px; }
    .token { background: #f5f5f5; padding: 10px; border-radius: 6px;
             font-family: monospace; font-size: 11px; word-break: break-all; color: #888; }
  </style>
</head>
<body>
  <div class="tick">✅</div>
  <h2>Login Successful</h2>
  <p>Your access token has been saved.<br>
     The bot is now ready to place live orders.</p>
  <p>Go to Telegram and send your trade.</p>
  <p style="margin-top:30px">
    <small class="token">Token: ${token.slice(0, 20)}...${token.slice(-10)}</small>
  </p>
</body>
</html>`;
}

function errorPage(message) {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Login Failed</title>
  <style>
    body { font-family: sans-serif; max-width: 400px; margin: 80px auto; padding: 20px; text-align: center; }
    h2 { color: #c62828; }
    p { color: #555; }
    a { color: #387ed1; }
  </style>
</head>
<body>
  <h2>❌ Login Failed</h2>
  <p>${message}</p>
  <a href="/login">Try again</a>
</body>
</html>`;
}