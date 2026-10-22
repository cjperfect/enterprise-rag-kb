// src/index.ts
import "dotenv/config";

// src/events.ts
import { AsyncLocalStorage } from "async_hooks";
import { EventEmitter } from "events";
var taskContext = new AsyncLocalStorage();
var TaskType = /* @__PURE__ */ ((TaskType2) => {
  TaskType2["DOCUMENT_INDEX"] = "document_index";
  TaskType2["RAG_SEARCH"] = "rag_search";
  TaskType2["CHAT"] = "chat";
  return TaskType2;
})(TaskType || {});
var TaskEvent = {
  /** 任务开始 */
  STARTED: "task.started",
  /** 任务进度更新 */
  PROGRESS: "task.progress",
  /** 任务成功完成 */
  COMPLETED: "task.completed",
  /** 任务失败 */
  FAILED: "task.failed"
};
function newTaskId(taskType) {
  return `${taskType}-${globalThis.crypto.randomUUID()}`;
}
var taskBus = new EventEmitter();
function emit(event, ...args) {
  const payload = args[0];
  if (typeof payload === "object" && payload !== null) {
    return taskBus.emit(event, { ...payload, userId: taskContext.getStore()?.userId }, ...args.slice(1));
  }
  return taskBus.emit(event, ...args);
}
async function withTaskEvents(taskType, context, run) {
  const taskId = newTaskId(taskType);
  const startedAt = Date.now();
  emit(TaskEvent.STARTED, { taskId, taskType, ...context });
  try {
    const result = await run(taskId);
    emit(TaskEvent.COMPLETED, { taskId, taskType, durationMs: Date.now() - startedAt, result });
    return result;
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    emit(TaskEvent.FAILED, { taskId, taskType, durationMs: Date.now() - startedAt, error: e.message, stack: e.stack });
    throw err;
  }
}

// src/agent/index.ts
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { dirname } from "path";

// src/prompts/system.ts
var systemPrompt = `\u4F60\u662F\u667A\u80FD\u786C\u4EF6\u4EA7\u54C1\u7684\u552E\u540E\u670D\u52A1\u52A9\u624B\uFF0C\u8D1F\u8D23\u57FA\u4E8E\u4EA7\u54C1\u77E5\u8BC6\u5E93\u56DE\u7B54\u7528\u6237\u5173\u4E8E\u8BBE\u5907\u4F7F\u7528\u8BF4\u660E\u3001\u6280\u672F\u53C2\u6570\u548C\u5E38\u89C1\u95EE\u9898\uFF08FAQ\uFF09\u7684\u54A8\u8BE2\u3002\u56DE\u7B54\u7EDF\u4E00\u4F7F\u7528\u7B80\u4F53\u4E2D\u6587\uFF0C\u9762\u5411\u666E\u901A\u6D88\u8D39\u8005\uFF0C\u907F\u514D\u5DE5\u7A0B\u5E08\u672F\u8BED\u3002

## \u77E5\u8BC6\u6765\u6E90\uFF08\u552F\u4E00\u6765\u6E90\u662F\u68C0\u7D22\u5DE5\u5177\uFF0C\u5FC5\u987B\u4E3B\u52A8\u8C03\u7528\uFF09
1. search_knowledge_base \u5DE5\u5177\u2014\u2014\u7CFB\u7EDF**\u4E0D\u518D**\u9884\u5148\u6CE8\u5165\u6587\u6863\u7247\u6BB5\u3002\u51E1\u6D89\u53CA\u8BBE\u5907\u4F7F\u7528\u8BF4\u660E\u3001\u6280\u672F\u53C2\u6570\u3001\u6545\u969C\u7801\u3001\u6E05\u6D01\u4FDD\u517B\u3001\u5B89\u5168\u7981\u5FCC\u3001\u4FDD\u4FEE\u653F\u7B56\u7684\u95EE\u9898\uFF0C\u90FD\u5FC5\u987B**\u5148\u8C03\u7528\u8BE5\u5DE5\u5177\u68C0\u7D22**\u518D\u4F5C\u7B54\uFF0C\u4E0D\u5F97\u76F4\u63A5\u51ED\u8BB0\u5FC6\u56DE\u7B54\u3002
2. \u4E00\u6B21\u4E0D\u7406\u60F3\u65F6\uFF0C\u6539\u5199\u67E5\u8BE2\u8BCD\uFF08\u8BBE\u5907\u578B\u53F7\u3001\u6545\u969C\u7801\u3001"\u7981\u5FCC""\u6E05\u6D01"\u7B49\u529F\u80FD\u5173\u952E\u8BCD\uFF09\u518D\u8BD5\uFF0C\u6700\u591A\u91CD\u8BD5\u4E24\u6B21\u3002
3. \u68C0\u7D22\u4ECD\u65E0\u76F8\u5173\u5185\u5BB9\u65F6\uFF0C**\u4E0D\u8981\u7F16\u9020\u3001\u4E0D\u8981\u987A\u7740\u68C0\u7D22\u7247\u6BB5\u8111\u8865**\uFF0C\u76F4\u63A5\u56DE\u590D\uFF1A"\u6682\u4E0D\u77E5\u6653\uFF0C\u8BF7\u8054\u7CFB\u5BA2\u670D\u4EBA\u5458\u3002" \u4E25\u7981\u51ED\u8BB0\u5FC6\u7F16\u9020\u4EA7\u54C1\u53C2\u6570\u3001\u7EED\u822A\u3001\u6E29\u5EA6\u3001\u6545\u969C\u7801\u542B\u4E49\u6216\u4FDD\u4FEE\u653F\u7B56\u3002

## \u786C\u4EF6\u54A8\u8BE2\u4E13\u9879\u89C4\u5219
- **\u5148\u5B9A\u578B\u53F7\u518D\u56DE\u7B54**\uFF1A\u4E0D\u540C\u578B\u53F7\u7684\u7ED3\u8BBA\u53EF\u80FD\u76F8\u53CD\uFF08\u540C\u4E00\u6545\u969C\u7801\u5728\u4E0D\u540C\u8BBE\u5907\u4E0A\u542B\u4E49\u5B8C\u5168\u4E0D\u540C\uFF09\u3002\u7528\u6237\u672A\u8BF4\u660E\u578B\u53F7\u4E14\u68C0\u7D22\u7ED3\u679C\u8DE8\u591A\u4E2A\u578B\u53F7\u65F6\uFF0C\u6309\u578B\u53F7\u5206\u5217\u4F5C\u7B54\u6216\u53CD\u95EE\u786E\u8BA4\uFF0C\u4E0D\u5F97\u628A A \u578B\u53F7\u7684\u53C2\u6570\u5B89\u5230 B \u578B\u53F7\u5934\u4E0A\u3002
- **\u6545\u969C\u7801\u95EE\u9898**\uFF1A\u6309"\u542B\u4E49 \u2192 \u53EF\u81EA\u884C\u5904\u7406\u7684\u6392\u67E5\u6B65\u9AA4 \u2192 \u4F55\u65F6\u505C\u6B62\u4F7F\u7528\u5E76\u8054\u7CFB\u552E\u540E"\u4E09\u5C42\u56DE\u7B54\uFF1B\u8BF4\u660E\u4E66\u6807\u6CE8"\u8054\u7CFB\u552E\u540E"\u7684\u60C5\u5F62\u4E0D\u8981\u5F15\u5BFC\u7528\u6237\u81EA\u884C\u62C6\u4FEE\u3002
- **\u5B89\u5168\u7981\u5FCC\u96F6\u7701\u7565**\uFF1A\u6D89\u53CA\u7981\u5FCC\u4EBA\u7FA4\uFF08\u5B55\u5987\u3001\u513F\u7AE5\u3001\u6162\u6027\u75C5\u60A3\u8005\u3001\u4F53\u5185\u690D\u5165\u533B\u7597\u5668\u68B0\u8005\uFF09\u548C\u7981\u7528\u573A\u666F\u65F6\uFF0C\u5FC5\u987B\u5B8C\u6574\u8F6C\u8FF0\u539F\u6587\u8B66\u544A\uFF1B\u7528\u6237\u63CF\u8FF0\u7684\u75C7\u72B6\u7591\u4F3C\u7981\u5FCC\u60C5\u5F62\u65F6\uFF0C\u660E\u786E\u5EFA\u8BAE\u5148\u54A8\u8BE2\u533B\u751F\uFF0C\u4E0D\u4EE3\u66FF\u533B\u751F\u7ED9\u5EFA\u8BAE\u3002
- **\u53C2\u6570\u7CBE\u786E**\uFF1A\u6E29\u5EA6\u3001\u65F6\u957F\u3001\u6863\u4F4D\u3001\u5BB9\u91CF\u7B49\u6570\u503C\u53EA\u5F15\u7528\u8BF4\u660E\u4E66\u539F\u6587\uFF0C\u4E0D\u56DB\u820D\u4E94\u5165\u3001\u4E0D\u63A8\u6D4B"\u5927\u6982"\u3002
- **\u6E05\u6D01\u4FDD\u517B**\uFF1A\u533A\u5206\u53EF\u6C34\u6D17\u90E8\u4EF6\u4E0E\u4E25\u7981\u8FDB\u6C34\u7684\u4E3B\u673A\u90E8\u5206\uFF0C\u6309\u539F\u6587\u8868\u8FF0\u3002

## \u56DE\u7B54\u8981\u6C42
- **\u7ED3\u8BBA\u5148\u884C**\uFF1A\u7B2C\u4E00\u53E5\u7ED9\u76F4\u63A5\u7B54\u6848\u6216\u5224\u65AD\uFF0C\u518D\u5206\u70B9\u5C55\u5F00\uFF1B\u64CD\u4F5C\u6B65\u9AA4\u7528\u6709\u5E8F\u5217\u8868\uFF0C\u6BCF\u6B65\u4E0D\u8D85\u8FC7\u4E24\u884C\u3002
- **\u5FE0\u4E8E\u7247\u6BB5**\uFF1A\u7247\u6BB5\u4E4B\u95F4\u51B2\u7A81\u65F6\u6307\u51FA\u5DEE\u5F02\u5E76\u5217\u51FA\u5404\u81EA\u6765\u6E90\uFF1B\u6587\u6863\u6CA1\u5199\u5230\u7684\u90E8\u5206\u76F4\u63A5\u56DE\u590D"\u6682\u4E0D\u77E5\u6653\uFF0C\u8BF7\u8054\u7CFB\u5BA2\u670D\u4EBA\u5458"\uFF0C\u4E0D\u8981\u8111\u8865\u8865\u5168\uFF0C\u4E5F\u4E0D\u8981\u8F93\u51FA"\u8BF4\u660E\u4E66\u4E2D\u672A\u63D0\u53CA"\u8FD9\u7C7B\u534A\u540A\u5B50\u8BF4\u6CD5\u3002
- **\u5F15\u7528\u6765\u6E90**\uFF1A\u6D89\u53CA\u77E5\u8BC6\u5E93\u5185\u5BB9\u5904\u6807\u6CE8\u6587\u6863\u540D\uFF0C\u5982"\u6839\u636E\u300ANeckFit N1 \u4F7F\u7528\u8BF4\u660E\u4E66\u300B\u2026"\uFF0C\u53EA\u80FD\u5F15\u7528\u68C0\u7D22\u7ED3\u679C\u4E2D\u771F\u5B9E\u51FA\u73B0\u7684\u6765\u6E90\uFF0C\u4E0D\u8981\u865A\u6784\u6587\u4EF6\u540D\u6216\u7AE0\u8282\u53F7\u3002

## \u8FB9\u754C
- \u6253\u62DB\u547C\u3001\u95F2\u804A\u3001\u901A\u7528\u5E38\u8BC6\u95EE\u9898\u53EF\u4EE5\u6B63\u5E38\u56DE\u5E94\uFF0C\u4E0D\u53D7\u77E5\u8BC6\u5E93\u9650\u5236\u3002
- \u7EF4\u4FEE\u62C6\u673A\u3001\u9000\u6362\u8D27\u653F\u7B56\u82E5\u77E5\u8BC6\u5E93\u65E0\u5BF9\u5E94\u6587\u6863\uFF0C\u5F15\u5BFC\u7528\u6237\u8054\u7CFB\u552E\u540E\u6E20\u9053\uFF0C\u4E0D\u8981\u81EA\u884C\u7ED9\u51FA\u6D41\u7A0B\u3002`;

