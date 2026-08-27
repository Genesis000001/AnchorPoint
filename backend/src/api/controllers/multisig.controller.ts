import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import multisigService from '../../services/multisig.service';
import logger from '../../utils/logger';
import { MultisigStatus } from '@prisma/client';

export class MultisigController {
  /**
   * Create a new multisig transaction
   */
  async createTransaction(req: AuthRequest, res: Response): Promise<void> {
    try {
      const {
        envelopeXdr,
        requiredSigners,
        threshold,
        memo,
        expiresAt,
        metadata,
      } = req.body;

      const creatorPublicKey = req.user!.publicKey;

      const transaction = await multisigService.createTransaction({
        envelopeXdr,
        creatorPublicKey,
        requiredSigners,
        threshold,
        memo,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        metadata,
      });

      res.status(201).json({
        status: 'success',
        data: { transaction },
      });
    } catch (error: any) {
      logger.error('Error creating multisig transaction:', error);
      res.status(400).json({
        status: 'error',
        message: error.message || 'Failed to create multisig transaction',
      });
    }
  }

  /**
   * Add a signature to a multisig transaction
   */
  async addSignature(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { transactionId } = req.params;
      const { signedEnvelopeXdr } = req.body;
      const signerPublicKey = req.user!.publicKey;

      const transaction = await multisigService.addSignature({
        transactionId,
        signerPublicKey,
        signedEnvelopeXdr,
      });

      res.json({
        status: 'success',
        data: { transaction },
      });
    } catch (error: any) {
      logger.error('Error adding signature:', error);
      res.status(400).json({
        status: 'error',
        message: error.message || 'Failed to add signature',
      });
    }
  }

  /**
   * Get a multisig transaction by ID
   */
  async getTransaction(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { transactionId } = req.params;

      const transaction = await multisigService.getTransaction(transactionId);

      if (!transaction) {
        res.status(404).json({
          status: 'error',
          message: 'Transaction not found',
        });
        return;
      }

      res.json({
        status: 'success',
        data: { transaction },
      });
    } catch (error: any) {
      logger.error('Error fetching transaction:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch transaction',
      });
    }
  }

  /**
   * Get multisig transactions for the authenticated user
   */
  async getMyTransactions(req: AuthRequest, res: Response): Promise<void> {
    try {
      const publicKey = req.user!.publicKey;
      const { status } = req.query;

      const transactions = await multisigService.getTransactionsForSigner(
        publicKey,
        status ? (status as MultisigStatus) : undefined
      );

      res.json({
        status: 'success',
        data: { transactions },
      });
    } catch (error: any) {
      logger.error('Error fetching transactions:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch transactions',
      });
    }
  }

  /**
   * Get pending transactions that need signature from the authenticated user
   */
  async getPendingTransactions(req: AuthRequest, res: Response): Promise<void> {
    try {
      const publicKey = req.user!.publicKey;

      const transactions = await multisigService.getPendingForSigner(publicKey);

      res.json({
        status: 'success',
        data: { transactions },
      });
    } catch (error: any) {
      logger.error('Error fetching pending transactions:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch pending transactions',
      });
    }
  }

  /**
   * Manually submit a transaction
   */
  async submitTransaction(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { transactionId } = req.params;

      const transaction = await multisigService.submitTransaction(transactionId);

      res.json({
        status: 'success',
        data: { transaction },
      });
    } catch (error: any) {
      logger.error('Error submitting transaction:', error);
      res.status(400).json({
        status: 'error',
        message: error.message || 'Failed to submit transaction',
      });
    }
  }

  /**
   * Get notifications for the authenticated user
   */
  async getNotifications(req: AuthRequest, res: Response): Promise<void> {
    try {
      const publicKey = req.user!.publicKey;
      const { unreadOnly } = req.query;

      const notifications = await multisigService.getNotifications(
        publicKey,
        unreadOnly === 'true'
      );

      res.json({
        status: 'success',
        data: { notifications },
      });
    } catch (error: any) {
      logger.error('Error fetching notifications:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch notifications',
      });
    }
  }

  /**
   * Mark notifications as read
   */
  async markNotificationsAsRead(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { notificationIds } = req.body;

      await multisigService.markNotificationsAsRead(notificationIds);

      res.json({
        status: 'success',
        message: 'Notifications marked as read',
      });
    } catch (error: any) {
      logger.error('Error marking notifications as read:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to mark notifications as read',
      });
    }
  }

  /**
   * Create an administrative action proposal
   */
  async createAdminProposal(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { actionType, description, payload, requiredSigners, threshold } = req.body;
      const creatorPublicKey = req.user?.publicKey || 'ADMIN_KEY';

      const proposal = await multisigService.createAdminProposal({
        actionType,
        description,
        payload,
        creatorPublicKey,
        requiredSigners,
        threshold,
      });

      res.status(201).json({
        status: 'success',
        data: { proposal },
      });
    } catch (error: any) {
      logger.error('Error creating admin proposal:', error);
      res.status(400).json({
        status: 'error',
        message: error.message || 'Failed to create admin proposal',
      });
    }
  }

  /**
   * Approve/sign an administrative action proposal
   */
  async approveAdminProposal(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { proposalId } = req.params;
      const { signature, signerPublicKey: bodySignerPublicKey } = req.body;
      const signerPublicKey = req.user?.publicKey || bodySignerPublicKey;

      if (!signature) {
        res.status(400).json({
          status: 'error',
          message: 'Cryptographic signature is required to approve admin proposal',
        });
        return;
      }

      if (!signerPublicKey) {
        res.status(400).json({
          status: 'error',
          message: 'Signer public key is required',
        });
        return;
      }

      const proposal = await multisigService.approveAdminProposal(
        proposalId,
        signerPublicKey,
        signature
      );

      res.json({
        status: 'success',
        data: { proposal },
      });
    } catch (error: any) {
      logger.error('Error approving admin proposal:', error);
      res.status(400).json({
        status: 'error',
        message: error.message || 'Failed to approve admin proposal',
      });
    }
  }

  /**
   * Reject an administrative action proposal
   */
  async rejectAdminProposal(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { proposalId } = req.params;
      const { reason, signerPublicKey: bodySignerPublicKey } = req.body;
      const signerPublicKey = req.user?.publicKey || bodySignerPublicKey || 'ADMIN_KEY';

      const proposal = await multisigService.rejectAdminProposal(
        proposalId,
        signerPublicKey,
        reason
      );

      res.json({
        status: 'success',
        data: { proposal },
      });
    } catch (error: any) {
      logger.error('Error rejecting admin proposal:', error);
      res.status(400).json({
        status: 'error',
        message: error.message || 'Failed to reject admin proposal',
      });
    }
  }

  /**
   * Execute an approved administrative action proposal
   */
  async executeAdminProposal(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { proposalId } = req.params;
      const executorPublicKey = req.user?.publicKey || 'ADMIN_KEY';

      const result = await multisigService.executeAdminProposal(
        proposalId,
        executorPublicKey
      );

      res.json({
        status: 'success',
        data: result,
      });
    } catch (error: any) {
      logger.error('Error executing admin proposal:', error);
      res.status(400).json({
        status: 'error',
        message: error.message || 'Failed to execute admin proposal',
      });
    }
  }

  /**
   * Get all administrative action proposals
   */
  async getAdminProposals(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { status } = req.query;
      const proposals = await multisigService.getAdminProposals(
        status as any
      );

      res.json({
        status: 'success',
        data: { proposals },
      });
    } catch (error: any) {
      logger.error('Error fetching admin proposals:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch admin proposals',
      });
    }
  }

  /**
   * Get admin proposal by ID
   */
  async getAdminProposalById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { proposalId } = req.params;
      const proposal = await multisigService.getAdminProposal(proposalId);

      if (!proposal) {
        res.status(404).json({
          status: 'error',
          message: 'Admin proposal not found',
        });
        return;
      }

      res.json({
        status: 'success',
        data: { proposal },
      });
    } catch (error: any) {
      logger.error('Error fetching admin proposal:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch admin proposal',
      });
    }
  }
}

export default new MultisigController();

