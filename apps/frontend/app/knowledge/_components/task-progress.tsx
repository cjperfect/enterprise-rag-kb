"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleX, Clock, Loader2, Play, Radio, WifiOff } from "lucide-react";
import { TaskEventName, useTaskEventStream, type TaskStreamMessage, type TaskStreamPayload } from "@/lib/use-task-event-stream";

/**
 * 通用任务进度面板：订阅后端 document_index 任务事件，展示分步流程条 + 事件时间线。
 *
 * 供「新建文档」「编辑保存」等场景复用（上传弹窗是它最早的形态，此处参数化步骤标签）。
 * 状态机：idle（未开始，不渲染）→ running（active=true）→ done / failed。
 *
 * 事件锚定：首个 STARTED **或** PROGRESS 都可作为本次任务的锚点 ——
 * 「编辑保存」这类在提交瞬间才建立 SSE 连接的场景，started 可能先发出而丢失，
 * 允许用第一个 progress 锚定后仍然能推进步骤条（上传弹窗要求 started 先到，因为它是
 * 弹窗打开就连 SSE，started 必达）。
 */
export type TaskProgressPhase = "idle" | "running" | "done" | "failed";

interface TimelineItem {
  id: string;
  name: string;
  payload: TaskStreamPayload;
}

interface TaskProgressPanelProps {
  /** SSE 连接开关：弹窗打开即 true（提交后才连会丢开头事件）；页内场景保存开始时置 true */
  enabled: boolean;
  /** 进入处理中（开始消费事件）：提交瞬间置 true */
  active: boolean;
  /** 步骤标签（含最后一步「完成」），如 ["解析", "切片", "向量化", "完成"] */
  labels: string[];
  /** HTTP 成功后若完全没收到事件，用它兜底点亮完成 */
  fallbackDone?: boolean;
  /** HTTP 失败兜底文案：非空时进入失败态 */
  fallbackError?: string | null;
  /** SSE completed 事件触发（可用来关闭弹窗 / 刷新列表） */
  onCompleted?: (payload: TaskStreamPayload) => void;
  /** 变化时重置内部状态（每次提交前递增 +1） */
  resetKey?: number;
}

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

export function TaskProgressPanel(props: TaskProgressPanelProps) {
  return <TaskProgressContent key={`${props.active}:${props.resetKey ?? 0}`} {...props} />;
}