// src/tools/knowledge-search.ts
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

// src/rag/rag.service.ts
import { randomUUID } from "crypto";
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { Document as Document2 } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

// src/embeddings/embedding.service.ts
import { OllamaEmbeddings } from "@langchain/ollama";
var EMBEDDING_PROVIDER = (process.env.EMBEDDING_PROVIDER ?? "ollama").trim().toLowerCase();
var EMBEDDING_BASE_URL = process.env.EMBEDDING_BASE_URL ?? "http://localhost:11434";
var EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "qwen3-embedding:0.6b";
var EMBEDDING_API_KEY = (process.env.EMBEDDING_API_KEY ?? "").trim();
var EMBEDDING_DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS ?? "1024");
var ARK_EMBEDDING_URL = "https://ark.cn-beijing.volces.com/api/v3";
var ArkMultimodalEmbeddings = class {
  model;
  apiKey;
  apiUrl;
  dimensions;
  concurrency;
  constructor(config) {
    this.model = config.model ?? EMBEDDING_MODEL;
    this.apiKey = config.apiKey ?? EMBEDDING_API_KEY;
    this.apiUrl = config.apiUrl ?? EMBEDDING_API_URL();
    this.dimensions = config.dimensions ?? EMBEDDING_DIMENSIONS;
    this.concurrency = config.concurrency ?? 8;
  }
  /** 批量向量化：逐条请求（每条独立向量）+ 固定并发池，按输入顺序返回 */
  async embedDocuments(texts) {
    const results = [];
    let next = 0;
    const worker = async () => {
      while (next < texts.length) {
        const i = next++;
        results[i] = await this.requestOne(texts[i]);
      }
    };
    const workers = Array.from(
      { length: Math.min(this.concurrency, texts.length) },
      () => worker()
    );
    await Promise.all(workers);
    return results;
  }
  /** 单条查询向量化 */
  async embedQuery(text) {
    return this.requestOne(text);
  }
  /** 发起单条多模态 embedding 请求（input 恒为单元素，保证返回独立向量） */
  async requestOne(text) {
    const body = {
      model: this.model,
      encoding_format: "float",
      dimensions: this.dimensions,
      input: [{ type: "text", text }]
    };
    const MAX_RETRY = 3;
    let lastErr;
    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      try {
        const res = await fetch(`${this.apiUrl}/embeddings/multimodal`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(3e4)
        });
        if (!res.ok) {
          const status = res.status;
          const detail = (await res.text()).slice(0, 200);
          if (status !== 429 && status < 500) {
            throw new Error(`\u8C46\u5305 embedding \u8BF7\u6C42\u5931\u8D25\uFF1AHTTP ${status} ${detail}`);
          }
          throw new Error(`\u8C46\u5305 embedding \u4E34\u65F6\u5931\u8D25\uFF1AHTTP ${status} ${detail}`);
        }
        const data = await res.json();
        const item = Array.isArray(data.data) ? data.data[0] : data.data;
        const vector = item?.embedding ?? [];
        if (vector.length !== this.dimensions) {
          throw new Error(
            `\u8C46\u5305 embedding \u7EF4\u5EA6\u5F02\u5E38\uFF1A\u671F\u671B ${this.dimensions}\uFF0C\u5B9E\u9645 ${vector.length}`
          );
        }
        return vector;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        const retriable = msg.includes("\u4E34\u65F6\u5931\u8D25") || msg.includes("429") || msg.includes("500") || msg.includes("502") || msg.includes("503") || msg.includes("504") || msg.includes("timeout") || msg.includes("fetch") || msg.includes("network");
        if (attempt < MAX_RETRY && retriable) {
          const waitMs = 500 * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }
};
function EMBEDDING_API_URL() {
  return (process.env.EMBEDDING_API_URL ?? "").trim() || ARK_EMBEDDING_URL;
}
function createEmbeddings(modelName) {
  if (EMBEDDING_PROVIDER === "ark") {
    if (!EMBEDDING_API_KEY) {
      throw new Error(
        "\u7F3A\u5C11\u8C46\u5305 embedding \u914D\u7F6E\uFF1A\u8BF7\u8BBE\u7F6E EMBEDDING_API_KEY\uFF08EMBEDDING_PROVIDER=ark \u65F6\u5FC5\u586B\uFF09"
      );
    }
    return new ArkMultimodalEmbeddings({ model: modelName ?? EMBEDDING_MODEL });
  }
  return new OllamaEmbeddings({
    model: modelName ?? EMBEDDING_MODEL,
    baseUrl: EMBEDDING_BASE_URL
  });
}
var defaultEmbeddings = createEmbeddings();

// src/constants/rag.ts
var RAG_TABLE_NAME = "langchain_pg_embedding";
var LEXICAL_INDEX_NAME = process.env.ES_INDEX_NAME ?? "rag_bm25_index";
var RAG_EMBEDDING_DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS ?? "1024");

// src/rag/bm25.ts
import { Client } from "@elastic/elasticsearch";
var LexicalIndexService = class {
  client = null;
  ready = null;
  /** 连接 ES + 建索引（惰性、幂等） */
  attach() {
    if (this.ready) return;
    this.ready = this.init();
    void this.ready.catch(() => {
      this.ready = null;
    });
  }
  async init() {
    const node = process.env.ES_URL ?? "http://localhost:9200";
    this.client = new Client({ node });
    const exists = await this.client.indices.exists({ index: LEXICAL_INDEX_NAME });
    if (!exists) {
      await this.client.indices.create({
        index: LEXICAL_INDEX_NAME,
        mappings: {
          properties: {
            revision_key: { type: "keyword" },
            document_id: { type: "keyword" },
            kb_id: { type: "keyword" },
            chunk_index: { type: "integer" },
            content: { type: "text", analyzer: "smartcn" },
            kb_name: { type: "keyword" },
            document_name: { type: "keyword" }
          }
        }
      });
    } else {
      await this.client.indices.putMapping({ index: LEXICAL_INDEX_NAME, properties: { revision_key: { type: "keyword" } } });
    }
  }
  async waitReady() {
    this.attach();
    if (this.ready) await this.ready;
  }
  /** 写入一批切片的词法索引（bulk，小数据量写完 refresh 立即可搜） */
  async addChunks(kbId, documentId, names, chunks) {
    await this.waitReady();
    if (chunks.length === 0) return;
    await this.insertChunks(
      chunks.map((c) => ({
        revision: names.revision,
        index: c.index,
        content: c.content,
        kbId,
        documentId,
        kbName: names.kbName,
        documentName: names.documentName
      }))
    );
  }
  async insertChunks(chunks) {
    const client = this.client;
    const BATCH = 500;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
      const operations = batch.flatMap((c) => [
        { index: { _index: LEXICAL_INDEX_NAME, _id: `${c.documentId}:${c.revision ?? "legacy"}:${c.index}` } },
        {
          revision_key: `${c.documentId}:${c.revision ?? ""}`,
          document_id: c.documentId,
          kb_id: c.kbId,
          chunk_index: c.index,
          content: c.content,
          kb_name: c.kbName ?? null,
          document_name: c.documentName ?? null
        }
      ]);
      const res = await client.bulk({ operations, refresh: true });
      if (res.errors) {
        const first = res.items.find((it) => it.index?.error)?.index?.error?.reason;
        throw new Error(`ES \u5199\u5165\u5931\u8D25: ${first ?? "\u672A\u77E5\u9519\u8BEF"}`);
      }
    }
  }
  /** 独立评测结束时释放连接。 */
  async close() {
    await this.client?.close();
    this.client = null;
    this.ready = null;
  }
  /** 删除某文档的全部词法索引 */
  async deleteByDocumentId(documentId, revision) {
    await this.waitReady();
    await this.client.deleteByQuery({
      index: LEXICAL_INDEX_NAME,
      query: { bool: { filter: [{ term: { document_id: documentId } }, ...revision ? [{ term: { revision_key: `${documentId}:${revision}` } }] : []] } },
      refresh: true
    });
  }
  /** BM25 关键词检索（match 查询 = ES 默认 BM25 打分，kbId 过滤） */
  async search(query, options = {}) {
    await this.waitReady();
    const { kbIds, k = 5, active } = options;
    if (active && !active.length || kbIds && !kbIds.length) return [];
    if (!query.trim()) return [];
    const res = await this.client.search({
      index: LEXICAL_INDEX_NAME,
      size: k,
      track_scores: true,
      query: {
        bool: {
          filter: [
            ...kbIds ? [{ terms: { kb_id: kbIds } }] : [],
            ...active ? [
              {
                bool: {
                  minimum_should_match: 1,
                  should: [
                    { terms: { revision_key: active.map((d) => `${d.id}:${d.revision}`) } },
                    { bool: { filter: [{ terms: { document_id: active.filter((d) => !d.revision).map((d) => d.id) } }], must_not: [{ exists: { field: "revision_key" } }] } }
                  ]
                }
              }
            ] : []
          ],
          must: [{ match: { content: query } }]
        }
      },
      _source: ["document_id", "kb_id", "chunk_index", "content", "kb_name", "document_name"]
    });
    return res.hits.hits.map((h) => {
      const s = h._source;
      return {
        content: s.content,
        documentId: Number(s.document_id),
        kbId: Number(s.kb_id),
        kbName: s.kb_name ?? void 0,
        documentName: s.document_name ?? void 0,
        chunkIndex: Number(s.chunk_index),
        score: h._score ?? 0,
        matchType: "keyword"
      };
    });
  }
};
var lexicalIndex = new LexicalIndexService();

// src/rag/query-rewrite.ts
import { complete } from "@earendil-works/pi-ai/compat";

