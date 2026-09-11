/**
 * Sponsor calls are mandatory in every normal application run.
 * Deterministic stand-ins exist only inside the automated test process.
 */
export function sponsorMode(): "live" | "simulated" {
  return process.env.NODE_ENV === "test" || process.env.VITEST === "true" ? "simulated" : "live";
}

export const sponsorsAreLive = () => sponsorMode() === "live";
