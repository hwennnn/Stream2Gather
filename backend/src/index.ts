import "reflect-metadata";
import "dotenv-safe/config";

import { ApiServer } from "./server";

const apiServer = new ApiServer();
apiServer.initialize().catch((err) => {
    console.error(err);
});

export default apiServer;
