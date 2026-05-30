# Deployment Guide — Render + Neon + Brevo

## 1. Prerequisites

| Tool | Purpose |
|------|---------|
| [Render](https://render.com) | Hosting (free web service) |
| [Neon](https://neon.tech) | PostgreSQL database |
| [Brevo](https://brevo.com) | Transactional email (HTTP API) |

---

## 2. Neon — Database Setup

1. Create a free Neon project at https://neon.tech
2. Copy the **Connection string** (looks like `postgresql://user:pass@host/dbname?sslmode=require`)
3. Open the **SQL Editor** in the Neon console
4. Paste the entire contents of `schema.sql` and click **Run**
   - This creates all tables, indexes, and seeds the initial data
5. Keep the connection string — you'll need it as `DATABASE_URL`

---

## 3. Brevo — Email Setup

1. Create a free Brevo account at https://brevo.com
2. Go to **Senders & Domains** → **Add a sender domain** → enter `mirror-logic.com`
3. Add the SPF and DKIM records Brevo provides into Cloudflare DNS (proxy off — grey cloud)
4. Click **Verify** once DNS propagates (~5–15 min)
5. Go to **Settings → SMTP & API → API Keys** → click **Generate a new API key**
6. Copy the key (starts with `xkeysib-`) → this is `BREVO_API_KEY`
7. Set `BREVO_USER` to your verified sender address (e.g. `noreply@mirror-logic.com`)

---

## 4. Render — Deployment

### 4a. Push to GitHub

1. Push this folder to a GitHub repository
2. Go to https://render.com → **New → Web Service**
3. Connect your GitHub repository

### 4b. Configure the Web Service

| Setting | Value |
|---------|-------|
| **Environment** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | Free |

### 4c. Set Environment Variables

In **Environment → Environment Variables**, add all of the following:

| Variable | Value | Description |
|----------|-------|-------------|
| `DATABASE_URL` | `postgresql://...` | Neon connection string |
| `BREVO_USER` | `noreply@mirror-logic.com` | Verified sender email address |
| `BREVO_API_KEY` | `xkeysib-...` | Brevo v3 API key |
| `APP_URL` | `https://your-app.onrender.com` | Your deployed URL (no trailing slash) |
| `PWD_SALT` | any random 32-char string | Password hashing salt |

> **Tip**: Generate a salt with: `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`

### 4d. Deploy

Click **Create Web Service**. Render builds and deploys in ~1-2 minutes.

---

## 5. Prevent Cold Starts (Important for Free Tier)

Render's free tier spins down after **15 minutes of inactivity**, causing a ~30-60 second cold start on the next request.

**Fix**: Set up a free uptime monitor to ping your app every 10 minutes:

1. Go to https://uptimerobot.com (free account)
2. Add a new monitor: **HTTP(s)** type
3. URL: `https://your-app.onrender.com`
4. Interval: **10 minutes**

This keeps the app warm at all times with zero cost.

---

## 6. Post-Deploy Verification

1. Visit your deployed URL — the login screen should appear
2. Log in as admin: **ID** `A20160170`, **Password** `fyp2025`
3. Change the admin password immediately via the user menu → **Change Password**
4. Distribute default password `fyp2025` to supervisors — they can change it after first login
5. Test the examiner portal at `/examiner?token=TEST` — should show "Invalid or expired link"
6. Test the peer eval portal at `/peer` — should show the student ID input form

---

## 7. Environment Variables Reference

```
DATABASE_URL=postgresql://neonuser:password@ep-cool-name-12345.us-east-2.aws.neon.tech/neondb?sslmode=require
BREVO_USER=noreply@mirror-logic.com
BREVO_API_KEY=xkeysib-abcdefghijklmnopqrstuvwxyz
APP_URL=https://fyp-system.onrender.com
PWD_SALT=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6
```

---

## 8. Admin Accounts

| Role | ID | Initial Password |
|------|----|-----------------|
| Admin | `A20160170` | `fyp2025` |
| Dr. Youssef Ajra | `F20160170` | `fyp2025` |

All other supervisors (SUP_001–SUP_019) also start with password `fyp2025`.

---

## 9. Updating the App

Just push to your GitHub branch — Render redeploys automatically.
Render free plan has **unlimited deployments**.

---

## 10. Custom Domain (Optional)

In Render **Settings → Custom Domains**, add your domain and follow the DNS instructions.

---

## 11. Specs — Render + Neon + Brevo

| Capability | Detail |
|-----------|--------|
| **Hosting** | Render free Web Service — persistent Node.js/Express |
| **Database** | Neon free tier — 0.5 GB storage, 1 compute unit |
| **Email** | Brevo free tier — 300 emails/day |
| **Cold start** | ~30-60 s after 15 min idle (eliminated by UptimeRobot) |
| **Deployments** | Unlimited (auto on git push) |
| **Custom domain** | Yes (free with Render) |
| **HTTPS** | Automatic TLS via Render |
| **Concurrent requests** | Limited on free tier; fine for academic use |
| **Bandwidth** | 100 GB/month free on Render |

| Limitation | Note |
|-----------|------|
| Free tier sleeps after 15 min idle | Fix with UptimeRobot (free) |
| Neon 0.5 GB storage cap | Enough for thousands of projects/grades |
| Brevo 300 emails/day cap | Well within FYP system usage |
| No WebSockets on free Render | Not needed — app uses HTTP polling |
