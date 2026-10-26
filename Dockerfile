# ==========================================
# SchoolBite - Multi-stage Dockerfile
# Optimized for Next.js 16 Standalone + Prisma PostgreSQL
# ==========================================

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# Step 1: Install dependencies
FROM base AS deps
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

# Step 2: Build the application
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# Step 3: Production runner image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV DATABASE_URL=""
ENV PATH="/app/node_modules/.bin:$PATH"

# Copy standalone Next.js server and static assets
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy Prisma schema and engines
COPY --from=builder /app/prisma ./prisma
COPY --from=deps /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=deps /app/node_modules/prisma ./node_modules/prisma
COPY --from=deps /app/node_modules/.bin ./node_modules/.bin

# Copy entrypoint script
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN tr -d '\r' < ./docker-entrypoint.sh > ./docker-entrypoint-clean.sh && \
    mv ./docker-entrypoint-clean.sh ./docker-entrypoint.sh && \
    chmod +x ./docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
