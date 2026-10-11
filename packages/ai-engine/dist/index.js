// src/index.ts
import "dotenv/config";

// src/events.ts
import { EventEmitter } from "events";
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
import { HumanMessage as HumanMessage2 } from "@langchain/core/messages";
import { createAgent } from "langchain";

// src/agent/model.ts
import { ChatOllama } from "@langchain/ollama";
import { DEFAULT_MODEL } from "@langchain-rag/shared/constants";
import { ChatOpenAI } from "@langchain/openai";
var baseConfig = {
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0.7,
  maxTokens: 1024,
  timeout: 6e4,
  configuration: { baseURL: process.env.LLM_BASE_URL }
};
var OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3.5:0.8b";
function createModel(modelName) {
  if (process.env.LLM_PROVIDER === "ollama") {
    const model = modelName && modelName !== DEFAULT_MODEL ? modelName : OLLAMA_MODEL;
    return new ChatOllama({
      baseUrl: process.env.LLM_BASE_URL ?? "http://localhost:11434",
      model,
      think: false,
      temperature: 0.7,
      maxTokens: 1024,
      timeout: 6e4
    });
  }
  return new ChatOpenAI({
    ...baseConfig,
    model: modelName || process.env.LLM_MODEL || DEFAULT_MODEL
  });
}
var defaultModel = createModel();

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
import { tool } from "langchain";
import { z } from "zod";

// src/rag/rag.service.ts
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
var LEXICAL_TABLE_NAME = "rag_bm25_index";
var RAG_EMBEDDING_DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS ?? "1024");

// src/rag/tokenizer.ts
var CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
var WORD_RE = /[a-z0-9_]/;
function scanRuns(text) {
  const s = text.toLowerCase();
  const runs = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (CJK_RE.test(ch)) {
      let j = i;
      while (j < s.length && CJK_RE.test(s[j])) j++;
      runs.push({ type: "cjk", run: s.slice(i, j) });
      i = j;
    } else if (WORD_RE.test(ch)) {
      let j = i;
      while (j < s.length && WORD_RE.test(s[j])) j++;
      runs.push({ type: "word", run: s.slice(i, j) });
      i = j;
    } else {
      i++;
    }
  }
  return runs;
}
function bigrams(run) {
  const out = [];
  for (let x = 0; x + 1 < run.length; x++) out.push(run.slice(x, x + 2));
  return out;
}
function tokenizeForIndex(text) {
  const tokens = [];
  for (const { type, run } of scanRuns(text)) {
    if (type === "word") {
      tokens.push(run);
    } else if (run.length === 1) {
      tokens.push(run);
    } else {
      tokens.push(...run.split(""), ...bigrams(run));
    }
  }
  return tokens;
}
function tokenizeQuery(text) {
  const set = /* @__PURE__ */ new Set();
  for (const { type, run } of scanRuns(text)) {
    if (type === "word") {
      set.add(run);
    } else if (run.length === 1) {
      set.add(run);
    } else {
      for (const bg of bigrams(run)) set.add(bg);
    }
  }
  return [...set];
}

