# FrameForge Video Processor

Worker service that processes videos by extracting frames.

## 🚀 Features

- **Video Frame Extraction** - Extract frames from video files using FFmpeg
- **S3 Integration** - Download from and upload to S3 buckets
- **RabbitMQ Consumer** - Processes jobs from message queue
- **ZIP Creation** - Package extracted frames with manifest
- **Database Updates** - Track job status and results
- **Prometheus Metrics** - Processing performance monitoring

## 🔧 Environment Variables

Create a `.env` file:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/frameforge
RABBITMQ_URL=amqp://user:pass@localhost:5672
S3_BUCKET=frameforge-videos
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
TEMP_DIR=/tmp/frameforge
FPS=1
NODE_ENV=development
```

## 💻 Development

```bash
# Install dependencies
npm install

# Requires FFmpeg
# Ubuntu/Debian: sudo apt-get install ffmpeg
# macOS: brew install ffmpeg
# Windows: Download from https://ffmpeg.org/

# Run in development mode
npm run dev

# Build
npm run build

# Start production
npm start
```

## 📦 Dependencies

- FFmpeg for video processing
- RabbitMQ for job queue
- AWS SDK for S3 operations
- TypeORM for database
- Archiver for ZIP creation

---

**Part of the FrameForge microservices ecosystem**
