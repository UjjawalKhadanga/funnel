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
  try {
    const key = req.params.key;
    const item = await ratelimiter.consume(key);
    res.json({ message: item ? 'Key consumed' : 'Key not consumed', item });
  } catch (e) {
    console.log(e);
  }
})

app.listen(3000, () => {
  console.log('Server is running on port 3000');
})