// src/index.ts
// Entry point — starts the Express server

import { createApp } from './api/server';

const PORT = Number(process.env['PORT'] ?? 3000);

export const app = createApp();

app.listen(PORT, () => {
  console.log(`optim-service listening on port ${PORT}`);
});
