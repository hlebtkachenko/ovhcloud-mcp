export function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

/** Error result for the model. `verifyWith` names the read tool to use when a write's outcome is unknown. */
export function errorResult(err: unknown, verifyWith?: string) {
  const msg = err instanceof Error ? err.message : String(err);
  const hint = verifyWith && /outcome unknown/.test(msg) ? ` Verify with ${verifyWith} before retrying.` : "";
  return { content: [{ type: "text" as const, text: `Error: ${msg}${hint}` }], isError: true as const };
}

/** Builds an API path, percent-encoding every interpolated value as one path segment. */
export function apiPath(strings: TemplateStringsArray, ...values: Array<string | number>): string {
  return strings.reduce((out, s, i) => out + s + (i < values.length ? encodeURIComponent(String(values[i])) : ""), "");
}

export const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
