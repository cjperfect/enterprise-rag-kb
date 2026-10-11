# ===== Backend (NestJS) Dockerfile =====
# Multi-stage：build 阶段装依赖、编译；runtime 阶段只拷产物
#
# 构建上下文必须是 monorepo 根（docker build -f apps/backend/Dockerfile .），
# 因为 backend 通过 workspace 引用 @langchain-rag/shared 和 @langchain-rag/ai-engine。

# ---- Stage 1: 依赖 + 编译 ----
FROM node:20-slim AS builder

# prisma 需要 openssl
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# pnpm（与 package.json 的 packageManager 版本对齐）
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# 先拷 workspace 配置和 lockfile，利用 Docker 层缓存
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/ai-engine/package.json packages/ai-engine/
COPY apps/backend/package.json apps/backend/

# 装依赖（含 workspace 链接）
RUN pnpm install --frozen-lockfile

# 拷源码
COPY packages/shared packages/shared
COPY packages/ai-engine packages/ai-engine
COPY apps/backend apps/backend

# build：shared → ai-engine → backend（顺序不能乱）
RUN pnpm --filter @langchain-rag/shared build \
 && pnpm --filter @langchain-rag/ai-engine build \
 && pnpm --filter backend build

# ---- Stage 2: 运行时 ----
FROM node:20-slim AS runtime

RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app

# 从 builder 拷运行时需要的产物
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/ai-engine/dist ./packages/ai-engine/dist
COPY --from=builder /app/packages/ai-engine/package.json ./packages/ai-engine/
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/apps/backend/package.json ./apps/backend/
COPY --from=builder /app/apps/backend/prisma ./apps/backend/prisma

WORKDIR /app/apps/backend

EXPOSE 3001

# 先 generate prisma client 再启动（镜像内不依赖宿主机 node_modules）
CMD ["sh", "-c", "npx prisma generate && node dist/main"]
