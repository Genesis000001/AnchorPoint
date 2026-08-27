import { Router } from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Queue } from 'bullmq';
import { queueConnection, QUEUE_NAMES } from '../../config/queue';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/api/queue-dashboard');

// Exposed so the app's graceful shutdown handler can drain/close these connections.
export const dashboardQueues = Object.values(QUEUE_NAMES).map(
  (name) => new Queue(name, { connection: queueConnection })
);

const queues = dashboardQueues.map((queue) => new BullMQAdapter(queue));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
createBullBoard({ queues: queues as any, serverAdapter });

const router = Router();
router.use('/', serverAdapter.getRouter());

export default router;
