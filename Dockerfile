# Use Node.js 18.20.2 as base image
FROM node:18.20.2-alpine

# Set working directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN yarn build

# Default command - run the auto signing tool
CMD ["bin/signing-tool", "auto"]