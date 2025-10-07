
# Salesforce Account Demo (Local, Free)

This demo shows how to connect to Salesforce and list `Account` records using Node.js + jsforce without creating a Connected App.
It uses Username + Password + Security Token for login.

## Prerequisites
- Node.js >= 18 installed
- A Salesforce Developer Edition user with a **security token**

## Setup
```bash
npm install
cp .env.example .env
# edit .env and set SF_USERNAME, SF_PASSWORD, SF_TOKEN
npm start
```

Open http://localhost:3000 then click **/accounts** to see the first 10 Account records.

## Notes
- If your user is on a Sandbox, set `SF_LOGIN_URL=https://test.salesforce.com` in `.env`.
- If you get login errors, reset your security token from Salesforce: User icon → Settings → Reset My Security Token.
