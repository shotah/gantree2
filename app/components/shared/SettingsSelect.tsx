"use client";

import type { ReactNode } from "react";

export type SelectOption = { readonly id: string; readonly label: string };

/**
 * The one dropdown behind the cog — Agent, Language, Font size, Photo size.
 * Native `<select>` so the OS picker does the work on a phone. The label wraps
 * the control, so screen readers and `getByLabelText` agree on its name.
 */
export function SettingsSelect({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  options: readonly SelectOption[];
  /** The picked option id. Callers parse it back to their closed set. */
  onChange: (id: string) => void;
  /** One dim line under the control. */
  hint?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1 text-xs text-muted">
        {label}
        <select
          className="w-full rounded border border-edge bg-canvas px-1.5 py-1 text-sm text-fg"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </label>
      {hint ? <p className="text-[11px] text-dim">{hint}</p> : null}
    </div>
  );
}
