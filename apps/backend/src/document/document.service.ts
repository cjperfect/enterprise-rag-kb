import { Injectable, Logger, BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { CommonStatus } from "@enterprise-rag-kb/shared";
import { emit, withTaskEvents, TaskEvent, TaskType, parseDocument, ragService, normalizeParsedText } from "@enterprise-rag-kb/ai-engine";
import { KnowledgeService } from "../knowledge/knowledge.service";
import type { CreateDocumentDto, UpdateDocumentDto } from "../knowledge/dto/knowledge.dto";

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeService,
  ) {}

  private async getDocument(docId: number, userId: number) {
    const doc = await this.prisma.knowledgeDocument.findFirst({
      where: { id: docId, userId, status: { not: CommonStatus.DELETED }, knowledgeBase: { userId, status: { in: [CommonStatus.NORMAL, CommonStatus.ARCHIVED] } } },
    });
    if (!doc) throw new NotFoundException("文档不存在");
    return doc;
  }

  async createDocument(
    kbId: number,
    userId: number,
    dto: Omit<CreateDocumentDto, "knowledgeBaseId">,
    taskId?: string,
    parseMeta?: { mode?: string; pages?: number; ocrPages?: number },
  ) {
    await this.knowledge.get(kbId, userId);
    if (typeof dto.fileName !== "string" || !dto.fileName.trim() || typeof dto.content !== "string" || !dto.content.trim())
      throw new BadRequestException("文件名和文档内容不能为空");
    const content = normalizeParsedText(dto.content, true);
    const doc = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM knowledge_base WHERE id = ${kbId} FOR UPDATE`;
      const kb = await tx.knowledgeBase.findFirst({ where: { id: kbId, userId, status: { in: [1, 2] } } });
      if (!kb) throw new NotFoundException("知识库不存在");
      const created = await tx.knowledgeDocument.create({
        data: {
          knowledgeBaseId: kbId,
          userId,
          fileName: dto.fileName.trim(),
          fileType: extname(dto.fileName).slice(1).toLowerCase() || "md",
          content,
          fileSize: Buffer.byteLength(content, "utf8"),
          status: CommonStatus.FAILED,
          errorMessage: "正在建立索引",
          parseMode: parseMeta?.mode,
          parsePages: parseMeta?.pages,
          parseOcrPages: parseMeta?.ocrPages,
        },
      });
      await tx.knowledgeBase.update({ where: { id: kbId }, data: { documentCount: { increment: 1 } } });
      return created;
    });
    const run = async (tid: string) => {
      try {
        return await this.saveIndex(doc.id, userId, { content, fileName: dto.fileName }, tid);
      } catch (error) {
        await this.prisma.knowledgeDocument.updateMany({
          where: { id: doc.id, status: CommonStatus.FAILED },
          data: { errorMessage: error instanceof Error ? error.message : "索引失败" },
        });
        throw error;
      }
    };
    return taskId ? run(taskId) : withTaskEvents(TaskType.DOCUMENT_INDEX, { kbId, documentId: doc.id, message: `新建文档：${dto.fileName}` }, run);
  }

  /** 两路索引先准备；切片、计数、内容和活跃版本在同一事务内提交。 */
  private async saveIndex(docId: number, userId: number, dto: UpdateDocumentDto, taskId: string) {
    const doc = await this.getDocument(docId, userId);
    const kb = await this.knowledge.get(doc.knowledgeBaseId, userId);
    const content = normalizeParsedText(dto.content ?? doc.content ?? "", true);
    if (!content.trim()) throw new BadRequestException("文档内容不能为空");
    const fileName = dto.fileName?.trim() ?? doc.fileName;
    if (!fileName) throw new BadRequestException("文件名不能为空");
    emit(TaskEvent.PROGRESS, { taskId, taskType: TaskType.DOCUMENT_INDEX, step: 1, message: "数据清洗完成，准备新索引版本" });
    const prepared = await ragService.prepareDocument(kb.id, docId, content, { kbName: kb.name, documentName: fileName }, taskId, 2);
    let updated;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        // 与删除知识库、删除文档使用相同的锁顺序，避免并发计数漂移。
        await tx.$queryRaw`SELECT id FROM knowledge_base WHERE id = ${kb.id} FOR UPDATE`;
        const activeKb = await tx.knowledgeBase.findFirst({ where: { id: kb.id, userId, status: { in: [1, 2] } } });
        if (!activeKb) throw new NotFoundException("知识库已删除");
        const changed = await tx.knowledgeDocument.updateMany({
          where: { id: docId, userId, updatedAt: doc.updatedAt, indexRevision: doc.indexRevision, status: { not: CommonStatus.DELETED } },
          data: {
            fileName,
            content,
            fileSize: Buffer.byteLength(content, "utf8"),
            chunkCount: prepared.chunks.length,
            indexRevision: prepared.revision,
            status: CommonStatus.NORMAL,
            errorMessage: null,
          },
        });
        if (changed.count !== 1) throw new ConflictException("文档已被其他操作修改，请刷新后重试");
        await tx.knowledgeChunk.deleteMany({ where: { documentId: docId } });
        await tx.knowledgeChunk.createMany({ data: prepared.chunks.map((c) => ({ documentId: docId, kbId: kb.id, ...c })) });
        await tx.knowledgeBase.update({ where: { id: kb.id }, data: { chunkCount: { increment: prepared.chunks.length - doc.chunkCount } } });
        return tx.knowledgeDocument.findUniqueOrThrow({ where: { id: docId } });
      });
    } catch (error) {
      await ragService.discardRevision(docId, prepared.revision);
      throw error;
    }
    // 只清理明确的旧版本，绝不能按“非当前版本”删除并发请求正在准备的版本。
    if (doc.indexRevision) await ragService.discardRevision(docId, doc.indexRevision);
    return updated;
  }

  async getDocumentContent(docId: number, userId: number) {
    const doc = await this.getDocument(docId, userId);
    return { content: doc.content ?? "" };
  }

  async getParsedDocument(docId: number, userId: number) {
    const doc = await this.getDocument(docId, userId);
    return { content: doc.content ?? "", fileType: doc.fileType, parseMode: doc.parseMode, parsePages: doc.parsePages, parseOcrPages: doc.parseOcrPages };
  }

  async getDocumentChunks(docId: number, userId: number) {
    await this.getDocument(docId, userId);
    return this.prisma.knowledgeChunk.findMany({ where: { documentId: docId }, orderBy: { index: "asc" } });
  }

  private async parseFile(file: { fileName: string; buffer: Buffer; size: number }, taskId: string) {
    if (!file?.buffer || !file.fileName) throw new BadRequestException("请选择文件");
    const extension = extname(file.fileName).toLowerCase();
    if (![".pdf", ".md", ".markdown", ".txt"].includes(extension)) throw new BadRequestException("仅支持 PDF、Markdown 和文本文件");
    const dir = await mkdtemp(join(tmpdir(), "kb-parse-"));
    try {
      const path = join(dir, `document${extension}`);
      await writeFile(path, file.buffer);
      emit(TaskEvent.PROGRESS, { taskId, taskType: TaskType.DOCUMENT_INDEX, step: 1, message: "解析文档内容" });
      const { fileType, docs } = await parseDocument(path);
      const content = normalizeParsedText(docs.map((d) => d.pageContent).join("\n\n"), true);
      if (!content.trim()) throw new BadRequestException("未解析到可用文本，请检查文件或启用 OCR 后重试");
      const meta = docs[0]?.metadata;
      emit(TaskEvent.PROGRESS, { taskId, taskType: TaskType.DOCUMENT_INDEX, step: 2, message: "数据清洗完成" });
      return {
        fileName: file.fileName,
        fileType,
        content,
        parseMeta: meta?.mode ? { mode: String(meta.mode), pages: Number(meta.pages) || undefined, ocrPages: Number(meta.ocrPages) || undefined } : undefined,
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async parseOnly(kbId: number, userId: number, file: { fileName: string; buffer: Buffer; size: number }) {
    await this.knowledge.get(kbId, userId);
    return withTaskEvents(TaskType.DOCUMENT_INDEX, { kbId, message: `解析文档：${file?.fileName ?? ""}` }, (tid) => this.parseFile(file, tid));
  }

  async uploadDocument(kbId: number, userId: number, file: { fileName: string; buffer: Buffer; size: number }) {
    await this.knowledge.get(kbId, userId);
    return withTaskEvents(TaskType.DOCUMENT_INDEX, { kbId, message: `上传文档：${file?.fileName ?? ""}` }, async (tid) => {
      const parsed = await this.parseFile(file, tid);
      return this.createDocument(kbId, userId, parsed, tid, parsed.parseMeta);
    });
  }

  async updateDocument(docId: number, userId: number, dto: UpdateDocumentDto) {
    const doc = await this.getDocument(docId, userId);
    if (dto.fileName !== undefined && (typeof dto.fileName !== "string" || !dto.fileName.trim())) throw new BadRequestException("文件名不能为空");
    if (dto.content !== undefined && typeof dto.content !== "string") throw new BadRequestException("文档内容必须为文本");
    if (dto.content === undefined && dto.fileName === undefined) return doc;
    return withTaskEvents(TaskType.DOCUMENT_INDEX, { kbId: doc.knowledgeBaseId, documentId: docId, message: `更新文档：${dto.fileName ?? doc.fileName}` }, (tid) =>
      this.saveIndex(docId, userId, dto, tid),
    );
  }

  async deleteDocument(docId: number, userId: number) {
    const doc = await this.getDocument(docId, userId);
    const deleted = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM knowledge_base WHERE id = ${doc.knowledgeBaseId} FOR UPDATE`;
      const current = await tx.knowledgeDocument.findFirst({ where: { id: docId, userId, status: { not: CommonStatus.DELETED } } });
      if (!current) throw new NotFoundException("文档已删除");
      await tx.knowledgeChunk.deleteMany({ where: { documentId: docId } });
      await tx.knowledgeBase.update({ where: { id: doc.knowledgeBaseId }, data: { documentCount: { decrement: 1 }, chunkCount: { decrement: current.chunkCount } } });
      return tx.knowledgeDocument.update({ where: { id: docId }, data: { status: CommonStatus.DELETED, chunkCount: 0 } });
    });
    try {
      await ragService.deleteByDocumentId(docId);
    } catch (error) {
      this.logger.warn(`已删除文档 ${docId} 的索引清理失败（检索已过滤）: ${String(error)}`);
    }
    return deleted;
  }
}
