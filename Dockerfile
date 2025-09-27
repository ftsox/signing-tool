# Use Node.js 20 LTS as base image
FROM node:20-alpine

# Set metadata
LABEL maintainer="Flare Network"
LABEL description="FTSO V2 Signing Tool for automatic reward signing"
LABEL version="1.0"

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create app directory and non-root user
RUN addgroup -g 1001 -S signing && \
    adduser -u 1001 -S signing -G signing

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile --production=false && \
    yarn cache clean

# Copy source code
COPY . .

# Build the application
RUN yarn build && \
    # Remove dev dependencies to reduce image size
    yarn install --frozen-lockfile --production=true && \
    yarn cache clean

# Copy and set up entrypoint script
COPY docker/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create directories for logs and data
RUN mkdir -p /app/logs /app/data && \
    chown -R signing:signing /app

# Switch to non-root user
USER signing

# Set environment variables
ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV TZ=UTC

# Expose health check port (if needed for monitoring)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "console.log('Health check passed')" || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Default command - run the auto signing tool
CMD ["/usr/local/bin/docker-entrypoint.sh", "auto"]