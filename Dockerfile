# Build stage
FROM node:20-alpine AS builder

# Install FFmpeg
RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine

# Install FFmpeg and tini
RUN apk add --no-cache ffmpeg tini

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production && \
    npm cache clean --force

COPY --from=builder /app/dist ./dist

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    mkdir -p /tmp/frameforge && \
    chown -R nodejs:nodejs /tmp/frameforge

USER nodejs

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "process.exit(0)"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
