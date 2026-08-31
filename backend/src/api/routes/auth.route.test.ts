import request from 'supertest';
import express from 'express';
import { rateLimit } from 'express-rate-limit';

jest.mock('../middleware/rate-limit.middleware', () => ({
  authLimiter: rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 10,
    message: { error: 'Too many authentication attempts, please try again after 10 minutes.' },
  }),
}));

import authRouter from './auth.route';
import { authLimiter } from '../middleware/rate-limit.middleware';

const app = express();
app.use(express.json());
app.use('/sep10', authLimiter, authRouter);
app.use('/auth', authLimiter, authRouter);

describe('Auth Route Rate Limiting', () => {
  it('should return 429 when rate limit is exceeded', async () => {
    // authLimiter max is 10, let's send 11 requests
    for (let i = 0; i < 10; i++) {
      await request(app).post('/sep10').send({ account: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' });
    }
    const response = await request(app).post('/sep10').send({ account: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' });
    expect(response.status).toBe(429);
  });
});

describe('GET /auth challenge generation', () => {
  it('returns 400 when the account query parameter is missing', async () => {
    const challengeApp = express();
    challengeApp.use(express.json());
    challengeApp.use('/auth', authRouter);

    const response = await request(challengeApp).get('/auth');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'account parameter is required' });
  });
});
