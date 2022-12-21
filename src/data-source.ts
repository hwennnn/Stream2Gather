import { Video } from "./entity/Video";
import { DataSource } from "typeorm";
import { Room } from "./entity/Room";
import { User } from "./entity/User";

export const AppDataSource = new DataSource({
    type: "postgres",
    host: "localhost",
    port: 5432,
    username: "postgres",
    password: "postgres",
    database: "stream2gather",
    synchronize: true,
    logging: true,
    entities: [User, Room, Video],
    migrations: [],
    subscribers: [],
});
