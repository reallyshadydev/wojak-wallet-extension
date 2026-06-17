/**
 * Bridge QR parser — TypeScript port of Android QrPaymentData.kt.
 *
 * Supported formats:
 * 1. JSON: {"address":"...","amount":"...","opreturn":"...","opreturn_hex":"..."}
 * 2. URI: wojakcoin:ADDRESS?amount=X&opreturn=...&opreturn_hex=...
 *         (also accepts any other scheme, e.g. junkcoin: from the bridge frontend)
 * 3. Plain address (fallback)
 *
 * When opreturn_hex is present, the value must be hex-decoded to raw bytes in the tx.
 */

export interface BridgeQrData {
  address: string;
  amount?: string;
  opReturnMemo?: string;
  /** True when the memo came from opreturn_hex — encode as Buffer.from(x,"hex"). */
  opReturnIsHex?: boolean;
  label?: string;
}

export function parseBridgeQr(qrContent: string): BridgeQrData | null {
  const trimmed = qrContent.trim();
  if (!trimmed) return null;

  // ── JSON format ─────────────────────────────────────────────────────────────
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const json = JSON.parse(trimmed) as Record<string, string>;
      const addr = (json.address ?? "").trim();
      if (addr) {
        const hexMemo = json.opreturn_hex ?? undefined;
        const textMemo =
          json.opreturn ?? json.op_return ?? json.memo ?? json.message ?? undefined;
        return {
          address: addr,
          amount: json.amount ?? undefined,
          opReturnMemo: hexMemo ?? textMemo,
          opReturnIsHex: hexMemo !== undefined,
          label: json.label ?? undefined,
        };
      }
    } catch {
      // not valid JSON
    }
  }

  // ── URI scheme ──────────────────────────────────────────────────────────────
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/.exec(trimmed);
  if (schemeMatch) {
    const rest = schemeMatch[2].startsWith("//")
      ? schemeMatch[2].slice(2)
      : schemeMatch[2];
    const qIdx = rest.indexOf("?");
    const addrPart = qIdx >= 0 ? rest.slice(0, qIdx) : rest;
    const queryStr = qIdx >= 0 ? rest.slice(qIdx + 1) : "";
    const addr = addrPart.trim();
    if (!addr) return null;

    const params = parseQuery(queryStr);
    const hexMemo = params["opreturn_hex"] ?? undefined;
    const textMemo =
      params["opreturn"] ??
      params["op_return"] ??
      params["memo"] ??
      params["message"] ??
      undefined;

    return {
      address: addr,
      amount: params["amount"],
      opReturnMemo: hexMemo ?? textMemo,
      opReturnIsHex: hexMemo !== undefined,
      label: params["label"],
    };
  }

  // ── Plain address ────────────────────────────────────────────────────────────
  return { address: trimmed };
}

function parseQuery(qs: string): Record<string, string> {
  if (!qs) return {};
  const result: Record<string, string> = {};
  for (const pair of qs.split("&")) {
    const idx = pair.indexOf("=");
    if (idx > 0) {
      const key = pair.slice(0, idx).toLowerCase();
      try {
        result[key] = decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, " "));
      } catch {
        result[key] = pair.slice(idx + 1);
      }
    }
  }
  return result;
}
