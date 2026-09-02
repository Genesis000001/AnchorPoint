# =============================================================================
# Stage 1: builder — Node.js build environment (never ships to production)
# =============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace-level dependency manifests to enable layer-cache reuse.
# These layers are only invalidated when package*.json files change.
COPY package.json package-lock.json ./

# Copy dashboard package.json so the workspace install resolves it correctly.
COPY dashboard/package.json ./dashboard/package.json

# Install all workspace dependencies (including devDependencies for the build).
RUN npm ci --ignore-scripts

# Copy dashboard source code after the install layer so changes to source
# do not invalidate the dependency layer.
COPY dashboard/ ./dashboard/

# Compile TypeScript and bundle assets via Vite.
# Output lands in dashboard/dist/.
RUN npm run build -w dashboard

# =============================================================================
# Stage 2: runner — nginx serves only the pre-built static assets
# =============================================================================
FROM nginx:1.27-alpine AS runner

# Remove the default placeholder HTML shipped with nginx.
RUN rm -rf /usr/share/nginx/html/*

# Custom nginx site configuration (SPA routing, CORS headers, compression, etc.)
COPY dashboard/nginx.conf /etc/nginx/conf.d/default.conf

# Copy compiled static assets from the builder stage.
# The Node.js toolchain and all node_modules are left behind — they never
# enter this image.
COPY --from=builder /app/dashboard/dist /usr/share/nginx/html

# Ensure the nginx worker process can read the static files.
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chmod -R 755 /usr/share/nginx/html

# nginx:alpine already drops privileges to the 'nginx' user by default.

EXPOSE 80

# Lightweight health-check that validates nginx is up and serving the SPA.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
