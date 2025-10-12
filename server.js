const express = require('express');
const jsforce = require('jsforce');
require('dotenv').config();
const app = express();
const PORT = process.env.PORT || 3000;

const {
  SF_USERNAME,
  SF_PASSWORD,
  SF_TOKEN,
  SF_LOGIN_URL = 'https://login.salesforce.com'
} = process.env;

app.use(express.urlencoded({ extended: true })); // รับ form POST
app.use(express.json());                          // รับ JSON

if (!SF_USERNAME || !SF_PASSWORD || !SF_TOKEN) {
  console.warn('⚠️  Please set SF_USERNAME, SF_PASSWORD, SF_TOKEN in .env');
}

let conn;

async function ensureConnection() {
  if (conn && conn.accessToken) return conn;
  conn = new jsforce.Connection({ loginUrl: SF_LOGIN_URL });
  await conn.login(SF_USERNAME, SF_PASSWORD + SF_TOKEN);
  return conn;
}
app.get('*', (req, res) => {
  console.log('Request path:', req.path);
  res.status(404).send(`Path not found: ${req.path}`);
});

app.get('/', async (req, res) => {
  res.send(`
    <h2>Salesforce Demo (Accounts)</h2>
    <ul>
      <li><a href="/accounts">/accounts</a> – list top 10 accounts</li>
      <li><a href="/whoami">/whoami</a> – show org & user info</li>
    </ul>
  `);
});

app.get('/whoami', async (req, res) => {
  try {
    const c = await ensureConnection();
    const id = await c.identity();
    res.type('json').send(JSON.stringify(id, null, 2));
  } catch (e) {
    res.status(500).send(e.toString());
  }
});

app.get('/accounts', async (req, res) => {
  try {
    const c = await ensureConnection();
    const records = await c.sobject('Account')
      .find({}, 'Id, Name, Type, Industry, CreatedDate')
      .limit(10);
    res.type('json').send(JSON.stringify(records, null, 2));
  } catch (e) {
    res.status(500).send(e.toString());
  }
});

app.get('/accounts/table', async (req, res) => {
  try {
    const c = await ensureConnection();
    const limit = Number(req.query.limit || 20);
    const search = req.query.q ? req.query.q.trim() : "";
    const createdId = req.query.createdId || "";

    let soql = "SELECT Id, Name, Type, Industry, CreatedDate FROM Account";
    if (search) soql += ` WHERE Name LIKE '%${search}%'`;
    soql += ` ORDER BY CreatedDate DESC LIMIT ${limit}`;

    const result = await c.query(soql);

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

    res.send(`
      <h2>Accounts</h2>
      ${banner}
      <form>
        <input name="q" placeholder="Search name…" value="${search}">
        <input name="limit" type="number" value="${limit}" min="1" max="200">
        <button>Search</button>
        <a href="/accounts/new">+ New</a>
      </form>
      <table border="1" cellpadding="6" cellspacing="0">
        <thead><tr>
          <th>Id</th><th>Name</th><th>Type</th><th>Industry</th><th>Created</th><th>Actions</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `);
  } catch (e) {
    res.status(500).send(`<pre>${e.toString()}</pre>`);
  }
});

// ฟอร์มสร้าง
app.get('/accounts/new', (req, res) => {
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

// บันทึกสร้าง
app.post('/accounts', async (req, res) => {
  try {
    const c = await ensureConnection();
    const result = await c.sobject('Account').create({
      Name: req.body.Name,
      Type: req.body.Type || null,
      Industry: req.body.Industry || null
    });
    if (!result.success) throw new Error(JSON.stringify(result, null, 2));
    // เด้งกลับตารางพร้อมไฮไลต์แถวที่เพิ่งสร้าง
    res.redirect(`/accounts/table?createdId=${result.id}`);
  } catch (e) {
    res.status(500).send(`<pre>${e.toString()}</pre>`);
  }
});

app.get('/accounts/:id', async (req, res) => {
  try {
    const c = await ensureConnection();
    const r = await c.sobject('Account').retrieve(req.params.id);
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
  } catch (e) {
    res.status(500).send(`<pre>${e.toString()}</pre>`);
  }
});

// ฟอร์มแก้ไข
app.get('/accounts/:id/edit', async (req, res) => {
  try {
    const c = await ensureConnection();
    const r = await c.sobject('Account').retrieve(req.params.id);
    res.send(`
      <h3>Edit Account</h3>
      <form method="post" action="/accounts/${r.Id}/update">
        <p><input name="Name" placeholder="Name" value="${r.Name || ''}" required></p>
        <p><input name="Type" placeholder="Type" value="${r.Type || ''}"></p>
        <p><input name="Industry" placeholder="Industry" value="${r.Industry || ''}"></p>
        <button>Save</button>  <a href="/accounts/${r.Id}">Cancel</a>
      </form>
    `);
  } catch (e) {
    res.status(500).send(`<pre>${e.toString()}</pre>`);
  }
});

// บันทึกแก้ไข
app.post('/accounts/:id/update', async (req, res) => {
  try {
    const c = await ensureConnection();
    const result = await c.sobject('Account').update({
      Id: req.params.id,
      Name: req.body.Name,
      Type: req.body.Type || null,
      Industry: req.body.Industry || null
    });
    if (!result.success) throw new Error(JSON.stringify(result, null, 2));
    res.redirect(`/accounts/${req.params.id}`);
  } catch (e) {
    res.status(500).send(`<pre>${e.toString()}</pre>`);
  }
});

app.post('/accounts/:id/delete', async (req, res) => {
  try {
    const c = await ensureConnection();
    await c.sobject('Account').destroy(req.params.id);
    res.redirect('/accounts/table');
  } catch (e) {
    res.status(500).send(`<pre>${e.toString()}</pre>`);
  }
});

app.get('/sf/customers', async (_req, res) => {
  try {
    const conn = await getSfConnection();
    const r = await conn.query(`
      SELECT Id, Name, Email__c, Phone__c, City__c
      FROM Customer__c
      ORDER BY CreatedDate DESC
      LIMIT 50
    `);
    res.json(r.records);
  } catch (e) {
    res.status(500).json({ error: 'SF query', detail: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`👉 Listening on http://localhost:${PORT}`);
});