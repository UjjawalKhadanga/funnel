import express from 'express';
import RateLimiterRedis from './ratelimiter/RateLimiterRedis.js';
import Redis from 'ioredis';

const app = express();

app.use(express.json());

const ratelimiter = new RateLimiterRedis(new Redis());

app.get('/:key', async (req: express.Request, res: express.Response) => {
  const key = req.params.key;
  await ratelimiter.register(key, { points: 1, duration: 60 });
  res.json({ message: 'Key registered' });
})

app.get('/:key/consume', async (req: express.Request, res: express.Response) => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.on('close', abort);
  try {
    const key = req.params.key;
    await ratelimiter.consume(key, { signal: controller.signal });
    res.json({ message: 'Key consumed' });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to consume key';
    if (!res.destroyed) res.status(400).json({ message });
  } finally {
    res.off('close', abort);
  }
})

const port = Number(process.env.PORT ?? 3001);

app.listen(port, '127.0.0.1', () => {
  console.log('Server is running at http://127.0.0.1:' + port);
})