import { AppDataSource } from "./dataSource";

const initializeDB = async () => {
    await AppDataSource.initialize();
};

export default initializeDB;
