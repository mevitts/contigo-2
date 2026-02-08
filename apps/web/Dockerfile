# Use Node.js 20 Alpine as base image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package.json
COPY package.json ./

# Install dependencies using npm
RUN npm install

# Copy all application files
COPY . .

# Run as non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /app
USER appuser

# Expose Vite's default port
EXPOSE 5173

# Run development server (--host 0.0.0.0 allows external connections)
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
