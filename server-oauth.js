const express = require('express');
const jsforce = require('jsforce');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

const {
  SF_CLIENT_ID,
  SF_CLIENT_SECRET,
  SF_LOGIN_URL = 'https://login.salesforce.com',
  APP_BASE_URL = 'http://localhost:3000'
} = process.env;

// เก็บ session แบบง่ายๆ
const sessions = {};
const oauth2 = new jsforce.OAuth2({
  loginUrl: SF_LOGIN_URL,
  clientId: SF_CLIENT_ID,
  clientSecret: SF_CLIENT_SECRET,
  redirectUri: `${APP_BASE_URL}/oauth/callback`
});

// หน้า Login
app.get('/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Login with Salesforce</title>
      <style>
        body { font-family: Arial; max-width: 400px; margin: 50px auto; padding: 20px; }
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
        <a href="${oauth2.getAuthorizationUrl({ scope: 'api refresh_token' })}" class="btn">
          Login with Salesforce
        </a>
        <p style="color: #666; font-size: 14px; margin-top: 20px;">
          You will be redirected to Salesforce for authentication
        </p>
      </div>
    </body>
    </html>
  `);
});

// OAuth Callback
app.get('/oauth/callback', async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    return res.status(400).send('Authorization code not found');
  }

  try {
    const conn = new jsforce.Connection({ oauth2 });
    
    // รับ access token
    const userInfo = await conn.authorize(code);
    
    // สร้าง session
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

    res.redirect('/');
    
  } catch (error) {
    console.error('OAuth Error:', error);
    res.status(500).send(`Authentication failed: ${error.message}`);
  }
});

// Middleware ตรวจสอบการ login
const requireAuth = (req, res, next) => {
  const sessionId = req.cookies?.sessionId;
  const session = sessions[sessionId];
  
  if (session && session.conn) {
    req.sfConn = session.conn;
    req.userInfo = session.userInfo;
    return next();
  }
  
  res.redirect('/login');
};

// หน้าแรก
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
        <a href="/logout" class="btn logout">Logout</a>
      </div>
      
      <div class="user-info">
        <h3>👤 User Information</h3>
        <p><strong>User ID:</strong> ${user.id}</p>
        <p><strong>Username:</strong> ${user.username}</p>
        <p><strong>Organization ID:</strong> ${user.organizationId}</p>
        <p><strong>Login Time:</strong> ${new Date().toLocaleString()}</p>
      </div>
      
      <h3>📊 Available Actions</h3>
      <div>
        <a href="/accounts" class="btn">View Accounts</a>
        <a href="/whoami" class="btn">User Details</a>
        <a href="/query" class="btn">Run SOQL Query</a>
      </div>
    </body>
    </html>
  `);
});

// Logout
app.get('/logout', (req, res) => {
  const sessionId = req.cookies?.sessionId;
  if (sessionId) {
    delete sessions[sessionId];
  }
  res.clearCookie('sessionId');
  res.redirect('/login');
});

// ดูข้อมูลผู้ใช้
app.get('/whoami', requireAuth, async (req, res) => {
  try {
    const identity = await req.sfConn.identity();
    res.json(identity);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ดู Accounts
app.get('/accounts', requireAuth, async (req, res) => {
  try {
    const accounts = await req.sfConn.sobject('Account')
      .find({}, 'Id, Name, Type, Industry, Phone, CreatedDate')
      .limit(10);
    res.json(accounts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Run SOQL Query
app.get('/query', requireAuth, async (req, res) => {
  try {
    const query = req.query.q || 'SELECT Id, Name FROM Account LIMIT 5';
    const result = await req.sfConn.query(query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on ${APP_BASE_URL}`);
  console.log(`👉 Login URL: ${APP_BASE_URL}/login`);
});