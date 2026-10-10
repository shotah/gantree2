"use client";

export function PermitRow({
  name,
  action,
  hint,
  disabled,
  pressed,
  onClick,
}: {
  name: string;
  action: string;
  hint?: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick?: () => void;
}) {
  const chip = Boolean(onClick) || Boolean(disabled);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-xs text-muted">{name}</span>
        {chip
          ? (
              <button
                type="button"
                aria-label={action}
                aria-pressed={pressed}
                disabled={disabled || !onClick}
                className="shrink-0 rounded-lg border border-accent-line bg-accent-soft px-2 py-0.5 text-xs text-mark disabled:opacity-50"
                onClick={onClick}
              >
                {action}
              </button>
            )
          : (
              <span className="shrink-0 text-xs text-ok">{action}</span>
            )}
      </div>
      {hint
        ? <p className="text-[11px] text-dim">{hint}</p>
        : null}
    </div>
  );
}
