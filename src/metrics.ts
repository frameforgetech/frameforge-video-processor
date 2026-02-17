import { Registry, Counter, Histogram, Gauge } from 'prom-client';
import http from 'http';

const register = new Registry();

// Metrics
const jobsProcessed = new Counter({
  name: 'video_processor_jobs_processed_total',
  help: 'Total number of video jobs successfully processed',
  registers: [register],
});

const jobsFailed = new Counter({
  name: 'video_processor_jobs_failed_total',
  help: 'Total number of video jobs that failed',
  registers: [register],
});

const processingDuration = new Histogram({
  name: 'video_processor_processing_duration_seconds',
  help: 'Duration of video processing in seconds',
  buckets: [10, 30, 60, 120, 300, 600, 1200],
  registers: [register],
});

const queueDepth = new Gauge({
  name: 'video_processor_queue_depth',
  help: 'Current depth of the processing queue',
  registers: [register],
});

const framesExtracted = new Counter({
  name: 'video_processor_frames_extracted_total',
  help: 'Total number of frames extracted from videos',
  registers: [register],
});

export function incrementProcessed(): void {
  jobsProcessed.inc();
}

export function incrementFailed(): void {
  jobsFailed.inc();
}

export function recordProcessingDuration(seconds: number): void {
  processingDuration.observe(seconds);
}

export function setQueueDepth(depth: number): void {
  queueDepth.set(depth);
}

export function incrementFramesExtracted(count: number): void {
  framesExtracted.inc(count);
}

export function setupMetrics(): void {
  const metricsPort = parseInt(process.env.METRICS_PORT || '9091');

  http.createServer(async (_req, res) => {
    res.setHeader('Content-Type', register.contentType);
    res.end(await register.metrics());
  }).listen(metricsPort, () => {
    console.log(`Metrics server listening on port ${metricsPort}`);
  });
}
