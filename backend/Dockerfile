# ─────────────────────────────────────────────────────────────
#  SafyEdu Backend — Multi-Stage Production Dockerfile
#  Base: node:22-alpine (minimal attack surface, ~50 MB base)
#
#  Stages:
#   1. deps     — Install ALL npm deps (including devDeps for build)
#   2. builder  — Compile TypeScript, generate Prisma client
#   3. production — Copy only runtime artifacts (no src, no devDeps)
# ─────────────────────────────────────────────────────────────

# ── Stage 1: Install dependencies ────────────────────────────
FROM node:22-alpine AS deps

# Install OS libs required by Prisma and native addons
RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

COPY package.json package-lock.json ./
# Install ALL dependencies (including devDeps — needed for tsc)
RUN npm ci --legacy-peer-deps

# ── Stage 2: Build ────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

# Copy installed node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source and config
COPY . .

# Generate Prisma client (reads schema.prisma)
RUN npx prisma generate

# Compile TypeScript
RUN npm run build

# ── Stage 3: Production runner ────────────────────────────────
FROM node:22-alpine AS production

RUN apk add --no-cache libc6-compat openssl dumb-init

# Run as non-root user for security
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nestjs

WORKDIR /app

# Copy compiled output
COPY --from=builder --chown=nestjs:nodejs /app/dist       ./dist
# Copy Prisma schema + generated client (needed at runtime)
COPY --from=builder --chown=nestjs:nodejs /app/prisma     ./prisma
COPY --from=builder --chown=nestjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nestjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

# Install ONLY production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

USER nestjs

EXPOSE 3000

ENV NODE_ENV=production

# dumb-init: proper PID 1 signal handling for graceful shutdown
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
