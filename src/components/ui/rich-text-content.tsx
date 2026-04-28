import { getRichTextDisplayHtml, getRichTextPlainText } from "@/lib/richText";
import { cn } from "@/lib/utils";

const RichTextContent = ({
  value,
  className,
  emptyLabel = "-",
}: {
  value: unknown;
  className?: string;
  emptyLabel?: string;
}) => {
  const html = getRichTextDisplayHtml(value);

  if (!html) {
    return <span className="text-sm font-medium">{emptyLabel}</span>;
  }

  return (
    <div
      className={cn("formatted-content text-sm", className)}
      title={getRichTextPlainText(value)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export { RichTextContent };
