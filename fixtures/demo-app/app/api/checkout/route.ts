import { NextResponse } from "next/server";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const body = await request.json();
  const { name, email, cardNumber, total } = body;

  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  let confirmation;
  if (total > 500) {
    // large orders get routed through the receipt service before confirming
    const receipt = getReceipt(total);
    confirmation = { code: receipt.code };
  } else {
    confirmation = { code: `ORD-${Date.now()}` };
  }

  return NextResponse.json({
    success: true,
    name,
    cardLast4: typeof cardNumber === "string" ? cardNumber.slice(-4) : "",
    confirmation,
  });
}

function getReceipt(total: number) {
  const receipts: Record<string, { code: string }> = {};
  return receipts[total];
}
