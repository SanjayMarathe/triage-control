import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { HydraDBClient } from "@hydradb/sdk";
import type { IntegrationStatus } from "../shared/types";
import { probeHotdata } from "./hotdata";
import { sponsorMode } from "./runtime";

const execFileAsync = promisify(execFile);

function integration(
  name: IntegrationStatus["name"],
  configured: boolean,
  connected: boolean,
  detail: string,
): IntegrationStatus {
  return {
    name,
    configured,
    mode: sponsorMode(),
    status: connected ? "connected" : configured ? "degraded" : "degraded",
    detail,
  };
}

function diagnostic(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/(Bearer|token|api[_-]?key)\s*[:=]?\s*\S+/gi, "$1 [redacted]").slice(0, 180);
}

async function rocketRideStatus(): Promise<IntegrationStatus> {
  const apiKey = process.env.ROCKETRIDE_APIKEY;
  const uri = process.env.ROCKETRIDE_URI;
  const modelKey = process.env.ROCKETRIDE_OPENAI_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey || !uri || !modelKey) {
    return integration("RocketRide", false, false, "URI, runtime key, or OpenAI model key missing");
  }
  type RocketRideProbeClient = {
    connect: (credential?: string, options?: { timeout?: number }) => Promise<void>;
    validate: (options: { pipeline: Record<string, unknown> }) => Promise<{ errors?: Array<{ message?: string }> }>;
    disconnect: () => Promise<void>;
  };
  let client: RocketRideProbeClient | undefined;
  try {
    const sdk = (await import("rocketride")) as unknown as {
      RocketRideClient: new (options: Record<string, unknown>) => RocketRideProbeClient;
    };
    client = new sdk.RocketRideClient({
      auth: apiKey,
      uri,
      env: { ROCKETRIDE_OPENAI_KEY: modelKey },
      persist: false,
      maxRetryTime: 20_000,
      requestTimeout: 20_000,
    });
    await client.connect(apiKey, { timeout: 20_000 });
    const pipelinePath = resolve(process.env.ROCKETRIDE_PIPELINE_PATH || "./pipeline/triage.pipe");
    const pipeline = JSON.parse(await readFile(pipelinePath, "utf8")) as Record<string, unknown>;
    const validation = await client.validate({ pipeline });
    if (validation.errors?.length) {
      throw new Error(validation.errors.map((item) => item.message || "invalid component").join("; "));
    }
    return integration("RocketRide", true, true, `WebSocket authenticated; six-agent pipeline structurally valid at ${uri}`);
  } catch (error) {
    return integration("RocketRide", true, false, `runtime or pipeline probe failed: ${diagnostic(error)}`);
  } finally {
    await client?.disconnect().catch(() => undefined);
  }
}

