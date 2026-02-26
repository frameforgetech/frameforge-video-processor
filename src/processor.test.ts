// processor.test.ts
// Strategy: All mock factories are fully self-contained (no outer variable refs).
// We retrieve the mock send fn via the mocked module after imports.

jest.mock('@aws-sdk/client-s3', () => {
  const mockSend = jest.fn();
  const S3Client = jest.fn().mockImplementation(() => ({ send: mockSend }));
  (S3Client as any).__mockSend = mockSend;
  return { S3Client, GetObjectCommand: jest.fn((p: any) => p), PutObjectCommand: jest.fn((p: any) => p) };
});
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));
jest.mock('fluent-ffmpeg', () => {
  const fn: any = jest.fn();
  fn.ffprobe = jest.fn();
  return fn;
});
jest.mock('archiver', () => jest.fn());
jest.mock('@frameforgetech/shared-contracts', () => ({
  VideoJob: class {},
  JobStatus: {
    PENDING: 'pending', PROCESSING: 'processing',
    COMPLETED: 'completed', FAILED: 'failed',
  },
}));
jest.mock('./database', () => ({
  AppDataSource: { getRepository: jest.fn() },
}));
jest.mock('./metrics', () => ({
  recordProcessingDuration: jest.fn(),
  incrementFramesExtracted: jest.fn(),
  incrementFailed: jest.fn(),
}));
jest.mock('amqplib', () => ({
  connect: jest.fn(),
}));
jest.mock('fs', () => {
  const { Writable } = require('stream');
  class Sink extends Writable { _write(_c: any, _e: any, cb: any) { cb(); } }
  const mkdir = jest.fn().mockResolvedValue(undefined);
  const readdir = jest.fn().mockResolvedValue(['f1.png', 'f2.png', 'f3.png']);
  const writeFile = jest.fn().mockResolvedValue(undefined);
  const readFile = jest.fn().mockResolvedValue(Buffer.from('zip'));
  const rm = jest.fn().mockResolvedValue(undefined);
  return {
    promises: { mkdir, readdir, writeFile, readFile, rm },
    createWriteStream: jest.fn().mockImplementation(() => new Sink()),
    __mkdir: mkdir, __readdir: readdir, __writeFile: writeFile,
    __readFile: readFile, __rm: rm,
  };
});

import { S3Client } from '@aws-sdk/client-s3';
import ffmpeg from 'fluent-ffmpeg';
import archiver from 'archiver';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppDataSource } from './database';
import * as metrics from './metrics';
import * as fsModule from 'fs';
import { processVideoJob } from './processor';
import { Readable } from 'stream';

// Retrieve the shared mockSend from the S3Client mock factory
const mockS3Send: jest.Mock = (S3Client as any).__mockSend;
const mockGetSignedUrl = getSignedUrl as jest.MockedFunction<typeof getSignedUrl>;
const mockFfmpeg = ffmpeg as jest.MockedFunction<typeof ffmpeg>;
const mockFfprobe = (ffmpeg as any).ffprobe as jest.MockedFunction<any>;
const mockArchiver = archiver as jest.MockedFunction<typeof archiver>;
const mockGetRepository = AppDataSource.getRepository as jest.MockedFunction<any>;
const mockCreateWriteStream = fsModule.createWriteStream as jest.MockedFunction<any>;
const mockRm = (fsModule as any).__rm as jest.MockedFunction<any>;
const mockReaddir = (fsModule as any).__readdir as jest.MockedFunction<any>;

const mockRepo = { findOne: jest.fn(), save: jest.fn() };

function makeMsg(o: Record<string, string> = {}) {
  return {
    jobId: 'j1', userId: 'u1',
    videoUrl: 'https://bkt.s3.amazonaws.com/u1/v.mp4',
    filename: 'v.mp4', timestamp: '2024-01-01T00:00:00Z', ...o,
  };
}
function makeChan() { return { sendToQueue: jest.fn().mockResolvedValue(true) }; }
function makeReadable() {
  const r = new Readable({ read() {} });
  setImmediate(() => r.push(null));
  return r;
}

function setupHappyFfmpeg() {
  const handlers: Record<string, Function> = {};
  const inst = {
    outputOptions: jest.fn().mockReturnThis(),
    output: jest.fn().mockReturnThis(),
    on: jest.fn().mockImplementation((ev: string, fn: Function) => { handlers[ev] = fn; return inst; }),
    run: jest.fn().mockImplementation(() => {
      setImmediate(() => handlers['end'] && handlers['end']());
    }),
  };
  mockFfmpeg.mockReturnValue(inst as any);
}

function setupHappyArchiver() {
  let pipedOutput: NodeJS.WritableStream | undefined;
  const arch = {
    pipe: jest.fn().mockImplementation((dest: NodeJS.WritableStream) => { pipedOutput = dest; return arch; }),
    directory: jest.fn().mockReturnThis(),
    on: jest.fn().mockReturnThis(),
    finalize: jest.fn().mockImplementation(() => {
      // End the output stream so it emits 'close', matching what processor.ts awaits
      setImmediate(() => pipedOutput && (pipedOutput as any).end());
    }),
  };
  mockArchiver.mockReturnValue(arch as any);
}

