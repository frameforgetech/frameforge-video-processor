import amqp from 'amqplib';
import { AppDataSource } from './database';
import { VideoJob } from '@frameforge/shared-contracts';
import { processVideoJob } from './processor';
import { setupMetrics, incrementProcessed, incrementFailed } from './metrics';

let channel: amqp.Channel;
let connection: amqp.Connection;

const QUEUE_NAME = 'video.processing';
const EVENTS_QUEUE = 'video.events';
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_JOBS || '5');

interface VideoProcessingMessage {
  jobId: string;
  userId: string;
  videoUrl: string;
  filename: string;
  timestamp: string;
}

export async function initializeRabbitMQ(): Promise<void> {
  const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
  
  try {
    console.log('Connecting to RabbitMQ...');
    connection = await amqp.connect(rabbitmqUrl);
    channel = await connection.createChannel();

    // Assert queues exist
    await channel.assertQueue(QUEUE_NAME, { durable: true });
    await channel.assertQueue(EVENTS_QUEUE, { durable: true });

    // Set prefetch to limit concurrent processing
    await channel.prefetch(MAX_CONCURRENT);

    console.log(`RabbitMQ connected. Listening to queue: ${QUEUE_NAME}`);
    console.log(`Max concurrent jobs: ${MAX_CONCURRENT}`);

    // Start consuming messages
    await channel.consume(QUEUE_NAME, async (msg) => {
      if (!msg) return;

      try {
        const message: VideoProcessingMessage = JSON.parse(msg.content.toString());
        console.log(`Received job: ${message.jobId}`);

        await processVideoJob(message, channel, EVENTS_QUEUE);
        
        // Acknowledge message
        channel.ack(msg);
        incrementProcessed();
        
      } catch (error) {
        console.error('Error processing message:', error);
        
        // Reject and requeue (up to 3 times)
        const retryCount = (msg.properties.headers['x-retry-count'] || 0) + 1;
        
        if (retryCount < 3) {
          // Requeue with retry count
          channel.nack(msg, false, false);
          await channel.sendToQueue(QUEUE_NAME, msg.content, {
            headers: { 'x-retry-count': retryCount },
          });
          console.log(`Message requeued (attempt ${retryCount}/3)`);
        } else {
          // Send to DLQ after 3 attempts
          channel.nack(msg, false, false);
          incrementFailed();
          console.log(`Message rejected after ${retryCount} attempts`);
        }
      }
    });

    // Handle connection errors
    connection.on('error', (err) => {
      console.error('RabbitMQ connection error:', err);
    });

    connection.on('close', () => {
      console.log('RabbitMQ connection closed. Reconnecting in 5 seconds...');
      setTimeout(initializeRabbitMQ, 5000);
    });

  } catch (error) {
    console.error('Failed to connect to RabbitMQ:', error);
    // Retry connection after 5 seconds
    setTimeout(initializeRabbitMQ, 5000);
    throw error;
  }
}

export async function publishEvent(event: object): Promise<void> {
  try {
    await channel.sendToQueue(EVENTS_QUEUE, Buffer.from(JSON.stringify(event)), {
      persistent: true,
    });
  } catch (error) {
    console.error('Failed to publish event:', error);
    throw error;
  }
}

export async function closeRabbitMQ(): Promise<void> {
  try {
    if (channel) await channel.close();
    if (connection) await connection.close();
  } catch (error) {
    console.error('Error closing RabbitMQ connection:', error);
  }
}
