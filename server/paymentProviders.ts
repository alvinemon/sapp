import { listPaymentMethods, type PaymentMethod } from "./payments.js";
import { grantAccess } from "./premium.js";

export type PaymentProvider = "bkash" | "surjo" | "nagad" | "custom";

export interface VerifyPaymentInput {
  provider: PaymentProvider;
  reference: string;
  amount: string;
  contentId: string;
  methodId: string;
}

export interface VerifyPaymentResult {
  ok: boolean;
  autoGranted?: boolean;
  code?: string;
  message?: string;
}

/** Stub — wire Surjo Pay API when SURJO_API_KEY + SURJO_MERCHANT_ID are set. */
export async function verifySurjoPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
  const apiKey = process.env.SURJO_API_KEY?.trim();
  const merchantId = process.env.SURJO_MERCHANT_ID?.trim();
  if (!apiKey || !merchantId) {
    return { ok: false, message: "Surjo API not configured — set SURJO_API_KEY and SURJO_MERCHANT_ID" };
  }
  const ref = input.reference.trim();
  if (ref.length < 6) {
    return { ok: false, message: "Invalid Surjo transaction reference" };
  }
  // Placeholder: real integration would POST to Surjo verify endpoint with merchantId
  const { code } = grantAccess(input.contentId, {
    methodId: input.methodId,
    reference: ref,
  });
  return { ok: true, autoGranted: true, code };
}

/** Stub — wire bKash checkout API when BKASH_API_KEY + BKASH_SECRET are set. */
export async function verifyBkashPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
  const apiKey = process.env.BKASH_API_KEY?.trim();
  const secret = process.env.BKASH_SECRET?.trim();
  if (!apiKey || !secret) {
    return { ok: false, message: "bKash API not configured — set BKASH_API_KEY and BKASH_SECRET" };
  }
  const ref = input.reference.trim();
  if (ref.length < 8) {
    return { ok: false, message: "Invalid bKash transaction reference" };
  }
  const { code } = grantAccess(input.contentId, {
    methodId: input.methodId,
    reference: ref,
  });
  return { ok: true, autoGranted: true, code };
}

export async function verifyAutoPayment(
  method: PaymentMethod,
  input: VerifyPaymentInput,
): Promise<VerifyPaymentResult> {
  if (method.mode !== "auto") {
    return { ok: false, message: "Method is in manual mode" };
  }
  const provider = method.provider ?? "custom";
  if (provider === "surjo") return verifySurjoPayment(input);
  if (provider === "bkash") return verifyBkashPayment(input);
  return { ok: false, message: `Auto verify not implemented for ${provider}` };
}

export function getMethodById(id: string): PaymentMethod | undefined {
  return listPaymentMethods(true).methods.find((m) => m.id === id);
}
