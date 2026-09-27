import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Express } from 'express';
import { loadApp } from './helpers.ts';

// Auth config is read at module load, so it is stubbed before the app is
// imported. Each test file has its own module registry.
const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const USERNAME = 'tester';
const PASSWORD = 'correct horse battery';

let app: Express;

beforeAll(async () => {
  vi.stubEnv('AUTH_ENABLED', 'true');
  vi.stubEnv('AUTH_USERNAME', USERNAME);
  vi.stubEnv('AUTH_PASSWORD', PASSWORD);
  vi.stubEnv('AUTH_JWT_SECRET', SECRET);
  vi.stubEnv('AUTH_JWT_EXPIRES_IN', '1h');
  app = await loadApp();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('auth enabled', () => {
  it('reports auth as enabled on the public config endpoint', async () => {
    const res = await request(app).get('/api/auth/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { enabled: true } });
  });

  it('keeps the health check public', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });

  it('rejects API requests without a Bearer token with 401', async () => {
    const res = await request(app).get('/api/properties');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe('string');
  });

  it('rejects a non-Bearer Authorization header with 401', async () => {
    const res = await request(app).get('/api/properties').set('Authorization', `Basic ${SECRET}`);
    expect(res.status).toBe(401);
  });

  it('rejects a garbage token with 401', async () => {
    const res = await request(app).get('/api/properties').set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects a token signed with a different secret', async () => {
    const forged = jwt.sign({ sub: USERNAME, role: 'admin' }, 'some-other-secret-that-is-also-32-chars!!');
    const res = await request(app).get('/api/properties').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const expired = jwt.sign(
      { sub: USERNAME, role: 'admin', exp: Math.floor(Date.now() / 1000) - 60 },
      SECRET
    );
    const res = await request(app).get('/api/properties').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it('accepts a valid JWT minted from the configured secret', async () => {
    const token = jwt.sign({ sub: USERNAME, role: 'admin' }, SECRET, { expiresIn: '5m' });
    const res = await request(app).get('/api/properties').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('protects write endpoints too', async () => {
    const res = await request(app).post('/api/campaigns').send({ name: 'Nope' });
    expect(res.status).toBe(401);
  });

  describe('POST /api/auth/login', () => {
    it('issues a token for the configured credentials that unlocks the API', async () => {
      const login = await request(app).post('/api/auth/login').send({ username: USERNAME, password: PASSWORD });
      expect(login.status).toBe(200);
      expect(login.body.success).toBe(true);
      expect(login.body.data.username).toBe(USERNAME);
      expect(typeof login.body.data.token).toBe('string');

      const res = await request(app)
        .get('/api/campaigns')
        .set('Authorization', `Bearer ${login.body.data.token}`);
      expect(res.status).toBe(200);
    });

    it.each([
      ['wrong password', { username: USERNAME, password: 'wrong password!' }],
      ['wrong username', { username: 'someone', password: PASSWORD }],
      ['missing password', { username: USERNAME }],
      ['empty body', {}],
      ['non-string credentials', { username: 1, password: ['x'] }],
    ])('rejects %s with 401', async (_label, body) => {
      const res = await request(app).post('/api/auth/login').send(body);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.data).toBeUndefined();
    });
  });
});
