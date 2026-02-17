# Build stage
FROM node:20-alpine AS builder

# Install FFmpeg
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Copy shared contracts first
COPY frameforge-shared-contracts/package*.json ./shared-contracts/
COPY frameforge-shared-contracts/tsconfig.json ./shared-contracts/
COPY frameforge-shared-contracts/src ./shared-contracts/src/

# Build shared contracts
WORKDIR /app/shared-contracts
RUN npm ci && npm run build

# Copy video-processor files
WORKDIR /app/video-processor
COPY frameforge-video-processor/package*.json ./
RUN npm ci

COPY frameforge-video-processor/src ./src/
COPY frameforge-video-processor/tsconfig.json ./
RUN npm run build

# Production stage
FROM node:20-alpine

# Install FFmpeg and tini
RUN apk add --no-cache ffmpeg tini

# Set up shared contracts directory
WORKDIR /app/shared-contracts
COPY --from=builder /app/shared-contracts/package*.json ./
COPY --from=builder /app/shared-contracts/dist ./dist/

# Set up video-processor directory
WORKDIR /app/video-processor
COPY frameforge-video-processor/package*.json ./
RUN npm ci --only=production && \
    npm cache clean --force

COPY --from=builder /app/video-processor/dist ./dist

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    mkdir -p /tmp/frameforge && \
    chown -R nodejs:nodejs /tmp/frameforge

USER nodejs

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "process.exit(0)"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
