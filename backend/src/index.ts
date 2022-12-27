import 'dotenv-safe/config';
import 'reflect-metadata';

import { ApiServer } from './server';

const apiServer = new ApiServer();
apiServer.initialize().catch((err) => {
  console.error(err);
});

export default apiServer;
