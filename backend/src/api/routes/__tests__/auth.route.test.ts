import request from 'supertest';
import app from '../../../index';

describe('CORS preflight for SEP-10 endpoints', () => {
  test('OPTIONS /auth returns pre-flight CORS headers', async () => {
    const res = await request(app).options('/auth').set('Origin', 'https://example.com');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-headers']).toBeDefined();
    expect(res.headers['access-control-allow-headers']).toContain('Authorization');
    expect(res.headers['access-control-allow-headers']).toContain('Content-Type');
  });

  test('OPTIONS /auth/token returns pre-flight CORS headers', async () => {
    const res = await request(app).options('/auth/token').set('Origin', 'https://example.com');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-headers']).toBeDefined();
    expect(res.headers['access-control-allow-headers']).toContain('Authorization');
    expect(res.headers['access-control-allow-headers']).toContain('Content-Type');
  });
});
