import { Router, Response, Request } from 'express';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { UserPasswordResetService } from '../../services/user-password-reset.service';
import { createRateLimiter } from '../middleware/rate-limit.middleware';

const router = Router();
const userPasswordResetService = new UserPasswordResetService();

const passwordResetRequestSchema = z.object({
  email: z.string().email(),
});

const passwordResetConfirmSchema = z.object({
  token: z.string(),
  newPassword: z.string().min(12),
});

const passwordResetLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: 'Too many password reset requests, please try again after an hour.',
  keyPrefix: 'rl:password-reset:',
});

/**
 * @swagger
 * /api/users/password-reset/request:
 *   post:
 *     summary: Request user password reset
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: Reset request accepted
 */
router.post('/password-reset/request', passwordResetLimiter, async (req: Request, res: Response) => {
  const parsed = passwordResetRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ status: 'error', message: 'Invalid email' });
  }

  try {
    await userPasswordResetService.requestPasswordReset(parsed.data.email);
    res.json({
      status: 'success',
      message: 'If an account exists for that email, a password reset link has been sent.',
    });
  } catch (error) {
    console.error('Failed to request password reset', error);
    res.status(500).json({ status: 'error', message: 'Unable to process password reset request.' });
  }
});

/**
 * @swagger
 * /api/users/password-reset/confirm:
 *   post:
 *     summary: Confirm user password reset
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password updated
 */
router.post('/password-reset/confirm', async (req: Request, res: Response) => {
  const parsed = passwordResetConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ status: 'error', message: 'Invalid payload' });
  }

  try {
    await userPasswordResetService.confirmPasswordReset(parsed.data.token, parsed.data.newPassword);
    res.json({ status: 'success', message: 'Password has been reset successfully.' });
  } catch (error) {
    console.error('Failed to confirm password reset', error);
    res.status(500).json({ status: 'error', message: 'Unable to reset password.' });
  }
});

/**
 * @swagger
 * /api/users/hierarchy:
 *   get:
 *     summary: Get User Referral Hierarchy
 *     description: Fetches the downline referral hierarchy for the authenticated user using a recursive CTE.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Hierarchy retrieved successfully
 */
router.get('/hierarchy', authMiddleware, async (req: AuthRequest, res: Response) => {
  const publicKey = req.user!.publicKey;

  try {
    const user = await prisma.user.findUnique({ where: { publicKey } });
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    const userId = user.id;

    // We use a raw query here to demonstrate Recursive CTE capabilities,
    // which Prisma doesn't natively support in its high-level API.
    const hierarchy = await prisma.$queryRaw`
      WITH RECURSIVE
        UserHierarchy(id, publicKey, email, parentUserId, level) AS (
          -- Anchor member
          SELECT id, publicKey, email, parentUserId, 0
          FROM User
          WHERE id = ${userId}
          
          UNION ALL
          
          -- Recursive member
          SELECT u.id, u.publicKey, u.email, u.parentUserId, uh.level + 1
          FROM User u
          JOIN UserHierarchy uh ON u.parentUserId = uh.id
        )
      SELECT * FROM UserHierarchy;
    `;

    res.json({
      status: 'success',
      data: hierarchy,
    });
  } catch (error) {
    console.error('Error fetching user hierarchy:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch user hierarchy',
    });
  }
});

export default router;
