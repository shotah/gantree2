export const PAGES_ORIGIN: string;

export const REPO: string;

export const APPS_REPO: string;

export const DOC_PAGES: { file: string; nav: string }[];

export function parsePagesArgs(argv: string[]): { outDir: string; help: boolean };

export function githubSlug(text: string): string;

export function titleFromMarkdown(md: string): string;

export function rewriteHref(href: string): string;

export function markdownToHtml(md: string): string;

export function buildPages(rootDir: string, outDir: string, log?: (message: string) => void): string[];
