import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { loadApp } from './helpers.ts';

let app: Express;

beforeAll(async () => {
  app = await loadApp();
});

describe('app-level HTTP conventions (auth disabled)', () => {
  it('reports health as ok with an ISO timestamp', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });

  it('tells the client that auth is disabled', async () => {
    const res = await request(app).get('/api/auth/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { enabled: false } });
  });

  it('lets API requests through without a token when auth is disabled', async () => {
    const res = await request(app).get('/api/campaigns');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('answers unknown endpoints with 404 and the error envelope', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe('string');
  });

  it('rejects a malformed JSON body with 400 and the error envelope', async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .set('Content-Type', 'application/json')
      .send('{"name": ');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe('string');
  });
});
