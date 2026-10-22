const { test } = require("node:test");
const assert = require("node:assert/strict");
const { RagService, lexicalIndex, splitTextToChunks, taskContext, emit, taskBus, TaskEvent } = require("../packages/ai-engine/dist/index.js");
const { scoreItem, aggregate } = require("../eval/scorer.cjs");

const embeddings = { embedQuery: async () => [1, 0], embedDocuments: async (texts) => texts.map(() => [1, 0]) };

function service(t) {
  const rag = new RagService(embeddings);
  const calls = [];
  rag.vectorStore = {
    pool: {
      query: async (sql, args) => {
        calls.push({ sql, args });
        return { rows: [{ id: 7, revision: "old" }] };
      },
    },
    addDocuments: async (docs) => {
      calls.push({ docs });
    },
    delete: async (filter) => {
      calls.push({ deleted: filter });
    },
  };
  t.mock.method(lexicalIndex, "addChunks", async () => {});
  t.mock.method(lexicalIndex, "deleteByDocumentId", async () => {});
  return { rag, calls };
}

test("table and text chunks preserve source order", async () => {
  const chunks = await splitTextToChunks("前言\n\n| 参数 | 值 |\n| --- | --- |\n| 电量 | 100 |\n\n结尾", { preserveTables: true });
  assert.equal(chunks[0], "前言");
  assert.match(chunks[1], /电量/);
  assert.equal(chunks[2], "结尾");
});

test("chunk overlap supports zero and invalid ranges fail clearly", async () => {
  const size = process.env.CHUNK_SIZE;
  const overlap = process.env.CHUNK_OVERLAP;
  try {
    process.env.CHUNK_SIZE = "10";
    process.env.CHUNK_OVERLAP = "0";
    assert.equal((await splitTextToChunks("01234567890123456789")).join(""), "01234567890123456789");
    process.env.CHUNK_OVERLAP = "10";
    await assert.rejects(splitTextToChunks("text"), /切片参数无效/);
  } finally {
    if (size === undefined) delete process.env.CHUNK_SIZE;
    else process.env.CHUNK_SIZE = size;
    if (overlap === undefined) delete process.env.CHUNK_OVERLAP;
    else process.env.CHUNK_OVERLAP = overlap;
  }
});

test("staging writes a new version without deleting or activating the old one", async (t) => {
  const { rag, calls } = service(t);
  const prepared = await rag.prepareDocument(1, 7, "新内容");
  assert.ok(prepared.revision);
  assert.equal(calls[0].docs[0].metadata.revision, prepared.revision);
  assert.equal(
    calls.some((c) => c.deleted || c.sql),
    false,
  );
});

test("partial ES write failure only removes the failed staged revision", async (t) => {
  const { rag, calls } = service(t);
  lexicalIndex.addChunks.mock.mockImplementation(async () => {
    throw new Error("ES offline");
  });
  await assert.rejects(rag.prepareDocument(1, 7, "新内容"), /ES offline/);
  const staged = calls.find((c) => c.docs).docs[0].metadata.revision;
  assert.deepEqual(calls.find((c) => c.deleted).deleted, { filter: { documentId: 7, revision: staged } });
});

test("retrieval starts both routes concurrently and keeps a surviving route", async (t) => {
  const { rag } = service(t);
  let release;
  let semanticStarted = false;
  let lexicalStarted = false;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  t.mock.method(rag, "semanticSearch", async () => {
    semanticStarted = true;
    await blocked;
    throw new Error("embedding offline");
  });
  t.mock.method(lexicalIndex, "search", async () => {
    lexicalStarted = true;
    return [{ content: "证据", documentId: 7, kbId: 1, chunkIndex: 1, score: 1, matchType: "keyword" }];
  });
  const pending = rag.search("查询");
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(semanticStarted && lexicalStarted);
  release();
  assert.equal((await pending)[0].content, "证据");
});

test("both failed routes surface a service error rather than a false no-answer", async (t) => {
  const { rag } = service(t);
  t.mock.method(rag, "semanticSearch", async () => {
    throw new Error("offline");
  });
  t.mock.method(lexicalIndex, "search", async () => {
    throw new Error("offline");
  });
  await assert.rejects(rag.search("查询"), /均不可用/);
  assert.deepEqual(await rag.search("查询", { kbIds: [] }), []);
});

test("adversarial recall cannot be classified as hallucination or dilute normal metrics", () => {
  const normal = scoreItem({ id: "n", expect_keywords: ["证据"] }, [{ content: "证据" }], [5]);
  const trap = scoreItem({ id: "a", type: "adversarial", expect_doc: "产品" }, [{ content: "相关内容", documentName: "产品" }], [5]);
  assert.equal(trap.hit, null);
  assert.equal(trap.mrr, null);
  assert.equal(aggregate([normal, trap], [5])["hit@5"], 1);
  assert.equal(aggregate([normal, trap], [5]).questions, 1);
});

test("task events keep concurrent request ownership", async () => {
  const events = [];
  const listener = (event) => events.push(event);
  taskBus.on(TaskEvent.PROGRESS, listener);
  try {
    await Promise.all(
      [1, 2].map((userId) =>
        taskContext.run({ userId }, async () => {
          await new Promise((resolve) => setImmediate(resolve));
          emit(TaskEvent.PROGRESS, { taskId: String(userId), taskType: "document_index" });
        }),
      ),
    );
    assert.deepEqual(
      events.map((e) => [e.taskId, e.userId]),
      [
        ["1", 1],
        ["2", 2],
      ],
    );
  } finally {
    taskBus.off(TaskEvent.PROGRESS, listener);
  }
});
