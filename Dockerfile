# Use Node.js 20 LTS as base image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile --production=false

# Copy source code
COPY . .

# Build the application
RUN yarn build && \
    yarn install --frozen-lockfile --production=true && \
    yarn cache clean

# Default command - run the auto signing tool
CMD ["bin/signing-tool", "auto"]