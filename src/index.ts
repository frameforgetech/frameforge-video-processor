import dotenv from 'dotenv';

dotenv.config();

console.log('Video Processor Service starting...');

// Placeholder for RabbitMQ consumer setup
const startProcessor = async (): Promise<void> => {
  console.log('Video Processor ready to consume messages');
};

startProcessor().catch((error) => {
  console.error('Failed to start Video Processor:', error);
  process.exit(1);
});
