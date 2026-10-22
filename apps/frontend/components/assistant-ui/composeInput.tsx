import { ComposerPrimitive } from "@assistant-ui/react";
import { unstable_useMentionAdapter } from "@assistant-ui/react";
import { ComposerTriggerPopover } from "@/components/assistant-ui/composer-trigger-popover";
import { ThreadEnableMentionsContext } from "@/components/assistant-ui/thread";
import { atMentionFormatter } from "@/lib/directive-formatter";
import { LibraryIcon } from "lucide-react";
import { useState, useEffect, useRef, useContext } from "react";
import { getKnowledgeBases } from "@/api/knowledge-api";
import { knowledgeBaseRegistry } from "@/lib/knowledge-base-registry";
import type { KnowledgeBase } from "@/interfaces/knowledge";

export function ComposerInput() {
  const enableMentions = useContext(ThreadEnableMentionsContext);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!enableMentions) return;
    let active = true;
    async function load() {
      try {
        const kbs = await getKnowledgeBases();
        if (active) {
          setKnowledgeBases(kbs);
          knowledgeBaseRegistry.setAll(kbs);
        }
      } catch (error) {
        console.error("加载知识库失败", error);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [enableMentions]);

  // @ 提及配置 — 选择知识库
  const mention = unstable_useMentionAdapter({
    formatter: atMentionFormatter,
    items: knowledgeBases.map((kb) => ({
      id: String(kb.id),
      type: "knowledge-base",
      label: kb.name,
      description: kb.description,
      metadata: { icon: "Library", documentCount: kb.documentCount },
    })),
  });

  // 无 @ 提及模式（知识库聊天等场景）
  if (!enableMentions) {
    return (
      <ComposerPrimitive.Input
        ref={textareaRef}
        placeholder="发送消息"
        className="aui-composer-input caret-primary placeholder:text-muted-foreground/80 max-h-32 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base outline-none"
        rows={1}
        autoFocus
        enterKeyHint="send"
        aria-label="消息输入框"
      />
    );
  }

  // @ 提及模式
  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <ComposerPrimitive.Input
        ref={textareaRef}
        placeholder="发送消息，输入@选择知识库"
        className="aui-composer-input caret-primary placeholder:text-muted-foreground/80 max-h-32 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base outline-none"
        rows={1}
        autoFocus
        enterKeyHint="send"
        aria-label="消息输入框"
      />

      <ComposerTriggerPopover char="@" {...mention} emptyItemsLabel="暂无知识库" fallbackIcon={LibraryIcon} iconMap={{ Library: LibraryIcon }} />
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
}
