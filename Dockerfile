# Build stage
FROM node:20-alpine AS builder

# Install FFmpeg
RUN apk add --no-cache ffmpeg

WORKDIR /build

# Copy and build shared contracts first
COPY frameforge-shared-contracts/package*.json ./frameforge-shared-contracts/
COPY frameforge-shared-contracts/tsconfig.json ./frameforge-shared-contracts/
COPY frameforge-shared-contracts/src ./frameforge-shared-contracts/src/

WORKDIR /build/frameforge-shared-contracts
RUN npm install && npm run build

# Copy video-processor files
WORKDIR /build/frameforge-video-processor
COPY frameforge-video-processor/package*.json ./
COPY frameforge-video-processor/tsconfig.json ./
RUN npm install

COPY frameforge-video-processor/src ./src/
RUN npm run build

# Production stage
FROM node:20-alpine

# Install FFmpeg and tini
RUN apk add --no-cache ffmpeg tini

WORKDIR /app

# Copy built shared contracts
COPY --from=builder /build/frameforge-shared-contracts/package*.json ./frameforge-shared-contracts/
COPY --from=builder /build/frameforge-shared-contracts/dist ./frameforge-shared-contracts/dist/
COPY --from=builder /build/frameforge-shared-contracts/node_modules ./frameforge-shared-contracts/node_modules/

# Set up video-processor directory
WORKDIR /app/frameforge-video-processor
COPY frameforge-video-processor/package*.json ./
RUN npm install --only=production && \
    npm cache clean --force

COPY --from=builder /build/frameforge-video-processor/dist ./dist

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    mkdir -p /tmp/frameforge && \
    chown -R nodejs:nodejs /tmp/frameforge

USER nodejs

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "process.exit(0)"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
