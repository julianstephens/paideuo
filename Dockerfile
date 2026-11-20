# syntax=docker/dockerfile:1

FROM node:24-slim AS frontend
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install --global "$(node -p 'require("./package.json").packageManager')"
RUN --mount=type=cache,id=paideuo-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
COPY docs/examples ./docs/examples
# The preceding install already verified the lockfile.
RUN pnpm_config_verify_deps_before_run=false pnpm run build

FROM nginx:stable-alpine
RUN apk add --no-cache ca-certificates
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1 \
    NGINX_ENVSUBST_FILTER="^(POCKETBASE_URL|NGINX_LOCAL_RESOLVERS)$"
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=frontend /app/dist/ /usr/share/nginx/html/
EXPOSE 80
