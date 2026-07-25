import express from 'express';
import { MockDataProvider } from '../data/provider.js';

const app = express();
const port = 4021;
const provider = new MockDataProvider();

app.get('/catalog', (_req, res) => {
  res.json({
    'cohort-insight': {
      price: '0.5 HBAR',
      params: ['ageRange', 'activityType'],
    },
  });
});

app.get('/data/cohort-insight', async (_req, res) => {
  const data = await provider.getCohortInsight({});
  res.json(data);
});

app.listen(port, () => {
  console.log(`x402 mock server listening on http://localhost:${port}`);
});
