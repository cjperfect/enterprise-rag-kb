import { Controller, Get, Post, Patch, Delete, Param, Body, Query, ParseIntPipe, UseInterceptors, UploadedFile } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { DocumentService } from "./document.service";
import type { CreateDocumentDto, UpdateDocumentDto } from "../knowledge/dto/knowledge.dto";
import { CurrentUser } from "../auth/current-user.decorator";

/** 单文件上传上限，与前端「单个文件最大 50MB」提示对齐 */
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024;

/**
 * 文档资源路由 — 文档作为独立资源，不再嵌套在知识库路径下
 *
 *   POST   /api/documents                新建文档（JSON，body 带 knowledgeBaseId）
 *   POST   /api/documents/upload?kbId=3  上传文件（multipart，解析 + 切片 + 向量化）
 *   GET    /api/documents/:docId/content 文档全文
 *   GET    /api/documents/:docId/chunks  文档切片
 *   PATCH  /api/documents/:docId         更新文档内容（重建索引）
 *   DELETE /api/documents/:docId         软删除文档
 *
 * 知识库下的文档列表仍由 GET /api/knowledge/:id/documents 提供（容器聚合查询）。
 */
@Controller("api/documents")
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @Post()
  async createDocument(@CurrentUser() user: { id: number }, @Body() dto: CreateDocumentDto) {
    return this.documentService.createDocument(dto.knowledgeBaseId, user.id, dto);
  }

  @Post("upload")
  // 限制与前端提示保持一致（50MB）：超限时直接返回 413，而不是把文件读到内存里再失败
  // defParamCharset: "utf8"：让 busboy 按 UTF-8 解码 multipart 文件名（浏览器 FormData 的
  //   filename 无编码声明、busboy 默认 latin1 兜底会乱码），从而 file.originalname 直接正确，
  //   后端无需再对中文文件名做 latin1→UTF-8 还原（decodeFileName 已随此配置移除）
  @UseInterceptors(FileInterceptor("file", { defParamCharset: "utf8", limits: { fileSize: MAX_UPLOAD_SIZE } }))
  async uploadDocument(
    @Query("kbId", ParseIntPipe) kbId: number,
    @CurrentUser() user: { id: number },
    @UploadedFile() file: { buffer: Buffer; originalname: string; size: number },
  ) {
    return this.documentService.uploadDocument(kbId, user.id, {
      fileName: file?.originalname,
      buffer: file?.buffer,
      size: file?.size,
    });
  }

  /** 只解析不上库：返回解析文本 + 元数据，前端预览/编辑后确认入库 */
  @Post("parse")
  @UseInterceptors(FileInterceptor("file", { defParamCharset: "utf8", limits: { fileSize: MAX_UPLOAD_SIZE } }))
  async parseDocumentOnly(
    @Query("kbId", ParseIntPipe) kbId: number,
    @CurrentUser() user: { id: number },
    @UploadedFile() file: { buffer: Buffer; originalname: string; size: number },
  ) {
    return this.documentService.parseOnly(kbId, user.id, {
      fileName: file?.originalname,
      buffer: file?.buffer,
      size: file?.size,
    });
  }

  @Get(":docId/content")
  async getDocumentContent(@Param("docId", ParseIntPipe) docId: number, @CurrentUser() user: { id: number }) {
    return this.documentService.getDocumentContent(docId, user.id);
  }

  @Get(":docId/parsed")
  async getParsedDocument(@Param("docId", ParseIntPipe) docId: number, @CurrentUser() user: { id: number }) {
    return this.documentService.getParsedDocument(docId, user.id);
  }

  @Get(":docId/chunks")
  async getDocumentChunks(@Param("docId", ParseIntPipe) docId: number, @CurrentUser() user: { id: number }) {
    return this.documentService.getDocumentChunks(docId, user.id);
  }

  @Patch(":docId")
  async updateDocument(@Param("docId", ParseIntPipe) docId: number, @CurrentUser() user: { id: number }, @Body() dto: UpdateDocumentDto) {
    return this.documentService.updateDocument(docId, user.id, dto);
  }

  @Delete(":docId")
  async deleteDocument(@Param("docId", ParseIntPipe) docId: number, @CurrentUser() user: { id: number }) {
    return this.documentService.deleteDocument(docId, user.id);
  }
}
