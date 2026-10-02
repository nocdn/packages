import process from "node:process";
import { parseArgs } from "node:util";

const options = {
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
  init: { type: "boolean" },
  edit: { type: "boolean" },
  undo: { type: "boolean" },
  log: { type: "boolean" },
  "last-log": { type: "boolean" },
  mcp: { type: "boolean" },
  "setup-tunnel": { type: "boolean" },
  "quick-tunnel": { type: "boolean" },
  stdout: { type: "boolean" },
  "no-clipboard": { type: "boolean" },
  "dry-run": { type: "boolean" },
  yes: { type: "boolean", short: "y" },
  "no-tunnel": { type: "boolean" },
  "no-auth": { type: "boolean" },
  "rotate-secret": { type: "boolean" },
  verbose: { type: "boolean" },
  color: { type: "boolean" },
  "no-color": { type: "boolean" },
  path: { type: "string" },
  "allow-home": { type: "boolean" },
  "allow-outside": { type: "boolean" },
  port: { type: "string" },
  hostname: { type: "string" },
  "tunnel-token": { type: "string" },
  "tunnel-name": { type: "string" },
  "auth-token": { type: "string" },
  message: { type: "string", short: "m" },
  task: { type: "string" },
  include: { type: "string", short: "i", multiple: true },
  exclude: { type: "string", short: "e", multiple: true },
};

export function parseCliArgs(
  argv,
  { command = "pastepatch", env = process.env } = {},
) {
  const separator = argv.indexOf("--");
  const args = separator < 0 ? argv : argv.slice(0, separator);
  try {
    const { values, positionals, tokens } = parseArgs({
      args,
      options,
      strict: true,
      allowPositionals: true,
      tokens: true,
    });
    if (positionals.length > 1)
      throw new Error("Expected at most one project path.");
    const mcp = Boolean(
      values.mcp || values["setup-tunnel"] || values["quick-tunnel"],
    );
    const modes = [
      values.init,
      values.edit,
      values.undo,
      values.log || values["last-log"],
      mcp,
    ];
    if (modes.filter(Boolean).length > 1) {
      throw new Error(
        "Choose only one mode: --init, --edit, --undo, --log, or --mcp.",
      );
    }
    if (values["quick-tunnel"]) {
      for (const flag of [
        "no-tunnel",
        "setup-tunnel",
        "hostname",
        "tunnel-name",
        "tunnel-token",
      ]) {
        if (values[flag] !== undefined && values[flag] !== false) {
          throw new Error(`--quick-tunnel cannot be combined with --${flag}.`);
        }
      }
    }
    const rawPort =
      values.port ??
      (values.help || values.version ? undefined : env.PASTEPATCH_MCP_PORT);
    const port =
      rawPort === undefined || rawPort === "" ? null : Number(rawPort);
    if (
      port !== null &&
      (!Number.isInteger(port) || port < 1 || port > 65535)
    ) {
      throw new Error(`--port must be an integer 1-65535, got "${rawPort}".`);
    }
    const last = (...names) =>
      tokens
        .filter(
          (token) => token.kind === "option" && names.includes(token.name),
        )
        .at(-1);
    return {
      help: Boolean(values.help),
      version: Boolean(values.version),
      init: Boolean(values.init),
      edit: Boolean(values.edit),
      undo: Boolean(values.undo),
      log: Boolean(values.log || values["last-log"]),
      mcp,
      setupTunnel: Boolean(values["setup-tunnel"]),
      quickTunnel: Boolean(values["quick-tunnel"]),
      path: values.path ?? positionals[0] ?? ".",
      pathExplicit: values.path !== undefined || positionals.length > 0,
      stdout: Boolean(values.stdout),
      noClipboard: Boolean(values["no-clipboard"]),
      dryRun: Boolean(values["dry-run"]),
      yes: Boolean(values.yes),
      noTunnel: Boolean(values["no-tunnel"]),
      noAuth: Boolean(values["no-auth"]),
      rotateSecret: Boolean(values["rotate-secret"]),
      verbose: Boolean(values.verbose),
      allowHome: Boolean(values["allow-home"]),
      allowOutside: Boolean(values["allow-outside"]),
      color: last("color", "no-color")
        ? last("color", "no-color").name === "color"
        : null,
      task: last("task", "message")?.value ?? "",
      include: values.include ?? [],
      exclude: values.exclude ?? [],
      ingestArgs: separator < 0 ? [] : argv.slice(separator + 1),
      port,
      hostname: values.hostname ?? env.PASTEPATCH_MCP_HOSTNAME ?? "",
      tunnelName: values["tunnel-name"] ?? env.PASTEPATCH_TUNNEL_NAME ?? "",
      tunnelToken:
        values["tunnel-token"] ??
        env.PASTEPATCH_TUNNEL_TOKEN ??
        env.CLOUDFLARE_TUNNEL_TOKEN ??
        "",
      authToken: values["auth-token"] ?? env.PASTEPATCH_MCP_TOKEN ?? "",
    };
  } catch (error) {
    throw new Error(`${error.message}\nRun ${command} --help for usage.`, {
      cause: error,
    });
  }
}
