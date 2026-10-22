/** 只允许针对显式创建的隔离库/索引运行，绝不清空业务数据。 */
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const backendRequire = createRequire(require.resolve("../../apps/backend/package.json"));
const { Pool } = backendRequire("pg");
const enabled = process.env.DATABASE_URL?.includes("/codex_rag_test_") && process.env.ES_INDEX_NAME?.startsWith("codex_rag_test_");
let rag;
let pool;
let lexicalIndex;

after(async () => {
  if (rag?.vectorStore) await rag.vectorStore.end();
  if (lexicalIndex?.client) await lexicalIndex.client.close();
  if (pool) await pool.end();
});

test("real PGvector + Elasticsearch: stage, fail, activate, delete and hide KB", { skip: !enabled }, async () => {
  const engine = require("../../packages/ai-engine/dist/index.js");
  lexicalIndex = engine.lexicalIndex;
  const vector = (text) => {
    const values = Array(1024).fill(0);
    values[text.includes("新版") ? 1 : 0] = 1;
    return values;
  };
  rag = new engine.RagService({ embedQuery: async (text) => vector(text), embedDocuments: async (texts) => texts.map(vector) });
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(`INSERT INTO "user" (id, name, email, password, updated_at) VALUES (1, 'test', 'test@example.com', 'not-a-real-password', now())`);
  await pool.query(`INSERT INTO knowledge_base (id, user_id, name, updated_at) VALUES (1, 1, 'test', now())`);
  await pool.query(
    `INSERT INTO knowledge_document (id, knowledge_base_id, user_id, file_name, file_type, content, status, updated_at) VALUES (1, 1, 1, 'test.md', 'md', '旧版电池参数', 4, now())`,
  );

  const old = await rag.prepareDocument(1, 1, "旧版电池参数", { documentName: "test.md" });
  assert.deepEqual(await rag.search("电池", { kbIds: [1] }), [], "staged document must not be searchable");
  await pool.query("UPDATE knowledge_document SET status = 1, index_revision = $1 WHERE id = 1", [old.revision]);
  assert.equal((await rag.search("电池", { kbIds: [1] }))[0].content, "旧版电池参数");

  const next = await rag.prepareDocument(1, 1, "新版电池参数", { documentName: "test.md" });
  const beforeCommit = await rag.search("电池", { kbIds: [1] });
  assert.ok(
    beforeCommit.every((r) => r.content === "旧版电池参数"),
    "new version hidden until atomic activation",
  );
  const add = lexicalIndex.addChunks;
  lexicalIndex.addChunks = async () => {
    throw new Error("simulated ES failure");
  };
  try {
    await assert.rejects(rag.prepareDocument(1, 1, "失败版本电池"), /simulated ES failure/);
  } finally {
    lexicalIndex.addChunks = add;
  }
  assert.equal((await rag.search("电池", { kbIds: [1] }))[0].content, "旧版电池参数");

  await pool.query("UPDATE knowledge_document SET index_revision = $1 WHERE id = 1", [next.revision]);
  const activated = await rag.search("新版电池", { kbIds: [1] });
  assert.equal(activated.length, 1);
  assert.equal(activated[0].content, "新版电池参数");
  assert.equal(activated[0].matchType, "both");

  await pool.query("UPDATE knowledge_document SET status = 3 WHERE id = 1");
  assert.deepEqual(await rag.search("电池", { kbIds: [1] }), [], "soft deletion hides vectors even before cleanup");
  await pool.query("UPDATE knowledge_document SET status = 1 WHERE id = 1");
  await pool.query("UPDATE knowledge_base SET status = 3 WHERE id = 1");
  assert.deepEqual(await rag.search("电池", { kbIds: [1] }), [], "deleted knowledge base hides all indexes");
  await rag.deleteByDocumentId(1);
});

