// ============================================================================
// 知识库领域类型
// ============================================================================

/** 知识库 */
export interface KnowledgeBase {
  /** 知识库 ID */
  id: number;
  /** 知识库名称 */
  name: string;
  /** 知识库描述 */
  description?: string;
  /** 文档数量 */
  documentCount: number;
  /** 状态：1=正常 2=归档 3=删除 */
  status: number;
  /** 创建时间 */
  createdAt: string;
  /** 最后更新时间 */
  updatedAt: string;
}

/** 创建知识库请求参数 */
export interface CreateKnowledgeBaseInput {
  /** 知识库名称 */
  name: string;
  /** 知识库描述（可选） */
  description?: string;
}

/** 更新知识库请求参数 */
export interface UpdateKnowledgeBaseInput {
  /** 知识库名称（可选，不传则不修改） */
  name?: string;
  /** 知识库描述（可选，不传则不修改） */
  description?: string;
}

/** 知识库中的文档 */
export interface KnowledgeBaseDocument {
  /** 文档 ID */
  id: number;
  /** 所属知识库 ID */
  knowledgeBaseId: number;
  /** 文件名（含扩展名） */
  fileName: string;
  /** 文件类型（如 pdf、md、docx） */
  fileType: string;
  /** 文件大小（字节） */
  fileSize: number;
  /** 切片数量 */
  chunkCount: number;
  /** 文档状态：1=正常 2=归档 3=删除 4=解析/索引失败 */
  status: number;
  /** 失败原因（仅 status=4 时有值） */
  errorMessage?: string | null;
  /** 上传时间 */
  createdAt: string;
}

/** 新建文档请求参数 */
export interface CreateDocumentInput {
  /** 文件名（含扩展名，如 note.md） */
  fileName: string;
  /** 文档正文（Markdown 格式） */
  content: string;
}

/** 文档切片 */
export interface DocumentChunk {
  /** 切片 ID */
  id: number;
  /** 所属文档 ID */
  documentId: number;
  /** 切片在文档中的序号（从 1 开始） */
  index: number;
  /** 切片文本内容 */
  content: string;
  /** Token 数量 */
  tokenCount: number;
}

// ============================================================================
// 页面状态
// ============================================================================

/** 知识库管理页整体状态 */
export interface PageState {
  /** API 操作失败提示 */
  error: string;
  /** 知识库列表 */
  allKbs: KnowledgeBase[];
  /** 知识库列表是否加载中 */
  kbsLoading: boolean;
  /** 当前选中的知识库 */
  selectedKb: KnowledgeBase | null;
  /** 当前知识库下的文档列表 */
  documents: KnowledgeBaseDocument[];
  /** 文档列表是否加载中 */
  docsLoading: boolean;
  /** 文档搜索关键词 */
  searchQuery: string;
  /** 当前选中的文档 */
  selectedDoc: KnowledgeBaseDocument | null;
  /** 当前文档的完整内容 */
  docContent: string;
  /** 文档内容是否加载中 */
  docContentLoading: boolean;
  /** 新建/编辑对话框是否打开 */
  dialogOpen: boolean;
  /** 正在编辑的知识库（null 表示新建模式） */
  editingKb: KnowledgeBase | null;
  /** 删除确认对话框是否打开 */
  deleteDialogOpen: boolean;
  /** 待删除的知识库 */
  deleteTarget: KnowledgeBase | null;
  /** 新建文档对话框是否打开 */
  createDocOpen: boolean;
  /** 上传文档对话框是否打开 */
  uploadDocOpen: boolean;
}

// ============================================================================
// 组件 Props
// ============================================================================

/** KnowledgeList 组件 Props */
export interface KnowledgeListProps {
  /** 知识库列表数据 */
  items: KnowledgeBase[];
  /** 当前选中项的 ID */
  selectedId: number | null;
  /** 是否加载中 */
  loading: boolean;
  /** 选中知识库回调 */
  onSelect: (id: number) => void;
  /** 点击新建按钮回调 */
  onCreateClick: () => void;
  /** 点击编辑回调 */
  onEdit: (kb: KnowledgeBase) => void;
  /** 点击删除回调 */
  onDelete: (kb: KnowledgeBase) => void;
}

/** DocumentList 组件 Props */
export interface DocumentListProps {
  /** 文档列表数据 */
  documents: KnowledgeBaseDocument[];
  /** 当前选中项的 ID */
  selectedId: number | null;
  /** 选中文档回调 */
  onSelect: (doc: KnowledgeBaseDocument) => void;
  /** 删除文档回调 */
  onDelete: (doc: KnowledgeBaseDocument) => void | Promise<void>;
  /** 是否加载中 */
  loading: boolean;
}

/** DocumentViewer 组件 Props */
export interface DocumentViewerProps {
  /** 文档完整文本内容 */
  content: string | null;
  /** 文件名（null 时不展示内容） */
  fileName: string | null;
  /** 是否加载中 */
  loading: boolean;
  /** 知识库 ID（编辑模式需要） */
  knowledgeBaseId?: number;
  /** 文档 ID（编辑模式需要） */
  documentId?: number;
  /** 保存后的回调 */
  onSaved?: () => void;
}

/** KnowledgeChat 组件 Props */
export interface KnowledgeChatProps {
  /** 关联的知识库 ID */
  knowledgeBaseId: number;
  /** 关联的知识库名称 */
  knowledgeBaseName: string;
}

/** CreateDialog 组件 Props */
export interface CreateDialogProps {
  /** 对话框是否打开 */
  open: boolean;
  /** 对话框打开状态变化回调 */
  onOpenChange: (open: boolean) => void;
  /** 提交回调（新建或编辑） */
  onSubmit: (data: { name: string; description?: string }) => Promise<void>;
  /** 正在编辑的知识库（null 或 undefined 表示新建模式） */
  editingKb?: KnowledgeBase | null;
}
