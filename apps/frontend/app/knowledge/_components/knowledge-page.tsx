"use client";

import { useSyncExternalStore, useEffect, useMemo, useCallback, useRef, useReducer } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Library, Search, FilePlus, Upload } from "lucide-react";
import { Panel, Group, Separator } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DocumentList } from "./document-list";
import { DocumentViewer } from "./document-viewer";
import { KnowledgeList } from "./knowledge-list";
import dynamic from "next/dynamic";
import { CreateDialog } from "./create-dialog";
import { CreateDocumentDialog } from "./create-document-dialog";
import { UploadDocumentDialog } from "./upload-document-dialog";
import {
  getKnowledgeBases,
  getDocuments,
  getDocumentContent,
  createKnowledgeBase,
  updateKnowledgeBase,
  deleteKnowledgeBase,
  createDocument,
  deleteDocument,
} from "@/api/knowledge-api";
import type { KnowledgeBase, PageState } from "@/interfaces/knowledge";

const KnowledgeChat = dynamic(() => import("./knowledge-chat").then((m) => ({ default: m.KnowledgeChat })), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <Skeleton className="h-8 w-32" />
    </div>
  ),
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const initialState: PageState = {
  error: "",
  allKbs: [],
  kbsLoading: true,
  selectedKb: null,
  documents: [],
  docsLoading: false,
  searchQuery: "",
  selectedDoc: null,
  docContent: "",
  docContentLoading: false,
  dialogOpen: false,
  editingKb: null,
  deleteDialogOpen: false,
  deleteTarget: null,
  createDocOpen: false,
  uploadDocOpen: false,
};