function TaskProgressContent({ enabled, active, labels, fallbackDone = false, fallbackError = null, onCompleted }: TaskProgressPanelProps) {
  const [eventPhase, setPhase] = useState<TaskProgressPhase>(active ? "running" : "idle");
  const phase = fallbackError ? "failed" : fallbackDone ? "done" : eventPhase;
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [eventError, setError] = useState("");
  const error = eventError || fallbackError || "";
  /** 渐进点亮的「已显示步数」：目标值 completedSteps，每 200ms 追 1 步 */
  const [displayStep, setDisplayStep] = useState(0);

  const phaseRef = useRef<TaskProgressPhase>(active ? "running" : "idle");
  const taskIdRef = useRef<string | null>(null);
  const sawEventRef = useRef(false);

  const setPhaseAll = (next: TaskProgressPhase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  const handleMessage = (message: TaskStreamMessage) => {
    const payload = message.payload;
    if (!payload) return;
    if (phaseRef.current !== "running") return;

    if (!taskIdRef.current) {
      // 锚定：首个 STARTED 或 PROGRESS（见文件头注释）
      if (message.name !== TaskEventName.STARTED && message.name !== TaskEventName.PROGRESS) return;
      taskIdRef.current = payload.taskId;
    } else if (payload.taskId !== taskIdRef.current) {
      return; // 属于其他任务的事件
    }

    sawEventRef.current = true;
    setItems((prev) => [...prev, { id: `${message.name}-${prev.length}`, name: message.name, payload }]);

    if (message.name === TaskEventName.COMPLETED) {
      setPhaseAll("done");
      onCompleted?.(payload);
    }
    if (message.name === TaskEventName.FAILED) {
      setError(payload.error ?? "任务执行失败");
      setPhaseAll("failed");
    }
  };

  const stream = useTaskEventStream({ types: ["document_index"], enabled, onMessage: handleMessage });

  /** 已完成的步骤数：progress step=N 表示第 N 步完成，completed / done 点亮最后一步 */
  const completedSteps = useMemo(() => {
    if (phase === "failed") return 0;
    let n = 0;
    for (const item of items) {
      if (item.name === TaskEventName.PROGRESS && typeof item.payload.step === "number") {
        n = Math.max(n, item.payload.step);
      }
    }
    if (phase === "done" || items.some((i) => i.name === TaskEventName.COMPLETED)) return labels.length;
    return n;
  }, [items, phase, labels.length]);

  // 渐进点亮：completedSteps 是目标步数，displayStep 每 200ms 追 1 步。
  // 即使 SSE 事件瞬间到达（新建/编辑链路很快）或 HTTP 兜底直接完成，
  // UI 也逐步点亮，避免「一下子全完成」的观感；displayStep 永不超前于真实进度。
  useEffect(() => {
    if (completedSteps <= displayStep) return;
    const timer = setTimeout(() => setDisplayStep((s) => s + 1), 200);
    return () => clearTimeout(timer);
  }, [completedSteps, displayStep]);

  // 兼容两种 completed result：旧实现返回切片数组（.length），现实现返回文档记录（.chunkCount）
  const completedItem = items.findLast((item) => item.name === TaskEventName.COMPLETED);
  const completedResult = completedItem?.payload.result;
  const chunkCount = Array.isArray(completedResult)
    ? completedResult.length
    : completedResult && typeof completedResult === "object" && "chunkCount" in completedResult
      ? ((completedResult as { chunkCount?: number }).chunkCount ?? null)
      : null;
  const durationText = completedItem?.payload.durationMs != null ? `${(completedItem.payload.durationMs / 1000).toFixed(1)}s` : null;

  if (phase === "idle") return null; // 未开始不渲染

  return (
    <div className="space-y-3">
      {/* 事件流连接状态：绿点表示进度会实时推送 */}
      {phase === "running" && stream.connected && !stream.error ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Radio className="size-3.5 text-emerald-600" />
          事件流已连接，进度实时推送
        </div>
      ) : null}

      {/* 分步流程条：completedSteps 由 progress step 推进 */}
      <div className="flex items-center py-1">
        {labels.map((label, i) => {
          const done = i < displayStep;
          const activeStep = phase === "running" && i === displayStep;
          return (
            <Fragment key={label}>
              {i > 0 ? <div className={`h-0.5 flex-1 rounded ${i <= displayStep ? "bg-emerald-500" : "bg-border"}`} /> : null}
              <div className="flex w-14 flex-col items-center gap-1">
                <span
                  className={`flex size-6 items-center justify-center rounded-full text-xs ${
                    done ? "bg-emerald-500 text-white" : activeStep ? "border-2 border-primary text-primary" : "border-2 border-border text-muted-foreground"
                  }`}
                >
                  {done ? <Check className="size-3.5" /> : activeStep ? <Loader2 className="size-3.5 animate-spin" /> : i + 1}
                </span>
                <span className={`whitespace-nowrap text-xs ${done ? "text-emerald-600" : activeStep ? "font-medium text-foreground" : "text-muted-foreground"}`}>{label}</span>
              </div>
            </Fragment>
          );
        })}
      </div>

      {/* 事件时间线 */}
      <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border bg-muted/20 p-3">
        {items.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            正在处理…
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
          <span>
            处理完成
            {chunkCount != null ? ` · ${chunkCount} 个切片` : ""}
            {durationText ? ` · 耗时 ${durationText}` : ""}
          </span>
        </div>
      ) : null}

      {stream.error ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800">
          <WifiOff className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{stream.error}</span>
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
