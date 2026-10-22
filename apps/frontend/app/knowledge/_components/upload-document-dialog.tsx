"use client";

import { useState, useRef, Fragment, useEffect, useMemo, type DragEvent } from "react";
import { Loader2, Upload, File, X, Check, CircleX, Play, Clock, WifiOff, Radio, RefreshCw, Database } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TaskEventName, useTaskEventStream } from "@/lib/use-task-event-stream";
import type { TaskStreamMessage, TaskStreamPayload } from "@/lib/use-task-event-stream";
import { parseDocumentApi, createDocument } from "@/api/knowledge-api";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/**
 * 弹窗阶段（两段式：先解析预览，用户确认后再入库）
 *   select    → 选文件
 *   parsing   → 解析中（只解析不上库）
 *   parsed    → 解析完成：展示解析结果，用户可编辑后确认入库
 *   indexing  → 确认入库：切片 + 向量化 + 落库
 *   done      → 完成
 *   failed    → 失败
 */
type Phase = "select" | "parsing" | "parsed" | "indexing" | "done" | "failed";

interface TimelineItem {
  id: string;
  name: string;
  payload: TaskStreamPayload;
}

interface UploadDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 知识库 ID（上传归属） */
  kbId?: number;
  /** 入库完成后回调（父组件刷新列表） */
  onCreated?: () => void;
}

/** 各阶段文案 */
const COPY: Record<Phase, { title: string; description: string }> = {
  select: { title: "上传文档", description: "上传后先解析预览，确认无误再入库索引。支持 PDF / Markdown，单个文件最大 50MB" },
  parsing: { title: "正在解析", description: "解析文档内容（PDF 逐页路由：文本层走 Unstructured、扫描页走 OCR），请稍候" },
  parsed: { title: "确认解析结果", description: "下方为解析产物，可直接编辑修正，确认后才会切片、向量化并入库" },
  indexing: { title: "正在入库", description: "切片、向量化与落库进行中，请勿关闭窗口" },
  done: { title: "入库完成", description: "文档已确认入库，可以开始检索了" },
  failed: { title: "处理失败", description: "文档处理过程中出现异常，请检查后重试" },
};

/**
 * 分步流程条：按阶段切换 ——
 *   parsing（文件解析阶段，parse 接口）：
 *     5 步 [解析/数据清洗/切片/向量化/完成]，事件只走 step1 解析、step2 数据清洗，走到第 2 步即停
 *   indexing（确认入库阶段，createDocument）：
 *     4 步 [数据清洗/切片/向量化/完成] —— 内容已就绪（解析产物），无「解析」步骤；
 *     事件 step1 数据清洗 / step2 切片 / step3 向量化 / completed 完成，一一对应
 */
const PARSE_STEPS = ["解析", "数据清洗", "切片", "向量化", "完成"];
const INDEX_STEPS = ["数据清洗", "切片", "向量化", "完成"];

