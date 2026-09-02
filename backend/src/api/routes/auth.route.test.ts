import request from 'supertest';
import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';

let sep10ChallengeLimiter: RequestHandler;

jest.mock('../middleware/rate-limit.middleware', () => ({
  sep10ChallengeLimiter: (req: Request, res: Response, next: NextFunction) => sep10ChallengeLimiter(req, res, next),
}));

import authRouter from './auth.route';

beforeEach(() => {
  sep10ChallengeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: true,
    message: { error: 'Too many challenge requests, please try again later.' },
  });
});

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/sep10', sep10ChallengeLimiter, authRouter);
  app.use('/auth', sep10ChallengeLimiter, authRouter);
  return app;
};

describe('SEP-10 challenge rate limiting', () => {
  it('should return 429 when the challenge rate limit is exceeded', async () => {
    const app = createApp();

    for (let i = 0; i < 10; i++) {
      await request(app).post('/sep10').send({ account: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' });
    }

    const response = await request(app)
      .post('/sep10')
      .send({ account: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' });

    expect(response.status).toBe(429);
    expect(response.body).toEqual({ error: 'Too many challenge requests, please try again later.' });
  });

  it('should expose X-RateLimit-Limit and X-RateLimit-Remaining headers', async () => {
    const app = createApp();

    const withinLimit = await request(app)
      .post('/sep10')
      .send({ account: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' });

    expect(withinLimit.status).not.toBe(429);
    expect(withinLimit.headers['x-ratelimit-limit']).toBe('10');
    expect(withinLimit.headers['x-ratelimit-remaining']).toBeDefined();
    const remaining = parseInt(withinLimit.headers['x-ratelimit-remaining'] as string, 10);
    expect(remaining).toBeGreaterThanOrEqual(0);
    expect(remaining).toBeLessThanOrEqual(9);
  });

  it('should decrement X-RateLimit-Remaining as requests consume the limit', async () => {
    const app = createApp();

    const first = await request(app)
      .post('/sep10')
      .send({ account: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' });
    const second = await request(app)
      .post('/sep10')
      .send({ account: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' });

    const remainingAfterFirst = parseInt(first.headers['x-ratelimit-remaining'] as string, 10);
    const remainingAfterSecond = parseInt(second.headers['x-ratelimit-remaining'] as string, 10);

    expect(remainingAfterFirst).toBeGreaterThan(remainingAfterSecond);
  });

  it('should apply the same limit to the GET challenge endpoint', async () => {
    const app = createApp();

    for (let i = 0; i < 10; i++) {
      await request(app).get('/sep10?account=GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
    }

    const response = await request(app).get('/sep10?account=GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');

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
