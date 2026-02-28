FROM node:20-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Dependencies
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Builder
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# Runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Default upload configuration
ENV UPLOAD_MAX_SIZE=10485760
ENV STORAGE_TYPE=local

# PostgreSQL client for migration execution
RUN apk add --no-cache postgresql16-client

# Increase file descriptor limits for many concurrent SSE connections
# Default is typically 1024, increase to support 10k+ concurrent connections
# Note: Alpine Linux doesn't have /etc/security/limits.conf, limits are set at runtime

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Upload directory (use Railway volumes for persistence)
RUN mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads

# SQL migrations for auto-execution
COPY --chown=nextjs:nodejs sql/ ./sql/

# Startup script for migrations + server
COPY --chown=nextjs:nodejs scripts/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs
EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
