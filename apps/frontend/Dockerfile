# ===== Frontend (Next.js) Dockerfile =====
# 前提：next.config 里加 output: "standalone"（Next 推荐的容器化方式）

FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/frontend/package.json apps/frontend/

RUN pnpm install --frozen-lockfile --filter frontend...

COPY apps/frontend apps/frontend

# 构建时通过环境变量指定后端地址（容器内是服务名 backend，不是 localhost）
ARG BACKEND_URL=http://backend:3001
ENV BACKEND_URL=$BACKEND_URL

RUN pnpm --filter frontend build

# ---- 运行时 ----
FROM node:20-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

# standalone 产物自带最小 node_modules
COPY --from=builder /app/apps/frontend/.next/standalone ./
COPY --from=builder /app/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=builder /app/apps/frontend/public ./apps/frontend/public

EXPOSE 3000

CMD ["node", "apps/frontend/server.js"]
