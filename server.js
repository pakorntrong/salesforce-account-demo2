const fetch = require('node-fetch');
const express = require('express');
const jsforce = require('jsforce');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// ==================== ENVIRONMENT VARIABLES ====================
const {
  SF_CLIENT_ID,
  SF_CLIENT_SECRET,
  SF_LOGIN_URL = 'https://login.salesforce.com',
  APP_BASE_URL = 'http://localhost:3000'
} = process.env;

// ============= LINE Notification Function =============


async function sendLineNotify(message) {
  try {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) {
      console.error("❌ Missing LINE_CHANNEL_ACCESS_TOKEN in .env");
      return;
    }

    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        to: process.env.LINE_USER_ID, // ใส่ user id ที่จะรับข้อความ
        messages: [{ type: "text", text: message }]
      })
    });

    const data = await res.json();
    if (!res.ok) console.error("LINE Push Error:", data);
    else console.log("✅ LINE sent:", message);
  } catch (err) {
    console.error("LINE Notify Error:", err);
  }
}

// ==================== PKCE FUNCTIONS ====================
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(codeVerifier) {
  return crypto.createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
}

// ==================== SESSION & OAUTH CONFIG ====================
const sessions = {};
const oauth2 = new jsforce.OAuth2({
  loginUrl: SF_LOGIN_URL,
  clientId: SF_CLIENT_ID,
  clientSecret: SF_CLIENT_SECRET,
  redirectUri: `${APP_BASE_URL}/oauth/callback`
});

// ==================== AUTH MIDDLEWARE ====================
const requireAuth = (req, res, next) => {
  const sessionId = req.cookies?.sessionId;
  const session = sessions[sessionId];
  
  if (session && session.conn && session.conn.accessToken) {
    req.sfConn = session.conn;
    req.userInfo = session.userInfo;
    return next();
  }
  
  res.redirect('/login');
};

