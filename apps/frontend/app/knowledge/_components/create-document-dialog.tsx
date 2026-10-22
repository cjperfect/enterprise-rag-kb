"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, Maximize2, Minimize2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor, htmlToMd } from "@/components/rich-text-editor";
import { useAuthUser } from "@/lib/auth-context";
import { TaskProgressPanel } from "./task-progress";

// ---------------------------------------------------------------------------
// localStorage key
// ---------------------------------------------------------------------------

const DRAFT_KEY = "kb-create-document-draft";

interface Draft {
  fileName: string;
  content: string;
}

function loadDraft(userId: number): Draft {
  try {
    const raw = localStorage.getItem(`${DRAFT_KEY}:${userId}`);
    if (raw) return JSON.parse(raw) as Draft;
  } catch {
    /* 忽略解析错误 */
  }
  return { fileName: "", content: "" };
}

function saveDraft(draft: Draft, userId: number) {
  try {
    localStorage.setItem(`${DRAFT_KEY}:${userId}`, JSON.stringify(draft));
  } catch {
    /* 忽略存储满等异常 */
  }
}

function clearDraft(userId: number) {
  try {
    localStorage.removeItem(`${DRAFT_KEY}:${userId}`);
  } catch {
    /* 忽略 */
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CreateDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { fileName: string; content: string }) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CreateDocumentDialog(props: CreateDocumentDialogProps) {
  return <CreateDocumentForm key={String(props.open)} {...props} />;
}

function CreateDocumentForm({ open, onOpenChange, onSubmit }: CreateDocumentDialogProps) {
  const { id: userId } = useAuthUser();
  const [fileName, setFileName] = useState(() => (open ? loadDraft(userId).fileName : ""));
  const [content, setContent] = useState(() => (open ? loadDraft(userId).content : ""));
  const [fullscreen, setFullscreen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // 提交后的解析/切片/向量化进度（SSE 事件驱动）
  const [progressActive, setProgressActive] = useState(false);
  const [fallbackDone, setFallbackDone] = useState(false);
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const editorRef = useRef<ReturnType<typeof import("@tiptap/react").useEditor>>(null);

  // 实时保存草稿（防抖 500ms）
  const saveDraftDebounced = useCallback(() => {
    saveDraft({ fileName, content }, userId);
  }, [fileName, content, userId]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(saveDraftDebounced, 500);
    return () => clearTimeout(timer);
  }, [fileName, content, open, saveDraftDebounced]);

  const reset = () => {
    clearDraft(userId);
    setFileName("");
    setContent("");
    setFullscreen(false);
    setError("");
  };

  const handleSubmit = async () => {
    const trimmedName = fileName.trim();
    if (!trimmedName) {
      setError("请输入文件名");
      return;
    }

    // 新建文档默认为 Markdown：文件名无扩展名时自动补 .md（如「产品需求文档」→「产品需求文档.md」）
    const finalName = /\.\w+$/.test(trimmedName) ? trimmedName : `${trimmedName}.md`;

    const md = htmlToMd(editorRef.current?.getHTML?.() ?? "") ?? content;
    if (!md.trim()) {
      setError("请输入文档内容");
      return;
    }

    setLoading(true);
    setError("");
    setResetKey((k) => k + 1);
    setProgressActive(true);
    setFallbackDone(false);
    setFallbackError(null);
    try {
      await onSubmit({ fileName: finalName, content: md.trim() });
      // HTTP 成功即任务成功：SSE 无事件时用它兜底点亮完成；留一点时间让事件渲染
      setFallbackDone(true);
      setTimeout(() => {
        reset();
        onOpenChange(false);
      }, 600);
    } catch (e) {
      // SSE 的 task.failed 带具体原因，已收到就保留；否则用 HTTP 层原因兜底
      setFallbackError(e instanceof Error ? e.message : "保存失败，请重试");
      setProgressActive(false);
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) reset();
        onOpenChange(open);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={`flex flex-col transition-all duration-200 ${fullscreen ? "max-w-none! w-[98dvw]! h-[98dvh]! rounded-xl!" : "sm:max-w-3xl max-h-[85dvh]"}`}
      >
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle>新建文档</DialogTitle>
              <DialogDescription>使用富文本编辑器编写 Markdown 文档</DialogDescription>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <Button variant="ghost" size="icon" className="size-7" title={fullscreen ? "退出全屏" : "全屏"} onClick={() => setFullscreen(!fullscreen)} type="button">
                {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </Button>
              <Button variant="ghost" size="icon" className="size-7" title="关闭" onClick={() => onOpenChange(false)} type="button">
                <X className="size-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto py-2">
          {progressActive ? (
            // 提交中：展示分步进度（数据清洗 → 切片 → 向量化 → 完成）。
            // 新建内容来自编辑器（非文件），无「解析」步骤；
            // 与 createDocument 事件 step1-3 + completed 一一对应；SSE 事件驱动
            <TaskProgressPanel
              enabled={open}
              active={progressActive}
              labels={["数据清洗", "切片", "向量化", "完成"]}
              fallbackDone={fallbackDone}
              fallbackError={fallbackError}
              resetKey={resetKey}
              onCompleted={() => {
                reset();
                onOpenChange(false);
              }}
            />
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="doc-name">文件名</Label>
                <Input
                  id="doc-name"
                  placeholder="例如：产品需求文档.md"
                  value={fileName}
                  onChange={(e) => {
                    setFileName(e.target.value);
                    if (error) setError("");
                  }}
                  disabled={loading}
                  maxLength={200}
                />
              </div>

              <div className="flex-1 flex flex-col min-w-0 space-y-1">
                <Label>内容</Label>
                <RichTextEditor
                  initialContent={content}
                  placeholder="使用 Markdown 语法或工具栏编写文档内容..."
                  minHeight="200px"
                  onContentChange={setContent}
                  editorRef={editorRef}
                />
              </div>

              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 shrink-0">
          {progressActive ? (
            <Button disabled className="gap-2">
              <Loader2 className="size-4 animate-spin" />
              处理中…
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                取消
              </Button>
              <Button onClick={() => void handleSubmit()} disabled={loading} className="gap-2 ml-2">
                {loading ? <Loader2 className="size-4 animate-spin" /> : null}
                创建
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
