const validDataTypes = new Set(["fit", "tcx", "gpx", "fit.gz", "tcx.gz", "gpx.gz"]);

/**
 * Workers have no filesystem. Validation matches the Go handler; opening the
 * file then fails the same way a missing path does (`open file`).
 */
export function uploadsCreateError(args: Record<string, unknown>): string {
  const filePath = typeof args.file === "string" ? args.file : "";
  if (filePath === "") return "uploads_create: file path is required";

  let dataType = typeof args.data_type === "string" ? args.data_type : "";
  if (dataType === "") {
    const detected = detectDataType(filePath);
    if (typeof detected !== "string") return detected.error;
    dataType = detected;
  }
  if (!validDataTypes.has(dataType)) {
    return `uploads_create: invalid data_type '${dataType}'; must be one of: fit, tcx, gpx, fit.gz, tcx.gz, gpx.gz`;
  }
  return `uploads_create: open file: open ${filePath}: operation not supported`;
}

function detectDataType(filePath: string): string | { error: string } {
  const ext = extension(filePath);
  if (ext === "fit" || ext === "tcx" || ext === "gpx") return ext;
  if (ext === "gz") {
    const base = filePath.endsWith(".gz") ? filePath.slice(0, -3) : filePath;
    const inner = extension(base);
    if (inner === "fit" || inner === "tcx" || inner === "gpx") return `${inner}.gz`;
    return { error: "uploads_create: cannot detect data_type from extension; provide data_type explicitly" };
  }
  return { error: `uploads_create: unrecognized file extension '${ext}'; provide data_type explicitly (fit, tcx, gpx, fit.gz, tcx.gz, gpx.gz)` };
}

/** `path/filepath.Ext`, without the dot, lowercased. */
function extension(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot < 0) return "";
  return base.slice(dot + 1).toLowerCase();
}
