const HTML_TAG_PATTERN = /<\/?[a-z][\s\S]*>/i;

type RichTextBlock =
  | {
      type: "paragraph";
      text: string;
    }
  | {
      type: "list-item";
      text: string;
    };

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const normalizePlainText = (value: unknown) =>
  String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();

const textToParagraphHtml = (value: string) => escapeHtml(normalizePlainText(value)).replace(/\n/g, "<br>");

const mapAllowedTag = (tagName: string) => {
  switch (tagName) {
    case "b":
      return "strong";
    case "i":
      return "em";
    case "p":
    case "div":
    case "br":
    case "strong":
    case "em":
    case "u":
    case "ul":
    case "ol":
    case "li":
      return tagName;
    default:
      return null;
  }
};

const sanitizeNode = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeHtml(node.textContent ?? "");
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const element = node as HTMLElement;
  const allowedTag = mapAllowedTag(element.tagName.toLowerCase());
  const childContent = Array.from(element.childNodes).map(sanitizeNode).join("");

  if (!allowedTag) {
    return childContent;
  }

  if (allowedTag === "br") {
    return "<br>";
  }

  if (
    (allowedTag === "p" || allowedTag === "div" || allowedTag === "li") &&
    normalizeWhitespace(element.textContent ?? "") === ""
  ) {
    return "";
  }

  return `<${allowedTag}>${childContent}</${allowedTag}>`;
};

const getRichTextRoot = (value: string) => {
  const parser = new DOMParser();
  const document = parser.parseFromString(`<div>${value}</div>`, "text/html");

  return document.body.firstElementChild as HTMLDivElement | null;
};

const getNodeInlineText = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const element = node as HTMLElement;
  const tagName = element.tagName.toLowerCase();

  if (tagName === "br") {
    return "\n";
  }

  if (tagName === "ul" || tagName === "ol") {
    return "";
  }

  return Array.from(element.childNodes).map(getNodeInlineText).join("");
};

const getRichTextBlocks = (value: unknown): RichTextBlock[] => {
  const normalizedValue = normalizePlainText(value);
  if (!normalizedValue || !HTML_TAG_PATTERN.test(normalizedValue)) {
    return [];
  }

  const root = getRichTextRoot(sanitizeRichTextHtml(normalizedValue));
  if (!root) return [];

  const blocks: RichTextBlock[] = [];

  Array.from(root.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = normalizeWhitespace(node.textContent ?? "");
      if (text) {
        blocks.push({ type: "paragraph", text });
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const element = node as HTMLElement;
    const tagName = element.tagName.toLowerCase();

    if (tagName === "ul" || tagName === "ol") {
      Array.from(element.children).forEach((child) => {
        if (child.tagName.toLowerCase() !== "li") return;

        const text = normalizeWhitespace(getNodeInlineText(child));
        if (text) {
          blocks.push({ type: "list-item", text });
        }
      });
      return;
    }

    if (tagName === "li") {
      const text = normalizeWhitespace(getNodeInlineText(element));
      if (text) {
        blocks.push({ type: "list-item", text });
      }
      return;
    }

    const text = getNodeInlineText(element)
      .split(/\n+/)
      .map((line) => normalizeWhitespace(line))
      .filter(Boolean)
      .join("\n");

    if (text) {
      blocks.push({ type: "paragraph", text });
    }
  });

  return blocks;
};

const splitPlainTextLines = (value: unknown) =>
  normalizePlainText(value)
    .split(/\n+/)
    .map((line) => line.replace(/^[\s*\u2022\u25CF\u25AA\u25E6\-]+/, "").trim())
    .filter(Boolean);

export const isRichTextValue = (value: unknown): value is string =>
  typeof value === "string" && HTML_TAG_PATTERN.test(value);

export const sanitizeRichTextHtml = (value: string) => {
  const normalizedValue = normalizePlainText(value);
  if (!normalizedValue) return "";

  if (!HTML_TAG_PATTERN.test(normalizedValue)) {
    return textToParagraphHtml(normalizedValue);
  }

  const root = getRichTextRoot(normalizedValue);
  if (!root) {
    return textToParagraphHtml(normalizedValue);
  }

  return Array.from(root.childNodes).map(sanitizeNode).join("").trim();
};

export const getRichTextEditorValue = (value: unknown) => {
  const normalizedValue = normalizePlainText(value);
  if (!normalizedValue) return "";

  return isRichTextValue(normalizedValue)
    ? sanitizeRichTextHtml(normalizedValue)
    : textToParagraphHtml(normalizedValue);
};

export const getRichTextDisplayHtml = (value: unknown) => getRichTextEditorValue(value);

export const getRichTextPlainText = (value: unknown) => {
  const blocks = getRichTextBlocks(value);
  if (blocks.length > 0) {
    return blocks
      .map((block, index) => {
        const content = block.type === "list-item" ? `\u2022 ${block.text}` : block.text;
        const nextBlock = blocks[index + 1];

        if (!nextBlock) {
          return content;
        }

        const separator =
          block.type === "list-item" && nextBlock.type === "list-item" ? "\n" : "\n\n";

        return `${content}${separator}`;
      })
      .join("")
      .trim();
  }

  return normalizePlainText(value);
};

export const getRichTextParagraphs = (value: unknown) => {
  const blocks = getRichTextBlocks(value);
  if (blocks.length > 0) {
    return blocks.map((block) => block.text).filter(Boolean);
  }

  return normalizePlainText(value)
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
};

export const getRichTextListItems = (value: unknown) => {
  const blocks = getRichTextBlocks(value);
  const richListItems = blocks
    .filter((block): block is Extract<RichTextBlock, { type: "list-item" }> => block.type === "list-item")
    .map((block) => block.text)
    .filter(Boolean);

  if (richListItems.length > 0) {
    return richListItems;
  }

  const normalizedValue = normalizePlainText(value);
  if (!normalizedValue) return [];

  return normalizedValue
    .split(/\n+/)
    .flatMap((line) => (/[\u2022\u25CF\u25AA\u25E6]/.test(line) ? line.split(/\s*[\u2022\u25CF\u25AA\u25E6]\s*/) : [line]))
    .map((item) => item.replace(/^[\s*\u2022\u25CF\u25AA\u25E6\-]+/, "").trim())
    .filter(Boolean);
};

export const getRichTextLines = (value: unknown) => {
  const blocks = getRichTextBlocks(value);
  if (blocks.length > 0) {
    return blocks.map((block) => block.text).filter(Boolean);
  }

  return splitPlainTextLines(value);
};


