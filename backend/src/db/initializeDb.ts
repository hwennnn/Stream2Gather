import { AppDataSource } from './dataSource';

const initializeDB = async (): Promise<void> => {
  await AppDataSource.initialize();
};

export default initializeDB;
