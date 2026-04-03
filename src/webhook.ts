import { Router } from 'express';
import { middleware, type WebhookEvent, type MiddlewareConfig } from '@line/bot-sdk';
import { handleEvent } from './handlers/messageHandler';
import logger from './utils/logger';

const router = Router();

const middlewareConfig: MiddlewareConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET!,
};

router.post('/webhook', middleware(middlewareConfig), (req, res) => {
  // ตอบ 200 ทันที ก่อน LINE timeout (10 วินาที)
  res.sendStatus(200);

  const events: WebhookEvent[] = req.body.events;
  events.forEach(event => {
    handleEvent(event).catch(err => {
      logger.error({ err, event }, 'Error handling event');
    });
  });
});

export default router;