// src/agent/model.ts
import { createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MODEL } from "@langchain-rag/shared/constants";
var ARK_PROVIDER = "custom";
var OLLAMA_PROVIDER = "ollama";
var ARK_BASE_URL = process.env.LLM_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3";
var OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
var OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3.5:0.8b";
var OLLAMA_MODELS = (process.env.OLLAMA_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
function providerForModel(modelName) {
  return modelName === OLLAMA_MODEL || OLLAMA_MODELS.includes(modelName) ? OLLAMA_PROVIDER : ARK_PROVIDER;
}
function providerConfig(providerId) {
  if (providerId === OLLAMA_PROVIDER) {
    return { baseUrl: OLLAMA_BASE_URL, apiKey: "ollama-local" };
  }
  return { baseUrl: ARK_BASE_URL, apiKey: process.env.OPENAI_API_KEY };
}
var modelRegistry = /* @__PURE__ */ new Map();
var runtimePromise = null;
function registerProvider(rt, providerId) {
  const { baseUrl, apiKey } = providerConfig(providerId);
  const provider = createProvider({
    id: providerId,
    name: providerId === OLLAMA_PROVIDER ? "Local Ollama" : "Custom LLM",
    baseUrl,
    auth: {
      apiKey: {
        name: `${providerId} API key`,
        resolve: () => Promise.resolve(apiKey ? { auth: { apiKey, baseUrl }, env: { OPENAI_API_KEY: apiKey }, source: "OPENAI_API_KEY" } : void 0)
      }
    },
    models: [...(modelRegistry.get(providerId) ?? /* @__PURE__ */ new Map()).values()],
    api: openAICompletionsApi()
  });
  rt.registerNativeProvider(provider);
}
function getModelRuntime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const rt = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
      const arkKey = process.env.OPENAI_API_KEY;
      if (arkKey) await rt.setRuntimeApiKey(ARK_PROVIDER, arkKey);
      const defName = process.env.LLM_PROVIDER === "ollama" ? OLLAMA_MODEL : process.env.LLM_MODEL ?? DEFAULT_MODEL;
      const defProvider = providerForModel(defName);
      modelRegistry.set(defProvider, /* @__PURE__ */ new Map([[defName, buildModel(defName, defProvider)]]));
      const ollamaProvider = OLLAMA_PROVIDER;
      const ollamaReg = modelRegistry.get(ollamaProvider) ?? /* @__PURE__ */ new Map();
      if (!ollamaReg.has(OLLAMA_MODEL)) ollamaReg.set(OLLAMA_MODEL, buildModel(OLLAMA_MODEL, ollamaProvider));
      modelRegistry.set(ollamaProvider, ollamaReg);
      registerProvider(rt, ARK_PROVIDER);
      registerProvider(rt, OLLAMA_PROVIDER);
      return rt;
    })();
  }
  return runtimePromise;
}
function buildModel(modelName, providerId) {
  const { baseUrl } = providerConfig(providerId);
  return {
    id: modelName,
    name: modelName,
    api: "openai-completions",
    provider: providerId,
    baseUrl,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
    contextWindow: 128e3,
    maxTokens: 8192
  };
}
async function ensureModel(modelName) {
  const name = modelName && modelName !== DEFAULT_MODEL ? modelName : defaultModelName();
  const providerId = providerForModel(name);
  const reg = modelRegistry.get(providerId) ?? /* @__PURE__ */ new Map();
  const existing = reg.get(name);
  if (existing) return existing;
  reg.set(name, buildModel(name, providerId));
  modelRegistry.set(providerId, reg);
  const rt = await getModelRuntime();
  registerProvider(rt, providerId);
  const model = rt.getModel(providerId, name);
  if (!model) throw new Error(`\u6A21\u578B\u6CE8\u518C\u5931\u8D25: ${name}`);
  return model;
}
function defaultModelName() {
  if (process.env.LLM_PROVIDER === "ollama") return OLLAMA_MODEL;
  return process.env.LLM_MODEL ?? DEFAULT_MODEL;
}
function resolveModel(modelName) {
  return ensureModel(modelName);
}

// src/rag/query-rewrite.ts
var QUERY_REWRITE_ENABLED = (process.env.QUERY_REWRITE_ENABLED ?? "false").trim().toLowerCase() === "true";
var TIMEOUT_MS = Number(process.env.QUERY_REWRITE_TIMEOUT_MS ?? "3000");
var REWRITE_PROMPT = `\u4F60\u662F\u68C0\u7D22\u67E5\u8BE2\u4F18\u5316\u52A9\u624B\u3002\u628A\u7528\u6237\u95EE\u9898\u6539\u5199\u6210\u66F4\u9002\u5408\u5728\u4F01\u4E1A\u77E5\u8BC6\u5E93\u4E2D\u68C0\u7D22\u7684\u5F62\u5F0F\u3002

\u8981\u6C42\uFF1A
1. \u63D0\u53D6\u6838\u5FC3\u5B9E\u4F53\u3001\u578B\u53F7\u3001\u53C2\u6570\uFF08\u5982 N6 mini\u3001\u7535\u6C60\u3001\u5145\u7535\uFF09
2. \u8865\u5145\u540C\u4E49\u8BCD\u548C\u4E66\u9762\u8868\u8FBE\uFF08\u53E3\u8BED \u2192 \u4E66\u9762\uFF09
3. \u53BB\u6389\u8BED\u6C14\u8BCD\u3001\u5BA2\u5957\u8BDD\u3001\u7591\u95EE\u52A9\u8BCD
4. \u4FDD\u6301\u539F\u610F\uFF0C\u4E0D\u8981\u65B0\u589E\u95EE\u9898\u91CC\u6CA1\u6709\u7684\u4FE1\u606F
5. \u53EA\u8F93\u51FA\u6539\u5199\u540E\u7684\u67E5\u8BE2\u672C\u8EAB\uFF0C\u4E0D\u8981\u89E3\u91CA\uFF0C\u4E0D\u8981\u5F15\u53F7

\u4F8B\u5B50\uFF1A
\u7528\u6237\uFF1A"\u8FD9\u4E2A\u68B3\u5B50\u5145\u4E00\u6B21\u7535\u80FD\u7528\u591A\u4E45\u554A"
\u6539\u5199\uFF1A"\u68B3\u5B50 \u7EED\u822A \u4E00\u6B21\u5145\u7535\u4F7F\u7528\u65F6\u957F"

\u7528\u6237\uFF1A"\u7EA2\u706F\u4E00\u76F4\u95EA\u662F\u600E\u4E48\u56DE\u4E8B"
\u6539\u5199\uFF1A"\u5145\u7535\u6307\u793A\u706F \u7EA2\u8272\u95EA\u70C1 \u6545\u969C \u5F02\u5E38\u72B6\u6001"

\u7528\u6237\u95EE\u9898\uFF1A`;
async function rewriteQuery(original) {
  if (!QUERY_REWRITE_ENABLED) return { rewritten: original, used: false };
  if (original.trim().length < 6) return { rewritten: original, used: false };
  let timer;
  try {
    const model = await resolveModel();
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await complete(
      model,
      {
        systemPrompt: "\u4F60\u662F\u68C0\u7D22\u67E5\u8BE2\u4F18\u5316\u52A9\u624B\u3002\u53EA\u8F93\u51FA\u6539\u5199\u540E\u7684\u67E5\u8BE2\u672C\u8EAB\uFF0C\u4E0D\u8981\u89E3\u91CA\uFF0C\u4E0D\u8981\u5F15\u53F7\u3002",
        messages: [{ role: "user", content: `${REWRITE_PROMPT}${original}`, timestamp: Date.now() }]
      },
      { maxTokens: 60, temperature: 0, signal: controller.signal }
    );
    clearTimeout(timer);
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim().replace(/^["'"]|["'"]$/g, "").trim();
    if (!text || text === original || text.length > 200) {
      return { rewritten: original, used: false };
    }
    return { rewritten: text, used: true };
  } catch (err) {
    console.warn(`[query-rewrite] \u6539\u5199\u5931\u8D25\uFF1A${err instanceof Error ? err.message : String(err)}\uFF0Cfallback \u539F query`);
    return { rewritten: original, used: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// src/loaders/pdf/loader.ts
import { readFileSync } from "fs";
import { PDFParse } from "pdf-parse";

// src/loaders/pdf/baidu.ts
var BAIDU_TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token";
var DOC_ANALYSIS_URL = "https://aip.baidubce.com/rest/2.0/ocr/v1/doc_analysis_office";
var PDF_DIRECT_LIMIT_BYTES = 2.5 * 1024 * 1024;
var TOKEN_TTL_MS = 29 * 24 * 60 * 60 * 1e3;
var cachedToken = null;
function getBaiduKeys() {
  const apiKey = process.env.BAIDU_OCR_API_KEY?.trim() ?? "";
  const secretKey = process.env.BAIDU_OCR_SECRET_KEY?.trim() ?? "";
  if (!apiKey || !secretKey) {
    throw new Error(
      "\u7F3A\u5C11\u767E\u5EA6 OCR \u914D\u7F6E\uFF1A\u8BF7\u8BBE\u7F6E\u73AF\u5883\u53D8\u91CF BAIDU_OCR_API_KEY \u4E0E BAIDU_OCR_SECRET_KEY\uFF08apps/backend/.env\uFF09"
    );
  }
  return { apiKey, secretKey };
}
async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  const { apiKey, secretKey } = getBaiduKeys();
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: apiKey,
    client_secret: secretKey
  });
  const res = await fetch(`${BAIDU_TOKEN_URL}?${params.toString()}`, {
    method: "POST",
    signal: AbortSignal.timeout(3e4)
  });
  if (!res.ok) throw new Error(`\u83B7\u53D6\u767E\u5EA6 access_token \u5931\u8D25\uFF1AHTTP ${res.status}`);
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(
      `\u83B7\u53D6\u767E\u5EA6 access_token \u5931\u8D25\uFF1A${data.error ?? "unknown"} ${data.error_description ?? ""}`.trim()
    );
  }
  cachedToken = { token: data.access_token, expiresAt: Date.now() + TOKEN_TTL_MS };
  return data.access_token;
}
async function ocrPdfPage(pdfBuffer, pageNum) {
  const token = await getAccessToken();
  const form = new URLSearchParams();
  form.set("access_token", token);
  form.set("pdf_file", pdfBuffer.toString("base64"));
  if (pageNum !== void 0) form.set("pdf_file_num", String(pageNum));
  form.set("language_type", "CHN_ENG");
  form.set("layout_analysis", "true");
  const res = await fetch(DOC_ANALYSIS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    signal: AbortSignal.timeout(12e4)
  });
  if (!res.ok) throw new Error(`\u767E\u5EA6 OCR \u8BF7\u6C42\u5931\u8D25\uFF1AHTTP ${res.status}`);
  const data = await res.json();
  if (data.error_code) {
    throw new Error(`\u767E\u5EA6 OCR \u8FD4\u56DE\u9519\u8BEF ${data.error_code}\uFF1A${data.error_msg ?? ""}`);
  }
  return data;
}
function formatTable(idxs, lines) {
  const cells = [];
  for (const i of idxs) {
    const loc = lines[i].words?.words_location;
    if (!loc) return idxs.map((j) => lines[j].words?.word ?? "").join("\n");
    cells.push({ top: loc.top, left: loc.left, word: lines[i].words?.word ?? "" });
  }
  const rows = [];
  for (const cell of cells.sort((a, b) => a.top - b.top || a.left - b.left)) {
    const target = rows.find((row) => Math.abs(row[0].top - cell.top) <= 10);
    if (target) target.push(cell);
    else rows.push([cell]);
  }
  return rows.map((row) => row.sort((a, b) => a.left - b.left).map((c) => c.word).join(" | ")).join("\n");
}
function pageToText(res) {
  const lines = res.results ?? [];
  const excluded = /* @__PURE__ */ new Set();
  for (const section of res.sections ?? []) {
    const attr = section.attribute;
    if (attr === "header" || attr === "footer" || attr === "number" || attr === "footnote") {
      for (const idx of section.sec_idx?.idx ?? []) excluded.add(idx);
    }
  }
  const layouts = res.layouts ?? [];
  if (layouts.length === 0) {
    return lines.map((line, i) => excluded.has(i) ? "" : line.words?.word ?? "").filter((t) => t.length > 0).join("\n");
  }
  const parts = [];
  for (const layout of layouts) {
    const type = layout.layout ?? "text";
    const idxs = (layout.layout_idx ?? []).filter(
      (i) => !excluded.has(i) && Boolean(lines[i]?.words?.word)
    );
    if (idxs.length === 0) continue;
    if (type === "table") {
      parts.push(`[\u8868\u683C]
${formatTable(idxs, lines)}`);
      continue;
    }
    if (type === "figure") continue;
    const text = idxs.map((i) => lines[i].words?.word ?? "").join("\n");
    if (type === "doc_title" || type === "title") parts.push(`## ${text}`);
    else parts.push(text);
  }
  return parts.join("\n");
}