/** 时间线图标 */
function EventIcon({ name }: { name: string }) {
  switch (name) {
    case TaskEventName.STARTED:
      return <Play className="size-3.5 text-primary" />;
    case TaskEventName.PROGRESS:
      return <Clock className="size-3.5 text-muted-foreground" />;
    case TaskEventName.COMPLETED:
      return <Check className="size-3.5 text-emerald-600" />;
    case TaskEventName.FAILED:
      return <CircleX className="size-3.5 text-destructive" />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export function UploadDocumentDialog({ open, onOpenChange, kbId, onCreated }: UploadDocumentDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>("select");
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [error, setError] = useState("");
  /** 渐进点亮的「已显示步数」：目标值 completedSteps，每 180ms 追 1 步（避免快任务瞬跳全亮） */
  const [displayStep, setDisplayStep] = useState(0);

  // 解析预览状态：解析文本（可编辑）、原始文本、解析元数据
  const [parsedContent, setParsedContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [parseMeta, setParseMeta] = useState<{ mode?: string; pages?: number; ocrPages?: number } | null>(null);
  const [parsedFileType, setParsedFileType] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);

  // ref 镜像：SSE 回调读取最新值，避免闭包捕获旧 state
  const phaseRef = useRef<Phase>("select");
  const taskIdRef = useRef<string | null>(null);
  const sawEventRef = useRef(false);
  // 入库成功防重（SSE completed 与 HTTP 兜底都可能触发）
  const createdRef = useRef(false);

  /** 同步更新 state 与 ref */
  const setPhaseAll = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  const reset = () => {
    setFile(null);
    setDragging(false);
    setError("");
    setItems([]);
    setParsedContent("");
    setOriginalContent("");
    setParseMeta(null);
    setParsedFileType("");
    setPhaseAll("select");
    taskIdRef.current = null;
    sawEventRef.current = false;
    createdRef.current = false;
    setDisplayStep(0);
  };

  /** 进入完成态（SSE completed / HTTP 兜底共用，只触发一次 onCreated 刷新） */
  const enterDone = () => {
    if (createdRef.current) return;
    createdRef.current = true;
    setPhaseAll("done");
    onCreated?.();
  };

  /** SSE 事件处理：按当前阶段锚定任务（解析与入库是两个独立任务，切换阶段时重新锚定） */
  const handleMessage = (message: TaskStreamMessage) => {
    const payload = message.payload;
    if (!payload) return;
    // 仅在解析中 / 入库中接收事件，避免弹窗刚打开时被其他任务的事件污染
    if (phaseRef.current !== "parsing" && phaseRef.current !== "indexing") return;

    if (!taskIdRef.current) {
      // 本次任务尚未锚定：拿第一个 started 事件的 taskId 作为锚点
      if (message.name !== TaskEventName.STARTED) return;
      taskIdRef.current = payload.taskId;
    } else if (payload.taskId !== taskIdRef.current) {
      return; // 属于其他任务的事件
    }

    // completed / failed 先按阶段处理，避免「UI 已完成但 HTTP 还在 pending」的进度错位
    if (message.name === TaskEventName.FAILED) {
      setError(payload.error ?? "任务执行失败");
      setPhaseAll("failed");
      return;
    }
    if (message.name === TaskEventName.COMPLETED) {
      // 解析阶段忽略 completed：解析结果由 parse 接口的 HTTP 响应接管转「parsed」，
      // 不点亮分步条（解析阶段没有切片/向量化步骤）；入库阶段 completed 才真正完成
      if (phaseRef.current === "indexing") enterDone();
      return;
    }

    sawEventRef.current = true;
    setItems((prev) => [...prev, { id: `${message.name}-${prev.length}`, name: message.name, payload }]);
  };

  // 弹窗打开即建立 SSE 连接：后端是同步等待处理完成的，
  // 若等点击后再连，开头的事件会丢失。
  const stream = useTaskEventStream({ types: ["document_index"], enabled: open, onMessage: handleMessage });

  const handleFile = (f: File | null) => {
    setError("");
    if (!f) return;
    setFile(f);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  /** 第一步：只解析不上库，拿到解析结果进入预览编辑 */
  const handleParse = async () => {
    if (!file || !kbId) {
      setError(kbId ? "请先选择文件" : "请先选择知识库");
      return;
    }

    setError("");
    setItems([]);
    taskIdRef.current = null;
    sawEventRef.current = false;
    setDisplayStep(0);
    setPhaseAll("parsing");

    try {
      const data = await parseDocumentApi(kbId, file);
      setOriginalContent(data.content);
      setParsedContent(data.content);
      setParsedFileType(data.fileType);
      setParseMeta(data.parseMeta ?? null);
      setPhaseAll("parsed");
    } catch (e) {
      if (phaseRef.current !== "failed") {
        setError(e instanceof Error ? e.message : "解析失败，请重试");
        setPhaseAll("failed");
      }
    }
  };

  /** 第二步：用户确认（可能已编辑解析文本）→ createDocument 真正入库（切片 + 向量化） */
  const handleConfirm = async () => {
    if (!file || !kbId) return;
    if (!parsedContent.trim()) {
      setError("解析内容为空，无法入库");
      return;
    }

    setError("");
    setItems([]);
    taskIdRef.current = null;
    sawEventRef.current = false;
    createdRef.current = false;
    setDisplayStep(0);
    setPhaseAll("indexing");

    try {
      await createDocument(kbId, { fileName: file.name, content: parsedContent });

      // 后端同步完成索引，HTTP 成功即任务成功。留一点时间让末尾的
      // SSE 事件渲染出来；只有完全没收到事件（SSE 未连通）时才用 HTTP 结果兜底。
      await new Promise((resolve) => setTimeout(resolve, 600));
      if (phaseRef.current === "indexing" && !sawEventRef.current) enterDone();
    } catch (e) {
      if (phaseRef.current !== "failed") {
        setError(e instanceof Error ? e.message : "入库失败，请重试");
        setPhaseAll("failed");
      }
    }
  };

  /** 当前阶段的步骤条（解析阶段含「解析」，入库阶段从「数据清洗」开始） */
  const steps = phase === "parsing" ? PARSE_STEPS : INDEX_STEPS;

  /** 已完成步骤数：progress step=N 表示第 N 步完成，
   *  completed 事件点亮最后一步「完成」（仅入库阶段记录，解析阶段忽略 completed） */
  const completedSteps = useMemo(() => {
    let n = 0;
    for (const item of items) {
      if (item.name === TaskEventName.PROGRESS && typeof item.payload.step === "number") {
        n = Math.max(n, item.payload.step);
      }
    }
    if (items.some((i) => i.name === TaskEventName.COMPLETED)) return steps.length;
    return n;
  }, [items, steps.length]);

  // 渐进点亮：completedSteps 是目标，displayStep 每 180ms 追 1 步。
  // 即使解析很快（小文件 / md 毫秒级完成），UI 也逐步点亮，避免「解析一下子完成」的观感；
  // displayStep 永不超前于真实进度（真实慢任务下 UI 不会抢跑）。
  useEffect(() => {
    if (completedSteps <= displayStep) return;
    const timer = setTimeout(() => setDisplayStep((s) => s + 1), 180);
    return () => clearTimeout(timer);
  }, [completedSteps, displayStep]);

  const modeLabel = parseMeta?.mode ? ({ "text-layer": "纯文本层", "baidu-doc-analysis": "纯扫描 OCR", mixed: "混合路由" }[parseMeta.mode] ?? parseMeta.mode) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && (phase === "parsing" || phase === "indexing")) return; // 处理中不允许关闭
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-2xl" showCloseButton={phase !== "parsing" && phase !== "indexing"}>
        <DialogHeader>
          <DialogTitle>{COPY[phase].title}</DialogTitle>
          <DialogDescription>{COPY[phase].description}</DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {phase === "select" ? (
            file ? (
              // 已选择文件
              <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <File className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
                </div>
                <Button variant="ghost" size="icon" className="size-7 shrink-0" title="移除文件" onClick={() => setFile(null)}>
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              // 拖拽上传区域
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 transition-colors ${
                  dragging ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/50 hover:bg-muted/20"
                }`}
              >
                <Upload className="size-10 text-muted-foreground" strokeWidth={1.5} />
                <div className="text-center">
                  <p className="text-sm font-medium">拖拽文件到此处或点击选择</p>
                  <p className="text-xs text-muted-foreground mt-1">PDF · Markdown</p>
                </div>
                <input ref={inputRef} type="file" className="hidden" accept=".pdf,.md,.markdown" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
              </div>
            )
          ) : phase === "parsed" ? (
            // 解析结果预览 + 编辑（确认后才入库）
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <File className="size-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file?.name ?? "文档"}</p>
                  <p className="text-xs text-muted-foreground">
                    {file ? `${(file.size / 1024).toFixed(0)} KB` : ""}
                    {parsedFileType ? ` · ${parsedFileType}` : ""}
                    {modeLabel ? ` · ${modeLabel}` : ""}
                    {parseMeta?.pages != null ? ` · ${parseMeta.pages} 页` : ""}
                    {parseMeta?.ocrPages ? ` · OCR ${parseMeta.ocrPages} 页` : ""}
                  </p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                  <Check className="size-3" /> 解析完成
                </span>
              </div>

              {/* 解析文本编辑区：解析产物原样展示，用户可直接修正后再入库 */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">解析产物（{parsedContent.length.toLocaleString()} 字符）· 可直接编辑，点击「确认入库」才真正存库</p>
                  <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs" onClick={() => setParsedContent(originalContent)} title="恢复为解析原文">
                    <RefreshCw className="size-3" />
                    恢复原文
                  </Button>
                </div>
                <textarea
                  value={parsedContent}
                  onChange={(e) => setParsedContent(e.target.value)}
                  spellCheck={false}
                  className="min-h-[280px] w-full resize-y rounded-lg border bg-muted/10 p-3 font-mono text-[12.5px] leading-relaxed text-foreground/85 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                />
              </div>
            </div>
          ) : (
            // 处理中 / 结果：文件信息 + 任务事件时间线
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <File className="size-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file?.name ?? "文档"}</p>
                  <p className="text-xs text-muted-foreground">{file ? `${(file.size / 1024).toFixed(0)} KB` : ""}</p>
                </div>
                {phase === "parsing" || phase === "indexing" ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" /> : null}
              </div>

              {/* 事件流连接状态：绿点表示进度会实时推送 */}
              {(phase === "parsing" || phase === "indexing") && stream.connected && !stream.error ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Radio className="size-3.5 text-emerald-600" />
                  事件流已连接，进度实时推送
                </div>
              ) : null}

              {/* 分步流程条：解析与入库两阶段都渲染（5 步贯穿全流程；
                  解析阶段走到「数据清洗」即停，入库阶段走完 4 步 + 完成） */}
              {phase === "parsing" || phase === "indexing" ? (
                <div className="flex items-center py-1">
                  {steps.map((label, i) => {
                    const done = i < displayStep;
                    const active = (phase === "parsing" || phase === "indexing") && i === displayStep;
                    return (
                      <Fragment key={label}>
                        {i > 0 ? <div className={`h-0.5 flex-1 rounded ${i <= displayStep ? "bg-emerald-500" : "bg-border"}`} /> : null}
                        <div className="flex w-14 flex-col items-center gap-1">
                          <span
                            className={`flex size-6 items-center justify-center rounded-full text-xs ${
                              done ? "bg-emerald-500 text-white" : active ? "border-2 border-primary text-primary" : "border-2 border-border text-muted-foreground"
                            }`}
                          >
                            {done ? <Check className="size-3.5" /> : active ? <Loader2 className="size-3.5 animate-spin" /> : i + 1}
                          </span>
                          <span className={`whitespace-nowrap text-xs ${done ? "text-emerald-600" : active ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                            {label}
                          </span>
                        </div>
                      </Fragment>
                    );
                  })}
                </div>
              ) : null}

              <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border bg-muted/20 p-3">
                {items.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    {phase === "parsing" ? "正在上传并解析文件…" : "正在切片、向量化并入库…"}
                  </div>
                ) : (
                  items.map((item) => (
                    <div key={item.id} className="flex items-start gap-2 text-sm">
                      <span className="mt-0.5 shrink-0">
                        <EventIcon name={item.name} />
                      </span>
                      <span className="min-w-0 flex-1 break-words">
                        {item.payload.message ?? item.name}
                        {item.payload.step != null ? <span className="ml-1.5 text-xs text-muted-foreground">步骤 {item.payload.step}</span> : null}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {phase === "done" ? (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                  <Check className="size-4 shrink-0" />
                  <span>文档已入库并完成索引</span>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* 事件流连不上时明确告警，避免「点了上传什么都不发生」这种无从下手的体验 */}
        {stream.error ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800">
            <WifiOff className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 break-words">{stream.error}</span>
          </div>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter className="gap-2 sm:gap-0">
          {phase === "select" ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button onClick={() => void handleParse()} disabled={!file} className="gap-2 ml-2">
                <File className="size-4" />
                上传并解析
              </Button>
            </>
          ) : null}

          {phase === "parsing" || phase === "indexing" ? (
            <Button disabled className="gap-2">
              <Loader2 className="size-4 animate-spin" />
              {phase === "parsing" ? "解析中…" : "入库中…"}
            </Button>
          ) : null}

          {phase === "parsed" ? (
            <>
              <Button variant="outline" onClick={() => setPhaseAll("select")}>
                上一步
              </Button>
              <Button onClick={() => void handleConfirm()} disabled={!parsedContent.trim()} className="gap-2 ml-2">
                <Database className="size-4" />
                确认入库
              </Button>
            </>
          ) : null}

          {phase === "done" ? (
            <Button onClick={() => onOpenChange(false)} className="ml-2">
              完成
            </Button>
          ) : null}

          {phase === "failed" ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setError("");
                  setItems([]);
                  setPhaseAll("select");
                }}
              >
                重试
              </Button>
              <Button onClick={() => onOpenChange(false)} className="ml-2">
                关闭
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
