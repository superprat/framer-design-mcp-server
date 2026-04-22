import {
  FramerAPIError,
  FramerPluginClosedError,
  type Framer,
  isRetryableError,
  withConnection,
} from "framer-api";

interface FramerConfig {
  projectUrl: string;
  apiKey: string;
}

let cachedConfig: FramerConfig | undefined;

function loadConfig(): FramerConfig {
  if (cachedConfig) return cachedConfig;

  const projectUrl = process.env.FRAMER_PROJECT_URL?.trim();
  const apiKey = process.env.FRAMER_API_KEY?.trim();

  if (!projectUrl) {
    throw new ConfigError(
      "FRAMER_PROJECT_URL is not set. Set it to your project URL, e.g. 'https://framer.com/projects/Sites--aabbccdd1122'.",
    );
  }
  if (!apiKey) {
    throw new ConfigError(
      "FRAMER_API_KEY is not set. Generate an API key in Framer → Site Settings → General and export it as FRAMER_API_KEY.",
    );
  }

  cachedConfig = { projectUrl, apiKey };
  return cachedConfig;
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

export class FramerToolError extends Error {
  override name = "FramerToolError";
  constructor(
    message: string,
    public readonly hint?: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 250;

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Open a Framer connection for the duration of `fn`, retrying on transient SDK
 * errors. Always closes the underlying connection, even on throw.
 */
export async function withFramer<T>(fn: (framer: Framer) => Promise<T>): Promise<T> {
  const { projectUrl, apiKey } = loadConfig();

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await withConnection(projectUrl, fn, apiKey);
    } catch (err) {
      lastError = err;
      if (!isRetryableError(err) || attempt === MAX_RETRIES - 1) break;
      await sleep(BASE_BACKOFF_MS * 2 ** attempt);
    }
  }
  throw mapSdkError(lastError);
}

function mapSdkError(err: unknown): FramerToolError {
  if (err instanceof FramerToolError) return err;

  if (err instanceof FramerAPIError) {
    return new FramerToolError(
      err.message,
      hintForErrorCode(err.code),
      String(err.code),
    );
  }
  if (err instanceof FramerPluginClosedError) {
    return new FramerToolError(
      "The Framer connection closed before the operation completed.",
      "Retry the tool call. If the error persists, verify FRAMER_PROJECT_URL is reachable and FRAMER_API_KEY is still valid.",
    );
  }
  if (err instanceof Error) {
    return new FramerToolError(err.message);
  }
  return new FramerToolError("Unknown error from the Framer SDK.");
}

const HINTS: Record<string, string> = {
  UNAUTHORIZED: "Check FRAMER_API_KEY — it may be revoked or belong to a different project.",
  NODE_NOT_FOUND: "The referenced node does not exist in this project.",
  PROJECT_CLOSED: "The project is not reachable. Verify FRAMER_PROJECT_URL.",
  POOL_EXHAUSTED: "The Framer API is at capacity. Wait a moment and retry.",
  TIMEOUT: "The operation timed out. Retry or reduce the scope (e.g. paginate).",
  INVALID_REQUEST: "Check tool arguments — likely an invalid id or attribute value.",
  SCREENSHOT_TOO_LARGE: "Lower the scale (e.g. 1 instead of 2) or supply a smaller clip region.",
  INTERNAL: "Framer returned an internal error. Retry; if it persists, report to server-api-feedback@framer.com.",
};

function hintForErrorCode(code: string | number | undefined): string | undefined {
  return HINTS[String(code ?? "")];
}
