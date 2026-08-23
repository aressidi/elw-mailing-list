# ELW Mailing List - Deployment Guide

## Architecture: Neon + Vercel + Render

### 1. Neon PostgreSQL Database (Free Tier)
- **Never expires** (unlike Render's 30-day limit)
- 0.5 GB storage
- Serverless scaling

### 2. Render (Backend API)
- Free web service
- Auto-deploy from GitHub
- Runs Express API server

### 3. Vercel (Frontend)
- Free static hosting
- Best-in-class CDN
- Auto-deploy from GitHub

---

## Deployment Steps

### Step 1: Neon Database Setup

1. Go to https://neon.tech and sign up
2. Create new project called `elw-mailing-list`
3. Copy the connection string (looks like: `postgresql://user:pass@host.neon.tech/dbname?sslmode=require`)
4. Save this for Render configuration

### Step 2: Render Backend Setup

1. Go to https://render.com and sign up
2. Click "New +" → "Web Service"
3. Connect your GitHub repo: `aressidi/elw-mailing-list`
4. Configure:
   - **Name**: `elw-mailing-list-api`
   - **Runtime**: Node
   - **Build Command**: `npm install && npm run build:server`
   - **Start Command**: `npm start`
   - **Plan**: Free
5. Add Environment Variable:
   - `DATABASE_URL`: (paste from Neon)
   - `CLIENT_URL`: `https://elw-mailing-list.vercel.app`
   - `NODE_ENV`: `production`
6. Click "Create Web Service"

### Step 3: Vercel Frontend Setup

1. Go to https://vercel.com and sign up
2. Click "Add New..." → "Project"
3. Import your GitHub repo: `aressidi/elw-mailing-list`
4. Configure:
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. Add Environment Variable:
   - `VITE_API_URL`: `https://elw-mailing-list-api.onrender.com`
6. Click "Deploy"

### Step 4: Database Migration

After Render deploys, run migrations:

```bash
# Install Neon CLI or use psql
npx drizzle-kit migrate
```

Or use Render's Shell:
1. Go to your Render service dashboard
2. Click "Shell" tab
3. Run: `npm run db:migrate`

### Step 5: Import Data

Upload your CSV files via the app's upload interface, or use the import script:

```bash
# Local import to remote database
DATABASE_URL="your-neon-url" npx tsx scripts/import-csv.ts
```

---

## Environment Variables Summary

### Render (Backend)
```
DATABASE_URL=postgresql://user:pass@host.neon.tech/dbname?sslmode=require
CLIENT_URL=https://elw-mailing-list.vercel.app
NODE_ENV=production
PORT=10000
```

### Vercel (Frontend)
```
VITE_API_URL=https://elw-mailing-list-api.onrender.com
```

### Local Development
```
DATABASE_URL=postgresql://localhost:5432/elw_mailing_list
CLIENT_URL=http://localhost:5173
PORT=3000
NODE_ENV=development
```

---

## URLs After Deployment

- **Frontend**: https://elw-mailing-list.vercel.app
- **Backend API**: https://elw-mailing-list-api.onrender.com
- **Health Check**: https://elw-mailing-list-api.onrender.com/api/health

---

## Troubleshooting

### Cold Starts (Render Free Tier)
- Free services sleep after 15 min inactivity
- First request may take 30-60 seconds to wake up
- Subsequent requests are fast

### Database Connection Issues
- Ensure `sslmode=require` in DATABASE_URL
- Check Render logs for connection errors
- Verify Neon database is active

### CORS Errors
- Ensure `CLIENT_URL` in Render matches Vercel URL exactly
- Check for trailing slashes mismatch
