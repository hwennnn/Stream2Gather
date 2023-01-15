import { Message } from '@src/entities/Message';
import { Room } from '@src/entities/Room';
import { User } from '@src/entities/User';
import { DataSource } from 'typeorm';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.PG_HOST,
  port: parseInt(process.env.PG_PORT),
  username: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DB,
  synchronize: true,
  logging: true,
  entities: [User, Room, Message],
  migrations: [],
  subscribers: []
});
