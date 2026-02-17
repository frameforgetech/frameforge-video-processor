import dotenv from 'dotenv';
import { initializeDatabase } from './database';
import { initializeRabbitMQ, closeRabbitMQ } from './queue';
import { setupMetrics } from './metrics';

dotenv.config();

console.log('Video Processor Service starting...');

async function startProcessor(): Promise<void> {
  try {
    // Initialize metrics server
    setupMetrics();
    console.log('Metrics server started');

    // Connect to database
    await initializeDatabase();
    console.log('Database connected');

    // Connect to RabbitMQ and start consuming
    await initializeRabbitMQ();
    console.log('Video Processor ready to consume messages');

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('SIGTERM received, shutting down gracefully...');
      await closeRabbitMQ();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      console.log('SIGINT received, shutting down gracefully...');
      await closeRabbitMQ();
      process.exit(0);
    });

  } catch (error) {
    console.error('Failed to start Video Processor:', error);
    process.exit(1);
  }
}

startProcessor();
