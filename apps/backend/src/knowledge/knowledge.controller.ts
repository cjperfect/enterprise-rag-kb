import { Controller, Get, Post, Patch, Delete, Param, Body, ParseIntPipe } from "@nestjs/common";
import { KnowledgeService } from "./knowledge.service";
import type { CreateKnowledgeBaseDto, UpdateKnowledgeBaseDto } from "./dto/knowledge.dto";
import { CurrentUser } from "../auth/current-user.decorator";

/**
 * 知识库路由 — 只负责「容器」CRUD + 文档列表聚合查询
 *
 * 文档的创建/上传/更新/删除/内容/切片已拆到 /api/documents（见 document/document.controller.ts）。
 */
@Controller("api/knowledge")
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  // ==========================================================================
  // 知识库
  // ==========================================================================

  @Get()
  async list(@CurrentUser() user: { id: number }) {
    return this.knowledgeService.list(user.id);
  }

  @Post()
  async create(@CurrentUser() user: { id: number }, @Body() dto: CreateKnowledgeBaseDto) {
    return this.knowledgeService.create(user.id, dto);
  }

  @Get(":id")
  async get(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: { id: number }) {
    return this.knowledgeService.get(id, user.id);
  }

  @Patch(":id")
  async update(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: { id: number }, @Body() dto: UpdateKnowledgeBaseDto) {
    return this.knowledgeService.update(id, user.id, dto);
  }

  @Delete(":id")
  async delete(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: { id: number }) {
    return this.knowledgeService.delete(id, user.id);
  }

  // ==========================================================================
  // 文档列表（容器聚合查询）
  // ==========================================================================

  @Get(":id/documents")
  async getDocuments(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: { id: number }) {
    return this.knowledgeService.getDocuments(id, user.id);
  }
}
