import { DataSource } from 'typeorm';
import { VideoJob, User, migrations } from '@frameforgetech/shared-contracts';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USER || 'frameforge',
  password: process.env.DB_PASSWORD || 'frameforge123',
  database: process.env.DB_NAME || 'frameforge',
  entities: [VideoJob, User],
  migrations: migrations,
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
  poolSize: 10,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false, // Enable SSL for RDS
});

export async function initializeDatabase(): Promise<void> {
  try {
    await AppDataSource.initialize();
    console.log('Database connection established');
    
    // Run pending migrations
    await AppDataSource.runMigrations();
    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Error connecting to database:', error);
    throw error;
  }
}
