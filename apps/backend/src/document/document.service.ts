import { Injectable, Logger, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PrismaService } from "../prisma/prisma.service";
import { CommonStatus } from "@langchain-rag/shared";
import { emit, withTaskEvents, TaskEvent, TaskType } from "@langchain-rag/ai-engine";
import { parseDocument, ragService, normalizeParsedText } from "@langchain-rag/ai-engine";
import type { ChunkData } from "@langchain-rag/ai-engine";
import { KnowledgeService } from "../knowledge/knowledge.service";
import type { CreateDocumentDto, UpdateDocumentDto } from "../knowledge/dto/knowledge.dto";

/**
 * 根据文件名推断文件类型
 */
/**
 * 从文件名推断文件类型（落库用）。
 *
 * 新建文档的内容来自 Markdown 编辑器，因此**默认按 .md 处理**：
 * 文件名无扩展名（如「产品需求文档」）或扩展名不是字母数字（如「v1.2」）时，
 * 一律视为 Markdown —— 避免旧实现 split(".").pop() 把整个文件名当扩展名
 * （fileType 存成「产品需求文档」这类脏值）。
 * 上传文档的 fileType 由解析链路（parseDocument 返回）单独记录，不走这里。
 */
function getFileType(fileName: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(fileName);
  return match ? match[1].toLowerCase() : "md";
}

/**
 * 文档服务 — 文档生命周期 + 解析/切片/向量化编排
 *
 * 与知识库服务分离：KnowledgeService 只负责「容器」CRUD 与文档列表查询，
 * 文档的创建/上传/更新/删除、内容与切片读取，以及 loader 路由、OCR 逐页判定、
 * 向量化回滚、进度事件编排全部收敛在本服务。
 * 校验知识库存在时注入 KnowledgeService（单向依赖，无循环引用）。
 */
