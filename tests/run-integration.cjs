/** 创建独立库和 ES 索引，完成测试后仅清理本脚本创建的资源。 */
const { spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");
const backendRequire = createRequire(require.resolve("../apps/backend/package.json"));
const engineRequire = createRequire(require.resolve("../packages/ai-engine/package.json"));
const { Client: PgClient } = backendRequire("pg");
const { Client: EsClient } = engineRequire("@elastic/elasticsearch");

async function main() {
  const connection = process.env.INTEGRATION_DATABASE_URL;
  if (!connection) throw new Error("请设置 INTEGRATION_DATABASE_URL，连接可创建临时数据库的本地测试 PostgreSQL");
  const name = `codex_rag_test_${Date.now()}`;
  const admin = new PgClient({ connectionString: connection });
  const es = new EsClient({ node: process.env.ES_URL ?? "http://localhost:9200" });
  let created = false;
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    const url = new URL(connection);
    url.pathname = `/${name}`;
    const env = { ...process.env, DATABASE_URL: url.toString(), ES_INDEX_NAME: name };
    const migrated = spawnSync("pnpm", ["--filter", "@enterprise-rag-kb/backend", "exec", "prisma", "migrate", "deploy"], { env, stdio: "inherit" });
    if (migrated.status !== 0) throw new Error("测试库迁移失败");
    const tested = spawnSync(process.execPath, ["--test", "tests/integration/rag.integration.test.cjs"], { env, stdio: "inherit", timeout: 120000 });
    if (tested.status !== 0) throw new Error("集成测试失败");
  } finally {
    try {
      await es.indices.delete({ index: name, ignore_unavailable: true });
    } finally {
      await es.close();
      try {
        if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      } finally {
        await admin.end();
      }
    }
  }
}
void main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
