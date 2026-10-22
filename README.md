# 产研 RAG 知识库系统

企业内部产品手册与 FAQ 分散存储，员工在产品参数核对、使用指导及常见问题处理时，需要人工查找多份资料。本项目通过统一检索与智能问答，帮助员工快速获取有来源依据的产品信息，减少重复查阅，并统一答复口径。

## 技术栈

| 模块     | 技术                                                              |
| -------- | ----------------------------------------------------------------- |
| 前端     | Next.js 16 (Turbopack) + React 19 + Tailwind CSS 4 + assistant-ui |
| 后端     | NestJS 11 + Prisma 7 + SSE + RxJS                                 |
| Agent 层 | Pi Agent（JSONL 分支会话、结构化事件流、自定义工具定义）          |
| 检索原语 | LangChain.js（PGVectorStore / RecursiveCharacterTextSplitter）    |
| 模型层   | 火山方舟（豆包 LLM + Doubao Embedding）                           |
| 重排     | BGE Reranker（Cross-encoder 精排）                                |
| 数据库   | PostgreSQL 17 + pgvector + Elasticsearch 8                        |
| 文档解析 | pdf-parse + Unstructured + 百度 OCR + MuPDF + 多模态描述          |
| 评测     | Ragas (LLM-as-judge) + 自建 Golden QA 评测集                      |
| 构建工具 | pnpm workspace + tsup + ESLint + Prettier                         |

## 核心亮点

### 模块化架构与进度反馈

基于 pnpm Monorepo 拆分前端、服务端、AI 引擎及共享模块，核心 AI 逻辑独立成包、可独立测试。文档处理进度通过 SSE + RxJS 推送到前端，处理事件与 UI 展示解耦，解析/切片/向量化各阶段实时可见。

### 多形态文档解析

- **文本层探测**：pdf-parse 逐页检测 PDF 是否含文本层，原生文本 PDF 与扫描件分别路由
- **原生 PDF**：Unstructured 解析，保留标题层级、列表、表格结构
- **扫描件**：百度 OCR 兜底，本地解析失败时自动回退
- **表格保护**：GFM 表格整块切片，不拆散参数表
- **图表处理**：MuPDF 裁剪流程图/架构图，多模态模型生成语义描述后入索引

### 混合检索与重排

PGVector 语义检索 + Elasticsearch BM25 关键词检索，RRF（k=60）融合候选结果，再用 BGE Reranker 精排 top-20 → top-5。兼顾语义查询与产品型号、参数、故障码等精确匹配需求。

### 答案溯源与生成约束

回答关联来源文档及引用片段，用户可核查产品参数与操作依据。针对知识库未覆盖的问题，系统返回"资料不足"提示并引导用户澄清，而非编造答案。

### 分支树会话

基于 Pi Agent 的 JSONL 分支会话模型，支持任意历史消息开分支、编辑重答、切换分支，适配员工"改个问题看不同回答"的交互场景。

### 双层自动化评测

- **检索层**：基于 JSON 格式的标准评测集，用 Recall@k、MRR、nDCG 评估检索质量
- **生成层**：接入 Ragas，用 LLM-as-judge 评估 Faithfulness、Answer Relevancy、Context Precision、Context Recall
- **解耦设计**：评测逻辑与知识库配置解耦（kbIds 参数化），支持不同知识库及调参后的回归验证

## 检索效果（基于 95 题 Golden 集）

| 指标     | 纯向量检索 | 混合检索（向量+BM25 RRF） | 提升   |
| -------- | ---------- | ------------------------- | ------ |
| Recall@5 | 0.57       | **0.70**                  | +12.7% |
| MRR      | 0.28       | **0.34**                  | +0.06  |
| nDCG     | 0.35       | **0.43**                  | +0.08  |

> 评测集覆盖 20 款产品手册、95 道标注问题，含表格/流程图/陷阱题多类型。

## 功能

### 知识库管理 (`/knowledge`)

- 知识库 CRUD，多知识库隔离
- 文档上传（PDF/Markdown），自动解析、切片、向量化、双路索引
- 解析进度实时推送（SSE），失败状态记录与手动重试
- 文档预览：原文、切片列表、解析结果
- 三栏布局：知识库列表 / 文档详情 / AI 问答

### 主聊天 (`/`)

- @ 提及多知识库问答
- 分支树会话：任意消息开分支、编辑重答、切换分支
- 结构化流式输出：token / 思考过程 / 检索工具调用分阶段渲染
- 答案溯源：引用来源片段可点击跳转原文
- 未命中防御：知识库无覆盖时返回"资料不足"，不编造

## 项目结构

```
enterprise-rag-kb/
├── apps/
│   ├── backend/          # NestJS API 服务 (端口 3001)
│   └── frontend/          # Next.js 前端应用 (端口 3000)
├── packages/
│   ├── ai-engine/        # RAG 引擎（混合检索 / Agent / 工具 / 文档解析 / Rerank）
│   └── shared/           # 共享类型
├── eval/
│   ├── golden/           # Golden QA 评测集
│   ├── ragas/            # Ragas 评测管线（collect + score）
│   ├── reports/          # 评测报告
│   └── config.json       # 评测配置
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
# PostgreSQL (pgvector) + Elasticsearch (smartcn 中文分词)
docker compose -f docker/docker-compose.yml up -d
```

默认端口：PostgreSQL `5432`、Elasticsearch `9200`。如本地端口冲突，修改 `docker/docker-compose.yml` 里的端口映射即可。

### 4. 初始化数据库

```bash
pnpm db:generate     # 生成 Prisma 类型
pnpm db:migrate      # 创建表
pnpm db:seed         # 写入种子数据
```

### 5. 启动开发

```bash
pnpm dev:ai-engine   # 监听 ai-engine 包变化
pnpm dev:backend     # NestJS (3001)
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
