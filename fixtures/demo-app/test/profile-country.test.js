import test from "node:test";
import assert from "node:assert/strict";
import { displayCountry } from "../src/address.js";

test("displayCountry tolerates a legacy profile without country", () => {
  assert.equal(displayCountry({ name: "Ada" }), "");
});
