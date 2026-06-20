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

/** Stub — wire Surjo Pay API when credentials are set. */
export async function verifySurjoPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
  const apiKey = process.env.SURJO_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, message: "Surjo API not configured — use manual approval" };
  }
  // Placeholder: real integration would POST to Surjo verify endpoint
  const ref = input.reference.trim();
  if (ref.length < 6) {
    return { ok: false, message: "Invalid transaction reference" };
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
  if (provider === "bkash") {
    const apiKey = process.env.BKASH_API_KEY?.trim();
    if (!apiKey) return { ok: false, message: "bKash API not configured" };
    const { code } = grantAccess(input.contentId, {
      methodId: input.methodId,
      reference: input.reference.trim(),
    });
    return { ok: true, autoGranted: true, code };
  }
  return { ok: false, message: `Auto verify not implemented for ${provider}` };
}

export function getMethodById(id: string): PaymentMethod | undefined {
  return listPaymentMethods(true).methods.find((m) => m.id === id);
}