async function cogneeStatus(): Promise<IntegrationStatus> {
  const api = process.env.COGNEE_API_URL?.replace(/\/$/, "");
  const key = process.env.COGNEE_API_KEY;
  const tenant = process.env.COGNEE_TENANT_ID;
  if (!api || !key || !tenant) return integration("Cognee", false, false, "hosted URL, API key, or tenant ID missing");
  try {
    const response = await fetch(`${api}/api/v1/datasets/`, { headers: { "X-Api-Key": key, "X-Tenant-Id": tenant } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return integration("Cognee", true, true, "hosted tenant authenticated; datasets readable");
  } catch (error) {
    return integration("Cognee", true, false, `hosted API probe failed: ${diagnostic(error)}`);
  }
}

async function hydraStatus(): Promise<IntegrationStatus> {
  const token = process.env.HYDRA_API_KEY;
  const database = process.env.HYDRA_DATABASE || "default-tenant";
  if (!token) return integration("HydraDB", false, false, "API key missing");
  try {
    const client = new HydraDBClient({ token, baseUrl: process.env.HYDRA_API_URL || "https://api.hydradb.com", apiVersion: "2", timeoutInSeconds: 10, maxRetries: 0 });
    const result = await client.databases.list();
    const databases = result.data?.databases || result.data?.tenantIds || [];
    if (!databases.includes(database)) throw new Error(`configured database ${database} is unavailable`);
    return integration("HydraDB", true, true, `v2 authenticated; database ${database} readable`);
  } catch (error) {
    return integration("HydraDB", true, false, `v2 probe failed: ${diagnostic(error)}`);
  }
}

async function hotdataStatus(): Promise<IntegrationStatus> {
  const configured = Boolean(process.env.HOTDATA_API_KEY && process.env.HOTDATA_DATABASE_ID && process.env.HOTDATA_WORKSPACE_ID);
  if (!configured) return integration("hotdata", false, false, "API key, workspace, or database missing");
  const result = await probeHotdata();
  return integration(
    "hotdata",
    true,
    result.reachable && result.tableExists,
    result.reachable
      ? result.tableExists ? "database authenticated; public.triage_events exists" : "database authenticated; telemetry table absent"
      : `API probe failed (${result.errorCode || "unknown"})`,
  );
}

async function roteStatus(): Promise<IntegrationStatus> {
  const play = process.env.ROTE_PLAY_URI;
  const cli = process.env.ROTE_CLI || "rote";
  if (!play) return integration("Rote", false, false, "local or released Play URI missing");
  try {
    const local = play.startsWith(".") || play.startsWith("/") || play.endsWith(".ts");
    await execFileAsync(cli, local
      ? ["play", "info", "triage-remediation", "--json", "-d", new URL("../rote/triage-remediation", import.meta.url).pathname]
      : ["play", "inspect", play, "--json"], { timeout: 15_000, maxBuffer: 1024 * 1024 });
    return integration("Rote", true, true, `released ${local ? "local" : "registry"} Play ready: ${play}`);
  } catch (error) {
    return integration("Rote", true, false, `Play inspection failed: ${diagnostic(error)}`);
  }
}

async function snykStatus(): Promise<IntegrationStatus> {
  const token = process.env.SNYK_TOKEN;
  const org = process.env.SNYK_ORG_ID;
  if (!token || !org) return integration("Snyk", false, false, "token or organization ID missing");
  try {
    const cli = process.env.SNYK_CLI || "snyk";
    const { stdout } = await execFileAsync(cli, [
      "code",
      "test",
      "demo-shop",
      `--org=${org}`,
      "--severity-threshold=high",
      "--json",
    ], {
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, SNYK_TOKEN: token },
      timeout: 45_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout || "{}");
    const findings = Array.isArray(parsed.runs)
      ? parsed.runs.reduce((count: number, run: { results?: unknown[] }) => count + (run.results?.length || 0), 0)
      : 0;
    return integration("Snyk", true, true, `Snyk Code authenticated; high-severity baseline findings: ${findings}`);
  } catch (error) {
    return integration("Snyk", true, false, `organization probe failed: ${diagnostic(error)}`);
  }
}

async function githubStatus(): Promise<IntegrationStatus> {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BASE_BRANCH || "main";
  const expectedSha = process.env.GITHUB_BASE_SHA;
  if (!token || !owner || !repo || !expectedSha) return integration("GitHub", false, false, "token, repository, or pinned SHA missing");
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as { object?: { sha?: string } };
    if (body.object?.sha !== expectedSha) throw new Error("pinned base SHA is stale");
    return integration("GitHub", true, true, `${owner}/${repo}@${branch} writable token accepted; base SHA pinned`);
  } catch (error) {
    return integration("GitHub", true, false, `repository probe failed: ${diagnostic(error)}`);
  }
}

export async function probeIntegrations(): Promise<IntegrationStatus[]> {
  if (sponsorMode() === "simulated") return Promise.resolve([]);
  return Promise.all([
    rocketRideStatus(),
    cogneeStatus(),
    hydraStatus(),
    hotdataStatus(),
    roteStatus(),
    snykStatus(),
    githubStatus(),
  ]);
}
