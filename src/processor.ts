import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import archiver from 'archiver';
import { v4 as uuidv4 } from 'uuid';
import { Channel } from 'amqplib';
import { AppDataSource } from './database';
import { VideoJob } from '@frameforge/shared-contracts';
import { recordProcessingDuration, incrementFramesExtracted, incrementFailed } from './metrics';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const FPS = parseInt(process.env.FPS || '1');
const TEMP_DIR = process.env.TEMP_DIR || os.tmpdir();
const RESULTS_BUCKET = process.env.S3_RESULTS_BUCKET || 'frameforge-results';
const MAX_DURATION_MINUTES = 10;
const SEGMENT_DURATION_MINUTES = 2;

interface VideoProcessingMessage {
  jobId: string;
  userId: string;
  videoUrl: string;
  filename: string;
  timestamp: string;
}

interface ProcessingResult {
  success: boolean;
  frameCount?: number;
  resultUrl?: string;
  errorMessage?: string;
}

export async function processVideoJob(
  message: VideoProcessingMessage,
  channel: Channel,
  eventsQueue: string
): Promise<void> {
  const startTime = Date.now();
  const workDir = path.join(TEMP_DIR, `job-${message.jobId}`);
  
  try {
    console.log(`Starting processing for job ${message.jobId}`);
    
    // Create working directory
    await fs.promises.mkdir(workDir, { recursive: true });
    
    // Update job status to processing
    await updateJobStatus(message.jobId, 'processing', null, Date.now());
    
    // Download video from S3
    const videoPath = await downloadVideo(message.videoUrl, workDir);
    console.log(`Video downloaded: ${videoPath}`);
    
    // Validate video file
    await validateVideo(videoPath);
    console.log('Video validated successfully');
    
    // Extract frames
    const framesDir = path.join(workDir, 'frames');
    await fs.promises.mkdir(framesDir, { recursive: true });
    
    const frameCount = await extractFrames(videoPath, framesDir);
    console.log(`Extracted ${frameCount} frames`);
    incrementFramesExtracted(frameCount);
    
    // Create manifest
    const frames = await fs.promises.readdir(framesDir);
    const manifest = createManifest(message.filename, frameCount, frames);
    await fs.promises.writeFile(
      path.join(framesDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
    
    // Create ZIP file
    const zipPath = path.join(workDir, `${message.jobId}.zip`);
    await createZipFile(framesDir, zipPath);
    console.log(`ZIP file created: ${zipPath}`);
    
    // Upload result to S3
    const resultUrl = await uploadResult(zipPath, message.userId, message.jobId);
    console.log(`Result uploaded: ${resultUrl}`);
    
    // Update job status to completed
    await updateJobStatus(message.jobId, 'completed', resultUrl, null, frameCount);
    
    // Publish success event
    await publishSuccessEvent(channel, eventsQueue, message, frameCount, resultUrl);
    
    // Record metrics
    const duration = (Date.now() - startTime) / 1000;
    recordProcessingDuration(duration);
    
    console.log(`Job ${message.jobId} completed successfully in ${duration}s`);
    
  } catch (error) {
    console.error(`Job ${message.jobId} failed:`, error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Update job status to failed
    await updateJobStatus(message.jobId, 'failed', null, null, null, errorMessage);
    
    // Publish failure event
    await publishFailureEvent(channel, eventsQueue, message, errorMessage);
    
    incrementFailed();
    
    throw error;
    
  } finally {
    // Cleanup temporary files
    try {
      await fs.promises.rm(workDir, { recursive: true, force: true });
      console.log(`Cleaned up working directory: ${workDir}`);
    } catch (error) {
      console.error(`Failed to cleanup working directory: ${error}`);
    }
  }
}

async function downloadVideo(videoUrl: string, workDir: string): Promise<string> {
  // Extract bucket and key from S3 URL
  const url = new URL(videoUrl);
  const bucket = url.hostname.split('.')[0];
  const key = url.pathname.substring(1);
  
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await s3Client.send(command);
  
  if (!response.Body) {
    throw new Error('Failed to download video: empty response');
  }
  
  const videoPath = path.join(workDir, path.basename(key));
  const writeStream = fs.createWriteStream(videoPath);
  
  await new Promise((resolve, reject) => {
    (response.Body as Readable).pipe(writeStream);
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });
  
  return videoPath;
}

async function validateVideo(videoPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(new Error(`Video validation failed: ${err.message}`));
        return;
      }
      
      if (!metadata.streams|| metadata.streams.length === 0) {
        reject(new Error('Video file is corrupted or empty'));
        return;
      }
      
      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      if (!videoStream) {
        reject(new Error('No video stream found in file'));
        return;
      }
      
      resolve();
    });
  });
}

