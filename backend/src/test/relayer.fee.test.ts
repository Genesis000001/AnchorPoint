import request from 'supertest';
import app from '../index';
import { relayerService } from '../services/relayer.service';

describe('Relayer Fee API & Fee Bump integration tests', () => {
  describe('GET /api/relayer/fee-estimate', () => {
    it('should return fee estimate successfully', async () => {
      jest.spyOn(relayerService, 'getFeeEstimate').mockResolvedValueOnce({
        baseFee: 100,
        recommendedFee: 240,
        surgeMultiplier: 1.2,
        maxFeeCap: 10000,
        modeFee: 200,
        p90Fee: 200,
        minFee: 100,
        maxFee: 500,
        ledgerCapacityUsage: 0.75,
      });

      const res = await request(app).get('/api/relayer/fee-estimate?multiplier=1.2');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.recommendedFee).toBe(240);
      expect(res.body.data.surgeMultiplier).toBe(1.2);
    });
  });

  describe('POST /api/relayer/fee-bump', () => {
    it('should require transactionXdr', async () => {
      const res = await request(app).post('/api/relayer/fee-bump').send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('transactionXdr is required');
    });

    it('should submit fee bump successfully', async () => {
      jest.spyOn(relayerService, 'submitFeeBump').mockResolvedValueOnce({
        success: true,
        feeBumpTransactionXdr: 'mockBumpXdr',
        transactionHash: 'bumpTxHash123',
        fee: 300,
      });

      const res = await request(app).post('/api/relayer/fee-bump').send({
        transactionXdr: 'AAAA...',
        maxFee: 500,
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.transactionHash).toBe('bumpTxHash123');
      expect(res.body.fee).toBe(300);
    });
  });
});
