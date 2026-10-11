export function pctFromVitestSummary(json: unknown): number;

export function badgeColor(pct: number): string;

export function badgeSvg(opts: { label: string; pct: number }): string;

export function main(argv: string[]): { pct: number; out: string };