// src/rag/bm25.ts
var BM25_PARAMS = { k1: 1.2, b: 0.75 };
var BM25_SQL = `
WITH params AS (SELECT $4::float8 AS k1, $5::float8 AS b),
docs AS (
  SELECT id, document_id, kb_id, chunk_index, content, kb_name, document_name, tokens, token_count
  FROM ${LEXICAL_TABLE_NAME}
  WHERE $1::int[] IS NULL OR kb_id = ANY($1)
),
corpus AS (
  SELECT count(*)::float8 AS n, coalesce(avg(token_count)::float8, 1) AS avgdl
  FROM docs
),
terms AS (SELECT DISTINCT unnest($2::text[]) AS term),
cands AS (
  SELECT * FROM docs WHERE tokens && $2::text[]
),
df AS (
  SELECT t.term, count(c.id)::float8 AS n_df
  FROM terms t
  LEFT JOIN cands c ON c.tokens @> ARRAY[t.term]
  GROUP BY t.term
),
idf AS (
  SELECT d.term, ln(1 + (co.n - d.n_df + 0.5) / (d.n_df + 0.5)) AS idf
  FROM df d
  CROSS JOIN corpus co
  WHERE d.n_df > 0
),
tf AS (
  SELECT c.id, w.term, count(*)::float8 AS n_tf
  FROM cands c
  JOIN LATERAL unnest(c.tokens) AS w(term) ON true
  JOIN terms t ON t.term = w.term
  GROUP BY c.id, w.term
)
SELECT c.document_id, c.kb_id, c.chunk_index, c.content, c.kb_name, c.document_name,
       sum(i.idf * (tf.n_tf * (p.k1 + 1)) / (tf.n_tf + p.k1 * (1 - p.b + p.b * c.token_count / co.avgdl)))::float8 AS score
FROM tf
JOIN idf i ON i.term = tf.term
JOIN cands c ON c.id = tf.id
CROSS JOIN params p
CROSS JOIN corpus co
GROUP BY c.document_id, c.kb_id, c.chunk_index, c.content, c.kb_name, c.document_name, p.k1, p.b, co.avgdl
ORDER BY score DESC
LIMIT $3
`;
var LexicalIndexService = class {
  pool = null;
  ready = null;
  /** 绑定 pg 连接池（来自 PGVectorStore 内部 pool），首次使用时建表 + 回填 */
  attach(pool) {
    if (this.pool) return;
    this.pool = pool;
    this.ready = this.init();
  }
  async init() {
    const pool = this.pool;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${LEXICAL_TABLE_NAME} (
        id            serial PRIMARY KEY,
        document_id   int  NOT NULL,
        kb_id         int  NOT NULL,
        chunk_index   int  NOT NULL,
        content       text NOT NULL,
        kb_name       text,
        document_name text,
        tokens        text[] NOT NULL,
        token_count   int  NOT NULL
      )
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS lexical_tokens_idx ON ${LEXICAL_TABLE_NAME} USING GIN (tokens)`
    );
    await pool.query(`CREATE INDEX IF NOT EXISTS lexical_doc_idx ON ${LEXICAL_TABLE_NAME} (document_id)`);
    await this.backfillFromVectorStore();
  }
  /**
   * 一次性回填：BM25 表是空的、但向量表里已有历史切片时，
   * 从向量表把 content+metadata 搬过来补建词法索引（否则老文档永远搜不到关键词）。
   */
  async backfillFromVectorStore() {
    const pool = this.pool;
    const lex = await pool.query(`SELECT count(*)::int AS n FROM ${LEXICAL_TABLE_NAME}`);
    if (lex.rows[0].n > 0) return;
    const res = await pool.query(
      `SELECT content, metadata FROM ${RAG_TABLE_NAME} WHERE (metadata->>'documentId') IS NOT NULL`
    );
    const chunks = [];
    for (const row of res.rows) {
      const m = row.metadata;
      if (m.documentId == null || m.kbId == null || m.chunkIndex == null || !row.content) continue;
      chunks.push({
        index: Number(m.chunkIndex),
        content: row.content,
        kbId: Number(m.kbId),
        documentId: Number(m.documentId),
        kbName: m.kbName,
        documentName: m.documentName
      });
    }
    const BATCH = 500;
    for (let i = 0; i < chunks.length; i += BATCH) {
      await this.insertChunks(chunks.slice(i, i + BATCH));
    }
  }
  async waitReady() {
    if (this.ready) await this.ready;
  }
  /** 写入一批切片的词法索引 */
  async addChunks(kbId, documentId, names, chunks) {
    await this.waitReady();
    if (chunks.length === 0) return;
    await this.insertChunks(
      chunks.map((c) => ({
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
    const pool = this.pool;
    const values = [];
    const tuples = chunks.map((c, i) => {
      const base = i * 8;
      const tokens = tokenizeForIndex(c.content);
      values.push(
        c.documentId,
        c.kbId,
        c.index,
        c.content,
        c.kbName ?? null,
        c.documentName ?? null,
        tokens,
        tokens.length
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}::text[], $${base + 8})`;
    });
    await pool.query(
      `INSERT INTO ${LEXICAL_TABLE_NAME}
         (document_id, kb_id, chunk_index, content, kb_name, document_name, tokens, token_count)
       VALUES ${tuples.join(", ")}`,
      values
    );
  }
  /** 删除某文档的全部词法索引 */
  async deleteByDocumentId(documentId) {
    await this.waitReady();
    await this.pool.query(`DELETE FROM ${LEXICAL_TABLE_NAME} WHERE document_id = $1`, [documentId]);
  }
  /** BM25 关键词检索 */
  async search(query, options = {}) {
    await this.waitReady();
    const { kbIds, k = 5 } = options;
    const tokens = tokenizeQuery(query);
    if (tokens.length === 0) return [];
    const res = await this.pool.query(BM25_SQL, [
      kbIds && kbIds.length > 0 ? kbIds : null,
      tokens,
      k,
      BM25_PARAMS.k1,
      BM25_PARAMS.b
    ]);
    return res.rows.map((r) => ({
      content: r.content,
      documentId: Number(r.document_id),
      kbId: Number(r.kb_id),
      kbName: r.kb_name ?? void 0,
      documentName: r.document_name ?? void 0,
      chunkIndex: Number(r.chunk_index),
      score: Number(r.score),
      matchType: "keyword"
    }));
  }
};
var lexicalIndex = new LexicalIndexService();

