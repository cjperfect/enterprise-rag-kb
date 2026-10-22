import { ragService } from "@enterprise-rag-kb/ai-engine";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { Exceptions } from "../common/exceptions/business.exception";
import { CommonStatus } from "@enterprise-rag-kb/shared";
import type { CreateKnowledgeBaseDto, UpdateKnowledgeBaseDto } from "./dto/knowledge.dto";

/**
 * 知识库服务 — 只负责「容器」的 CRUD 与文档列表查询
 *
 * 文档的生命周期、解析、切片与向量化编排已拆到 DocumentService（见 document/），
 * 本服务不再持有任何 loader / rag 依赖；文档列表仅作知识库的聚合查询保留在这里。
 */
@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);
  constructor(private readonly prisma: PrismaService) {}

  // ==========================================================================
  // 知识库 CRUD
  // ==========================================================================

  /** 创建知识库 */
  async create(userId: number, dto: CreateKnowledgeBaseDto) {
    if (typeof dto?.name !== "string" || !dto.name.trim() || dto.name.length > 255) throw new BadRequestException("知识库名称须为 1~255 字符");
    return this.prisma.knowledgeBase.create({
      data: {
        userId,
        name: dto.name,
        description: dto.description,
      },
    });
  }

  /** 获取用户的知识库列表（正常 + 归档） */
  async list(userId: number) {
    return this.prisma.knowledgeBase.findMany({
      where: { userId, status: { in: [CommonStatus.NORMAL, CommonStatus.ARCHIVED] } },
      orderBy: { updatedAt: "desc" },
    });
  }

  /** 获取单个知识库 */
  async get(id: number, userId: number) {
    const kb = await this.prisma.knowledgeBase.findFirst({ where: { id, userId, status: { in: [CommonStatus.NORMAL, CommonStatus.ARCHIVED] } } });
    if (!kb) throw Exceptions.notFound("知识库不存在");
    return kb;
  }

  /** 更新知识库 */
  async update(id: number, userId: number, dto: UpdateKnowledgeBaseDto) {
    await this.get(id, userId); // 确保存在
    if (dto.name !== undefined && (typeof dto.name !== "string" || !dto.name.trim() || dto.name.length > 255)) throw new BadRequestException("知识库名称须为 1~255 字符");
    return this.prisma.knowledgeBase.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
    });
  }

  /** 软删除知识库（级联软删文档） */
  async delete(id: number, userId: number) {
    await this.get(id, userId);
    const documents = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM knowledge_base WHERE id = ${id} FOR UPDATE`;
      const docs = await tx.knowledgeDocument.findMany({ where: { knowledgeBaseId: id }, select: { id: true } });
      await tx.knowledgeDocument.updateMany({ where: { knowledgeBaseId: id }, data: { status: CommonStatus.DELETED, chunkCount: 0 } });
      await tx.knowledgeChunk.deleteMany({ where: { kbId: id } });
      await tx.chatConversation.updateMany({ where: { knowledgeId: id }, data: { status: CommonStatus.DELETED } });
      await tx.knowledgeBase.update({ where: { id }, data: { status: CommonStatus.DELETED, documentCount: 0, chunkCount: 0 } });
      return docs;
    });
    // 软删除先提交；外部服务故障不能让已删除内容继续被召回。
    for (const doc of documents) {
      try {
        await ragService.deleteByDocumentId(doc.id);
      } catch (error) {
        this.logger.warn(`知识库 ${id} 的文档 ${doc.id} 索引清理失败: ${String(error)}`);
      }
    }
    return { id, status: CommonStatus.DELETED };
  }

  // ==========================================================================
  // 文档列表（聚合查询）
  // ==========================================================================

  /** 获取知识库下的文档列表 */
  async getDocuments(kbId: number, userId: number) {
    await this.get(kbId, userId);
    return this.prisma.knowledgeDocument.findMany({
      where: {
        knowledgeBaseId: kbId,
        userId,
        status: { in: [CommonStatus.NORMAL, CommonStatus.ARCHIVED, CommonStatus.FAILED] },
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
