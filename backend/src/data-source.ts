import { DataSource } from "typeorm";
import { Room } from "./entities/Room";
import { User } from "./entities/User";

export const AppDataSource = new DataSource({
    type: "postgres",
    host: process.env.PG_HOST,
    port: parseInt(process.env.PG_PORT),
    username: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DB,
    synchronize: true,
    logging: true,
    entities: [User, Room],
    migrations: [],
    subscribers: [],
});