// src/rag/query-rewrite.ts
var QUERY_REWRITE_ENABLED = (process.env.QUERY_REWRITE_ENABLED ?? "false").trim().toLowerCase() === "true";
var TIMEOUT_MS = Number(process.env.QUERY_REWRITE_TIMEOUT_MS ?? "3000");
var REWRITE_PROMPT = `\u4F60\u662F\u68C0\u7D22\u67E5\u8BE2\u4F18\u5316\u52A9\u624B\u3002\u628A\u7528\u6237\u95EE\u9898\u6539\u5199\u6210\u66F4\u9002\u5408\u5728\u4EA7\u54C1\u8BF4\u660E\u4E66\u77E5\u8BC6\u5E93\u4E2D\u68C0\u7D22\u7684\u5F62\u5F0F\u3002

\u8981\u6C42\uFF1A
1. \u63D0\u53D6\u6838\u5FC3\u5B9E\u4F53\u3001\u578B\u53F7\u3001\u53C2\u6570\uFF08\u5982 N6 mini\u3001\u7535\u6C60\u3001\u5145\u7535\uFF09
2. \u8865\u5145\u540C\u4E49\u8BCD\u548C\u4E66\u9762\u8868\u8FBE\uFF08\u53E3\u8BED \u2192 \u4E66\u9762\uFF09
3. \u53BB\u6389\u8BED\u6C14\u8BCD\u3001\u5BA2\u5957\u8BDD\u3001\u7591\u95EE\u52A9\u8BCD
4. \u4FDD\u6301\u539F\u610F\uFF0C\u4E0D\u8981\u65B0\u589E\u95EE\u9898\u91CC\u6CA1\u6709\u7684\u4FE1\u606F
5. \u53EA\u8F93\u51FA\u6539\u5199\u540E\u7684\u67E5\u8BE2\u672C\u8EAB\uFF0C\u4E0D\u8981\u89E3\u91CA\uFF0C\u4E0D\u8981\u5F15\u53F7

\u4F8B\u5B50\uFF1A
\u7528\u6237\uFF1A"\u8FD9\u4E2A\u68B3\u5B50\u5145\u4E00\u6B21\u7535\u80FD\u7528\u591A\u4E45\u554A"
\u6539\u5199\uFF1A"N6 mini \u5145\u7535\u65F6\u95F4 \u7EED\u822A \u4E00\u6B21\u5145\u7535\u4F7F\u7528\u65F6\u957F"

\u7528\u6237\uFF1A"\u7EA2\u706F\u4E00\u76F4\u95EA\u662F\u600E\u4E48\u56DE\u4E8B"
\u6539\u5199\uFF1A"\u5145\u7535\u6307\u793A\u706F \u7EA2\u8272\u95EA\u70C1 \u6545\u969C \u5F02\u5E38\u72B6\u6001"

\u7528\u6237\u95EE\u9898\uFF1A`;
async function rewriteQuery(original) {
  if (!QUERY_REWRITE_ENABLED) return { rewritten: original, used: false };
  if (original.trim().length < 6) return { rewritten: original, used: false };
  try {
    const model = defaultModel.bind({ maxTokens: 60, temperature: 0 });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await model.invoke(`${REWRITE_PROMPT}${original}`, {
      signal: controller.signal
    });
    clearTimeout(timer);
    const text = (res.content?.toString() ?? "").trim().replace(/^["'"]|["'"]$/g, "").trim();
    if (!text || text === original || text.length > 200) {
      return { rewritten: original, used: false };
    }
    return { rewritten: text, used: true };
  } catch (err) {
    console.warn(
      `[query-rewrite] \u6539\u5199\u5931\u8D25\uFF1A${err instanceof Error ? err.message : String(err)}\uFF0Cfallback \u539F query`
    );
    return { rewritten: original, used: false };
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
async function parsePdfWithUnstructured(pdfBuffer, _options = {}) {
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
        console.warn(
          `[unstructured] \u7B2C ${attempt} \u6B21\u89E3\u6790\u672A\u6210\u529F\uFF0C${2 * attempt}s \u540E\u91CD\u8BD5\uFF1A${err instanceof Error ? err.message : String(err)}`
        );
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
      cells.push(cellMatch[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
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
        console.warn(
          `[image-semantic] \u7B2C ${fig.page} \u9875\u56FE\u7247\u8BED\u4E49\u5316\u5931\u8D25\uFF08\u5DF2\u8DF3\u8FC7\uFF09\uFF1A${err instanceof Error ? err.message : String(err)}`
        );
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
  throw new Error(
    `PDF \u6587\u4EF6\u8D85\u8FC7 ${PDF_DIRECT_LIMIT_BYTES / 1024 / 1024}MB \u4E14${reason}\uFF0C\u8D85\u51FA\u767E\u5EA6\u6587\u6863\u89E3\u6790 pdf_file \u76F4\u4F20\u4E0A\u9650\uFF08\u7F16\u7801\u540E 4M\uFF09\uFF0C\u8BF7\u538B\u7F29\u6216\u62C6\u5206\u540E\u91CD\u8BD5`
  );
}
var MIN_TEXT_CHARS = 20;
var MIN_CJK_CHARS = 5;
function needOcrPage(pageText) {
  const text = pageText.trim();
  if (text.length < MIN_TEXT_CHARS) return true;
  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  if (cjkCount >= MIN_CJK_CHARS) return false;
  if ((text.match(/\uFFFD/g) ?? []).length / text.length > 0.1) return true;
  const usableRatio = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u3000-\u303f\uff00-\uffef\x00-\x7f]/g) ?? []).length / text.length;
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
    return pageTexts.map((t) => t.split("\n").filter((l) => !isPageNumberLine(l)).join("\n"));
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
        console.warn(
          `[loadPdf] \u56FE\u7247\u8BED\u4E49\u5316\u6574\u4F53\u5931\u8D25\uFF08\u5DF2\u5FFD\u7565\uFF09\uFF1A${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    structured.forEach((text, i) => {
      if (!scanPageSet.has(i + 1)) pageTexts[i] = text;
    });
  } catch (err) {
    console.warn(
      `[loadPdf] Unstructured \u7248\u9762\u5206\u6790\u5931\u8D25\uFF0C\u6587\u672C\u5C42\u9875\u56DE\u9000\u672C\u5730\u63D0\u53D6\uFF1A${err instanceof Error ? err.message : String(err)}`
    );
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
    console.warn(
      `[loadPdf] \u672C\u5730\u6587\u672C\u5C42\u63A2\u6D4B\u5931\u8D25\uFF0C\u6574\u4EFD\u6587\u6863\u8D70 OCR\uFF1A${err instanceof Error ? err.message : String(err)}`
    );
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
import { readFileSync as readFileSync2 } from "fs";
import { Document } from "@langchain/core/documents";
async function loadMarkdown(filePath) {
  const content = readFileSync2(filePath, "utf-8");
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
    this.vectorStore = await PGVectorStore.initialize(this.embeddings, {
      ...config,
      dimensions: RAG_EMBEDDING_DIMENSIONS
    });
    lexicalIndex.attach(this.vectorStore.pool);
    return this.vectorStore;
  }
  /**
   * 索引文档：切片 + 向量化，返回切片数据供后端写 DB
   *
   * @param kbId 知识库 ID
   * @param documentId 文档 ID
   * @param content 文档全文
   * @param names 知识库名称 / 文档文件名（存入 vector metadata，检索时直接返回）
   * @param taskId 可选：外层任务已存在时复用其 taskId（跳过 started/completed 生命周期，
   *               只发 progress），避免「上传」外层任务与「索引」内层任务嵌套成两个 taskId、
   *               前端按第一个锚定后丢掉内层事件
   * @param stepOffset 步骤起始编号（外层任务已用掉 step1/2 时从 3 开始）
   * @returns 切片列表（含序号和 token 估算）
   */
  async indexDocument(kbId, documentId, content, names, taskId, stepOffset = 1) {
    if (taskId) {
      return this.vectorize(kbId, documentId, content, names, taskId, stepOffset);
    }
    return withTaskEvents(
      "document_index" /* DOCUMENT_INDEX */,
      { kbId, documentId, message: `\u7D22\u5F15\u6587\u6863 #${documentId}` },
      (tid) => this.vectorize(kbId, documentId, content, names, tid, stepOffset)
    );
  }
  /**
   * 重建索引（编辑保存专用）：删除旧向量 → 内容就绪 → 数据清洗 → 重新切片 → 重新向量化
   *
   * 事件序列与前端 5 步条（重建索引/数据清洗/切片/向量化/完成）一一对应：
   *   step(offset)     重建索引：删除旧向量
   *   step(offset+1)   数据清洗完成（CRLF / BOM 归一）
   *   step(offset+2)   切片完成（vectorize 发出）
   *   step(offset+3)   向量化完成（vectorize 发出）
   *
   * 编辑内容来自编辑器（非文件），无需「解析」步骤；与新建链路（createDocument）
   * 保持同一套步骤语义（数据清洗/切片/向量化/完成），仅多出「重建索引」第一步；
   * 编辑内容同样走 normalizeParsedText 统一清洗，保证进入切片前的格式一致。
   */
  async reindexDocument(documentId, kbId, content, names, taskId, stepOffset = 1) {
    const cleaned = normalizeParsedText(content, true);
    if (taskId) {
      await this.deleteByDocumentId(documentId);
      emit(TaskEvent.PROGRESS, { taskId, taskType: "document_index" /* DOCUMENT_INDEX */, step: stepOffset, message: "\u91CD\u5EFA\u7D22\u5F15\uFF1A\u5220\u9664\u65E7\u5411\u91CF" });
      emit(TaskEvent.PROGRESS, { taskId, taskType: "document_index" /* DOCUMENT_INDEX */, step: stepOffset + 1, message: "\u6570\u636E\u6E05\u6D17\u5B8C\u6210\uFF08CRLF / BOM \u5F52\u4E00\uFF09\uFF0C\u5F00\u59CB\u5207\u7247\u4E0E\u5411\u91CF\u5316" });
      return this.vectorize(kbId, documentId, cleaned, names, taskId, stepOffset + 2);
    }
    return withTaskEvents("document_index" /* DOCUMENT_INDEX */, { kbId, documentId, message: `\u91CD\u5EFA\u7D22\u5F15\u6587\u6863 #${documentId}` }, async (tid) => {
      await this.deleteByDocumentId(documentId);
      emit(TaskEvent.PROGRESS, { taskId: tid, taskType: "document_index" /* DOCUMENT_INDEX */, step: 1, message: "\u91CD\u5EFA\u7D22\u5F15\uFF1A\u5220\u9664\u65E7\u5411\u91CF" });
      emit(TaskEvent.PROGRESS, { taskId: tid, taskType: "document_index" /* DOCUMENT_INDEX */, step: 2, message: "\u6570\u636E\u6E05\u6D17\u5B8C\u6210\uFF08CRLF / BOM \u5F52\u4E00\uFF09\uFF0C\u5F00\u59CB\u5207\u7247\u4E0E\u5411\u91CF\u5316" });
      return this.vectorize(kbId, documentId, cleaned, names, tid, 3);
    });
  }
  /**
   * 切片 + 向量化核心逻辑（不发 started/completed，由 withTaskEvents 统一发）
   *
   * @param taskId 任务 ID（用于发进度事件）
   * @param stepOffset 步骤偏移（重建索引时前面多了"删旧向量"一步）
   */
  async vectorize(kbId, documentId, content, names, taskId, stepOffset = 1) {
    const texts = await splitTextToChunks(content, { preserveTables: true });
    if (texts.length === 0) return [];
    emit(TaskEvent.PROGRESS, { taskId, taskType: "document_index" /* DOCUMENT_INDEX */, step: stepOffset, message: `\u5207\u7247\u5B8C\u6210\uFF08${texts.length} \u7247\uFF09\uFF0C\u5F00\u59CB\u5411\u91CF\u5316` });
    const store = await this.getStore();
    const docs = texts.map(
      (text, i) => new Document2({
        pageContent: text,
        metadata: {
          documentId,
          kbId,
          chunkIndex: i + 1,
          kbName: names?.kbName,
          documentName: names?.documentName
        }
      })
    );
    await store.addDocuments(docs);
    await lexicalIndex.addChunks(
      kbId,
      documentId,
      { kbName: names?.kbName, documentName: names?.documentName },
      texts.map((text, i) => ({ content: text, index: i + 1 }))
    );
    emit(TaskEvent.PROGRESS, { taskId, taskType: "document_index" /* DOCUMENT_INDEX */, step: stepOffset + 1, message: "\u5411\u91CF\u5316\u5B8C\u6210" });
    return texts.map((text, i) => ({
      content: text,
      index: i + 1,
      tokenCount: Math.ceil(text.length / 2)
    }));
  }
  /**
   * 检索（默认混合模式）
   *
   * - semantic：向量余弦相似度，长于语义近似（"如何请假" 能命中 "休假申请流程"）
   * - keyword：BM25 词法匹配，长于精确词（型号、错误码、人名等专有名词）
   * - hybrid：两路各取候选，用 RRF 融合排名 —— rank 求和不用原始分，
   *   天然规避"余弦分 0~1 与 BM25 分无上界"不可比的问题
   *
   * @param query 用户问题
   * @param options.kbIds 限制在指定知识库
   * @param options.k top-K
   * @param options.mode 检索模式，默认 hybrid
   */
  async search(query, options = {}) {
    const { kbIds, k = 5, mode = "hybrid" } = options;
    const fetchK = Math.max(k * 2, 10);
    return withTaskEvents("rag_search" /* RAG_SEARCH */, { kbIds, message: `\u68C0\u7D22\uFF1A${query.slice(0, 50)}` }, async () => {
      await this.getStore();
      const { rewritten } = await rewriteQuery(query);
      const searchQuery = rewritten;
      const lists = [];
      if (mode !== "keyword") lists.push(await this.semanticSearch(searchQuery, kbIds, fetchK));
      if (mode !== "semantic") lists.push(await lexicalIndex.search(searchQuery, { kbIds, k: fetchK }));
      if (mode !== "hybrid") return lists[0].slice(0, k);
      return fuseRrf(lists, k);
    });
  }
  /** 向量相似度检索 */
  async semanticSearch(query, kbIds, k) {
    const store = await this.getStore();
    const filter = kbIds && kbIds.length > 0 ? { kbId: { in: kbIds } } : void 0;
    const results = await store.similaritySearchWithScore(query, k, filter);
    return results.map(([doc, score]) => {
      const metadata = doc.metadata;
      return {
        content: doc.pageContent,
        documentId: metadata.documentId,
        kbId: metadata.kbId,
        kbName: metadata.kbName,
        documentName: metadata.documentName,
        chunkIndex: metadata.chunkIndex,
        score,
        matchType: "semantic"
      };
    });
  }
  /**
   * 删除某个文档的所有索引（向量 + BM25 词法）
   *
   * PGVectorStore 通过 metadata 过滤删除
   */
  async deleteByDocumentId(documentId) {
    const store = await this.getStore();
    await store.delete({ filter: { documentId } });
    await lexicalIndex.deleteByDocumentId(documentId);
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
  const tableBlocks = [];
  const textBlocks = [];
  let current = [];
  let table = [];
  let inTable = false;
  const flushText = () => {
    if (current.length) {
      textBlocks.push(current.join("\n"));
      current = [];
    }
  };
  const flushTable = () => {
    if (table.length) {
      tableBlocks.push(table.join("\n"));
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
  return { tableBlocks, textBlocks };
}
async function splitTextToChunks(text, options) {
  if (options?.preserveTables) {
    const { tableBlocks, textBlocks } = extractTableBlocks(text);
    const chunks = [...tableBlocks];
    for (const block of textBlocks) {
      chunks.push(...await splitTextInternal(block));
    }
    return chunks.filter(Boolean);
  }
  return splitTextInternal(text);
}
async function splitTextInternal(text) {
  const chunkSize = Number(process.env.CHUNK_SIZE) || 350;
  const chunkOverlap = Number(process.env.CHUNK_OVERLAP) || 40;
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
function isRetrievalScope(value) {
  return typeof value === "object" && value !== null && "results" in value && Array.isArray(value.results);
}
function readRetrievalScope(config) {
  const raw = config?.configurable?.retrieval;
  return isRetrievalScope(raw) ? raw : void 0;
}
function readScopedKbIds(config) {
  const raw = config?.configurable?.kbIds;
  if (!Array.isArray(raw)) return [];
  return raw.filter((value) => typeof value === "number");
}
var MATCH_LABELS = {
  both: "\u8BED\u4E49+\u5173\u952E\u8BCD",
  semantic: "\u8BED\u4E49",
  keyword: "\u5173\u952E\u8BCD"
};
var knowledgeSearchTool = tool(
  async ({ query }, config) => {
    const kbIds = readScopedKbIds(config);
    if (kbIds.length === 0) {
      return "\u5F53\u524D\u4F1A\u8BDD\u672A\u6307\u5B9A\u77E5\u8BC6\u5E93\uFF0C\u65E0\u6CD5\u68C0\u7D22\u3002\u8BF7\u63D0\u793A\u7528\u6237\u5148\u9009\u62E9\u8981\u67E5\u8BE2\u7684\u77E5\u8BC6\u5E93\u3002";
    }
    const results = await ragService.search(query, { kbIds, k: 5 });
    appendScopedResults(readRetrievalScope(config), results);
    if (results.length === 0) {
      return "\u672A\u627E\u5230\u76F8\u5173\u6587\u6863\u3002\u8BF7\u544A\u77E5\u7528\u6237\u5F53\u524D\u77E5\u8BC6\u5E93\u4E2D\u6CA1\u6709\u5339\u914D\u7684\u4FE1\u606F\u3002";
    }
    return results.map(
      (r, i) => `[\u6587\u6863\u7247\u6BB5 ${i + 1}] \u6765\u6E90: ${r.kbName ?? `\u77E5\u8BC6\u5E93#${r.kbId}`}${r.documentName ? `/${r.documentName}` : ""} (\u5339\u914D: ${MATCH_LABELS[r.matchType] ?? r.matchType}, \u5F97\u5206: ${(r.score * 100).toFixed(1)}%)
${r.content}`
    ).join("\n\n");
  },
  {
    name: "search_knowledge_base",
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
    schema: z.object({
      query: z.string().describe("\u68C0\u7D22\u67E5\u8BE2\u8BED\u53E5\uFF1B\u5EFA\u8BAE\u4F7F\u7528\u95EE\u9898\u4E2D\u7684\u5173\u952E\u8BCD\uFF0C\u9996\u6B21\u4E0D\u7406\u60F3\u65F6\u53EF\u6362\u7528\u578B\u53F7\u3001\u6545\u969C\u7801\u7B49\u529F\u80FD\u5173\u952E\u8BCD")
    })
  }
);

// src/libs/messages.ts
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
function toLangChainMessages(messages) {
  return messages.map((m) => {
    switch (m.role) {
      case "user":
        return new HumanMessage(m.content);
      case "assistant":
        return new AIMessage(m.content);
      case "system":
        return new SystemMessage(m.content);
    }
  });
}

// src/agent/index.ts
function readQuery(data) {
  if (typeof data !== "object" || data === null || !("input" in data)) return "";
  const wrapper = data.input;
  if (typeof wrapper !== "object" || wrapper === null || !("input" in wrapper)) return "";
  const serialized = wrapper.input;
  if (typeof serialized !== "string") return "";
  try {
    const parsed = JSON.parse(serialized);
    if (typeof parsed === "object" && parsed !== null && "query" in parsed && typeof parsed.query === "string") {
      return parsed.query;
    }
  } catch {
  }
  return "";
}
function readToolOutput(output) {
  if (typeof output === "string") return output;
  if (typeof output === "object" && output !== null && "content" in output && typeof output.content === "string") {
    return output.content;
  }
  return void 0;
}
var AiEngine = class _AiEngine {
  /**
   * Agent 全局单例
   */
  static agent = createAgent({
    model: defaultModel,
    tools: [knowledgeSearchTool],
    systemPrompt
  });
  /** 获取 agent（需要切换模型时创建新实例） */
  getAgent(modelName) {
    const currentModel = defaultModel.model;
    if (!modelName || modelName === currentModel) return _AiEngine.agent;
    return createAgent({
      model: createModel(modelName),
      tools: [knowledgeSearchTool],
      systemPrompt
    });
  }
  /**
   * 普通对话
   */
  async chat(input, options = {}) {
    const messages = [...toLangChainMessages(options.history ?? []), new HumanMessage2(input)];
    const res = await this.getAgent(options.model).invoke(
      { messages },
      { configurable: { kbIds: options.kbIds } }
    );
    const last = res.messages.at(-1);
    return typeof last?.content === "string" ? last.content : JSON.stringify(last?.content);
  }
  /**
   * 流式对话
   */
  async *stream(input, options = {}) {
    const messages = [...toLangChainMessages(options.history ?? []), new HumanMessage2(input)];
    const stream = await this.getAgent(options.model).stream(
      { messages },
      { streamMode: "messages", configurable: { kbIds: options.kbIds } }
    );
    for await (const [chunk] of stream) {
      if (typeof chunk.content === "string") {
        yield chunk.content;
      }
    }
  }
  /**
   * 流式对话 + 观察整个执行过程（token + tool + chain）
   *
   * 流式是 AsyncGenerator，包不进 withTaskEvents，手动发三段生命周期事件：
   * started → （逐 token 流式）→ completed / failed。
   * 工具调用的明细不再单独 emit——前端经 SSE 的 tool_start/tool_end 已能看到。
   *
   * 检索完全交给 agent：这里不做预检索，由模型自行决定是否调用检索工具。
   * 检索作用域（kbIds）与结果归属都经 `configurable` 下传给工具，
   * 结果写在每次调用新建的 `retrieval` 对象上——不用模块级变量，并发会话不会互相污染。
   */
  async *streamEvents(input, options = {}) {
    const taskId = newTaskId("chat" /* CHAT */);
    const startedAt = Date.now();
    emit(TaskEvent.STARTED, { taskId, taskType: "chat" /* CHAT */, message: `\u5BF9\u8BDD\uFF1A${input.slice(0, 50)}` });
    const retrieval = { results: [] };
    try {
      const messages = [...toLangChainMessages(options.history ?? []), new HumanMessage2(input)];
      const stream = await this.getAgent(options.model).streamEvents(
        { messages },
        { version: "v2", configurable: { kbIds: options.kbIds, retrieval } }
      );
      for await (const event of stream) {
        switch (event.event) {
          case "on_chat_model_stream": {
            const chunk = event.data.chunk;
            const reasoning = chunk.additional_kwargs?.reasoning || chunk.additional_kwargs?.reasoning_content;
            if (typeof reasoning === "string" && reasoning) {
              yield { type: "reasoning", content: reasoning };
            }
            if (typeof chunk.content === "string" && chunk.content) {
              yield { type: "token", content: chunk.content };
            }
            break;
          }
          // 知识库检索工具 → 专用事件，前端可展示检索状态 + 知识库名称
          case "on_tool_start":
            if (event.name === "search_knowledge_base") {
              yield { type: "knowledge_search", query: readQuery(event.data), kbIds: options.kbIds };
            } else {
              yield { type: "tool_start", name: event.name };
            }
            break;
          case "on_tool_end":
            if (event.name === "search_knowledge_base") {
              const docs = retrieval.results;
              const kbNames = [...new Set(docs.map((r) => r.kbName).filter((name) => typeof name === "string"))];
              yield {
                type: "knowledge_search",
                query: "",
                kbIds: options.kbIds,
                kbNames,
                results: readToolOutput(event.data.output),
                docs
              };
            } else {
              yield {
                type: "tool_end",
                name: event.name,
                result: readToolOutput(event.data.output)
              };
            }
            break;
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
  BM25_PARAMS,
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
  tokenizeForIndex,
  tokenizeQuery,
  withTaskEvents
};
