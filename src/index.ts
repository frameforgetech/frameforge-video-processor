import dotenv from 'dotenv';
import http from 'http';
import { initializeDatabase } from './database';
import { initializeRabbitMQ, closeRabbitMQ } from './queue';
import { setupMetrics } from './metrics';

dotenv.config();

console.log('Video Processor Service starting...');

// Health check server (used by k8s liveness/readiness probes)
const healthPort = parseInt(process.env.PORT || '3002');
http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', service: 'video-processor' }));
}).listen(healthPort, () => {
  console.log(`Health server listening on port ${healthPort}`);
});

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
