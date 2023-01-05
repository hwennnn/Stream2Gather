import { AppDataSource } from '@src/db/dataSource';

const initializeDB = async (): Promise<void> => {
  await AppDataSource.initialize();
};

export default initializeDB;
