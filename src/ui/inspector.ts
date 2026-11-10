/**
 * The drawer's "Inspector command": a line to paste into a terminal that makes the same tool call
 * with the MCP Inspector's CLI. Pure strings, so it stays browser-safe and testable in Node.
 * Quoting is for a POSIX shell (macOS, Linux, WSL).
 */

/** One shell word: left bare when it is plainly safe, otherwise single-quoted. */
export function shellQuote(word: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(word)) return word;
  return `'${word.replace(/'/g, `'\\''`)}'`;
}

export interface InspectorLaunch {
  command: string;
  args: string[];
  /** The folder the server runs in; its relative paths only make sense from there. */
  cwd?: string;
}

export function inspectorCommand(
  launch: InspectorLaunch | undefined,
  toolName: string,
  toolArgs: Record<string, unknown>,
): string {
  const server = launch
    ? [launch.command, ...launch.args].map(shellQuote).join(" ")
    : "<server command>";
  const cd = launch?.cwd ? `cd ${shellQuote(launch.cwd)} && ` : "";
  const flags = Object.entries(toolArgs)
    .map(([k, v]) => ` --tool-arg ${shellQuote(`${k}=${JSON.stringify(v)}`)}`)
    .join("");
  return `${cd}npx @modelcontextprotocol/inspector --cli ${server} --method tools/call --tool-name ${shellQuote(toolName)}${flags}`;
}