function setupHappyPath() {
  mockS3Send
    .mockResolvedValueOnce({ Body: makeReadable() })
    .mockResolvedValue({});
  mockGetSignedUrl.mockResolvedValue('https://signed.url/r.zip' as any);
  mockFfprobe.mockImplementation((_p: string, cb: Function) =>
    cb(null, { streams: [{ codec_type: 'video' }] })
  );
  setupHappyFfmpeg();
  setupHappyArchiver();
  mockReaddir.mockResolvedValue(['f1.png', 'f2.png', 'f3.png']);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetRepository.mockReturnValue(mockRepo);
  mockRepo.findOne.mockResolvedValue({ jobId: 'j1', status: 'pending' });
  mockRepo.save.mockResolvedValue({});
  // Reset readdir to default 3 frames
  mockReaddir.mockResolvedValue(['f1.png', 'f2.png', 'f3.png']);
});

// ─── success ──────────────────────────────────────────────────────────────────
describe('processVideoJob — success', () => {
  it('sets job status to completed', async () => {
    setupHappyPath();
    await processVideoJob(makeMsg() as any, makeChan() as any, 'events');
    const last = mockRepo.save.mock.calls[mockRepo.save.mock.calls.length - 1][0];
    expect(last.status).toBe('completed');
  });

  it('records frame count', async () => {
    setupHappyPath();
    await processVideoJob(makeMsg() as any, makeChan() as any, 'events');
    expect(metrics.incrementFramesExtracted).toHaveBeenCalledWith(3);
  });

  it('records processing duration', async () => {
    setupHappyPath();
    await processVideoJob(makeMsg() as any, makeChan() as any, 'events');
    expect(metrics.recordProcessingDuration).toHaveBeenCalledWith(expect.any(Number));
  });

  it('publishes completed event', async () => {
    setupHappyPath();
    const ch = makeChan();
    await processVideoJob(makeMsg() as any, ch as any, 'events');
    const p = JSON.parse((ch.sendToQueue.mock.calls[0][1] as Buffer).toString());
    expect(p.type).toBe('video.processing.completed');
    expect(p.resultUrl).toBe('https://signed.url/r.zip');
  });

  it('cleans up work dir', async () => {
    setupHappyPath();
    await processVideoJob(makeMsg() as any, makeChan() as any, 'events');
    expect(mockRm).toHaveBeenCalledWith(expect.stringContaining('j1'), expect.any(Object));
  });
});

// ─── errors ───────────────────────────────────────────────────────────────────
describe('processVideoJob — errors', () => {
  it('throws when job not found', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    await expect(processVideoJob(makeMsg() as any, makeChan() as any, 'ev'))
      .rejects.toThrow('Job j1 not found');
  });

  it('throws when S3 body is null', async () => {
    mockS3Send.mockResolvedValue({ Body: null });
    await expect(processVideoJob(makeMsg() as any, makeChan() as any, 'ev'))
      .rejects.toThrow('Failed to download video: empty response');
  });

  it('publishes failed event on S3 error', async () => {
    mockS3Send.mockRejectedValue(new Error('S3 down'));
    const ch = makeChan();
    await expect(processVideoJob(makeMsg() as any, ch as any, 'events'))
      .rejects.toThrow('S3 down');
    const p = JSON.parse((ch.sendToQueue.mock.calls[0][1] as Buffer).toString());
    expect(p.type).toBe('video.processing.failed');
  });

  it('increments failed metric on error', async () => {
    mockS3Send.mockRejectedValue(new Error('err'));
    await expect(processVideoJob(makeMsg() as any, makeChan() as any, 'ev')).rejects.toThrow();
    expect(metrics.incrementFailed).toHaveBeenCalled();
  });

  it('throws when no video stream found', async () => {
    mockS3Send.mockResolvedValue({ Body: makeReadable() });
    mockFfprobe.mockImplementation((_p: string, cb: Function) =>
      cb(null, { streams: [{ codec_type: 'audio' }] })
    );
    await expect(processVideoJob(makeMsg() as any, makeChan() as any, 'ev'))
      .rejects.toThrow('No video stream found in file');
  });

  it('throws when ffprobe errors', async () => {
    mockS3Send.mockResolvedValue({ Body: makeReadable() });
    mockFfprobe.mockImplementation((_p: string, cb: Function) =>
      cb(new Error('bad'), null)
    );
    await expect(processVideoJob(makeMsg() as any, makeChan() as any, 'ev'))
      .rejects.toThrow('Video validation failed');
  });

  it('throws when streams is empty', async () => {
    mockS3Send.mockResolvedValue({ Body: makeReadable() });
    mockFfprobe.mockImplementation((_p: string, cb: Function) =>
      cb(null, { streams: [] })
    );
    await expect(processVideoJob(makeMsg() as any, makeChan() as any, 'ev'))
      .rejects.toThrow('Video file is corrupted or empty');
  });
});
