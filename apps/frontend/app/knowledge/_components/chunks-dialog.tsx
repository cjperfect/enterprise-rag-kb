"use client";

import { useEffect, useState } from "react";
import { FileText, AlertCircle } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getDocumentChunks } from "@/api/knowledge-api";
import type { DocumentChunk } from "@/interfaces/knowledge";

/**
 * 切片内容用 Markdown 渲染（含 GFM 表格），否则解析产物的
 * `| 项目 | 参数 |` 表格会以源代码形式展示，看不出表格结构。
 * 注意：不做 document-viewer 那种「单换行提升为段落」的预处理——
 * GFM 表格依赖连续行（表头/分隔行/数据行之间是单个 \n），提升了反而破坏表格。
 */
const chunkMarkdownComponents = {
  table({ children }: { children?: React.ReactNode }) {
    return (
      <div className="my-1 overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">{children}</table>
      </div>
    );
  },
  th({ children }: { children?: React.ReactNode }) {
    return <th className="border bg-muted/40 px-2 py-1 text-left font-medium">{children}</th>;
  },
  td({ children }: { children?: React.ReactNode }) {
    return <td className="border px-2 py-1 align-top">{children}</td>;
  },
  code({ children }: { children?: React.ReactNode }) {
    return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">{children}</code>;
  },
  pre({ children }: { children?: React.ReactNode }) {
    return <>{children}</>;
  },
};

/**
 * 文档切片弹窗：展示当前文档的所有切片（序号 / token 数 / 内容）
 *
 * 切片是 RAG 检索的基本单元，这里按 index 顺序展示全文分片，
 * 便于检查解析质量（切片是否断裂、内容是否完整）与检索命中范围。
 */
export function ChunksDialog(props: Parameters<typeof ChunksContent>[0]) {
  return <ChunksContent key={`${props.open}:${props.documentId}`} {...props} />;
}

function ChunksContent({ open, onOpenChange, documentId, fileName }: { open: boolean; onOpenChange: (open: boolean) => void; documentId: number; fileName: string }) {
  const [chunks, setChunks] = useState<DocumentChunk[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    async function load() {
      try {
        const data = await getDocumentChunks(documentId);
        if (active) setChunks(data);
      } catch (error) {
        if (active) setError(error instanceof Error ? error.message : "加载切片失败");
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [open, documentId]);

  const totalTokens = chunks?.reduce((sum, c) => sum + c.tokenCount, 0) ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <FileText className="size-4 text-muted-foreground" />
            文档切片：{fileName}
          </DialogTitle>
          <DialogDescription className="text-xs">{chunks ? `共 ${chunks.length} 片 · 约 ${totalTokens} tokens` : "加载中..."}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4">
          {error ? (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              <AlertCircle className="size-4" />
              {error}
            </div>
          ) : chunks === null ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-lg border p-3">
                  <Skeleton className="mb-2 h-3 w-24" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="mt-1 h-3 w-4/5" />
                </div>
              ))}
            </div>
          ) : chunks.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">该文档暂无切片</div>
          ) : (
            <div className="space-y-3">
              {chunks.map((chunk) => (
                <div key={chunk.id} className="rounded-lg border bg-muted/20 p-3">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">切片 #{chunk.index}</span>
                    <span className="text-xs text-muted-foreground">≈ {chunk.tokenCount} tokens</span>
                  </div>
                  <div className="prose-chunk text-[13px] leading-relaxed text-foreground/85">
                    <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={chunkMarkdownComponents}>
                      {chunk.content}
                    </Markdown>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t px-6 py-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
