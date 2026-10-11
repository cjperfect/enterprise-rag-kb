"use client";

import { useState, type FC } from "react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";
import { FileText, File, FileCode, FileJson, Trash2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DocumentListProps } from "@/interfaces/knowledge";
import { FILE_TYPE_COLORS, DEFAULT_FILE_COLOR, formatFileSize } from "@/constants/file-types";

dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

const FILE_TYPE_ICONS: Record<string, React.ReactNode> = {
  pdf: <File className="size-4 text-red-500" />,
  docx: <File className="size-4 text-blue-500" />,
  md: <FileText className="size-4 text-emerald-500" />,
  txt: <FileText className="size-4 text-muted-foreground" />,
  sql: <FileCode className="size-4 text-purple-500" />,
  ts: <FileCode className="size-4 text-cyan-500" />,
  tsx: <FileCode className="size-4 text-cyan-500" />,
  js: <FileJson className="size-4 text-amber-500" />,
  py: <FileCode className="size-4 text-blue-400" />,
  pptx: <File className="size-4 text-orange-500" />,
};

const DEFAULT_FILE_ICON = <FileText className="size-4 text-muted-foreground" />;

export function DocumentList({ documents, selectedId, onSelect, onDelete, loading }: DocumentListProps) {
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg p-3">
            <Skeleton className="size-8 rounded-lg" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <FileText className="size-10 mb-3" strokeWidth={1.5} />
        <p className="text-sm">暂无文档</p>
        <p className="text-xs mt-1">上传文档后即可查看</p>
      </div>
    );
  }

  const targetDoc = documents.find((d) => d.id === deleteTarget);

  return (
    <>
      <div className="divide-y">
        {documents.map((doc) => (
          <div
            key={doc.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(doc)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(doc);
              }
            }}
            className={`group w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 cursor-pointer ${
              selectedId === doc.id ? "bg-muted border-l-3 border-l-primary" : "border-l-2 border-transparent"
            }`}
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">{FILE_TYPE_ICONS[doc.fileType] ?? DEFAULT_FILE_ICON}</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate flex items-center gap-2">
                {doc.fileName}
                {doc.status === 4 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-normal shrink-0" title={doc.errorMessage ?? undefined}>
                    解析失败
                  </span>
                )}
              </p>
              {doc.status === 4 && doc.errorMessage ? (
                <p className="text-xs text-destructive/90 truncate" title={doc.errorMessage}>{doc.errorMessage}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(doc.fileSize)} · {doc.chunkCount} 切片 · {dayjs(doc.createdAt).format("MM/DD")}
                </p>
              )}
            </div>
            <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase shrink-0 ${FILE_TYPE_COLORS[doc.fileType] ?? DEFAULT_FILE_COLOR}`}>{doc.fileType}</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteTarget(doc.id);
              }}
              title="删除文档"
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        ))}
      </div>

      <Dialog open={deleteTarget !== null} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>此操作不可撤销。确定要删除文档「{targetDoc?.fileName ?? ""}」吗？</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (targetDoc) onDelete(targetDoc);
                setDeleteTarget(null);
              }}
            >
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