test("real HTTP: authentication, cookies, document/conversation ownership and parsing", { skip: !enabled }, async () => {
  const { spawn } = require("node:child_process");
  const path = require("node:path");
  // The preceding fixture inserts explicit IDs; advance sequences before registration.
  for (const table of ["user", "knowledge_base", "knowledge_document"]) {
    await pool.query(`SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), (SELECT MAX(id) FROM "${table}"))`);
  }
  const { createServer } = require("node:http");
  let failEmbedding = false;
  const embedding = createServer(async (request, response) => {
    const body = [];
    for await (const chunk of request) body.push(chunk);
    JSON.parse(Buffer.concat(body).toString());
    response.setHeader("Content-Type", "application/json");
    response.statusCode = failEmbedding ? 400 : 200;
    response.end(JSON.stringify(failEmbedding ? { error: "simulated embedding failure" } : { data: { embedding: [1, ...Array(1023).fill(0)] } }));
  });
  await new Promise((resolve) => embedding.listen(0, "127.0.0.1", resolve));
  const embeddingPort = embedding.address().port;
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  let logs = "";
  const backend = spawn(process.execPath, [path.resolve(__dirname, "../../apps/backend/dist/main.js")], {
    cwd: path.resolve(__dirname, "../../apps/backend"),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "test",
      EMBEDDING_PROVIDER: "ark",
      EMBEDDING_API_KEY: "test",
      EMBEDDING_API_URL: `http://127.0.0.1:${embeddingPort}`,
      EMBEDDING_DIMENSIONS: "1024",
      JWT_SECRET: "isolated-test-secret-with-at-least-32-bytes",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  backend.stdout.on("data", (data) => {
    logs += data.toString();
  });
  backend.stderr.on("data", (data) => {
    logs += data.toString();
  });
  const url = `http://localhost:${port}`;
  const request = (route, cookie, method = "GET", body) =>
    fetch(`${url}/api${route}`, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(url)).ok) {
          ready = true;
          break;
        }
      } catch {
        /* startup */
      }
      if (backend.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, `backend did not start: ${logs.slice(-3000)}`);
    assert.equal((await request("/knowledge")).status, 401);
    const register = async (name) => {
      const response = await request("/auth/register", null, "POST", { email: `${name}@example.com`, name, password: "test-password-123" });
      assert.equal(response.status, 201);
      assert.match(response.headers.get("set-cookie"), /HttpOnly/i);
      assert.match(response.headers.get("set-cookie"), /SameSite=Strict/i);
      const data = await response.json();
      return { cookie: response.headers.get("set-cookie").split(";")[0], id: data.data.user.id };
    };
    const a = await register("owner-a");
    const b = await register("owner-b");
    assert.equal((await request("/auth/me", a.cookie)).status, 200);
    const kbResponse = await request("/knowledge", a.cookie, "POST", { name: "Owner A" });
    const kb = (await kbResponse.json()).data;
    assert.equal((await request(`/knowledge/${kb.id}`, b.cookie)).status, 404);
    assert.equal((await request(`/knowledge/${kb.id}`, b.cookie, "PATCH", { name: "stolen" })).status, 404);
    assert.equal((await request(`/knowledge/${kb.id}`, b.cookie, "DELETE")).status, 404);
    const convResponse = await request("/conversations", a.cookie, "POST", { knowledgeId: kb.id });
    const conv = (await convResponse.json()).data;
    assert.equal((await request(`/conversations/${conv.id}`, b.cookie)).status, 404);
    assert.equal((await request(`/conversations/${conv.id}/messages`, b.cookie)).status, 404);
    assert.equal((await request("/conversations", b.cookie, "POST", { knowledgeId: kb.id })).status, 404);
    const created = await request("/documents", a.cookie, "POST", { knowledgeBaseId: kb.id, fileName: "owned.md", content: "前言\n表格\n结尾" });
    assert.equal(created.status, 201);
    const docId = (await created.json()).data.id;
    assert.equal((await request(`/documents/${docId}/content`, b.cookie)).status, 404);
    assert.equal((await request(`/documents/${docId}`, b.cookie, "PATCH", { content: "stolen" })).status, 404);
    const original = await request(`/documents/${docId}/content`, a.cookie);
    assert.equal((await original.json()).data.content, "前言\n表格\n结尾");
    let counts = (await (await request(`/knowledge/${kb.id}`, a.cookie)).json()).data;
    assert.equal(counts.documentCount, 1);
    assert.ok(counts.chunkCount > 0);
    failEmbedding = true;
    const failedUpdate = await request(`/documents/${docId}`, a.cookie, "PATCH", { content: "失败的新版内容" });
    assert.equal(failedUpdate.status, 500);
    assert.equal((await (await request(`/documents/${docId}/content`, a.cookie)).json()).data.content, "前言\n表格\n结尾");
    assert.ok((await rag.search("前言", { kbIds: [kb.id] })).some((r) => r.content === "前言\n表格\n结尾"));
    failEmbedding = false;
    const updated = await request(`/documents/${docId}`, a.cookie, "PATCH", { content: "新版内容" });
    assert.equal(updated.status, 200);
    assert.equal((await (await request(`/documents/${docId}/content`, a.cookie)).json()).data.content, "新版内容");
    assert.ok((await rag.search("新版", { kbIds: [kb.id] })).every((r) => r.content === "新版内容"));
    assert.equal((await request(`/documents/${docId}`, a.cookie, "DELETE")).status, 200);
    assert.equal((await request(`/documents/${docId}`, a.cookie, "DELETE")).status, 404);
    counts = (await (await request(`/knowledge/${kb.id}`, a.cookie)).json()).data;
    assert.equal(counts.documentCount, 0);
    assert.equal(counts.chunkCount, 0);
    failEmbedding = true;
    assert.equal((await request("/documents", a.cookie, "POST", { knowledgeBaseId: kb.id, fileName: "failed.md", content: "失败文档" })).status, 500);
    const failedDoc = (await (await request(`/knowledge/${kb.id}/documents`, a.cookie)).json()).data[0];
    assert.equal(failedDoc.status, 4);
    assert.equal((await request(`/documents/${failedDoc.id}`, a.cookie, "DELETE")).status, 200);
    assert.equal((await (await request(`/knowledge/${kb.id}`, a.cookie)).json()).data.documentCount, 0);
    failEmbedding = false;
    const empty = new FormData();
    empty.append("file", new Blob([" \n "]), "empty.md");
    const parsed = await fetch(`${url}/api/documents/parse?kbId=${kb.id}`, { method: "POST", headers: { Cookie: a.cookie }, body: empty });
    assert.equal(parsed.status, 400, "empty parsed text should be rejected instead of indexing bytes");
    const forbiddenParse = await fetch(`${url}/api/documents/parse?kbId=${kb.id}`, { method: "POST", headers: { Cookie: b.cookie }, body: empty });
    assert.equal(forbiddenParse.status, 404);
    const logout = await request("/auth/logout", a.cookie, "POST");
    assert.equal(logout.status, 201);
    assert.match(logout.headers.get("set-cookie"), /Expires=Thu, 01 Jan 1970/i);
  } finally {
    backend.kill("SIGTERM");
    if (backend.exitCode === null) await new Promise((resolve) => backend.once("exit", resolve));
    await new Promise((resolve) => embedding.close(resolve));
  }
});