@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeService,
  ) {}

  // ==========================================================================
  // 文档 CRUD
  // ==========================================================================

  /**
   * 新建文档：ai-engine 负责切片 + 向量化，后端负责 DB 记录
   *
   * 知识库归属走独立参数 kbId，dto 不需要再携带 knowledgeBaseId
   * （该字段只属于 HTTP 入口 CreateDocumentDto，上传/重索引等内部调用直接传 kbId）。
   *
   * @param taskId 可选：上传链路（uploadDocument）已用 withTaskEvents 建好外层任务，
   *               传入后 indexDocument 复用同一 taskId（step 从 3 开始：1 解析、2 切片、3 向量化），
   *               避免嵌套任务导致前端按第一个 started 锚定后丢掉内层事件。
   *               直接新建文档（无 taskId）时行为不变：indexDocument 自带完整任务事件。
   */
  async createDocument(
    kbId: number,
    userId: number,
    dto: Omit<CreateDocumentDto, "knowledgeBaseId">,
    taskId?: string,
    parseMeta?: { mode?: string; pages?: number; ocrPages?: number },
  ) {
    const kb = await this.knowledge.get(kbId);

    const fileType = getFileType(dto.fileName);
    const fileSize = Buffer.byteLength(dto.content, "utf-8");

    const doc = await this.prisma.knowledgeDocument.create({
      data: {
        knowledgeBaseId: kbId,
        userId,
        fileName: dto.fileName,
        fileType,
        fileSize,
        content: dto.content,
        chunkCount: 0,
        status: CommonStatus.NORMAL,
        // 上传链路会带上解析元数据（mode/pages/ocrPages），供前端「解析结果」查看与后续质量监控
        parseMode: parseMeta?.mode,
        parsePages: parseMeta?.pages,
        parseOcrPages: parseMeta?.ocrPages,
      },
    });

    const names = { kbName: kb.name, documentName: dto.fileName };

    // 上传链路已带外层任务（taskId 传入）时不再包一层，复用 uploadDocument 的任务事件；
    // 独立新建文档时包完整任务事件（对齐上传四步：解析 → 切片 → 向量化 → 完成），
    // 让前端「新建文档」也能看到分步进度。
    if (taskId) {
      return this.indexAndPersist(doc.id, kbId, dto.content, names, taskId, 3);
    }

    return withTaskEvents(
      TaskType.DOCUMENT_INDEX,
      { kbId, message: `新建文档：${dto.fileName}` },
      async (tid) => {
        // 新建/编辑的内容来自编辑器（非文件），无需「解析」步骤：
        // step1 数据清洗 → step2 切片 → step3 向量化（vectorize 内发出，stepOffset=2）
        emit(TaskEvent.PROGRESS, {
          taskId: tid,
          taskType: TaskType.DOCUMENT_INDEX,
          step: 1,
          message: "数据清洗完成（CRLF / BOM 归一），开始切片与向量化",
        });
        return this.indexAndPersist(doc.id, kbId, dto.content, names, tid, 2);
      },
    );
  }

  /**
   * 索引 + 落库公共段：切片向量化（失败回滚幽灵文档）→ 写切片 → 更新计数 → 回写 chunkCount
   */
  private async indexAndPersist(
    docId: number,
    kbId: number,
    content: string,
    names: { kbName: string; documentName: string },
    taskId?: string,
    stepOffset?: number,
  ) {
    // ai-engine 全权处理切片 + 向量化（存入 KB 名称 + 文档名，便于检索时展示来源）。
    // 索引失败必须回滚文档记录：否则会留下 chunkCount=0 的幽灵文档 ——
    // HTTP 返回成功、列表里看得见，但内容永远搜不到，删除时还会再撞一次同样的向量错误。
    const chunks = await ragService
      .indexDocument(kbId, docId, content, names, taskId, stepOffset)
      .catch(async (err) => {
        const reason = err instanceof Error ? err.message : String(err);
        this.logger.error(`文档 ${docId} 索引失败：${reason}`, err);
        // 不删文档行：清掉可能已写入的向量/chunk，把文档标记为 FAILED 并写入 error_message，
        // 让前端列表能看到这份失败文档（带错误原因），用户可重试或删除 ——
        // 之前直接删行会导致前端只收到 500、列表里什么都看不到，无从排查。
        try { await ragService.deleteByDocumentId(docId); } catch { /* 多半没写入过 */ }
        await this.prisma.knowledgeChunk.deleteMany({ where: { documentId: docId } });
        await this.prisma.knowledgeDocument.update({
          where: { id: docId },
          data: { status: CommonStatus.FAILED, errorMessage: reason, chunkCount: 0 },
        });
        // HTTP 层仍返回 500 + 真实原因（同步响应），同时文档已在库里标记 FAILED（异步可见）
        throw new InternalServerErrorException(`文档索引失败：${reason}`);
      });

    // 写切片记录（新建场景无旧切片）
    await this.writeChunks(docId, kbId, chunks);

    // 更新知识库计数：文档 +1、chunk +N
    await this.adjustKbCounts(kbId, chunks.length, 1);

    return this.prisma.knowledgeDocument.update({
      where: { id: docId },
      data: { chunkCount: chunks.length },
    });
  }

  /**
   * 索引失败时丢弃刚建的文档记录
   *
   * 向量清理是尽力而为：索引可能失败在「向量库还没写进去」这一步
   * （例如扩展缺失），此时清理本身也会失败，不能因此盖住原始错误。
   */
  private async discardUnindexedDocument(docId: number) {
    try {
      await ragService.deleteByDocumentId(docId);
    } catch (err) {
      this.logger.warn(`回滚文档 ${docId} 时清理向量失败（多半是没写入过）: ${err instanceof Error ? err.message : String(err)}`);
    }

    await this.prisma.knowledgeChunk.deleteMany({ where: { documentId: docId } });
    await this.prisma.knowledgeDocument.delete({ where: { id: docId } });
  }

  /**
   * 写 / 替换切片记录（update 场景先删旧切片再写新）
   */
  private async writeChunks(docId: number, kbId: number, chunks: ChunkData[], replace = false) {
    if (replace) {
      await this.prisma.knowledgeChunk.deleteMany({ where: { documentId: docId } });
    }
    if (chunks.length > 0) {
      await this.prisma.knowledgeChunk.createMany({
        data: chunks.map((c) => ({
          documentId: docId,
          kbId,
          index: c.index,
          content: c.content,
          tokenCount: c.tokenCount,
        })),
      });
    }
  }

  /**
   * 调整知识库计数（chunkDelta：切片增量；documentDelta：文档增量，仅新建文档为 1）
   */
  private async adjustKbCounts(kbId: number, chunkDelta: number, documentDelta = 0) {
    await this.prisma.knowledgeBase.update({
      where: { id: kbId },
      data: {
        chunkCount: { increment: chunkDelta },
        documentCount: { increment: documentDelta },
      },
    });
  }

  /** 获取文档完整文本内容（按切片顺序拼接） */
  async getDocumentContent(docId: number) {
    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: { documentId: docId },
      orderBy: { index: "asc" },
    });
    return { content: chunks.map((c) => c.content).join("\n\n") };
  }

  /**
   * 获取文档解析结果：原始解析全文（content 字段，切片前未拼接的 parseDocument 输出）
   * + 解析元数据（mode / pages / ocrPages，仅 PDF 上传有值）
   */
  async getParsedDocument(docId: number) {
    const doc = await this.prisma.knowledgeDocument.findUnique({ where: { id: docId } });
    // 抛 NotFoundException 而非普通 Error：普通 Error 会被全局过滤器转成 500，
    // 前端拿到的是「服务器内部错误」而非可识别的「文档不存在」（编辑已删除的文档时尤其明显）
    if (!doc) throw new NotFoundException(`文档不存在（id=${docId}）`);
    return {
      content: doc.content ?? "",
      fileType: doc.fileType,
      parseMode: doc.parseMode,
      parsePages: doc.parsePages,
      parseOcrPages: doc.parseOcrPages,
    };
  }

  /** 获取文档切片列表 */
  async getDocumentChunks(docId: number) {
    return this.prisma.knowledgeChunk.findMany({
      where: { documentId: docId },
      orderBy: { index: "asc" },
    });
  }

  /**
   * 上传文件：解析 + 切片 + 向量化 + 入库，整条链路是一个 document_index 任务
   *
   * 事件序列（前端按此渲染分步流程）：
   *   task.started        → 「上传文档：xxx」
   *   task.progress step1 → 解析文档内容（PDF 逐页路由 / Markdown）
   *   task.progress step2 → 解析完成（共 N 页 · mode），开始切片与向量化
   *   task.progress step3 → 切片完成（N 片），开始向量化   （vectorize 内）
   *   task.progress step4 → 向量化完成                     （vectorize 内）
   *   task.completed      → 返回文档记录（含 chunkCount）
   */
  async uploadDocument(kbId: number, userId: number, file: { fileName: string; buffer: Buffer; size: number }) {
    await this.knowledge.get(kbId);

    // multipart 文件名先做 latin1→UTF-8 还原（multer 会把中文文件名解成乱码），
    // 后续的类型判断、临时路径、落库文件名全部使用还原后的名字
    // multer 已配置 defParamCharset: "utf8"，file.originalname 即正确的 UTF-8 文件名
    const fileName = file.fileName;
    const tempPath = join(tmpdir(), `kb-upload-${Date.now()}-${fileName}`);

    try {
      // 写入临时文件（PDF loader 需要文件路径）
      writeFileSync(tempPath, file.buffer);

      return await withTaskEvents(
        TaskType.DOCUMENT_INDEX,
        { kbId, message: `上传文档：${fileName}` },
        async (taskId) => {
          // step 1：解析阶段（对 PDF 可能包含逐页文本层判定 / 百度 OCR，耗时明显，必须有进度）
          emit(TaskEvent.PROGRESS, {
            taskId,
            taskType: TaskType.DOCUMENT_INDEX,
            step: 1,
            message: "解析文档内容（PDF 逐页路由 / Markdown）",
          });

          // 统一交给 ai-engine：内部按扩展名路由 PDF（Unstructured+OCR）/ Markdown 解析
          const { docs } = await parseDocument(tempPath);
          const content = docs.map((d) => d.pageContent).join("\n\n");

          // step 2：解析完成，从 loader 元数据带出 PDF 解析统计（模式/页数/OCR 页数）
          const meta = (docs[0]?.metadata ?? {}) as { mode?: string; pages?: number; ocrPages?: number };
          emit(TaskEvent.PROGRESS, {
            taskId,
            taskType: TaskType.DOCUMENT_INDEX,
            step: 2,
            message:
              `解析完成（${meta.pages != null ? `共 ${meta.pages} 页` : "内容提取完成"}` +
              `${meta.mode ? ` · ${meta.mode}` : ""}${meta.ocrPages ? ` · OCR ${meta.ocrPages} 页` : ""}），` +
              `数据清洗完成（CRLF / BOM 归一），开始切片与向量化`,
          });

          // 如果 loader 未提取到任何文本，回退为原始 buffer 内容；
          // parseMeta 仅 PDF 解析有（mode/pages/ocrPages），Markdown 无解析统计则不带
          return this.createDocument(
            kbId,
            userId,
            {
              fileName: fileName,
              content: content.trim() || file.buffer.toString("utf-8"),
            },
            taskId,
            meta.mode ? { mode: meta.mode, pages: meta.pages, ocrPages: meta.ocrPages } : undefined,
          );
        },
      );
    } catch (err) {
      this.logger.error(`文件上传失败: ${fileName}`, err);
      throw err;
    } finally {
      // 清理临时文件
      try {
        unlinkSync(tempPath);
      } catch {
        /* 忽略清理错误 */
      }
    }
  }


  /**
   * 只解析不上库：调用 parseDocument 返回解析文本与元数据，供前端预览/编辑。
   *
   * 与 uploadDocument 的区别：不做切片/向量化/落库，不创建文档记录。
   * 用户在前端确认（可先编辑解析文本）后再调 createDocument 真正入库，
   * 实现「先看解析结果、确认后入库」的交互。
   *
   * 事件序列（前端按此渲染解析进度）：
   *   task.started        → 「解析文档：xxx」
   *   task.progress step1 → 解析文档内容
   *   task.progress step2 → 数据清洗完成（独立事件，与 step1 分开推进步骤条）
   *   task.completed      → 返回 { fileName, fileType, content, parseMeta }（解析统计在 parseMeta）
   */
  async parseOnly(kbId: number, file: { fileName: string; buffer: Buffer; size: number }) {
    await this.knowledge.get(kbId);

    const fileName = file.fileName;
    const tempPath = join(tmpdir(), `kb-parse-${Date.now()}-${fileName}`);

    try {
      writeFileSync(tempPath, file.buffer);

      return await withTaskEvents(
        TaskType.DOCUMENT_INDEX,
        { kbId, message: `解析文档：${fileName}` },
        async (taskId) => {
          emit(TaskEvent.PROGRESS, {
            taskId,
            taskType: TaskType.DOCUMENT_INDEX,
            step: 1,
            message: "解析文档内容（PDF 逐页路由 / Markdown）",
          });

          const { fileType, docs } = await parseDocument(tempPath);
          const content = docs.map((d) => d.pageContent).join("\n\n");
          const meta = (docs[0]?.metadata ?? {}) as { mode?: string; pages?: number; ocrPages?: number };

          // step2 只发「数据清洗完成」：解析阶段步骤条为 解析/数据清洗/切片/向量化/完成，
          // step1（解析）与 step2（数据清洗）应是两条独立进度，合并成一条消息会让
          // 「解析」与「数据清洗」几乎同时点亮（观感：解析和数据清洗只发了一条 SSE）。
          // 解析统计（共 N 页 · mode · OCR N 页）由返回的 parseMeta 承载，前端元信息区展示。
          emit(TaskEvent.PROGRESS, {
            taskId,
            taskType: TaskType.DOCUMENT_INDEX,
            step: 2,
            message: "数据清洗完成（CRLF / BOM 归一）",
          });

          // 与 uploadDocument 相同的回退：loader 未提取到任何文本时用原始 buffer 内容
          return {
            fileName,
            fileType,
            content: content.trim() || file.buffer.toString("utf-8"),
            parseMeta: meta.mode ? { mode: meta.mode, pages: meta.pages, ocrPages: meta.ocrPages } : undefined,
          };
        },
      );
    } catch (err) {
      this.logger.error(`文件解析失败: ${fileName}`, err);
      throw err;
    } finally {
      // 清理临时文件
      try {
        unlinkSync(tempPath);
      } catch {
        /* 忽略清理错误 */
      }
    }
  }

  /** 更新文档内容：ai-engine 负责重建索引 */
  async updateDocument(docId: number, userId: number, dto: UpdateDocumentDto) {
    const doc = await this.prisma.knowledgeDocument.findUnique({ where: { id: docId } });
    if (!doc) throw new Error("文档不存在");

    const updateData: Record<string, unknown> = {};
    if (dto.fileName !== undefined) updateData.fileName = dto.fileName;

    if (dto.content !== undefined) {
      const fileSize = Buffer.byteLength(dto.content, "utf-8");

      // 获取 KB 名称用于向量 metadata
      const kb = await this.knowledge.get(doc.knowledgeBaseId);
      const fileName = dto.fileName ?? doc.fileName;
      // 闭包内 TS 会丢失 dto.content 的收窄，先取为局部常量
      // 编辑内容统一清洗（CRLF→LF + 去 BOM），与解析链路进入切片前的格式保持一致；
      // reindexDocument 内部会再清洗一次（幂等），此处清洗保证库里也存归一化后的内容
      const newContent = normalizeParsedText(dto.content ?? "", true);

      // 重建索引包成完整任务事件（step1 删除旧向量 → step2 切片 → step3 向量化 → 完成），
      // 让前端「保存编辑」也能看到分步进度。
      return withTaskEvents(
        TaskType.DOCUMENT_INDEX,
        { kbId: doc.knowledgeBaseId, documentId: docId, message: `更新文档：${fileName}` },
        async (tid) => {
          // ai-engine 全权处理：删旧向量 + 重新切片 + 向量化（复用外层任务 taskId，step 从 1 开始）。
          // 必须放在删旧切片之前 —— 索引失败时直接抛错，原有切片与内容保持不变，
          // 不会出现「内容还在、切片记录被清空」的静默数据丢失。
          const chunks = await ragService.reindexDocument(
            docId,
            doc.knowledgeBaseId,
            newContent,
            { kbName: kb.name, documentName: fileName },
            tid,
            1,
          );

          // 索引成功后再替换切片记录（先删旧再写新）
          await this.writeChunks(docId, doc.knowledgeBaseId, chunks, true);

          updateData.content = dto.content;
          updateData.fileSize = fileSize;
          updateData.chunkCount = chunks.length;

          await this.adjustKbCounts(doc.knowledgeBaseId, chunks.length - doc.chunkCount);

          return this.prisma.knowledgeDocument.update({ where: { id: docId }, data: updateData });
        },
      );
    }

    // 仅改文件名等元数据，不触发重建索引
    return this.prisma.knowledgeDocument.update({ where: { id: docId }, data: updateData });
  }

  /** 软删除文档 */
  async deleteDocument(docId: number, userId: number) {
    const doc = await this.prisma.knowledgeDocument.findUnique({ where: { id: docId } });
    if (!doc) throw new Error("文档不存在");

    // 清除向量再删除切片
    await ragService.deleteByDocumentId(docId);
    await this.prisma.knowledgeChunk.deleteMany({ where: { documentId: docId } });

    // 更新知识库计数
    await this.prisma.knowledgeBase.update({
      where: { id: doc.knowledgeBaseId },
      data: {
        documentCount: { decrement: 1 },
        chunkCount: { decrement: doc.chunkCount },
      },
    });

    return this.prisma.knowledgeDocument.update({
      where: { id: docId },
      data: { status: CommonStatus.DELETED },
    });
  }
}