export function KnowledgePage() {
  const router = useRouter();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [state, setState] = useReducer((prev: PageState, next: Partial<PageState>) => ({ ...prev, ...next }), initialState);

  const {
    allKbs,
    kbsLoading,
    selectedKb,
    documents,
    docsLoading,
    searchQuery,
    selectedDoc,
    docContent,
    docContentLoading,
    dialogOpen,
    editingKb,
    deleteDialogOpen,
    deleteTarget,
    createDocOpen,
    uploadDocOpen,
  } = state;

  const allKbsRef = useRef(allKbs);
  useEffect(() => {
    allKbsRef.current = allKbs;
  }, [allKbs]);

  // 防止 StrictMode 下 useEffect 重复执行
  const initRef = useRef(false);

  // 加载知识库列表
  const fetchKbList = useCallback(async () => {
    setState({ kbsLoading: true });
    const data = await getKnowledgeBases();
    setState({ allKbs: data, kbsLoading: false });
    return data;
  }, []);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    void (async () => {
      try {
        const data = await fetchKbList();
        if (data.length === 0) return;
        const first = data[0];
        setState({ selectedKb: first, selectedDoc: null, searchQuery: "", docsLoading: true });
        const docs = await getDocuments(first.id);
        setState({ documents: docs, docsLoading: false });
      } catch (error) {
        setState({ error: String(error), kbsLoading: false, docsLoading: false });
      }
    })();
  }, [fetchKbList]);

  // 选中知识库 → 加载文档
  const handleSelectKb = useCallback(async (id: number) => {
    const kb = allKbsRef.current.find((k) => k.id === id) ?? null;
    setState({ selectedKb: kb, selectedDoc: null, searchQuery: "" });
    if (!kb) return;

    setState({ docsLoading: true });
    const docs = await getDocuments(id);
    setState({ documents: docs, docsLoading: false });
  }, []);

  // 选中文档 → 加载文档内容
  useEffect(() => {
    const docId = selectedDoc?.id;
    if (!docId || !selectedKb) return;
    void (async () => {
      setState({ docContentLoading: true });
      try {
        const { content } = await getDocumentContent(docId);
        setState({ docContent: content });
      } catch (error) {
        setState({ error: String(error) });
      } finally {
        setState({ docContentLoading: false });
      }
    })();
  }, [selectedDoc?.id]);

  // 新建文档
  const handleCreateDocument = async (data: { fileName: string; content: string }) => {
    if (!selectedKb) return;
    await createDocument(selectedKb.id, data);
    const docs = await getDocuments(selectedKb.id);
    setState({ documents: docs });
    await fetchKbList();
  };

  // 上传文档入库完成：刷新文档列表与知识库计数（解析预览与确认入库在弹窗内完成）
  const handleDocCreated = async () => {
    if (!selectedKb) return;
    const docs = await getDocuments(selectedKb.id);
    setState({ documents: docs });
    await fetchKbList();
  };

  // 过滤文档
  const filteredDocuments = useMemo(() => {
    if (!searchQuery.trim()) return documents;
    const q = searchQuery.toLowerCase();
    return documents.filter((d) => d.fileName.toLowerCase().includes(q));
  }, [documents, searchQuery]);

  // 新建 / 编辑
  const handleSave = async (data: { name: string; description?: string }) => {
    if (editingKb) {
      await updateKnowledgeBase(editingKb.id, data);
    } else {
      await createKnowledgeBase(data);
    }
    const updated = await fetchKbList();
    const target = editingKb ? (updated.find((k) => k.id === editingKb.id) ?? updated[0]) : updated[0];
    if (target) {
      setState({ selectedKb: target, docsLoading: true });
      const docs = await getDocuments(target.id);
      setState({ documents: docs, docsLoading: false });
    }
    setState({ editingKb: null });
  };

  const openCreate = () => setState({ editingKb: null, dialogOpen: true });
  const handleEdit = (kb: KnowledgeBase) => setState({ editingKb: kb, dialogOpen: true });

  // 删除
  const handleDeleteClick = (kb: KnowledgeBase) => setState({ deleteTarget: kb, deleteDialogOpen: true });

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    await deleteKnowledgeBase(deleteTarget.id);
    // 如果删除的是当前选中的知识库，清除选中
    if (selectedKb?.id === deleteTarget.id) {
      setState({
        selectedKb: null,
        documents: [],
        selectedDoc: null,
        deleteDialogOpen: false,
        deleteTarget: null,
      });
    } else {
      setState({ deleteDialogOpen: false, deleteTarget: null });
    }
    await fetchKbList();
  };

  return (
    <div className="h-dvh flex flex-col bg-background">
      {/* 顶栏 */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Button variant="ghost" size="icon" className="size-8" onClick={() => router.push("/")}>
          <ArrowLeft className="size-5" />
        </Button>
        <div className="flex items-center gap-2">
          <Library className="size-4 text-primary" strokeWidth={2} />
          <h1 className="font-semibold">知识库</h1>
        </div>
      </header>

      {state.error ? (
        <p role="alert" className="border-b px-4 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {/* 三栏主体 */}
      <div className="flex-1 overflow-hidden">
        {mounted ? (
          <Group orientation="horizontal" id="knowledge-main" autoSave="knowledge-main">
            {/* 左栏：知识库列表 */}
            <Panel defaultSize={15} minSize={15}>
              <KnowledgeList
                items={allKbs}
                selectedId={selectedKb?.id ?? null}
                loading={kbsLoading}
                onSelect={(id) => {
                  void handleSelectKb(id).catch((error: unknown) => setState({ error: String(error), docsLoading: false }));
                }}
                onCreateClick={openCreate}
                onEdit={handleEdit}
                onDelete={handleDeleteClick}
              />
            </Panel>

            <Separator className="bg-border data-[resize-handle-active]:bg-primary/40 transition-colors" />

            {/* 中栏：文档列表 / 文档查看 */}
            <Panel defaultSize={42} minSize={20}>
              {!selectedKb ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground border-r">
                  <Library className="size-12" strokeWidth={1} />
                  <p className="text-sm">选择左侧知识库查看文档</p>
                </div>
              ) : selectedDoc ? (
                <div className="flex h-full flex-col border-r">
                  <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setState({ selectedDoc: null })}>
                      ← 返回文件列表
                    </Button>
                    <span className="text-xs text-muted-foreground">{selectedKb.name}</span>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <DocumentViewer
                      content={docContent}
                      fileName={selectedDoc.fileName}
                      loading={docContentLoading}
                      knowledgeBaseId={selectedKb.id}
                      documentId={selectedDoc.id}
                      onSaved={() => {
                        // 重新加载文档内容
                        void (async () => {
                          try {
                            const { content } = await getDocumentContent(selectedDoc.id);
                            setState({ docContent: content });
                          } catch (error) {
                            setState({ error: String(error) });
                          }
                        })();
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex h-full flex-col border-r">
                  <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
                    <div className="relative flex-1">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={searchQuery}
                        onChange={(e) => setState({ searchQuery: e.target.value })}
                        placeholder="搜索文件…"
                        className="h-7.5 border-0 bg-transparent pl-8 text-sm shadow-none focus-visible:ring-0"
                      />
                    </div>
                    <div className="ml-2 flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="icon" className="size-7" title="新建文档" onClick={() => setState({ createDocOpen: true })}>
                        <FilePlus className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-7" title="上传文档" onClick={() => setState({ uploadDocOpen: true })}>
                        <Upload className="size-4" />
                      </Button>
                    </div>
                    <span className="ml-1 shrink-0 text-xs text-muted-foreground">
                      {docsLoading ? <Skeleton className="inline-block h-3 w-8" /> : `${documents.length} 个文件`}
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    <DocumentList
                      documents={filteredDocuments}
                      selectedId={null}
                      onSelect={(doc) => setState({ selectedDoc: doc })}
                      onDelete={async (doc) => {
                        await deleteDocument(doc.id);
                        const docs = await getDocuments(selectedKb.id);
                        setState({ documents: docs });
                      }}
                      loading={docsLoading}
                    />
                  </div>
                </div>
              )}
            </Panel>

            <Separator className="bg-border data-[resize-handle-active]:bg-primary/40 transition-colors" />

            {/* 右栏：AI 聊天 */}
            <Panel defaultSize={40} minSize={20}>
              <KnowledgeChat key={selectedKb?.id ?? "empty"} knowledgeBaseId={selectedKb?.id ?? 0} knowledgeBaseName={selectedKb?.name ?? ""} />
            </Panel>
          </Group>
        ) : (
          <div className="flex h-full items-center justify-center">
            <Skeleton className="h-8 w-64" />
          </div>
        )}
      </div>

      {/* 新建/编辑对话框 */}
      <CreateDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setState({ dialogOpen: open, ...(open ? {} : { editingKb: null }) });
        }}
        onSubmit={handleSave}
        editingKb={editingKb}
      />

      {/* 删除确认对话框 */}
      <Dialog open={deleteDialogOpen} onOpenChange={(open) => setState({ deleteDialogOpen: open })}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除知识库「{deleteTarget?.name}
              」吗？此操作不可撤销，知识库内的所有文档将被一并删除。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setState({ deleteDialogOpen: false })}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void handleConfirmDelete().catch((error: unknown) => setState({ error: String(error) }));
              }}
              className="gap-2 ml-2"
            >
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 新建文档对话框 */}
      <CreateDocumentDialog open={createDocOpen} onOpenChange={(open) => setState({ createDocOpen: open })} onSubmit={handleCreateDocument} />

      {/* 上传文档对话框 */}
      <UploadDocumentDialog
        open={uploadDocOpen}
        onOpenChange={(open) => setState({ uploadDocOpen: open })}
        kbId={selectedKb?.id}
        onCreated={() => {
          void handleDocCreated().catch((error: unknown) => setState({ error: String(error) }));
        }}
      />
    </div>
  );
}