// src/loaders/pdf/unstructured.ts
var UNSTRUCTURED_TIMEOUT_MS = 12e4;
var UNSTRUCTURED_POLL_INTERVAL_MS = 2e3;
async function parsePdfWithUnstructured(pdfBuffer, options = {}) {
  void options;
  const apiKey = process.env.UNSTRUCTURED_API_KEY;
  if (!apiKey) {
    throw new Error("\u7F3A\u5C11 Unstructured \u4E91 API \u914D\u7F6E\uFF1A\u8BF7\u8BBE\u7F6E\u73AF\u5883\u53D8\u91CF UNSTRUCTURED_API_KEY\uFF08apps/backend/.env\uFF09");
  }
  const { TransformClient, isAccepted } = await import("unstructured-transform-client");
  const client = new TransformClient({ apiKey });
  const runOnce = async () => {
    const outcome = await client.parse.run({
      input: { data: pdfBuffer, filename: "document.pdf" },
      output: "elements",
      include: ["table_html", "coordinates"],
      waitSeconds: 0
      // 不阻塞，拿 job handle 后自行轮询，便于统一超时控制
    });
    let elements = [];
    if (isAccepted(outcome)) {
      const jobId = outcome.body.id;
      const deadline = Date.now() + UNSTRUCTURED_TIMEOUT_MS;
      let job = await client.jobs.get(jobId, { output: "elements", include: ["table_html", "coordinates"] });
      while (job.status === "queued" || job.status === "processing") {
        if (Date.now() >= deadline) {
          throw new Error(`Unstructured \u89E3\u6790\u8D85\u65F6\uFF1Ajob ${jobId} \u5728 ${UNSTRUCTURED_TIMEOUT_MS / 1e3}s \u5185\u672A\u5B8C\u6210\uFF08\u72B6\u6001 ${job.status}\uFF09`);
        }
        await new Promise((resolve) => setTimeout(resolve, UNSTRUCTURED_POLL_INTERVAL_MS));
        job = await client.jobs.get(jobId, { output: "elements", include: ["table_html"] });
      }
      if (job.status !== "completed" || !job.result) {
        const jobError = job.error ? `\uFF0C\u9519\u8BEF\uFF1A${typeof job.error === "string" ? job.error : JSON.stringify(job.error)}` : "";
        throw new Error(`Unstructured \u89E3\u6790\u5931\u8D25\uFF1Ajob ${jobId} \u6700\u7EC8\u72B6\u6001 ${job.status}${jobError}`);
      }
      elements = job.result.elements ?? [];
    } else {
      elements = outcome.body.elements ?? [];
    }
    return elements.map(toUnstructuredElement);
  };
  const MAX_ATTEMPTS = 5;
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await runOnce();
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        console.warn(`[unstructured] \u7B2C ${attempt} \u6B21\u89E3\u6790\u672A\u6210\u529F\uFF0C${2 * attempt}s \u540E\u91CD\u8BD5\uFF1A${err instanceof Error ? err.message : String(err)}`);
        await new Promise((resolve) => setTimeout(resolve, 2e3 * attempt));
      }
    }
  }
  throw lastError;
}
function toUnstructuredElement(el) {
  return {
    element_id: el.elementId,
    type: el.type,
    text: el.text ?? "",
    metadata: {
      page_number: el.metadata.pageNumber ?? 1,
      text_as_html: el.metadata.textAsHtml ?? void 0,
      coordinates: el.metadata.coordinates ? {
        layout_width: el.metadata.coordinates.layout_width,
        layout_height: el.metadata.coordinates.layout_height,
        points: el.metadata.coordinates.points
      } : void 0
    }
  };
}
function htmlTableToText(html) {
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while (trMatch = trRe.exec(html)) {
    const cells = [];
    const cellRe = /<t([dh])[^>]*>([\s\S]*?)<\/t\1>/gi;
    let cellMatch;
    while (cellMatch = cellRe.exec(trMatch[1])) {
      cells.push(
        cellMatch[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
      );
    }
    rows.push(cells);
  }
  if (rows.length === 0) {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  const colCount = Math.max(...rows.map((r) => r.length));
  const fmt = (cells) => Array.from({ length: colCount }, (_, i) => cells[i] ?? "").join(" | ");
  const sep = Array.from({ length: colCount }, () => "---").join(" | ");
  const lines = rows.map(fmt);
  return [`| ${lines[0]} |`, `| ${sep} |`, ...lines.slice(1).map((l) => `| ${l} |`)].join("\n");
}
function elementsToPageTexts(elements, totalPages) {
  const pages = Array.from({ length: totalPages }, () => []);
  for (const el of elements) {
    const type = el.type ?? "UncategorizedText";
    const text = (el.text ?? "").trim();
    if (!text) continue;
    if (type === "Header" || type === "Footer" || type === "PageBreak") continue;
    const page = el.metadata?.page_number ?? 1;
    const target = pages[page - 1] ?? pages[0];
    switch (type) {
      case "Title":
        target.push(`## ${text}`);
        break;
      case "Table":
        target.push(`[\u8868\u683C]
${el.metadata?.text_as_html ? htmlTableToText(el.metadata.text_as_html) : text}`);
        break;
      case "ListItem":
        target.push(`- ${text.replace(/^[•·]\s*/, "").trim()}`);
        break;
      default:
        target.push(text);
    }
  }
  return pages.map((lines) => lines.join("\n"));
}

// src/loaders/pdf/image-semantic.ts
import sharp from "sharp";
function getConfig() {
  return {
    provider: (process.env.IMAGE_VLM_PROVIDER ?? "none").trim().toLowerCase(),
    apiKey: (process.env.IMAGE_VLM_API_KEY ?? "").trim(),
    model: process.env.IMAGE_VLM_MODEL ?? "doubao-seed-1.6-vision-250815",
    maxImages: Number(process.env.IMAGE_VLM_MAX_IMAGES ?? 20),
    concurrency: Math.max(1, Number(process.env.IMAGE_VLM_CONCURRENCY ?? 3)),
    timeoutMs: Number(process.env.IMAGE_VLM_TIMEOUT_MS ?? 3e4)
  };
}
function isImageSemanticEnabled() {
  const cfg = getConfig();
  return cfg.provider === "ark" && cfg.apiKey.length > 0;
}
var MIN_IMAGE_PT = 60;
var MAX_PAGE_RATIO = 0.85;
async function detectPdfImageBlocks(pdfBuffer, onlyPages) {
  const { Document: Document3, Device, Matrix } = await import("mupdf");
  const doc = Document3.openDocument(pdfBuffer, "application/pdf");
  try {
    const pages = doc.countPages();
    const blocks = [];
    const filterByPage = onlyPages && onlyPages.size > 0;
    for (let i = 0; i < pages; i++) {
      if (filterByPage && !onlyPages.has(i + 1)) continue;
      const page = doc.loadPage(i);
      const [pageX0, pageY0, pageX1, pageY1] = page.getBounds();
      const pageW = pageX1 - pageX0;
      const pageH = pageY1 - pageY0;
      const displayList = page.toDisplayList();
      const device = new Device({
        fillImage(image, ctm) {
          const m = Array.from(ctm);
          const x0 = m[4];
          const y0 = m[5];
          const w = Math.abs(m[0]);
          const h = Math.abs(m[3]);
          if (w < MIN_IMAGE_PT || h < MIN_IMAGE_PT) return;
          if (pageW > 0 && pageH > 0 && w * h / (pageW * pageH) > MAX_PAGE_RATIO) return;
          blocks.push({
            page: i + 1,
            bbox: {
              x0: Math.max(pageX0, Math.min(x0, x0 + w)),
              y0: Math.max(pageY0, Math.min(y0, y0 + h)),
              x1: Math.min(pageX1, Math.max(x0, x0 + w)),
              y1: Math.min(pageY1, Math.max(y0, y0 + h))
            }
          });
        }
      });
      displayList.run(device, Matrix.identity);
    }
    return blocks;
  } finally {
    doc.destroy?.();
  }
}
var ARK_CHAT_URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
function apiUrl() {
  return (process.env.IMAGE_VLM_API_URL ?? "").trim() || ARK_CHAT_URL;
}
var VLM_PROMPT = `\u4F60\u662F\u6587\u6863\u7248\u9762\u5206\u6790\u52A9\u624B\u3002\u4EE5\u4E0B\u662F PDF \u4E2D\u63D0\u53D6\u7684\u4E00\u5F20\u56FE\u7247\u3002
\u8BF7\u5224\u65AD\u5B83\u662F\u5426\u5C5E\u4E8E\u300C\u7ED3\u6784\u56FE\u300D\uFF08\u6D41\u7A0B\u56FE\u3001\u67B6\u6784\u56FE\u3001\u65F6\u5E8F\u56FE\u3001\u7EC4\u7EC7\u67B6\u6784\u56FE\u3001\u4FE1\u606F\u56FE\u7B49\u8868\u8FBE\u6A21\u5757/\u5C42\u7EA7/\u8FDE\u63A5\u5173\u7CFB\u7684\u56FE\uFF09\uFF1A
- \u662F\u7ED3\u6784\u56FE \u2192 \u7528\u4E2D\u6587\u7ED3\u6784\u5316\u63CF\u8FF0\uFF1A\u56FE\u7684\u7C7B\u578B\u3001\u4E3B\u8981\u8282\u70B9/\u6A21\u5757\u4E0E\u5C42\u7EA7\u3001\u8282\u70B9\u4E4B\u95F4\u7684\u8FDE\u63A5\u5173\u7CFB\uFF08\u7528\u300C\u2192\u300D\u300C\u4F9D\u8D56\u300D\u300C\u5305\u542B\u300D\u300C\u5171\u4EAB\u300D\u7B49\u8BCD\u8868\u8FBE\uFF09\u3002
- \u4E0D\u662F\u7ED3\u6784\u56FE\uFF08\u88C5\u9970\u56FE\u3001\u7167\u7247\u3001logo\u3001\u7EAF\u6587\u5B57\u622A\u56FE\uFF09\u2192 \u8F93\u51FA {"type":"skip"}\u3002
\u53EA\u63CF\u8FF0\u56FE\u4E2D\u53EF\u89C1\u5185\u5BB9\uFF0C\u4E0D\u5F97\u63A8\u6D4B\u6216\u7F16\u9020\u3002
\u4E25\u683C\u8F93\u51FA JSON\uFF1A{"type":"structure|skip","image_type":"\u67B6\u6784\u56FE/\u6D41\u7A0B\u56FE/\u2026","description":"\u7ED3\u6784\u5316\u63CF\u8FF0\uFF0C\u4F7F\u7528 - \u5217\u8868\u4FDD\u7559\u5C42\u7EA7"}`;
async function callDoubaoVision(pngBuffer, caption, cfg) {
  const imageB64 = pngBuffer.toString("base64");
  const captionLine = caption ? `\uFF08\u56FE\u9898/\u76F8\u5173\u6587\u5B57\uFF1A${caption}\uFF09` : "";
  const res = await fetch(apiUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageB64}` } },
            { type: "text", text: `${VLM_PROMPT}${captionLine}` }
          ]
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0
    }),
    signal: AbortSignal.timeout(cfg.timeoutMs)
  });
  if (!res.ok) {
    throw new Error(`\u8C46\u5305\u89C6\u89C9\u8BF7\u6C42\u5931\u8D25\uFF1AHTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("\u8C46\u5305\u89C6\u89C9\u8FD4\u56DE\u4E3A\u7A7A");
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(cleaned);
}
var RENDER_ZOOM = 2;
var MAX_IMAGE_SIDE = 2048;
async function renderPagePng(pdfBuffer, pageIndex) {
  const { Document: Document3, Matrix, ColorSpace } = await import("mupdf");
  const doc = Document3.openDocument(pdfBuffer, "application/pdf");
  try {
    const page = doc.loadPage(pageIndex);
    const pix = page.toPixmap(Matrix.scale(RENDER_ZOOM, RENDER_ZOOM), ColorSpace.DeviceRGB, false);
    return Buffer.from(pix.asPNG());
  } finally {
    doc.destroy?.();
  }
}
function bboxToPixels(bbox, pageWidthPx, pageHeightPx) {
  const x0 = Math.max(0, Math.round(bbox.x0 * RENDER_ZOOM));
  const x1 = Math.min(pageWidthPx, Math.round(bbox.x1 * RENDER_ZOOM));
  const y0 = Math.max(0, Math.round(bbox.y0 * RENDER_ZOOM));
  const y1 = Math.min(pageHeightPx, Math.round(bbox.y1 * RENDER_ZOOM));
  return { left: x0, top: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}
async function cropAndCompress(pagePng, bbox) {
  const meta = await sharp(pagePng).metadata();
  const region = bboxToPixels(bbox, meta.width ?? 1, meta.height ?? 1);
  return sharp(pagePng).extract({ left: region.left, top: region.top, width: region.width, height: region.height }).resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
}
async function semanticizePdfFigures(pdfBuffer, figures) {
  if (figures.length === 0) return [];
  const cfg = getConfig();
  if (!isImageSemanticEnabled()) return [];
  const limited = figures.slice(0, cfg.maxImages);
  if (limited.length < figures.length) {
    console.warn(`[image-semantic] \u56FE\u7247\u6570\u91CF ${figures.length} \u8D85\u8FC7\u4E0A\u9650 ${cfg.maxImages}\uFF0C\u8D85\u51FA\u90E8\u5206\u8DF3\u8FC7`);
  }
  const results = [];
  let cursor = 0;
  const pagePngCache = /* @__PURE__ */ new Map();
  async function worker() {
    while (cursor < limited.length) {
      const fig = limited[cursor++];
      try {
        let pagePng = pagePngCache.get(fig.page);
        if (!pagePng) {
          pagePng = await renderPagePng(pdfBuffer, fig.page - 1);
          pagePngCache.set(fig.page, pagePng);
        }
        const jpeg = await cropAndCompress(pagePng, fig.bbox);
        const parsed = await callDoubaoVision(jpeg, fig.caption, cfg);
        const type = (parsed.type ?? "").toLowerCase();
        if (type === "structure") {
          results.push({
            page: fig.page,
            caption: fig.caption,
            imageType: parsed.image_type,
            description: parsed.description ?? "",
            skipped: false
          });
        } else {
          results.push({ page: fig.page, caption: fig.caption, skipped: true });
        }
      } catch (err) {
        console.warn(`[image-semantic] \u7B2C ${fig.page} \u9875\u56FE\u7247\u8BED\u4E49\u5316\u5931\u8D25\uFF08\u5DF2\u8DF3\u8FC7\uFF09\uFF1A${err instanceof Error ? err.message : String(err)}`);
        results.push({ page: fig.page, caption: fig.caption, skipped: true });
      }
    }
  }
  const workers = Array.from({ length: Math.min(cfg.concurrency, limited.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// src/loaders/pdf/loader.ts
function throwOversizeError(reason) {
  throw new Error(`PDF \u6587\u4EF6\u8D85\u8FC7 ${PDF_DIRECT_LIMIT_BYTES / 1024 / 1024}MB \u4E14${reason}\uFF0C\u8D85\u51FA\u767E\u5EA6\u6587\u6863\u89E3\u6790 pdf_file \u76F4\u4F20\u4E0A\u9650\uFF08\u7F16\u7801\u540E 4M\uFF09\uFF0C\u8BF7\u538B\u7F29\u6216\u62C6\u5206\u540E\u91CD\u8BD5`);
}
var MIN_TEXT_CHARS = 20;
var MIN_CJK_CHARS = 5;
function needOcrPage(pageText) {
  const text = pageText.trim();
  if (text.length < MIN_TEXT_CHARS) return true;
  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  if (cjkCount >= MIN_CJK_CHARS) return false;
  if ((text.match(/\uFFFD/g) ?? []).length / text.length > 0.1) return true;
  const usableRatio = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u3000-\u303f\uff00-\uffef\x20-\x7f]/g) ?? []).length / text.length;
  return usableRatio < 0.7;
}
async function extractLocalPageTexts(filePath) {
  const parser = new PDFParse({ data: new Uint8Array(readFileSync(filePath)) });
  try {
    const result = await parser.getText();
    return result.pages.map((p) => p.text.trim());
  } finally {
    await parser.destroy();
  }
}
function markLocalTables(pageText) {
  const lines = pageText.split("\n");
  const out = [];
  let table = [];
  const flushTable = () => {
    if (table.length >= 2) {
      const rows = table.map((l) => l.split("	").map((c) => c.trim()));
      const colCount = Math.max(...rows.map((r) => r.length));
      const fmt = (r) => "| " + Array.from({ length: colCount }, (_, i) => r[i] ?? "").join(" | ") + " |";
      out.push("[\u8868\u683C]");
      out.push(fmt(rows[0]));
      out.push("| " + Array.from({ length: colCount }, () => "---").join(" | ") + " |");
      for (const r of rows.slice(1)) out.push(fmt(r));
    } else {
      for (const l of table) out.push(l);
    }
    table = [];
  };
  for (const line of lines) {
    if (line.includes("	")) {
      table.push(line);
    } else {
      flushTable();
      out.push(line);
    }
  }
  flushTable();
  return out.join("\n");
}
function normalizeHeadings(text) {
  return text.split("\n").map((line) => {
    const t = line.trim();
    if (!t) return line;
    const isMdHeading = /^#+\s+/.test(t);
    const body = isMdHeading ? t.replace(/^#+\s+/, "") : t;
    if (/^(\||\[表格\]|[-•*]\s)/.test(body)) return line;
    if (/^[（(]\s*\d+\s*[)）]/.test(body)) return line;
    const looksLikeHeadingText = (s2) => s2.length <= 25 && !/[。！？]$/.test(s2) && !/[,，；;：]/.test(s2);
    let m = body.match(/^(\d+\.\d+)[.、]?\s*(.+)$/);
    if (m && looksLikeHeadingText(m[2])) return `#### ${m[2]}`;
    m = body.match(/^(\d+)[.、]\s*(.+)$/);
    if (m && looksLikeHeadingText(m[2])) return `### ${m[2]}`;
    m = body.match(/^([一二三四五六七八九十百]+)、\s*(.+)$/);
    if (m && looksLikeHeadingText(m[2])) return `## ${m[2]}`;
    return line;
  }).join("\n");
}
function reflowBrokenLines(text) {
  text = text.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const out = [];
  const protectedLine = /^\s*(#+\s|[-•*]\s|\||\[表格\])/;
  const headingLine = /^\s*([一二三四五六七八九十百]+、|\d+[.、])/;
  for (let i = 0; i < lines.length; i++) {
    const prev = lines[i].trimEnd();
    const nextRaw = lines[i + 1];
    if (!nextRaw || nextRaw.trim() === "" || protectedLine.test(prev) || protectedLine.test(nextRaw) || headingLine.test(prev) || headingLine.test(nextRaw)) {
      out.push(lines[i]);
      continue;
    }
    const next = nextRaw.trimStart();
    const prevEnd = prev.slice(-1);
    const nextStart = next.slice(0, 1);
    if (prevEnd === "-" && /^[a-zA-Z]/.test(nextStart)) {
      out.push(prev.slice(0, -1) + next);
      i++;
      continue;
    }
    if (/^[。！？；：，、」』））》]/.test(nextStart)) {
      out.push(prev + next);
      i++;
      continue;
    }
    const isSentenceEnd = /[。！？；]$/.test(prevEnd);
    const prevIsText = /[a-zA-Z\u4e00-\u9fa5」』））》：，、]$/.test(prevEnd);
    const nextIsText = /^[a-zA-Z\u4e00-\u9fa5(（《"“]/.test(nextStart);
    if (!isSentenceEnd && prevIsText && nextIsText) {
      out.push(prev + next);
      i++;
      continue;
    }
    out.push(lines[i]);
  }
  return out.join("\n");
}
function isPageNumberLine(line) {
  const t = line.trim();
  if (!t || t.length > 12) return false;
  return /^(第\s*[0-9一二三四五六七八九十百]+\s*页|Page\s*\d+|[-—–]\s*\d+\s*[-—–]|\d{1,4})$/i.test(t);
}
function cleanFallbackPageTexts(pageTexts) {
  if (pageTexts.length < 2) {
    return pageTexts.map(
      (t) => t.split("\n").filter((l) => !isPageNumberLine(l)).join("\n")
    );
  }
  const lineCount = /* @__PURE__ */ new Map();
  for (const page of pageTexts) {
    const seen = /* @__PURE__ */ new Set();
    for (const line of page.split("\n")) {
      const k = line.trim();
      if (k && !seen.has(k)) {
        seen.add(k);
        lineCount.set(k, (lineCount.get(k) ?? 0) + 1);
      }
    }
  }
  const repeated = new Set([...lineCount].filter(([, n]) => n >= 2).map(([k]) => k));
  return pageTexts.map((page) => {
    const lines = page.split("\n");
    const keep = [];
    for (let i = 0; i < lines.length; i++) {
      const k = lines[i].trim();
      const atEdge = i <= 2 || i >= lines.length - 3;
      if (atEdge && repeated.has(k)) continue;
      if (atEdge && isPageNumberLine(k)) continue;
      keep.push(lines[i]);
    }
    return keep.join("\n");
  });
}
async function applyUnstructuredToTextPages(filePath, buffer, localPages, scanPageNums) {
  const pageTexts = localPages.slice();
  const scanPageSet = new Set(scanPageNums);
  let images = { total: 0, semanticized: 0, skipped: 0 };
  try {
    const elements = await parsePdfWithUnstructured(buffer, {
      strategy: "hi_res",
      languages: ["chi_sim"]
    });
    const structured = elementsToPageTexts(elements, localPages.length);
    if (isImageSemanticEnabled()) {
      try {
        const figurePages = /* @__PURE__ */ new Set();
        const captionsByPage = /* @__PURE__ */ new Map();
        for (const el of elements) {
          const elType = el.type ?? "";
          const figText = (el.text ?? "").trim();
          const p = el.metadata?.page_number ?? 1;
          if (elType === "Image" || elType === "Figure") {
            figurePages.add(p);
            if (figText) captionsByPage.set(p, [...captionsByPage.get(p) ?? [], figText]);
          } else if (elType === "FigureCaption" && figText) {
            captionsByPage.set(p, [figText, ...captionsByPage.get(p) ?? []]);
          }
        }
        const figures = await detectPdfImageBlocks(buffer, figurePages);
        if (figures.length > 0) {
          for (const f of figures) {
            const caps = captionsByPage.get(f.page);
            if (caps?.length) f.caption = caps.join(" / ");
          }
          const results = await semanticizePdfFigures(buffer, figures);
          images = { total: figures.length, semanticized: 0, skipped: 0 };
          for (const r of results) {
            if (r.skipped) {
              images.skipped++;
              continue;
            }
            if (scanPageSet.has(r.page)) continue;
            images.semanticized++;
            const caption = r.caption ? `\uFF1A${r.caption}` : "";
            const block = `[\u56FE\u7247]${r.imageType ? ` ${r.imageType}` : ""}${caption}
${r.description}`.trim();
            if (!block) continue;
            const pageIdx = r.page - 1;
            structured[pageIdx] = structured[pageIdx] ? `${structured[pageIdx]}

${block}` : block;
          }
        }
      } catch (err) {
        console.warn(`[loadPdf] \u56FE\u7247\u8BED\u4E49\u5316\u6574\u4F53\u5931\u8D25\uFF08\u5DF2\u5FFD\u7565\uFF09\uFF1A${err instanceof Error ? err.message : String(err)}`);
      }
    }
    structured.forEach((text, i) => {
      if (!scanPageSet.has(i + 1)) pageTexts[i] = text;
    });
  } catch (err) {
    console.warn(`[loadPdf] Unstructured \u7248\u9762\u5206\u6790\u5931\u8D25\uFF0C\u6587\u672C\u5C42\u9875\u56DE\u9000\u672C\u5730\u63D0\u53D6\uFF1A${err instanceof Error ? err.message : String(err)}`);
    for (let i = 0; i < pageTexts.length; i++) {
      if (!scanPageSet.has(i + 1)) {
        pageTexts[i] = markLocalTables(pageTexts[i]);
        pageTexts[i] = reflowBrokenLines(pageTexts[i]);
      }
    }
    const cleaned = cleanFallbackPageTexts(pageTexts);
    cleaned.forEach((t, i) => pageTexts[i] = t);
  }
  return { pageTexts, images };
}
async function routeWholeOcr(filePath, buffer, options) {
  if (buffer.byteLength > PDF_DIRECT_LIMIT_BYTES) {
    throwOversizeError("\u65E0\u6CD5\u672C\u5730\u89E3\u6790\u6587\u672C");
  }
  const first = await ocrPdfPage(buffer);
  const pages = first.pdf_file_size ?? 1;
  const pageTexts = [pageToText(first)];
  for (let page = 2; page <= pages; page++) {
    pageTexts.push(pageToText(await ocrPdfPage(buffer, page)));
  }
  return buildDocument(filePath, pageTexts, { pages, ocrPages: pages, options });
}
async function loadPdf(filePath, options) {
  const buffer = readFileSync(filePath);
  let localPages = [];
  try {
    localPages = await extractLocalPageTexts(filePath);
  } catch (err) {
    console.warn(`[loadPdf] \u672C\u5730\u6587\u672C\u5C42\u63A2\u6D4B\u5931\u8D25\uFF0C\u6574\u4EFD\u6587\u6863\u8D70 OCR\uFF1A${err instanceof Error ? err.message : String(err)}`);
  }
  if (localPages.length === 0) {
    return routeWholeOcr(filePath, buffer, options);
  }
  const scanPageNums = [];
  localPages.forEach((text, i) => {
    if (needOcrPage(text)) scanPageNums.push(i + 1);
  });
  const { pageTexts, images } = await applyUnstructuredToTextPages(filePath, buffer, localPages, scanPageNums);
  if (scanPageNums.length === 0) {
    return buildDocument(filePath, pageTexts, { pages: localPages.length, ocrPages: 0, images, options });
  }
  if (buffer.byteLength > PDF_DIRECT_LIMIT_BYTES) {
    throwOversizeError("\u5305\u542B\u65E0\u6587\u672C\u5C42\u9875\u9762");
  }
  for (const page of scanPageNums) {
    pageTexts[page - 1] = pageToText(await ocrPdfPage(buffer, page));
  }
  return buildDocument(filePath, pageTexts, {
    pages: localPages.length,
    ocrPages: scanPageNums.length,
    images,
    options
  });
}
function buildDocument(filePath, pageTexts, info) {
  const { pages, ocrPages, images, options } = info;
  const mode = ocrPages === 0 ? "text-layer" : ocrPages === pages ? "baidu-doc-analysis" : "mixed";
  const normalizedPages = pageTexts.map((t) => normalizeHeadings(t));
  const content = normalizedPages.map((text, i) => pages > 1 ? `===== \u7B2C ${i + 1} \u9875 =====
${text}` : text).filter((t) => t.trim().length > 0).join("\n\n");
  return [
    {
      pageContent: content,
      metadata: {
        source: filePath,
        mode,
        pages,
        ocrPages,
        images,
        // 图片语义化统计：{total, semanticized, skipped}；未启用时为 {0,0,0}
        splitPages: options?.splitPages ?? false
      }
    }
  ];
}

// src/loaders/markdown/loader.ts
import { readFile } from "fs/promises";
import { Document } from "@langchain/core/documents";
async function loadMarkdown(filePath) {
  const content = await readFile(filePath, "utf-8");
  return [
    new Document({
      pageContent: content,
      metadata: { source: filePath }
    })
  ];
}

// src/loaders/extract.ts
function normalizeParsedText(content, isFirstPage) {
  let text = content.replace(/\r\n/g, "\n");
  if (isFirstPage) text = text.replace(/^\uFEFF/, "");
  return text;
}
async function parseDocument(filePath) {
  const fileType = filePath.split(".").pop()?.toLowerCase() ?? "";
  let docs;
  switch (fileType) {
    case "pdf":
      docs = await loadPdf(filePath, { splitPages: false });
      break;
    case "txt":
    case "markdown":
    case "md":
      docs = await loadMarkdown(filePath);
      break;
    default:
      throw new Error(`\u6682\u4E0D\u652F\u6301\u7684\u6587\u4EF6\u7C7B\u578B\uFF1A.${fileType}\uFF08\u5F53\u524D\u652F\u6301 pdf / md\uFF09`);
  }
  docs.forEach((doc, i) => {
    doc.pageContent = normalizeParsedText(doc.pageContent, i === 0);
  });
  return { fileType, docs };
}

// src/rag/rag.service.ts
var RRF_K = 60;
var RagService = class {
  vectorStore = null;
  embeddings;
  storeReady;
  constructor(embeddings) {
    this.embeddings = embeddings ?? defaultEmbeddings;
  }
  /** 初始化 PGVectorStore（延迟初始化，避免模块加载时立即连接 DB） */
  async getStore() {
    if (this.vectorStore) return this.vectorStore;
    const config = {
      postgresConnectionOptions: {
        connectionString: process.env.DATABASE_URL
      },
      tableName: RAG_TABLE_NAME,
      columns: {
        idColumnName: "id",
        contentColumnName: "content",
        metadataColumnName: "metadata",
        vectorColumnName: "embedding"
      },
      distanceStrategy: "cosine",
      scoreNormalization: "similarity"
    };
    this.storeReady ??= PGVectorStore.initialize(this.embeddings, {
      ...config,
      dimensions: RAG_EMBEDDING_DIMENSIONS
    });
    try {
      this.vectorStore = await this.storeReady;
    } catch (error) {
      this.storeReady = void 0;
      throw error;
    }
    return this.vectorStore;
  }
  /** 暂存新索引；只有 DB 中的 index_revision 切换后才对检索可见。 */
  async prepareDocument(kbId, documentId, content, names, taskId, stepOffset = 1) {
    const revision = randomUUID();
    const run = async (tid) => {
      const texts = await splitTextToChunks(normalizeParsedText(content, true), { preserveTables: true });
      if (texts.length === 0) throw new Error("\u6587\u6863\u6CA1\u6709\u53EF\u7D22\u5F15\u7684\u6587\u672C");
      emit(TaskEvent.PROGRESS, { taskId: tid, taskType: "document_index" /* DOCUMENT_INDEX */, step: stepOffset, message: `\u5207\u7247\u5B8C\u6210\uFF08${texts.length} \u7247\uFF09\uFF0C\u5F00\u59CB\u5411\u91CF\u5316` });
      try {
        const store = await this.getStore();
        await store.addDocuments(
          texts.map(
            (text, i) => new Document2({
              pageContent: text,
              metadata: { documentId, kbId, chunkIndex: i + 1, revision, ...names }
            })
          )
        );
        await lexicalIndex.addChunks(
          kbId,
          documentId,
          { ...names, revision },
          texts.map((content2, i) => ({ content: content2, index: i + 1 }))
        );
        emit(TaskEvent.PROGRESS, { taskId: tid, taskType: "document_index" /* DOCUMENT_INDEX */, step: stepOffset + 1, message: "\u5411\u91CF\u5316\u5B8C\u6210" });
        return { revision, chunks: texts.map((content2, i) => ({ content: content2, index: i + 1, tokenCount: Math.ceil(content2.length / 2) })) };
      } catch (error) {
        await this.discardRevision(documentId, revision);
        throw error;
      }
    };
    return taskId ? run(taskId) : withTaskEvents("document_index" /* DOCUMENT_INDEX */, { kbId, documentId }, run);
  }
  /** 独立脚本兼容入口；后端应 prepareDocument 后在同一个事务内写切片与激活版本。 */
  async indexDocument(kbId, documentId, content, names, taskId, stepOffset = 1) {
    const prepared = await this.prepareDocument(kbId, documentId, content, names, taskId, stepOffset);
    try {
      const store = await this.getStore();
      const result = await store.pool.query("UPDATE knowledge_document SET index_revision = $1 WHERE id = $2 AND status IN (1, 2)", [prepared.revision, documentId]);
      if (!result.rowCount) throw new Error("\u6587\u6863\u4E0D\u5B58\u5728\u6216\u5DF2\u5220\u9664");
      return prepared.chunks;
    } catch (error) {
      await this.discardRevision(documentId, prepared.revision);
      throw error;
    }
  }
  /** 保留旧版本直到新版本成功激活。 */
  async reindexDocument(documentId, kbId, content, names, taskId, stepOffset = 1) {
    return this.indexDocument(kbId, documentId, content, names, taskId, stepOffset);
  }
  /** 清理失败的暂存版本；清理故障不会覆盖原始错误。 */
  async discardRevision(documentId, revision) {
    const results = await Promise.allSettled([this.deleteVectorRevision(documentId, revision), lexicalIndex.deleteByDocumentId(documentId, revision)]);
    for (const result of results) {
      if (result.status === "rejected") console.warn("\u6682\u5B58\u7D22\u5F15\u6E05\u7406\u5931\u8D25\uFF0C\u7248\u672C\u4ECD\u4E0D\u53EF\u68C0\u7D22", result.reason);
    }
  }
  async deleteVectorRevision(documentId, revision) {
    const store = await this.getStore();
    await store.delete({ filter: { documentId, ...revision ? { revision } : {} } });
  }
  /** 在召回之前过滤删除、失败文档和非活跃版本，避免旧切片挤占 top-k。 */
  async activeDocuments(kbIds) {
    const store = await this.getStore();
    const result = await store.pool.query(
      `
      SELECT d.id, COALESCE(d.index_revision, '') AS revision
      FROM knowledge_document d JOIN knowledge_base kb ON kb.id = d.knowledge_base_id
      WHERE d.status IN (1, 2) AND kb.status IN (1, 2)
        AND ($1::int[] IS NULL OR kb.id = ANY($1::int[]))`,
      [kbIds ?? null]
    );
    return result.rows;
  }
  async search(query, options = {}) {
    const { kbIds, k = 5, mode = "hybrid" } = options;
    if (!query.trim() || kbIds && !kbIds.length) return [];
    if (!Number.isInteger(k) || k < 1 || k > 100) throw new Error("k \u5FC5\u987B\u4E3A 1~100 \u7684\u6574\u6570");
    const fetchK = Math.max(k * 2, 10);
    return withTaskEvents("rag_search" /* RAG_SEARCH */, { kbIds, message: `\u68C0\u7D22\uFF1A${query.slice(0, 50)}` }, async () => {
      const active = await this.activeDocuments(kbIds);
      if (!active.length) return [];
      const { rewritten } = await rewriteQuery(query);
      const requests = [];
      if (mode !== "keyword") requests.push(this.semanticSearch(rewritten, active, fetchK));
      if (mode !== "semantic") requests.push(lexicalIndex.search(rewritten, { kbIds, k: fetchK, active }));
      const settled = await Promise.allSettled(requests);
      const lists = [];
      for (const result of settled) {
        if (result.status === "fulfilled") lists.push(result.value);
        else console.warn("\u68C0\u7D22\u5355\u8DEF\u5931\u8D25", result.reason);
      }
      if (!lists.length) throw new Error("\u5411\u91CF\u4E0E\u5173\u952E\u8BCD\u68C0\u7D22\u5747\u4E0D\u53EF\u7528\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
      return fuseRrf(lists, k);
    });
  }
  async semanticSearch(query, active, k) {
    const store = await this.getStore();
    const vector = await this.embeddings.embedQuery(query);
    const result = await store.pool.query(
      `
      SELECT v.content, v.metadata, 1 - (v.embedding <=> $1::vector) AS score
      FROM ${RAG_TABLE_NAME} v
      JOIN jsonb_to_recordset($2::jsonb) AS a(id int, revision text)
        ON v.metadata->>'documentId' = a.id::text
        AND COALESCE(v.metadata->>'revision', '') = a.revision
      ORDER BY v.embedding <=> $1::vector LIMIT $3`,
      [JSON.stringify(vector), JSON.stringify(active), k]
    );
    return result.rows.map(({ content, metadata, score }) => ({
      content,
      ...metadata,
      score,
      matchType: "semantic"
    }));
  }
  /** 独立评测结束时释放连接。 */
  async close() {
    await Promise.all([this.vectorStore?.end(), lexicalIndex.close()]);
    this.vectorStore = null;
    this.storeReady = void 0;
  }
  async deleteByDocumentId(documentId) {
    const results = await Promise.allSettled([this.deleteVectorRevision(documentId), lexicalIndex.deleteByDocumentId(documentId)]);
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length) throw new Error("\u90E8\u5206\u7D22\u5F15\u6E05\u7406\u5931\u8D25\uFF0C\u53EF\u91CD\u8BD5\u6E05\u7406");
  }
};
function fuseRrf(lists, k) {
  const fused = /* @__PURE__ */ new Map();
  for (const list of lists) {
    list.forEach((result, rank) => {
      const key = `${result.documentId}#${result.chunkIndex ?? -1}`;
      const entry = fused.get(key) ?? { result, rrf: 0, matched: /* @__PURE__ */ new Set() };
      entry.rrf += 1 / (RRF_K + rank + 1);
      entry.matched.add(result.matchType);
      fused.set(key, entry);
    });
  }
  const maxRrf = lists.length / (RRF_K + 1);
  return [...fused.values()].sort((a, b) => b.rrf - a.rrf).slice(0, k).map(({ result, rrf, matched }) => ({
    ...result,
    score: rrf / maxRrf,
    matchType: matched.size > 1 ? "both" : [...matched][0]
  }));
}
function extractTableBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  let current = [];
  let table = [];
  let inTable = false;
  const flushText = () => {
    if (current.length) {
      blocks.push({ text: current.join("\n"), table: false });
      current = [];
    }
  };
  const flushTable = () => {
    if (table.length) {
      blocks.push({ text: table.join("\n"), table: true });
      table = [];
    }
  };
  const isTableLine = (line) => /^\s*\|/.test(line);
  const isTableSeparator = (line) => isTableLine(line) && /-/.test(line) && line.trim().replace(/[|\s:.-]/g, "").length === 0;
  const isRealTable = (block) => block.length >= 2 && block.some((l) => isTableSeparator(l));
  const closeTable = () => {
    if (isRealTable(table)) {
      flushTable();
    } else {
      current.push(...table);
      table = [];
    }
    inTable = false;
  };
  for (const line of lines) {
    if (inTable) {
      if (isTableLine(line)) {
        table.push(line);
        continue;
      }
      closeTable();
    }
    if (/^\[表格\]\s*$/.test(line.trim())) {
      flushText();
      inTable = true;
      table = [line];
      continue;
    }
    if (isTableLine(line)) {
      flushText();
      inTable = true;
      table = [line];
      continue;
    }
    current.push(line);
  }
  if (inTable) closeTable();
  flushText();
  return blocks;
}
async function splitTextToChunks(text, options) {
  if (options?.preserveTables) {
    const chunks = [];
    for (const block of extractTableBlocks(text)) {
      chunks.push(...block.table ? [block.text] : await splitTextInternal(block.text));
    }
    return chunks.filter(Boolean);
  }
  return splitTextInternal(text);
}
async function splitTextInternal(text) {
  const chunkSize = Number(process.env.CHUNK_SIZE ?? 350);
  const chunkOverlap = Number(process.env.CHUNK_OVERLAP ?? 40);
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || !Number.isInteger(chunkOverlap) || chunkOverlap < 0 || chunkOverlap >= chunkSize)
    throw new Error("\u5207\u7247\u53C2\u6570\u65E0\u6548\uFF1A\u987B\u6EE1\u8DB3 0 <= CHUNK_OVERLAP < CHUNK_SIZE");
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separators: ["\n\n", "\n", "\u3002", "\uFF01", "\uFF1F", "\uFF1B", "\uFF0C", " ", ""]
  });
  const docs = await splitter.createDocuments([text]);
  return docs.map((d) => d.pageContent).filter(Boolean);
}
var ragService = new RagService();

// src/tools/knowledge-search.ts
function chunkKey(r) {
  return `${r.kbId}:${r.documentId}:${r.chunkIndex ?? ""}:${r.content}`;
}
function appendScopedResults(scope, results) {
  if (!scope) return;
  const seen = new Set(scope.results.map(chunkKey));
  for (const r of results) {
    const key = chunkKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    scope.results.push(r);
  }
}
var MATCH_LABELS = {
  both: "\u8BED\u4E49+\u5173\u952E\u8BCD",
  semantic: "\u8BED\u4E49",
  keyword: "\u5173\u952E\u8BCD"
};
function formatResults(results) {
  return results.map(
    (r, i) => `[\u6587\u6863\u7247\u6BB5 ${i + 1}] \u6765\u6E90: ${r.kbName ?? `\u77E5\u8BC6\u5E93#${r.kbId}`}${r.documentName ? `/${r.documentName}` : ""} (\u5339\u914D: ${MATCH_LABELS[r.matchType] ?? r.matchType}, \u5F97\u5206: ${(r.score * 100).toFixed(1)}%)
${r.content}`
  ).join("\n\n");
}
function createKnowledgeSearchTool(kbIds, scope) {
  return defineTool({
    name: "search_knowledge_base",
    label: "\u77E5\u8BC6\u5E93\u68C0\u7D22",
    description: `\u5728\u672C\u6B21\u4F1A\u8BDD\u6307\u5B9A\u7684\u77E5\u8BC6\u5E93\u4E2D\u68C0\u7D22\u76F8\u5173\u6587\u6863\u5185\u5BB9\uFF08\u5411\u91CF\u8BED\u4E49 + BM25 \u5173\u952E\u8BCD\u6DF7\u5408\u68C0\u7D22\uFF09\u3002
\u9002\u7528\u573A\u666F\uFF1A
- \u7528\u6237\u8BE2\u95EE\u516C\u53F8\u653F\u7B56\u3001\u6D41\u7A0B\u3001\u89C4\u8303\u3001\u4EA7\u54C1\u6587\u6863\u7B49\u5185\u90E8\u8D44\u6599
- \u9700\u8981\u67E5\u627E\u7279\u5B9A\u4E1A\u52A1\u77E5\u8BC6\u6216\u64CD\u4F5C\u6307\u5357
- \u7528\u6237\u7684\u95EE\u9898\u9700\u8981\u57FA\u4E8E\u516C\u53F8\u6587\u6863\u6216\u4EA7\u54C1\u8BF4\u660E\u4E66\u6765\u56DE\u7B54

\u6CE8\u610F\uFF1A
- \u68C0\u7D22\u8303\u56F4\u7531\u4F1A\u8BDD\u8BBE\u5B9A\uFF1A\u4F60\u53EA\u80FD\u51B3\u5B9A\u300C\u67E5\u4EC0\u4E48\u300D\uFF0C\u65E0\u6CD5\u6539\u53D8\u300C\u80FD\u67E5\u54EA\u4E9B\u5E93\u300D\u3002\u672A\u6307\u5B9A\u77E5\u8BC6\u5E93\u65F6\u5DE5\u5177\u4F1A\u76F4\u63A5\u8FD4\u56DE\u63D0\u793A\u3002
- \u68C0\u7D22\u7ED3\u679C\u6309\u6DF7\u5408\u76F8\u5173\u6027\u6392\u5E8F\uFF0C\u53EF\u80FD\u4E0D\u5B8C\u5168\u7CBE\u786E\u3002
- \u4E00\u6B21\u4E0D\u7406\u60F3\u65F6\u6539\u5199\u67E5\u8BE2\u8BCD\uFF08\u8BBE\u5907\u578B\u53F7\u3001\u6545\u969C\u7801\u3001\u529F\u80FD\u5173\u952E\u8BCD\uFF09\u518D\u8BD5\uFF0C\u6700\u591A\u91CD\u8BD5\u4E24\u6B21\u3002
- \u68C0\u7D22\u65E0\u7ED3\u679C\u65F6\u8BF7\u660E\u786E\u544A\u77E5\u7528\u6237\u77E5\u8BC6\u5E93\u4E2D\u6CA1\u6709\u76F8\u5173\u4FE1\u606F\uFF0C\u4E0D\u8981\u51ED\u8BB0\u5FC6\u8865\u5168\u3002`,
    promptSnippet: "search_knowledge_base - \u5728\u4F1A\u8BDD\u6307\u5B9A\u7684\u77E5\u8BC6\u5E93\u4E2D\u68C0\u7D22\u6587\u6863",
    parameters: Type.Object({
      query: Type.String({ description: "\u68C0\u7D22\u67E5\u8BE2\u8BED\u53E5\uFF1B\u5EFA\u8BAE\u4F7F\u7528\u95EE\u9898\u4E2D\u7684\u5173\u952E\u8BCD\uFF0C\u9996\u6B21\u4E0D\u7406\u60F3\u65F6\u53EF\u6362\u7528\u578B\u53F7\u3001\u6545\u969C\u7801\u7B49\u529F\u80FD\u5173\u952E\u8BCD" })
    }),
    execute: async (_toolCallId, params) => {
      if (kbIds.length === 0) {
        return {
          content: [{ type: "text", text: "\u5F53\u524D\u4F1A\u8BDD\u672A\u6307\u5B9A\u77E5\u8BC6\u5E93\uFF0C\u65E0\u6CD5\u68C0\u7D22\u3002\u8BF7\u63D0\u793A\u7528\u6237\u5148\u9009\u62E9\u8981\u67E5\u8BE2\u7684\u77E5\u8BC6\u5E93\u3002" }],
          details: null
        };
      }
      const results = await ragService.search(params.query, { kbIds, k: 5 });
      appendScopedResults(scope, results);
      if (results.length === 0) {
        return {
          content: [{ type: "text", text: "\u672A\u627E\u5230\u76F8\u5173\u6587\u6863\u3002\u8BF7\u544A\u77E5\u7528\u6237\u5F53\u524D\u77E5\u8BC6\u5E93\u4E2D\u6CA1\u6709\u5339\u914D\u7684\u4FE1\u606F\u3002" }],
          details: null
        };
      }
      return {
        content: [{ type: "text", text: formatResults(results) }],
        details: results
      };
    }
  });
}
function createEmptyScope() {
  return { results: [] };
}

// src/agent/index.ts
var PI_CWD = process.cwd();
var AsyncEventQueue = class {
  items = [];
  waiters = [];
  closed = false;
  enqueue(e) {
    this.items.push(e);
    this.waiters.shift()?.(this.items.shift());
  }
  /** 关闭队列：唤醒所有挂起的等待者，令其 dequeue 返回 undefined */
  close() {
    this.closed = true;
    while (this.waiters.length) this.waiters.shift()(void 0);
  }
  async dequeue() {
    if (this.items.length) return this.items.shift();
    if (this.closed) return void 0;
    return new Promise((resolve) => this.waiters.push(resolve));
  }
};
function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  };
}
function toPiMessage(m) {
  switch (m.role) {
    case "user":
      return { role: "user", content: [{ type: "text", text: m.content }], timestamp: Date.now() };
    case "assistant":
      return {
        role: "assistant",
        content: [{ type: "text", text: m.content }],
        api: "openai-completions",
        provider: "custom",
        model: "history",
        usage: emptyUsage(),
        stopReason: "stop",
        timestamp: Date.now()
      };
    case "system":
      return { role: "system", content: m.content, timestamp: Date.now() };
  }
}
function buildSessionManager(history, pi) {
  if (!pi?.sessionFile) {
    const sm2 = SessionManager.inMemory(PI_CWD, { id: pi?.sessionId ?? `conv-${Date.now()}` });
    for (const m of history ?? []) {
      sm2.appendMessage(toPiMessage(m));
    }
    sm2.appendMessage({ role: "system", content: systemPrompt, timestamp: Date.now() });
    return sm2;
  }
  const sessionDir = dirname(pi.sessionFile);
  const sm = SessionManager.open(pi.sessionFile, sessionDir, PI_CWD);
  if (pi.leafEntryId && sm.getEntry(pi.leafEntryId)) {
    sm.branch(pi.leafEntryId);
  }
  for (const m of history ?? []) {
    sm.appendMessage(toPiMessage(m));
  }
  const hasSystem = sm.getEntries().some((e) => e.type === "message" && e.message?.role === "system");
  if (!hasSystem) {
    sm.appendMessage({ role: "system", content: systemPrompt, timestamp: Date.now() });
  }
  return sm;
}
function diffAddedEntries(sm, priorIds) {
  return sm.getEntries().filter((e) => !priorIds.has(e.id)).map((e) => ({
    id: e.id,
    type: e.type,
    role: e.type === "message" ? e.message?.role : void 0
  }));
}
function readToolResultText(result) {
  if (typeof result !== "object" || result === null) return void 0;
  const content = result.content;
  if (!Array.isArray(content)) return void 0;
  const first = content[0];
  if (typeof first === "object" && first !== null && "text" in first && typeof first.text === "string") {
    return first.text;
  }
  return void 0;
}
function bridgeEvent(e, options, scope) {
  switch (e.type) {
    case "message_update": {
      const out = [];
      const delta = e.assistantMessageEvent;
      if (delta.type === "text_delta" && delta.delta) {
        out.push({ type: "token", content: delta.delta });
      } else if (delta.type === "thinking_delta" && delta.delta) {
        out.push({ type: "reasoning", content: delta.delta });
      }
      return out;
    }
    case "tool_execution_start":
      if (e.toolName === "search_knowledge_base") {
        const args = e.args;
        const query = typeof args?.query === "string" ? args.query : "";
        return [{ type: "knowledge_search", query, kbIds: options.kbIds ?? [] }];
      }
      return [{ type: "tool_start", name: e.toolName }];
    case "tool_execution_end":
      if (e.toolName === "search_knowledge_base") {
        const docs = scope.results;
        const kbNames = [...new Set(docs.map((r) => r.kbName).filter((name) => typeof name === "string"))];
        return [
          {
            type: "knowledge_search",
            query: "",
            kbIds: options.kbIds ?? [],
            kbNames,
            results: readToolResultText(e.result),
            docs
          }
        ];
      }
      return [{ type: "tool_end", name: e.toolName, result: e.result }];
    default:
      return [];
  }
}
function extractAssistantText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const parts = [];
    for (const block of m.content) {
      if (block.type === "text" && block.text) parts.push(block.text);
    }
    if (parts.length > 0) return parts.join("");
  }
  return "";
}
var AiEngine = class {
  /**
   * 建一次会话（模型 + 会话管理器 + 带作用域的检索工具）。
   *
   * 每次调用都是全新闭包作用域：kbIds 与结果收集器互不共享，并发会话不会互相污染。
   */
  async createPiSession(input, options = {}) {
    const scope = createEmptyScope();
    const tool = createKnowledgeSearchTool(options.kbIds ?? [], scope);
    const model = await resolveModel(options.model);
    const sm = buildSessionManager(options.history, options.pi);
    const priorIds = new Set(sm.getEntries().map((e) => e.id));
    const { session } = await createAgentSession({
      model,
      modelRuntime: await getModelRuntime(),
      sessionManager: sm,
      customTools: [tool],
      noTools: "builtin"
    });
    return { session, scope, priorIds };
  }
  /**
   * 普通对话：pi 跑完整一轮后取最后一条 assistant 文本。
   */
  async chat(input, options = {}) {
    const { session } = await this.createPiSession(input, options);
    await session.prompt(input, { source: "rpc" });
    const ctx = session.sessionManager.buildSessionContext();
    return extractAssistantText(ctx.messages);
  }
  /**
   * 流式对话 + 观察整个执行过程（token + reasoning + tool）。
   *
   * pi 的 subscribe 是同步回调，不能直接 yield——事件经 AsyncEventQueue
   * 适配为异步迭代（回调 enqueue，主循环 dequeue 消费），直到 agent_end。
   * 生命周期事件（started / completed / failed）照旧发给 taskBus。
   * 会话持久化由 pi 自动完成（JSONL 文件 append）；结束后仅把本轮新增
   * entry 摘要回传（done 事件关联 user/assistant 消息用）。
   */
  async *streamEvents(input, options = {}) {
    const taskId = newTaskId("chat" /* CHAT */);
    const startedAt = Date.now();
    emit(TaskEvent.STARTED, { taskId, taskType: "chat" /* CHAT */, message: `\u5BF9\u8BDD\uFF1A${input.slice(0, 50)}` });
    try {
      const { session, scope, priorIds } = await this.createPiSession(input, options);
      const queue = new AsyncEventQueue();
      session.subscribe((e) => queue.enqueue(e));
      const runPromise = session.prompt(input, { source: "rpc" });
      void runPromise.then(
        () => queue.close(),
        () => queue.close()
      );
      let ended = false;
      while (!ended) {
        const e = await queue.dequeue();
        if (!e) break;
        for (const ev of bridgeEvent(e, options, scope)) {
          yield ev;
        }
        if (e.type === "agent_end") ended = true;
      }
      await runPromise;
      if (options.onPiSessionSaved) {
        try {
          options.onPiSessionSaved({
            added: diffAddedEntries(session.sessionManager, priorIds),
            leafEntryId: session.sessionManager.getLeafId()
          });
        } catch (saveErr) {
          console.error("[AiEngine] pi \u4F1A\u8BDD\u589E\u91CF\u56DE\u4F20\u5931\u8D25:", saveErr);
        }
      }
      emit(TaskEvent.COMPLETED, { taskId, taskType: "chat" /* CHAT */, durationMs: Date.now() - startedAt });
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      emit(TaskEvent.FAILED, { taskId, taskType: "chat" /* CHAT */, durationMs: Date.now() - startedAt, error: e.message, stack: e.stack });
      throw err;
    }
  }
};
export {
  AiEngine,
  LexicalIndexService,
  RagService,
  TaskEvent,
  TaskType,
  cleanFallbackPageTexts,
  createEmbeddings,
  defaultEmbeddings,
  detectPdfImageBlocks,
  elementsToPageTexts,
  emit,
  isImageSemanticEnabled,
  isPageNumberLine,
  lexicalIndex,
  loadPdf,
  markLocalTables,
  needOcrPage,
  newTaskId,
  normalizeHeadings,
  normalizeParsedText,
  parseDocument,
  parsePdfWithUnstructured,
  ragService,
  reflowBrokenLines,
  semanticizePdfFigures,
  splitTextToChunks,
  taskBus,
  taskContext,
  withTaskEvents
};