// ==================== LOGIN ROUTES ====================
app.get('/login', (req, res) => {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  
  const authUrl = oauth2.getAuthorizationUrl({
    scope: 'api refresh_token',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });
  
  // เก็บ codeVerifier ใน session ชั่วคราว
  const tempSessionId = Math.random().toString(36).substring(2);
  sessions[tempSessionId] = {
    codeVerifier: codeVerifier,
    created: new Date().toISOString()
  };
  
  res.cookie('tempSessionId', tempSessionId, {
    httpOnly: true,
    maxAge: 10 * 60 * 1000 // 10 นาที
  });
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Login - Salesforce Demo</title>
      <style>
        body { font-family: Arial; max-width: 500px; margin: 50px auto; padding: 20px; }
        .login-box { border: 1px solid #0176d3; padding: 30px; border-radius: 8px; text-align: center; }
        .btn { background: #0176d3; color: white; padding: 12px 24px; text-decoration: none; 
               border-radius: 4px; display: inline-block; margin: 10px; }
        .btn:hover { background: #0160a3; }
      </style>
    </head>
    <body>
      <div class="login-box">
        <h2>🔐 Salesforce OAuth Login</h2>
        <p>Login using your Salesforce credentials</p>
        <a href="${authUrl}" class="btn">Login with Salesforce</a>
        
        <div style="margin-top: 20px; padding: 10px; background: #f8f9fa; border-radius: 4px;">
          <small>
            You will be redirected to Salesforce for secure authentication
          </small>
        </div>
      </div>
    </body>
    </html>
  `);
});

// OAuth Callback
app.get('/oauth/callback', async (req, res) => {
  const { code, error, error_description } = req.query;
  const tempSessionId = req.cookies?.tempSessionId;
  
  // ลบ temp cookie
  res.clearCookie('tempSessionId');
  
  if (error) {
    console.error('OAuth Error:', error, error_description);
    return res.send(`
      <h2>OAuth Error</h2>
      <p><strong>Error:</strong> ${error}</p>
      <p><strong>Description:</strong> ${error_description}</p>
      <a href="/login">Back to Login</a>
    `);
  }
  
  if (!code) {
    return res.send(`
      <h2>Authorization Failed</h2>
      <p>No authorization code received.</p>
      <a href="/login">Back to Login</a>
    `);
  }

  try {
    const conn = new jsforce.Connection({ oauth2 });
    
    // รับ codeVerifier จาก session
    const tempSession = sessions[tempSessionId];
    const codeVerifier = tempSession?.codeVerifier;
    
    // ลบ temp session
    if (tempSessionId) {
      delete sessions[tempSessionId];
    }
    
    if (!codeVerifier) {
      throw new Error('PKCE code verifier not found');
    }
    
    // รับ access token พร้อม code verifier
    const userInfo = await conn.authorize(code, { code_verifier: codeVerifier });
    
    // สร้าง session หลัก
    const sessionId = Math.random().toString(36).substring(2);
    sessions[sessionId] = {
      conn: conn,
      userInfo: userInfo,
      loginTime: new Date().toISOString()
    };

    // set cookie
    res.cookie('sessionId', sessionId, { 
      httpOnly: true, 
      maxAge: 24 * 60 * 60 * 1000 
    });

    // ✅ เปลี่ยนเส้นทางไปที่ Accounts Table ทันที
    res.redirect('/accounts/table');
    
  } catch (error) {
    console.error('OAuth Token Error:', error);
    res.send(`
      <h2>Authentication Failed</h2>
      <pre>${error.message}</pre>
      <a href="/login">Back to Login</a>
    `);
  }
});

// Logout
app.post('/logout', (req, res) => {
  const sessionId = req.cookies?.sessionId;
  if (sessionId) {
    delete sessions[sessionId];
  }
  res.clearCookie('sessionId');
  res.redirect('/login');
});

// ==================== PROTECTED ROUTES ====================
app.get('/', requireAuth, (req, res) => {
  const user = req.userInfo;
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Salesforce OAuth Demo</title>
      <style>
        body { font-family: Arial; max-width: 800px; margin: 0 auto; padding: 20px; }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ddd; padding-bottom: 20px; }
        .user-info { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .btn { background: #0176d3; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block; margin: 5px; }
        .logout { background: #dc3545; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Salesforce OAuth Demo</h1>
        <form style="display:inline" method="post" action="/logout">
          <button type="submit" class="btn logout">Logout</button>
        </form>
      </div>
      
      <div class="user-info">
        <h3>👤 User Information</h3>
        <p><strong>User ID:</strong> ${user.id}</p>
        <p><strong>Username:</strong> ${user.username || 'N/A'}</p>
        <p><strong>Email:</strong> ${user.email || 'N/A'}</p>
        <p><strong>Organization ID:</strong> ${user.organizationId}</p>
        <p><strong>Display Name:</strong> ${user.display_name || 'N/A'}</p>
        <p><strong>Login Time:</strong> ${new Date().toLocaleString()}</p>
      </div>
      
      <h3>📊 Available Actions</h3>
      <div>
        <a href="/accounts/table" class="btn">View Accounts Table</a>
        <a href="/whoami" class="btn">User Details</a>
        <a href="/accounts" class="btn">Accounts JSON</a>
      </div>
    </body>
    </html>
  `);
});

// ==================== SALESFORCE DATA ROUTES ====================
app.get('/whoami', requireAuth, async (req, res) => {
  try {
    const identity = await req.sfConn.identity();
    res.type('json').send(JSON.stringify(identity, null, 2));
  } catch (error) {
    res.status(500).send(`<pre>${error.toString()}</pre>`);
  }
});

app.get('/accounts', requireAuth, async (req, res) => {
  try {
    const accounts = await req.sfConn.sobject('Account')
      .find({}, 'Id, Name, Type, Industry, CreatedDate')
      .limit(10);
    res.type('json').send(JSON.stringify(accounts, null, 2));
  } catch (error) {
    res.status(500).send(`<pre>${error.toString()}</pre>`);
  }
});

app.get('/accounts/table', requireAuth, async (req, res) => {
  try {
    const limit = Number(req.query.limit || 20);
    const search = req.query.q ? req.query.q.trim() : "";
    const createdId = req.query.createdId || "";

    let soql = "SELECT Id, Name, Type, Industry, CreatedDate FROM Account";
    if (search) soql += ` WHERE Name LIKE '%${search}%'`;
    soql += ` ORDER BY CreatedDate DESC LIMIT ${limit}`;

    const result = await req.sfConn.query(soql);

    const rows = result.records.map(r => {
      const highlight = r.Id === createdId ? ' style="background:#fff6cc;"' : '';
      return `
        <tr${highlight}>
          <td><a href="/accounts/${r.Id}">${r.Id}</a></td>
          <td>${r.Name || ''}</td>
          <td>${r.Type || ''}</td>
          <td>${r.Industry || ''}</td>
          <td>${new Date(r.CreatedDate).toLocaleString()}</td>
          <td>
            <a href="/accounts/${r.Id}/edit">Edit</a> |
            <form style="display:inline" method="post" action="/accounts/${r.Id}/delete"
                  onsubmit="return confirm('Delete this account?');">
              <button type="submit">Delete</button>
            </form>
          </td>
        </tr>`;
    }).join('');

    const banner = createdId
      ? `<div style="padding:10px;margin:10px 0;border:1px solid #c8e6c9;background:#e8f5e9;">
           ✅ Created Account: <a href="/accounts/${createdId}">${createdId}</a>
         </div>`
      : '';

// ในส่วน HTML ของ /accounts/table
res.send(`
  <!DOCTYPE html>
  <html>
  <head>
    <title>Accounts Table</title>
    <style>
      body { font-family: Arial; max-width: 1200px; margin: 0 auto; padding: 20px; }
      table { border-collapse: collapse; width: 100%; margin-top: 20px; }
      th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
      th { background-color: #f2f2f2; }
      .header-buttons { display: flex; gap: 10px; margin-bottom: 20px; }
      .btn { 
        background: #0176d3; color: white; padding: 8px 16px; 
        text-decoration: none; border-radius: 4px; display: inline-block; 
      }
      .btn-logout { background: #dc3545; }
    </style>
  </head>
  <body>
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <h2>Accounts Table</h2>
      <div class="header-buttons">
        <a href="/" class="btn">🏠 Dashboard</a>
        <form style="display:inline" method="post" action="/logout">
          <button type="submit" class="btn btn-logout">🚪 Logout</button>
        </form>
      </div>
    </div>
    ${banner}
    <form>
      <input name="q" placeholder="Search name…" value="${search}">
      <input name="limit" type="number" value="${limit}" min="1" max="200">
      <button>Search</button>
      <a href="/accounts/new" style="margin-left: 20px;">+ New Account</a>
    </form>
    <table>
      <thead><tr>
        <th>Id</th><th>Name</th><th>Type</th><th>Industry</th><th>Created</th><th>Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </body>
  </html>
`);
  } catch (error) {
    res.status(500).send(`<pre>${error.toString()}</pre>`);
  }
});

// CRUD Routes
app.get('/accounts/new', requireAuth, (req, res) => {
  res.send(`
    <h3>Create Account</h3>
    <form method="post" action="/accounts">
      <p><input name="Name" placeholder="Name" required></p>
      <p><input name="Type" placeholder="Type"></p>
      <p><input name="Industry" placeholder="Industry"></p>
      <button>Create</button>  <a href="/accounts/table">Back</a>
    </form>
  `);
});

app.post('/accounts', requireAuth, async (req, res) => {
  try {
    const result = await req.sfConn.sobject('Account').create({
      Name: req.body.Name,
      Type: req.body.Type || null,
      Industry: req.body.Industry || null
    });
    if (!result.success) throw new Error(JSON.stringify(result, null, 2));
    // ✅ แจ้ง LINE ว่ามีการสร้าง Account ใหม่
    const msg = `🆕 Created Account: ${req.body.Name} (${result.id})`;
    await sendLineNotify(msg);
    res.redirect(`/accounts/table?createdId=${result.id}`);
  } catch (error) {
    res.status(500).send(`<pre>${error.toString()}</pre>`);
  }
});

app.get('/accounts/:id', requireAuth, async (req, res) => {
  try {
    const r = await req.sfConn.sobject('Account').retrieve(req.params.id);
    res.send(`
      <h2>Account Detail</h2>
      <p><b>Name:</b> ${r.Name || ''}</p>
      <p><b>Type:</b> ${r.Type || ''}</p>
      <p><b>Industry:</b> ${r.Industry || ''}</p>
      <p><b>Created:</b> ${r.CreatedDate ? new Date(r.CreatedDate).toLocaleString() : ''}</p>
      <p>
        <a href="/accounts/${r.Id}/edit">Edit</a> |
        <a href="/accounts/table">Back</a>
      </p>
      <details style="margin-top:12px;">
        <summary>Raw JSON</summary>
        <pre>${JSON.stringify(r, null, 2)}</pre>
      </details>
    `);
  } catch (error) {
    res.status(500).send(`<pre>${error.toString()}</pre>`);
  }
});

app.get('/accounts/:id/edit', requireAuth, async (req, res) => {
  try {
    const r = await req.sfConn.sobject('Account').retrieve(req.params.id);
    res.send(`
      <h3>Edit Account</h3>
      <form method="post" action="/accounts/${r.Id}/update">
        <p><input name="Name" placeholder="Name" value="${r.Name || ''}" required></p>
        <p><input name="Type" placeholder="Type" value="${r.Type || ''}"></p>
        <p><input name="Industry" placeholder="Industry" value="${r.Industry || ''}"></p>
        <button>Save</button>  <a href="/accounts/${r.Id}">Cancel</a>
      </form>
    `);
  } catch (error) {
    res.status(500).send(`<pre>${error.toString()}</pre>`);
  }
});

app.post('/accounts/:id/update', requireAuth, async (req, res) => {
  try {
    const result = await req.sfConn.sobject('Account').update({
      Id: req.params.id,
      Name: req.body.Name,
      Type: req.body.Type || null,
      Industry: req.body.Industry || null
    });
    if (!result.success) throw new Error(JSON.stringify(result, null, 2));
    res.redirect(`/accounts/${req.params.id}`);
  } catch (error) {
    res.status(500).send(`<pre>${error.toString()}</pre>`);
  }
});

app.post('/accounts/:id/delete', requireAuth, async (req, res) => {
  try {
    await req.sfConn.sobject('Account').destroy(req.params.id);
    res.redirect('/accounts/table');
  } catch (error) {
    res.status(500).send(`<pre>${error.toString()}</pre>`);
  }
});
// ==================== SALESFORCE WEBHOOK: /notify ====================
// Endpoint ที่ Salesforce Flow/Apex จะเรียกมา เมื่อมี record ใหม่/แก้ไข/ลบ
app.post('/notify', async (req, res) => {
  try {
    console.log('📩 /notify called. Content-Type:', req.headers['content-type']);
    console.log('📩 Raw body:', JSON.stringify(req.body).slice(0, 2000)); // log เบื้องต้น (truncate ถ้ายาว)

    const payload = req.body;

    // helper สร้างข้อความจาก record เดี่ยว
    function makeMessageForRecord(rec) {
      const ev = (rec.Event || rec.event || '').toString() ;
      const id = rec.Id || rec.id || '-';
      const name = rec.Name || rec.name || '-';
      const email = rec.Email || rec.email || rec.Email__c || rec.email__c || '';
      const created = rec.CreatedDate || rec.createdDate || '';

      let msg = `📢 Salesforce Notification\n`;
      msg += `🆔 Event: ${ev.toUpperCase()}\n`;
      msg += `• Name: ${name}\n`;
      msg += `• Id: ${id}\n`;
      if (email) msg += `• Email: ${email}\n`;
      if (created) msg += `• Created: ${created}\n`;
      return msg;
    }

    // ฟังก์ชันส่ง HTTP ไปยัง LINE (ใช้ sendLineNotify ของคุณ)
    // ถ้าต้องการ throttle/parallel สามารถปรับได้
    if (Array.isArray(payload)) {
      // ส่งทีละรายการ (sequential) — ปลอดภัย ถ้าจำนวนไม่เยอะ
      for (const rec of payload) {
        const message = makeMessageForRecord(rec);
        await sendLineNotify(message);
        console.log('✅ LINE sent for', rec.Id || rec.Name || '(no id)');
      }
      res.json({ ok: true, sent: payload.length + ' messages' });
    } else if (payload && typeof payload === 'object') {
      const message = makeMessageForRecord(payload);
      await sendLineNotify(message);
      console.log('✅ LINE sent for single record', payload.Id || payload.Name || '(no id)');
      res.json({ ok: true, sent: 1 });
    } else {
      console.warn('⚠️ Unknown payload format:', typeof payload);
      res.status(400).json({ ok: false, error: 'Unknown payload format' });
    }
  } catch (error) {
    console.error('❌ Notify Error:', error);
    res.status(500).json({ ok: false, error: error.toString() });
  }
});

// ==================== ERROR HANDLING ====================
app.get('*', (req, res) => {
  console.log('Request path:', req.path);
  res.status(404).send(`Path not found: ${req.path}`);
});

// ==================== SERVER START ====================
app.listen(PORT, () => {
  console.log(`🚀 Server running on ${APP_BASE_URL}`);
  console.log(`👉 Login URL: ${APP_BASE_URL}/login`);
  console.log('🔧 Environment Check:');
  console.log('SF_CLIENT_ID:', SF_CLIENT_ID ? '✅ Set' : '❌ Missing');
  console.log('SF_CLIENT_SECRET:', SF_CLIENT_SECRET ? '✅ Set' : '❌ Missing');
});
