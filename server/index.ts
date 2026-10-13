import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import routes from './routes.js';
import { db } from './db.js';
import { sql } from 'drizzle-orm';
import { loginHandler, authRequired, authConfigHandler } from './auth.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth endpoints (public) and gate for everything mounted below
app.post('/api/auth/login', loginHandler);
app.get('/api/auth/config', authConfigHandler);
app.use(authRequired);

// Mount API routes
app.use('/api', routes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    message: 'The requested API endpoint does not exist',
  });
});

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Server error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
  });
});

// Ensure known campaign Google Sheet links are populated in production DB
async function reconcileCampaignLinks() {
  const updates = [
    {
      namePattern: '%Morgan%September 2026%',
      link: 'https://docs.google.com/spreadsheets/d/1RpIvXeDRgZkqdeWmoYezvXxi7oTMS8NeFkqL53obtic/edit'
    },
    {
      namePattern: '%Halifax%September 2026%',
      link: 'https://docs.google.com/spreadsheets/d/1RpIvXeDRgZkqdeWmoYezvXxi7oTMS8NeFkqL53obtic/edit'
    },
    {
      namePattern: '%Benton%Tax Delinquent%September 2026%',
      link: 'https://docs.google.com/spreadsheets/d/1RpIvXeDRgZkqdeWmoYezvXxi7oTMS8NeFkqL53obtic/edit'
    },
    {
      namePattern: '%Faulkner%October 2026%',
      link: 'https://docs.google.com/spreadsheets/d/1lz-E6QcymdbsfFMcY-hKCCEiEdgecl7Z47KwyNrIAbU/edit'
    },
    {
      namePattern: '%Grafton%September 2026%',
      link: 'https://docs.google.com/spreadsheets/d/1hTMBD7-lJ6n2i9wOTEHWq6FcDxTnxZlWVvWZ1v6coBE/edit'
    },
    {
      namePattern: '%Caledonia%September 2026%',
      link: 'https://docs.google.com/spreadsheets/d/1HFL4je_bTpfqNobE2fYjQDJAcX-Z1ZqKrMBdz4ztrE0/edit'
    },
    {
      namePattern: '%Garland, Hot Spring%September 2026%',
      link: 'https://docs.google.com/spreadsheets/d/1TrF6UnPK3rhUw4SZpmHfywgfMr3OQq8DrD0wcKWg9xU/edit'
    },
    {
      namePattern: '%White & Lonoke%September 2026%',
      link: 'https://docs.google.com/spreadsheets/d/1sLgUSuUVvfXCsnFhKtSXWE0-awkxU3ReKUkSnoK6spY/edit'
    },
    {
      namePattern: '%Licking County%August 2026%',
      link: 'https://docs.google.com/spreadsheets/d/1Odt7qAPg9w3mwZ_Hw_WkqHSfakmWGi3E1VYcZ10qY5s/edit'
    },
    {
      namePattern: '%Windham County%August 2026%',
      link: 'https://docs.google.com/spreadsheets/d/1gmAPmDIG6MLNRUxxIhBFlnfovm_lHsv0shgoz8CJkfc/edit'
    }
  ];

  for (const item of updates) {
    try {
      await db.execute(sql`
        UPDATE campaigns
        SET link = ${item.link}
        WHERE name ILIKE ${item.namePattern} AND (link IS NULL OR link = '' OR link != ${item.link});
      `);
    } catch (err) {
      console.error('Error reconciling campaign link:', err);
    }
  }
}

app.listen(PORT, async () => {
  await reconcileCampaignLinks();
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 API available at http://localhost:${PORT}/api`);
  console.log(`💚 Health check: http://localhost:${PORT}/api/health`);
});

export default app;
