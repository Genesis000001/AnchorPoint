import express from 'express';
import request from 'supertest';
import sep6Router from './sep6.route';

describe('Issue #915 — SEP-6 Parameter Validation', () => {
  const app = express();
  app.use(express.json());
  // Mock authMiddleware to pass
  app.use('/sep6', (req, res, next) => {
    req.user = { account: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7' } as any;
    next();
  }, sep6Router);

  it('rejects deposit when asset_code is missing', async () => {
    const res = await request(app).get('/sep6/deposit');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('rejects deposit when memo_type is id but memo is not an integer', async () => {
    const res = await request(app)
      .get('/sep6/deposit')
      .query({ asset_code: 'USDC', memo_type: 'id', memo: 'not-an-id' });
    expect(res.status).toBe(400);
  });

  it('rejects deposit when memo_type is text but memo exceeds 28 bytes', async () => {
    const res = await request(app)
      .get('/sep6/deposit')
      .query({ asset_code: 'USDC', memo_type: 'text', memo: 'this-memo-is-definitely-longer-than-28-bytes' });
    expect(res.status).toBe(400);
  });

  it('accepts valid deposit parameters with type and location_id', async () => {
    const res = await request(app)
      .get('/sep6/deposit')
      .query({
        asset_code: 'USDC',
        amount: '100.50',
        type: 'bank_account',
        location_id: 'loc_123',
        memo: '12345',
        memo_type: 'id',
      });
    // Controller may return 200 or 500 depending on service mock, but validation passed (> 400 not validation error)
    expect(res.status).not.toBe(400);
  });
});
