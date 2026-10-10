"use client";

import type { ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

const PLUGINS = [remarkGfm, remarkBreaks];

const BUBBLE: Components = {
  p: ({ children }) => <p className="my-1 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mt-2 mb-1 text-[1.15em] font-semibold text-fg">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-2 mb-1 text-[1.05em] font-semibold text-fg">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-1.5 mb-1 font-medium text-fg">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-1.5 mb-1 font-medium text-fg">{children}</h4>,
  h5: ({ children }) => <h5 className="mt-1 mb-1 font-medium text-fg">{children}</h5>,
  h6: ({ children }) => <h6 className="mt-1 mb-1 font-medium text-fg">{children}</h6>,
  ul: ({ children }) => <ul className="my-1 list-disc space-y-0.5 pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 list-decimal space-y-0.5 pl-4">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-1 border-l-2 border-line pl-2 text-muted">{children}</blockquote>
  ),
  hr: () => <hr className="my-2 border-line" />,
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-mark underline underline-offset-2"
      target="_blank"
      rel="noreferrer noopener"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  del: ({ children }) => <del className="text-muted">{children}</del>,
  code: ({ className, children }) => {
    const block = Boolean(className);
    if (block) {
      return <code className={`${className ?? ""} font-mono text-[0.85em]`}>{children}</code>;
    }
    return (
      <code className="rounded bg-track px-1 py-0.5 font-mono text-[0.85em] text-fg">{children}</code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-1 overflow-x-auto rounded-lg bg-track p-2 text-fg">{children}</pre>
  ),
  img: ({ src, alt }) => (
    <img src={src} alt={alt ?? ""} className="my-1 max-h-48 rounded-lg" />
  ),
  table: ({ children }) => (
    <div className="my-1 overflow-x-auto">
      <table className="w-full border-collapse text-[0.9em]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-line bg-track px-1.5 py-1 text-left font-medium text-fg">{children}</th>
  ),
  td: ({ children }) => <td className="border border-line px-1.5 py-1">{children}</td>,
  input: ({ checked, type }) => (
    type === "checkbox"
      ? <input type="checkbox" checked={Boolean(checked)} disabled readOnly className="mr-1 align-middle" />
      : null
  ),
};

export function MarkdownBody({ text }: { text: string }): ReactNode {
  return (
    <div className="min-w-0 [overflow-wrap:anywhere]">
      <Markdown remarkPlugins={PLUGINS} components={BUBBLE}>{text}</Markdown>
    </div>
  );
}
