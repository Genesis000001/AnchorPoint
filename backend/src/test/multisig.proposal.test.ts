import request from 'supertest';
import app from '../index';
import multisigService from '../services/multisig.service';
import { generateAuthToken } from '../utils/jwt';

describe('Admin Multi-Signature Proposal Workflow', () => {
  const admin1 = 'GBADMIN11111111111111111111111111111111111111111111111111';
  const admin2 = 'GBADMIN22222222222222222222222222222222222222222222222222';
  const admin3 = 'GBADMIN33333333333333333333333333333333333333333333333333';

  const tokenAdmin1 = generateAuthToken(admin1);
  const tokenAdmin2 = generateAuthToken(admin2);
  const tokenAdmin3 = generateAuthToken(admin3);

  describe('Full Proposal Lifecycle (2-of-3 threshold)', () => {
    it('creates proposal in PROPOSED status and reaches APPROVED upon 2nd signature, then EXECUTED', async () => {
      // 1. Create admin proposal requiring 2-of-3 threshold
      const createRes = await request(app)
        .post('/api/multisig/proposals')
        .set('Authorization', `Bearer ${tokenAdmin1}`)
        .send({
          actionType: 'CONFIG_UPDATE',
          description: 'Increase relayer surge fee multiplier',
          payload: { RELAYER_FEE_SURGE_MULTIPLIER: 1.5 },
          requiredSigners: [admin1, admin2, admin3],
          threshold: 2,
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.status).toBe('success');
      const proposal = createRes.body.data.proposal;
      expect(proposal.status).toBe('PROPOSED');
      expect(proposal.threshold).toBe(2);
      expect(proposal.currentSignatures).toBe(0);

      const proposalId = proposal.id;

      // 2. Admin 1 approves (1 of 2)
      const approve1Res = await request(app)
        .post(`/api/multisig/proposals/${proposalId}/approve`)
        .set('Authorization', `Bearer ${tokenAdmin1}`)
        .send({
          signature: Buffer.from('sig-admin-1').toString('base64'),
        });

      expect(approve1Res.status).toBe(200);
      expect(approve1Res.body.data.proposal.status).toBe('PROPOSED');
      expect(approve1Res.body.data.proposal.currentSignatures).toBe(1);

      // Attempt execution before threshold -> should fail
      const earlyExecRes = await request(app)
        .post(`/api/multisig/proposals/${proposalId}/execute`)
        .set('Authorization', `Bearer ${tokenAdmin1}`);

      expect(earlyExecRes.status).toBe(400);
      expect(earlyExecRes.body.message).toContain('APPROVED');

      // 3. Admin 2 approves (2 of 2 -> reaches threshold!)
      const approve2Res = await request(app)
        .post(`/api/multisig/proposals/${proposalId}/approve`)
        .set('Authorization', `Bearer ${tokenAdmin2}`)
        .send({
          signature: Buffer.from('sig-admin-2').toString('base64'),
        });

      expect(approve2Res.status).toBe(200);
      expect(approve2Res.body.data.proposal.status).toBe('APPROVED');
      expect(approve2Res.body.data.proposal.currentSignatures).toBe(2);

      // 4. Execute proposal
      const execRes = await request(app)
        .post(`/api/multisig/proposals/${proposalId}/execute`)
        .set('Authorization', `Bearer ${tokenAdmin2}`);

      expect(execRes.status).toBe(200);
      expect(execRes.body.data.proposal.status).toBe('EXECUTED');
      expect(execRes.body.data.proposal.executedBy).toBe(admin2);

      // 5. Query proposals list
      const listRes = await request(app)
        .get('/api/multisig/proposals?status=EXECUTED')
        .set('Authorization', `Bearer ${tokenAdmin1}`);

      expect(listRes.status).toBe(200);
      const found = listRes.body.data.proposals.find((p: any) => p.id === proposalId);
      expect(found).toBeDefined();
      expect(found.status).toBe('EXECUTED');
    });

    it('allows rejection of an administrative proposal', async () => {
      const createRes = await request(app)
        .post('/api/multisig/proposals')
        .set('Authorization', `Bearer ${tokenAdmin1}`)
        .send({
          actionType: 'NETWORK_SWITCH',
          description: 'Switch to PUBLIC network',
          payload: { network: 'PUBLIC' },
          requiredSigners: [admin1, admin2, admin3],
          threshold: 2,
        });

      const proposalId = createRes.body.data.proposal.id;

      const rejectRes = await request(app)
        .post(`/api/multisig/proposals/${proposalId}/reject`)
        .set('Authorization', `Bearer ${tokenAdmin3}`)
        .send({
          reason: 'Network switch rejected due to maintenance window',
        });

      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.data.proposal.status).toBe('REJECTED');
      expect(rejectRes.body.data.proposal.rejectionReason).toContain('maintenance window');
    });
  });
});
