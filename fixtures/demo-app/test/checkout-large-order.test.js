import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/checkout/route.ts";

function checkout(overrides = {}) {
  return POST(new Request("http://demo-shop.local/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Demo Buyer",
      email: "buyer@example.com",
      cardNumber: "4111111111111111",
      total: 149.99,
      ...overrides,
    }),
  }));
}

test("large order returns a usable confirmation instead of throwing", async () => {
  const response = await checkout({ total: 599.98 });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.match(body.confirmation.code, /^ORD-\d+$/);
});

test("ordinary checkout remains successful", async () => {
  const response = await checkout();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.match(body.confirmation.code, /^ORD-\d+$/);
});

test("invalid email remains rejected", async () => {
  const response = await checkout({ email: "notanemail" });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid email address" });
});
