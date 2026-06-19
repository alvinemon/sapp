import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { canEditLibrary } from "./familyLibrary.js";

export interface PaymentMethod {
  id: string;
  name: string;
  account: string;
  instructions: string;
  enabled: boolean;
}

interface MethodsFile {
  methods: PaymentMethod[];
}

function methodsPath(): string {
  const cwd = join(process.cwd(), "data", "payment-methods.json");
  if (existsSync(cwd)) return cwd;
  return join(dirname(fileURLToPath(import.meta.url)), "..", "data", "payment-methods.json");
}

function readMethods(): MethodsFile {
  return JSON.parse(readFileSync(methodsPath(), "utf8")) as MethodsFile;
}

function writeMethods(data: MethodsFile) {
  writeFileSync(methodsPath(), JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function listPaymentMethods(includeDisabled = false) {
  const methods = readMethods().methods.filter((m) => includeDisabled || m.enabled);
  return { methods };
}

export function addPaymentMethod(input: {
  name: string;
  account: string;
  instructions: string;
}): PaymentMethod {
  const file = readMethods();
  const id = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24) || randomBytes(4).toString("hex");
  const method: PaymentMethod = {
    id,
    name: input.name.trim(),
    account: input.account.trim(),
    instructions: input.instructions.trim(),
    enabled: true,
  };
  file.methods.push(method);
  writeMethods(file);
  return method;
}

export function updatePaymentMethod(
  id: string,
  patch: Partial<Pick<PaymentMethod, "name" | "account" | "instructions" | "enabled">>,
): PaymentMethod | null {
  const file = readMethods();
  const idx = file.methods.findIndex((m) => m.id === id);
  if (idx < 0) return null;
  file.methods[idx] = { ...file.methods[idx], ...patch };
  writeMethods(file);
  return file.methods[idx];
}

export function removePaymentMethod(id: string): boolean {
  const file = readMethods();
  const before = file.methods.length;
  file.methods = file.methods.filter((m) => m.id !== id);
  if (file.methods.length === before) return false;
  writeMethods(file);
  return true;
}

export function assertAdmin(editKey: string | undefined) {
  if (!canEditLibrary(editKey)) throw new Error("Invalid edit key");
}
