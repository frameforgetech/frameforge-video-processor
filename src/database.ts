import { DataSource } from 'typeorm';
import { VideoJob } from '@frameforge/shared-contracts';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USER || 'frameforge',
  password: process.env.DB_PASSWORD || 'frameforge123',
  database: process.env.DB_NAME || 'frameforge',
  entities: [VideoJob],
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
  poolSize: 10,
});

export async function initializeDatabase(): Promise<void> {
  try {
    await AppDataSource.initialize();
    console.log('Database connection established');
  } catch (error) {
    console.error('Error connecting to database:', error);
    throw error;
  }
}