async function extractFrames(videoPath: string, outputDir: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions([
        `-vf fps=${FPS}`,
        '-y'
      ])
      .output(path.join(outputDir, 'frame_%04d.png'))
      .on('end', async () => {
        try {
          const frames = await fs.promises.readdir(outputDir);
          const frameCount = frames.filter(f => f.endsWith('.png')).length;
          resolve(frameCount);
        } catch (error) {
          reject(error);
        }
      })
      .on('error', (err) => {
        reject(new Error(`Frame extraction failed: ${err.message}`));
      })
      .run();
  });
}

function createManifest(filename: string, frameCount: number, frames: string[]): object {
  return {
    video: {
      originalFilename: filename,
      processedAt: new Date().toISOString(),
    },
    extraction: {
      fps: FPS,
      totalFrames: frameCount,
    },
    frames: frames.filter(f => f.endsWith('.png')).sort().map((frame, index) => ({
      filename: frame,
      timestamp: index / FPS,
      number: index + 1,
    })),
  };
}

async function createZipFile(sourceDir: string, zipPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', {
      zlib: { level: 6 } // Compression level
    });
    
    output.on('close', () => resolve());
    archive.on('error', (err) => reject(err));
    
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function uploadResult(zipPath: string, userId: string, jobId: string): Promise<string> {
  const key = `${userId}/${jobId}/result.zip`;
  const fileContent = await fs.promises.readFile(zipPath);
  
  const command = new PutObjectCommand({
    Bucket: RESULTS_BUCKET,
    Key: key,
    Body: fileContent,
    ContentType: 'application/zip',
  });
  
  await s3Client.send(command);
  
  // Return permanent S3 URL
  return `https://${RESULTS_BUCKET}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;
}

async function updateJobStatus(
  jobId: string,
  status: 'processing' | 'completed' | 'failed',
  resultUrl: string | null,
  startedAt: number | null,
  frameCount: number | null = null,
  errorMessage: string | null = null
): Promise<void> {
  const jobRepo = AppDataSource.getRepository(VideoJob);
  const job = await jobRepo.findOne({ where: { jobId } });
  
  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }
  
  job.status = status;
  
  if (startedAt) {
    job.startedAt = new Date(startedAt);
  }
  
  if (status === 'completed') {
    job.completedAt = new Date();
    job.resultUrl = resultUrl;
    job.frameCount = frameCount;
  } else if (status === 'failed') {
    job.completedAt = new Date();
    job.errorMessage = errorMessage;
  }
  
  await jobRepo.save(job);
}

async function publishSuccessEvent(
  channel: Channel,
  queueName: string,
  message: VideoProcessingMessage,
  frameCount: number,
  resultUrl: string
): Promise<void> {
  const event = {
    type: 'video.processing.completed',
    jobId: message.jobId,
    userId: message.userId,
    filename: message.filename,
    frameCount,
    resultUrl,
    timestamp: new Date().toISOString(),
  };
  
  await channel.sendToQueue(queueName, Buffer.from(JSON.stringify(event)), {
    persistent: true,
  });
}

async function publishFailureEvent(
  channel: Channel,
  queueName: string,
  message: VideoProcessingMessage,
  errorMessage: string
): Promise<void> {
  const event = {
    type: 'video.processing.failed',
    jobId: message.jobId,
    userId: message.userId,
    filename: message.filename,
    errorMessage,
    timestamp: new Date().toISOString(),
  };
  
  await channel.sendToQueue(queueName, Buffer.from(JSON.stringify(event)), {
    persistent: true,
  });
}
