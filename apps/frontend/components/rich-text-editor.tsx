"use client";

import { useRef, useEffect, type FC } from "react";
import { useEditor, EditorContent, type Extensions } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TipTapUnderline from "@tiptap/extension-underline";
import TipTapLink from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import TurndownService from "turndown";
import { cn } from "@/lib/utils";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Quote,
  List,
  ListOrdered,
  ListChecks,
  Heading1,
  Heading2,
  Heading3,
  CodeXml,
  Minus,
  Highlighter,
  Link,
  Undo2,
  Redo2,
  RemoveFormatting,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// HTML → Markdown
// ---------------------------------------------------------------------------

const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

// <u> 保留为 HTML（Markdown 无对应语法）
turndownService.addRule("underline", {
  filter: (node) => node.nodeName === "U" || node.style?.textDecoration === "underline",
  replacement: (content) => `<u>${content}</u>`,
});

// <s>/<del> → GFM 删除线
turndownService.addRule("strikethrough", {
  filter: (node) => node.nodeName === "S" || node.nodeName === "DEL" || node.nodeName === "STRIKE",
  replacement: (content) => `~~${content}~~`,
});

// <mark> 保留为 HTML（Markdown 无对应语法）
turndownService.addRule("mark", {
  filter: (node) => node.nodeName === "MARK",
  replacement: (content) => `<mark>${content}</mark>`,
});

// 任务列表 → GFM - [ ] / - [x]
turndownService.addRule("taskList", {
  filter: (node) => node.nodeName === "LI" && node.getAttribute("data-type") === "taskItem",
  replacement: (content, _node) => {
    const checked = _node.getAttribute("data-checked") === "true";
    return `- [${checked ? "x" : " "}] ${content}\n`;
  },
});

export function htmlToMd(html: string): string {
  try {
    return turndownService.turndown(html);
  } catch {
    return html;
  }
}

// ---------------------------------------------------------------------------
// 工具栏按钮
// ---------------------------------------------------------------------------

interface ToolbarButton {
  label: string;
  icon: LucideIcon;
  action: () => void;
  isActive: () => boolean;
}

const EDITOR_PROSE_CLASS =
  "prose prose-sm dark:prose-invert max-w-none outline-none " +
  "[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2 " +
  "[&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-2 " +
  "[&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 " +
  "[&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 " +
  "[&_blockquote]:border-l-4 [&_blockquote]:border-primary [&_blockquote]:pl-4 [&_blockquote]:italic " +
  "[&_pre]:bg-muted/30 [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:border " +
  "[&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm " +
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 " +
  "[&_hr]:my-4 [&_hr]:border-border " +
  "[&_.ProseMirror-placeholder]:text-muted-foreground [&_.ProseMirror-placeholder]:pointer-events-none";

