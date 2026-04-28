import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ClipboardEvent,
  type HTMLAttributes,
  type KeyboardEvent,
} from "react";
import {
  Bold,
  Eraser,
  Italic,
  List,
  ListOrdered,
  Underline,
} from "lucide-react";

import { getRichTextEditorValue, sanitizeRichTextHtml } from "@/lib/richText";
import { cn } from "@/lib/utils";
import { Button } from "./button";

type RichTextEditorProps = Omit<HTMLAttributes<HTMLDivElement>, "onChange"> & {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  minHeightClassName?: string;
};

const RichTextEditor = forwardRef<HTMLDivElement, RichTextEditorProps>(
  (
    {
      className,
      value = "",
      onChange,
      placeholder = "Escribe aqui...",
      minHeightClassName = "min-h-[140px]",
      ...props
    },
    ref,
  ) => {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const lastEmittedValueRef = useRef("");

    useImperativeHandle(ref, () => editorRef.current as HTMLDivElement, []);

    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;

      const nextHtml = getRichTextEditorValue(value);
      const isFocused = document.activeElement === editor;

      if (isFocused && value === lastEmittedValueRef.current) {
        return;
      }

      if (editor.innerHTML !== nextHtml) {
        editor.innerHTML = nextHtml;
      }
    }, [value]);

    const emitValue = ({ normalizeDom = false } = {}) => {
      const editor = editorRef.current;
      if (!editor) return;

      const sanitizedValue = sanitizeRichTextHtml(editor.innerHTML);

      if (normalizeDom && editor.innerHTML !== sanitizedValue) {
        editor.innerHTML = sanitizedValue;
      }

      lastEmittedValueRef.current = sanitizedValue;
      onChange?.(sanitizedValue);
    };

    const runCommand = (command: "bold" | "italic" | "underline" | "insertUnorderedList" | "insertOrderedList") => {
      editorRef.current?.focus();
      document.execCommand(command);
      emitValue();
    };

    const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
      event.preventDefault();
      const html = event.clipboardData.getData("text/html");
      const plainText = event.clipboardData.getData("text/plain");
      const content = sanitizeRichTextHtml(html || plainText);

      document.execCommand("insertHTML", false, content || escapeHtml(plainText));
      emitValue();
    };

    const clearFormatting = () => {
      const editor = editorRef.current;
      if (!editor) return;

      const plainText = editor.innerText.trim();
      const sanitizedValue = sanitizeRichTextHtml(plainText);
      editor.innerHTML = sanitizedValue;
      lastEmittedValueRef.current = sanitizedValue;
      onChange?.(sanitizedValue);
      editor.focus();
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" || event.shiftKey) return;

      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) return;
      if (!selection.isCollapsed) return;

      const editor = editorRef.current;
      if (!editor) return;

      const anchorNode = selection.anchorNode;
      const anchorElement =
        anchorNode instanceof HTMLElement ? anchorNode : anchorNode?.parentElement;
      const listItem = anchorElement?.closest("li");

      if (!listItem || !editor.contains(listItem)) {
        return;
      }

      event.preventDefault();

      const list = listItem.parentElement;
      if (!list || !["ul", "ol"].includes(list.tagName.toLowerCase())) return;

      const listItemText = (listItem.textContent ?? "").replace(/\u00a0/g, " ").trim();

      if (!listItemText) {
        const paragraph = document.createElement("div");
        paragraph.appendChild(document.createElement("br"));

        const listParent = list.parentNode;
        const nextSibling = list.nextSibling;

        listItem.remove();

        if (!list.querySelector("li")) {
          list.remove();
        }

        if (listParent) {
          listParent.insertBefore(paragraph, nextSibling);
        } else {
          editor.appendChild(paragraph);
        }

        placeCaretAtStart(paragraph);
        emitValue();
        return;
      }

      const selectionRange = selection.getRangeAt(0);
      const trailingRange = document.createRange();
      trailingRange.selectNodeContents(listItem);
      trailingRange.setStart(selectionRange.startContainer, selectionRange.startOffset);

      const trailingFragment = trailingRange.extractContents();
      const nextListItem = document.createElement("li");

      if (trailingFragment.childNodes.length > 0) {
        nextListItem.appendChild(trailingFragment);
      }

      ensureListItemContent(listItem);
      ensureListItemContent(nextListItem);
      list.insertBefore(nextListItem, listItem.nextSibling);
      placeCaretAtStart(nextListItem);
      emitValue();
    };

    return (
      <div className={cn("rounded-lg border border-input bg-background", className)}>
        <div className="flex flex-wrap gap-1 border-b border-border bg-muted/30 p-2">
          <ToolbarButton
            icon={Bold}
            label="Negrita"
            onClick={() => runCommand("bold")}
          />
          <ToolbarButton
            icon={Italic}
            label="Cursiva"
            onClick={() => runCommand("italic")}
          />
          <ToolbarButton
            icon={Underline}
            label="Subrayado"
            onClick={() => runCommand("underline")}
          />
          <ToolbarButton
            icon={List}
            label="Viñetas"
            onClick={() => runCommand("insertUnorderedList")}
          />
          <ToolbarButton
            icon={ListOrdered}
            label="Numeración"
            onClick={() => runCommand("insertOrderedList")}
          />
          <ToolbarButton
            icon={Eraser}
            label="Limpiar formato"
            onClick={clearFormatting}
          />
        </div>

        <div
          {...props}
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          data-placeholder={placeholder}
          className={cn(
            "formatted-content rich-text-editor w-full px-3 py-2 text-sm outline-none",
            minHeightClassName,
          )}
          onInput={emitValue}
          onBlur={() => emitValue({ normalizeDom: true })}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
      </div>
    );
  },
);

RichTextEditor.displayName = "RichTextEditor";

const ToolbarButton = ({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Bold;
  label: string;
  onClick: () => void;
}) => (
  <Button
    type="button"
    variant="ghost"
    size="sm"
    className="h-8 px-2"
    onMouseDown={(event) => event.preventDefault()}
    onClick={onClick}
    aria-label={label}
    title={label}
  >
    <Icon className="h-4 w-4" />
  </Button>
);

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const placeCaretAtStart = (element: HTMLElement) => {
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
};

const ensureListItemContent = (listItem: HTMLLIElement) => {
  const hasVisibleContent = (listItem.textContent ?? "").replace(/\u00a0/g, " ").trim().length > 0;
  const hasBreak = Boolean(listItem.querySelector("br"));
  if (hasVisibleContent || hasBreak) return;

  listItem.replaceChildren();

  listItem.appendChild(document.createElement("br"));
};

export { RichTextEditor };

