/* eslint-disable @typescript-eslint/unbound-method -- Jest references mocked methods for configuration and assertions. */
import { DocumentService } from "./document.service";
import { PrismaService } from "../prisma/prisma.service";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { ragService } from "@enterprise-rag-kb/ai-engine";

jest.mock("@enterprise-rag-kb/ai-engine", () => ({
  ragService: { prepareDocument: jest.fn(), discardRevision: jest.fn(), deleteByDocumentId: jest.fn() },
  normalizeParsedText: (text: string) => text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n"),
  emit: jest.fn(),
  TaskEvent: { PROGRESS: "progress" },
  TaskType: { DOCUMENT_INDEX: "index" },
  withTaskEvents: (_type: string, _context: unknown, run: (id: string) => unknown) => run("task"),
  parseDocument: jest.fn(),
}));

const doc = { id: 7, knowledgeBaseId: 1, userId: 1, fileName: "old.md", content: "原文", chunkCount: 2, indexRevision: "old", updatedAt: new Date(), status: 1 };
function setup() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    knowledgeBase: { findFirst: jest.fn().mockResolvedValue({ id: 1 }), update: jest.fn().mockResolvedValue({}) },
    knowledgeDocument: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(doc),
      findFirst: jest.fn().mockResolvedValue(doc),
      update: jest.fn().mockResolvedValue({ ...doc, status: 3 }),
    },
    knowledgeChunk: { deleteMany: jest.fn().mockResolvedValue({}), createMany: jest.fn().mockResolvedValue({}) },
  };
  const prisma = { knowledgeDocument: { findFirst: jest.fn().mockResolvedValue(doc) }, $transaction: jest.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)) };
  const knowledge = { get: jest.fn().mockResolvedValue({ id: 1, name: "知识库" }) };
  const service = new DocumentService(prisma as unknown as PrismaService, knowledge as unknown as KnowledgeService);
  return { service, prisma, tx };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(ragService.prepareDocument).mockResolvedValue({ revision: "new", chunks: [{ content: "新文", index: 1, tokenCount: 2 }] });
  jest.mocked(ragService.discardRevision).mockResolvedValue();
});

test("失败的索引准备不删除原切片或修改数据库", async () => {
  const { service, prisma, tx } = setup();
  jest.mocked(ragService.prepareDocument).mockRejectedValue(new Error("embedding failed"));
  await expect(service.updateDocument(7, 1, { content: "新文" })).rejects.toThrow("embedding failed");
  expect(prisma.$transaction).not.toHaveBeenCalled();
  expect(tx.knowledgeChunk.deleteMany).not.toHaveBeenCalled();
});

test("提交失败只丢弃暂存版本，保留旧版本", async () => {
  const { service, tx } = setup();
  tx.knowledgeDocument.updateMany.mockResolvedValue({ count: 0 });
  await expect(service.updateDocument(7, 1, { content: "新文" })).rejects.toThrow("文档已被其他操作修改");
  expect(ragService.discardRevision).toHaveBeenCalledWith(7, "new");
  expect(tx.knowledgeChunk.deleteMany).not.toHaveBeenCalled();
});

test("活跃版本、清洗后的原文、切片和计数一并在事务内提交", async () => {
  const { service, tx } = setup();
  await service.updateDocument(7, 1, { content: "\uFEFF新\r\n文" });
  expect(tx.knowledgeDocument.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ content: "新\n文", indexRevision: "new", errorMessage: null, status: 1 }) }),
  );
  expect(tx.knowledgeBase.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { chunkCount: { increment: -1 } } });
  expect(ragService.discardRevision).toHaveBeenCalledWith(7, "old");
});

test("全文读取原文，不重新拼接有重叠的切片", async () => {
  const { service } = setup();
  await expect(service.getDocumentContent(7, 1)).resolves.toEqual({ content: "原文" });
});

test("跨用户文档不可见，查询同时校验知识库归属和状态", async () => {
  const { service, prisma } = setup();
  prisma.knowledgeDocument.findFirst.mockResolvedValue(null);
  await expect(service.getDocumentContent(7, 2)).rejects.toThrow("文档不存在");
  expect(prisma.knowledgeDocument.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ userId: 2, knowledgeBase: { userId: 2, status: { in: [1, 2] } } }) }),
  );
});

test("重复删除不再次减少计数", async () => {
  const { service, tx } = setup();
  tx.knowledgeDocument.findFirst.mockResolvedValue(null);
  await expect(service.deleteDocument(7, 1)).rejects.toThrow("文档已删除");
  expect(tx.knowledgeBase.update).not.toHaveBeenCalled();
});
