import test from "node:test";
import assert from "node:assert/strict";
import { displayRegion } from "../src/address.js";

test("displayRegion tolerates a legacy address without region", () => {
  assert.equal(displayRegion({ city: "San Francisco" }), "");
});

test("displayRegion normalizes a populated region", () => {
  assert.equal(displayRegion({ region: "ca" }), "CA");
});
