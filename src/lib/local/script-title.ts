/** Read the title header without executing the generated Python script. */
export function extractScriptTitle(script: string | null): string | null {
  const firstLine = script?.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0];
  const title = firstLine?.match(/^[\t ]*#[\t ]*Title:[\t ]*(.*)$/)?.[1].trim();
  return title || null;
}
