
FROM node:24-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./


RUN npm install

# Copy source code
COPY . .

# Create necessary directories
RUN mkdir -p config lib api server

# Expose ports
EXPOSE 5354/udp
EXPOSE 8053

# Start the server
CMD ["npm", "start"]
