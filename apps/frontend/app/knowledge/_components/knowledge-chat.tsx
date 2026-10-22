"use client";

import { useMemo, useState, useEffect, type FC } from "react";
import { AssistantRuntimeProvider, useLocalRuntime, useRemoteThreadListRuntime } from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/thread";
import { ThreadList } from "@/components/assistant-ui/thread-list";
import { createKnowledgeChatAdapter } from "@/adapters/chat.adapter";
import { createRemoteThreadListAdapter } from "@/adapters/remote-thread-list.adapter";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Library, History } from "lucide-react";
import { knowledgeBaseRegistry } from "@/lib/knowledge-base-registry";
import type { KnowledgeChatProps } from "@/interfaces/knowledge";

// ---------------------------------------------------------------------------
// 欢迎页
// ---------------------------------------------------------------------------

const KnowledgeChatWelcome: FC<{ kbName: string }> = ({ kbName }) => (
  <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
    <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
      <Library className="size-7" strokeWidth={1.5} />
    </div>
    <div>
      <h2 className="text-lg font-semibold">{kbName}</h2>
      <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">基于该知识库的内容进行智能问答。AI 会从知识库文档中检索相关信息来回答你的问题。</p>
    </div>
  </div>
);

// ---------------------------------------------------------------------------

export function KnowledgeChat({ knowledgeBaseId, knowledgeBaseName }: KnowledgeChatProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const threadListAdapter = useMemo(
    () =>
      createRemoteThreadListAdapter({
        knowledgeId: knowledgeBaseId,
        defaultTitle: `知识库 - ${knowledgeBaseName}`,
      }),
    [knowledgeBaseId, knowledgeBaseName],
  );

  const chatAdapter = useMemo(() => createKnowledgeChatAdapter(knowledgeBaseId), [knowledgeBaseId, knowledgeBaseName]);

  // 注册当前知识库到全局 registry，便于 knowledge_search 事件展示来源名称
  useEffect(() => {
    knowledgeBaseRegistry.setAll([{ id: knowledgeBaseId, name: knowledgeBaseName }]);
  }, [knowledgeBaseId, knowledgeBaseName]);

  const runtime = useRemoteThreadListRuntime({
    adapter: threadListAdapter,
    runtimeHook: function useKnowledgeRuntime() {
      return useLocalRuntime(chatAdapter);
    },
  });

  const Welcome = useMemo(
    () =>
      function Welcome() {
        return <KnowledgeChatWelcome kbName={knowledgeBaseName} />;
      },
    [knowledgeBaseName],
  );
  const components = useMemo(() => ({ Welcome }), [Welcome]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-full flex-col bg-background">
        {/* 头部 */}
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
          <Library className="size-4 text-primary" />
          <span className="flex-1 text-sm font-semibold">AI 问答</span>

          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7">
                <History className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="flex w-128 flex-col p-0">
              <SheetHeader className="border-b px-4 py-3">
                <SheetTitle className="text-sm">历史会话</SheetTitle>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto px-2 py-1">
                <ThreadList />
              </div>
            </SheetContent>
          </Sheet>
        </div>

        {/* 聊天区域 */}
        <div className="flex-1 overflow-hidden">
          <Thread components={components} enableMentions={false} />
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
}
