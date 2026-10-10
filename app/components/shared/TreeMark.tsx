import {
  MARK_BOX,
  MARK_ORANGE,
  MARK_TREE_INNER_TRANSFORM,
  MARK_TREE_TRANSFORM,
  TREE_PATH,
} from "@/lib/theme/mark";

/**
 * The gantree mark, inline, in theme colours: the tree is `currentColor`,
 * the orange is the accent. Size it with `className` (`h-8 w-8`).
 */
export function TreeMark({ className = "h-8 w-8", title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox={`0 0 ${MARK_BOX} ${MARK_BOX}`}
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-tree-mark
    >
      <g fill="currentColor" transform={MARK_TREE_TRANSFORM}>
        <g transform={MARK_TREE_INNER_TRANSFORM}>
          <path d={TREE_PATH} />
        </g>
      </g>
      <line
        x1={MARK_ORANGE.x}
        y1={MARK_ORANGE.stringTop}
        x2={MARK_ORANGE.x}
        y2={MARK_ORANGE.stringBottom}
        stroke="currentColor"
        strokeOpacity={0.6}
        strokeWidth={1.15}
      />
      <circle cx={MARK_ORANGE.x} cy={MARK_ORANGE.cy} r={MARK_ORANGE.r} fill="var(--accent)" />
      <path
        d={`M${MARK_ORANGE.x} ${MARK_ORANGE.cy - 1.66} V${MARK_ORANGE.cy - 0.54}`}
        fill="none"
        stroke="var(--accent-line)"
        strokeWidth={0.95}
        strokeLinecap="round"
      />
    </svg>
  );
}