const DEFAULT_EXTENSIONS: Extensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
  TipTapUnderline,
  TipTapLink.configure({ openOnClick: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Highlight.configure({ multicolor: true }),
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RichTextEditorProps {
  /** 初始 Markdown 内容 */
  initialContent?: string;
  /** 占位文本 */
  placeholder?: string;
  /** 内容变化回调（返回 Markdown） */
  onContentChange?: (markdown: string) => void;
  /** 最小高度（CSS 值） */
  minHeight?: string;
  /** 获取编辑器实例的 ref */
  editorRef?: React.MutableRefObject<ReturnType<typeof useEditor> | null>;
  /** 是否显示工具栏 */
  showToolbar?: boolean;
  /** 自定义扩展 */
  extensions?: Extensions;
  /** 额外的 CSS 类名 */
  className?: string;
  /** 工具栏上额外的按钮 */
  extraToolbarButtons?: ToolbarButton[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const RichTextEditor: FC<RichTextEditorProps> = ({
  initialContent = "",
  placeholder = "输入内容...",
  onContentChange,
  minHeight = "200px",
  editorRef,
  showToolbar = true,
  extensions = [],
  className,
  extraToolbarButtons = [],
}) => {
  const initializedRef = useRef(false);

  const editor = useEditor({
    extensions: [...DEFAULT_EXTENSIONS, Placeholder.configure({ placeholder }), ...extensions],
    onUpdate: ({ editor: ed }) => {
      if (!initializedRef.current) return;
      const md = htmlToMd(ed.getHTML());
      onContentChange?.(md);
    },
    editorProps: {
      attributes: {
        class: cn(EDITOR_PROSE_CLASS, "px-4 py-3 rounded-b-md border border-input border-t-0 bg-background", className),
        style: `min-height: ${minHeight}`,
      },
    },
  });

  // 暴露编辑器实例
  useEffect(() => {
    if (editorRef) editorRef.current = editor;
  }, [editor, editorRef]);

  // 设置初始内容
  useEffect(() => {
    if (!editor || initializedRef.current) return;
    initializedRef.current = true;
    if (initialContent) {
      editor.commands.setContent(`<p>${initialContent.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`);
    }
  }, [editor, initialContent]);

  // 工具栏按钮
  const toolbarButtons: ToolbarButton[] = editor
    ? [
        { label: "撤销", icon: Undo2, action: () => editor.chain().focus().undo().run(), isActive: () => false },
        { label: "重做", icon: Redo2, action: () => editor.chain().focus().redo().run(), isActive: () => false },
        { label: "标题1", icon: Heading1, action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(), isActive: () => editor.isActive("heading", { level: 1 }) },
        { label: "标题2", icon: Heading2, action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), isActive: () => editor.isActive("heading", { level: 2 }) },
        { label: "标题3", icon: Heading3, action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), isActive: () => editor.isActive("heading", { level: 3 }) },
        { label: "加粗", icon: Bold, action: () => editor.chain().focus().toggleBold().run(), isActive: () => editor.isActive("bold") },
        { label: "斜体", icon: Italic, action: () => editor.chain().focus().toggleItalic().run(), isActive: () => editor.isActive("italic") },
        { label: "下划线", icon: Underline, action: () => editor.chain().focus().toggleUnderline().run(), isActive: () => editor.isActive("underline") },
        { label: "删除线", icon: Strikethrough, action: () => editor.chain().focus().toggleStrike().run(), isActive: () => editor.isActive("strike") },
        { label: "高亮", icon: Highlighter, action: () => editor.chain().focus().toggleHighlight().run(), isActive: () => editor.isActive("highlight") },
        { label: "行内代码", icon: Code, action: () => editor.chain().focus().toggleCode().run(), isActive: () => editor.isActive("code") },
        {
          label: "链接",
          icon: Link,
          action: () => {
            if (editor.isActive("link")) {
              editor.chain().focus().unsetLink().run();
              return;
            }
            const existingHref = editor.getAttributes("link").href as string | undefined;
            const url = window.prompt("输入链接 URL", existingHref ?? "");
            if (url) editor.chain().focus().setLink({ href: url }).run();
          },
          isActive: () => editor.isActive("link"),
        },
        { label: "代码块", icon: CodeXml, action: () => editor.chain().focus().toggleCodeBlock().run(), isActive: () => editor.isActive("codeBlock") },
        { label: "引用", icon: Quote, action: () => editor.chain().focus().toggleBlockquote().run(), isActive: () => editor.isActive("blockquote") },
        { label: "无序列表", icon: List, action: () => editor.chain().focus().toggleBulletList().run(), isActive: () => editor.isActive("bulletList") },
        { label: "有序列表", icon: ListOrdered, action: () => editor.chain().focus().toggleOrderedList().run(), isActive: () => editor.isActive("orderedList") },
        { label: "任务列表", icon: ListChecks, action: () => editor.chain().focus().toggleTaskList().run(), isActive: () => editor.isActive("taskList") },
        { label: "分割线", icon: Minus, action: () => editor.chain().focus().setHorizontalRule().run(), isActive: () => false },
        { label: "清除格式", icon: RemoveFormatting, action: () => editor.chain().focus().clearNodes().unsetAllMarks().run(), isActive: () => false },
        ...extraToolbarButtons,
      ]
    : [...extraToolbarButtons];

  const groupBreaks = new Set(["标题1", "加粗", "行内代码", "代码块", "无序列表"]);

  return (
    <div className="flex flex-col">
      {showToolbar && (
        <div className="flex shrink-0 flex-wrap items-center gap-0.5 rounded-t-md border border-b-0 border-input bg-muted/40 px-2 py-1.5">
          {toolbarButtons.map((btn, i) => (
            <span key={btn.label} className="contents">
              {i > 0 && groupBreaks.has(btn.label) && <span className="mx-1 h-4 w-px bg-border" />}
              <Button variant={btn.isActive() ? "secondary" : "ghost"} size="icon" className="size-7" onClick={btn.action} title={btn.label} type="button">
                <btn.icon className="size-3.5" />
              </Button>
            </span>
          ))}
        </div>
      )}
      <EditorContent editor={editor} className="flex-1 flex flex-col min-h-0 [&_.ProseMirror]:outline-none" />
    </div>
  );
};
