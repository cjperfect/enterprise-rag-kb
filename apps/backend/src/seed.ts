import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env["DATABASE_URL"]! }),
});

// ============================================================================
// 种子脚本（精简版）
//
// 职责：只保证开发环境存在 user id=1 的测试账号，供前端登录使用。
// 知识库 / 文档 / 切片 / 会话等业务数据**不在此填充**——它们由前端
// 上传文档、创建会话时真实生成（走完整解析 + 向量化 + BM25 链路）。
//
// 幂等规则：
//   - 已存在 id=1 用户 → 直接保留，不动任何其他数据；
//   - 不存在 → 清空 user 表（级联清掉其关联业务数据）并重建，保证 id=1。
// ============================================================================

const TEST_ACCOUNT = {
  email: "admin@test.com",
  password: "admin123456",
  name: "Admin",
} as const;

async function main() {
  console.log("🌱 Seeding...");

  // 1. 已存在 id=1：保留现状（不干扰已有会话/知识库等数据）
  const existing = await prisma.user.findUnique({ where: { id: 1 } });
  if (existing) {
    console.log(`✅ 已存在测试用户 id=1（${existing.email}），跳过创建，未改动其他数据`);
    return;
  }

  // 2. 不存在 id=1：清空 user 表并重建，确保新账号拿到 id=1
  console.log("🧹 未找到 id=1 用户，清空 user 表（连带级联业务数据）后重建...");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "user" RESTART IDENTITY CASCADE`);

  const password = await bcrypt.hash(TEST_ACCOUNT.password, 10);
  const user = await prisma.user.create({
    data: {
      name: TEST_ACCOUNT.name,
      email: TEST_ACCOUNT.email,
      password,
    },
  });
  console.log(`✅ 创建测试用户 id=${user.id}: ${user.email} / ${TEST_ACCOUNT.password}`);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
