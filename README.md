# 企业 RAG 知识库

面向企业内部产品手册与售后 FAQ 的智能问答系统。基于 **Pi Agent（Agent 层）+ LangChain.js（检索原语）**、**pgvector + Elasticsearch 混合检索**、**火山方舟（豆包 LLM + Doubao Embedding）**，并配套 **Golden QA + Ragas 双层评测体系**。

## 核心特性

- **混合检索**：向量语义检索（pgvector）+ BM25 关键词检索（Elasticsearch），RRF 融合排序
- **分支树会话**：基于 Pi Agent 的 JSONL 分支会话，支持任意历史节点开分支、编辑消息重答
- **文档解析**：PDF 版面分析、表格整体保留切片、扫描页 OCR 兜底
- **模型层**：LLM 与 Embedding 均接入火山方舟（豆包大模型 + Doubao Embedding）
- **双层评测**：检索层（Recall@k / MRR / nDCG）+ 生成层（Ragas Faithfulness / Answer Relevancy）

## 技术栈

| 模块     | 技术                                                                          |
| -------- | ----------------------------------------------------------------------------- |
| 前端     | Next.js 16 (Turbopack) + React 19 + Tailwind CSS 4 + assistant-ui              |
| 后端     | NestJS 11 + Prisma 7                                                          |
| AI 引擎  | Agent 层：Pi Agent；检索原语：LangChain.js（PGVectorStore / TextSplitter）；模型：火山方舟（豆包 LLM + Doubao Embedding） |
| 评测     | Ragas (LLM-as-judge) + 自建 Golden QA 评测集                                   |
| 数据库   | PostgreSQL 17 + pgvector                                                      |
| 构建工具 | pnpm workspace + tsup + oxlint/oxfmt                                          |

## 检索效果（基于 95 题 Golden 集）

| 指标       | 纯向量检索 | 混合检索（向量+BM25 RRF） | 提升   |
| ---------- | ---------- | ------------------------- | ------ |
| Recall@5   | 0.57       | **0.70**                  | +12.7% |
| MRR        | 0.28       | **0.34**                  | +0.06  |
| nDCG       | 0.35       | **0.43**                  | +0.08  |

## 功能

### 知识库管理 (`/knowledge`)

- **知识库 CRUD**：创建、编辑、删除知识库，多知识库隔离
- **文档管理**：上传 PDF/Markdown，自动解析、切片、向量化、双路索引
- **文档预览**：查看解析结果、切片列表、原文内容
- **索引管理**：单文档粒度重建（先删后建），失败状态记录与重试
- **三栏布局**：知识库列表 / 文档详情 / AI 问答

### 主聊天 (`/`)

- **多知识库问答**：@ 提及选择一个或多个知识库
- **分支树会话**：任意历史消息开分支、编辑重答、切换分支
- **结构化流式输出**：token / 思考过程 / 检索工具调用分阶段渲染
- **会话持久化**：JSONL 落盘，重启可恢复完整对话树

### 评测体系 (`eval/`)

- **Golden QA 评测集**：95 道标注题，覆盖 20 款产品、表格/流程图/陷阱题
- **检索层对比**：`compare.cjs` 跑纯向量 vs 混合检索，输出 Recall/MRR/nDCG
- **生成层评测**：`collect.cjs` + `score.py` 接入 Ragas，计算 Faithfulness / Answer Relevancy / Context Precision / Context Recall
- **解耦设计**：评测逻辑与知识库配置解耦（kbIds 参数化），跨知识库复用

## 项目结构

```
enterprise-rag-kb/
├── apps/
│   ├── backend/          # NestJS API 服务 (端口 3001)
│   └── frontend/         # Next.js 前端应用 (端口 3000)
├── packages/
│   ├── ai-engine/        # RAG 引擎（混合检索 / Agent / 工具 / 文档解析）
│   └── shared/           # 共享类型
├── eval/
│   ├── golden/           # Golden QA 评测集
│   ├── ragas/            # Ragas 评测管线（collect + score）
│   ├── reports/          # 评测报告
│   └── config.json      # 评测配置
├── docker/
│   └── docker-compose.yml  # PostgreSQL + pgvector
└── pnpm-workspace.yaml
```

## 前置环境

- Node.js >= 20
- pnpm >= 9
- Docker（用于运行 PostgreSQL / Elasticsearch）
- 火山方舟 API Key（[申请地址](https://www.volcengine.com/ark)，需开通豆包大模型与 Doubao Embedding）

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 环境变量配置

**apps/backend/.env**

```env
DATABASE_URL=postgresql://root:chenjiang@localhost:5433/langchain_rag
ES_URL=http://localhost:9200
LLM_PROVIDER=ark
ARK_API_KEY=your-ark-api-key
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
EMBEDDING_PROVIDER=ark
EMBEDDING_MODEL=doubao-embedding-text-240715
JWT_SECRET=your-jwt-secret
```

### 3. 启动依赖服务

```bash
# PostgreSQL（5433，避免与本地 5432 冲突）
docker compose -f docker/docker-compose.yml up -d

# Elasticsearch（9200）
docker run -d --name rag-elasticsearch -p 9200:9200 \
  -e "discovery.type=single-node" -e "xpack.security.enabled=false" \
  docker.elastic.co/elasticsearch/elasticsearch:8.11.0
```

### 4. 初始化数据库

```bash
pnpm db:generate     # 生成 Prisma 类型
pnpm db:migrate      # 创建表
pnpm db:seed         # 写入种子数据
```

### 5. 启动开发

```bash
pnpm dev:ai-engine   # 监听 ai-engine 包变化
pnpm dev:backend    # NestJS (3001)
pnpm dev:frontend    # Next.js (3000)
```

### 6. 跑评测（可选）

```bash
# 检索层对比（纯向量 vs 混合）
node eval/ragas/compare.cjs

# 生成层 Ragas 评测
cd eval/ragas && uv run python score.py
```

访问：

- 前端：http://localhost:3000
- 后端 API：http://localhost:3001

## 可靠性与评测

回归测试、集成测试、评测指标说明见 [docs/reliability-and-evaluation.md](docs/reliability-and-evaluation.md)。
