import { describe, expect, it } from "vitest";
import { humanizeRocketRideEvent } from "./rocketride";

describe("humanizeRocketRideEvent", () => {
  it("renders RocketRide console JSON as readable text", () => {
    expect(humanizeRocketRideEvent({
      category: "console",
      output: "[198MB] [DATA-SERVER]: Data connection established\n",
      project_id: "project-id",
    })).toBe("Data Server · Data connection established · 198 MB");
  });

  it("renders agent flow events without dumping transport metadata", () => {
    expect(humanizeRocketRideEvent({
      op: "leave",
      component: "agent_a5",
      trace: { invoke: "tool", lane: "invoke", result: "error" },
      token: "tk_secret",
    })).toBe("Agent 5 · Tool invocation failed");
  });

  it("redacts credentials from plain console messages", () => {
    const text = humanizeRocketRideEvent({ output: "Connected with Bearer rr_not-for-display" });
    expect(text).toBe("Connected with Bearer [redacted]");
  });
});
