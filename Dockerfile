# Stage 1: Build the React frontend
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY app/package.json ./app/
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build --workspace app

# Stage 2: Production runner
FROM node:22-alpine AS runner
WORKDIR /app
COPY package*.json ./
COPY app/package.json ./app/
RUN npm ci --omit=dev --ignore-scripts
COPY app/server/ ./app/server/
COPY --from=builder /app/app/dist ./app/dist
RUN SKIP_GEOIP_DOWNLOAD=false node app/server/scripts/download-geoip.js
EXPOSE 4000
ENV NODE_ENV=production
ENV API_PORT=4000
CMD ["node", "app/server/index.js"]
