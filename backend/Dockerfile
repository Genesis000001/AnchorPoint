# =============================================================================
# Stage 1: builder — installs ALL dependencies and compiles TypeScript
# =============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests first to maximise layer-cache reuse.
# These layers are only invalidated when package*.json files change.
COPY package.json package-lock.json ./

# Install all dependencies including devDependencies needed for the build step.
RUN npm ci --ignore-scripts

# Copy application source after dependencies to keep the install layer cached.
COPY . .

# Compile TypeScript → dist/ and generate Prisma client artefacts.
RUN npm run build && npx prisma generate

# Prune down to production-only node_modules in place so we can copy them
# cleanly to the runtime stage. Clearing the npm cache shrinks this layer.
RUN npm prune --omit=dev && npm cache clean --force

# =============================================================================
# Stage 2: runner — minimal production image with no build toolchain
# =============================================================================
FROM node:20-alpine AS runner

# Runtime utilities:
#   dumb-init  — proper PID-1 signal handling and zombie-process reaping
#   wget       — lightweight health-check probe (no curl needed)
RUN apk add --no-cache dumb-init wget

WORKDIR /app

ENV NODE_ENV=production

# Copy only the artefacts needed at runtime from the builder stage.
# Nothing from the build toolchain (TypeScript compiler, devDependencies, etc.)
# ever enters this image.
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules  ./node_modules
COPY --from=builder /app/dist          ./dist
COPY --from=builder /app/prisma        ./prisma

# Run as the unprivileged 'node' user supplied by the official Node image.
USER node

# Backend API port
EXPOSE 3002

# Orchestrator health-check (docker-compose, k8s liveness probe, etc.)
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3002/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
