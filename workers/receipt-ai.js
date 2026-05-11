const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

const RECEIPT_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "merchant",
    "amount",
    "taxAmount",
    "currency",
    "date",
    "subtotalAmount",
    "merchantAddress",
    "lineItems",
    "category",
    "paidBy",
    "paymentMethod",
    "suggestedTags",
    "confidence",
    "reviewWarnings"
  ],
  properties: {
    merchant: { type: ["string", "null"] },
    amount: { type: ["number", "null"] },
    taxAmount: { type: ["number", "null"] },
    currency: { type: ["string", "null"] },
    date: { type: ["string", "null"] },
    subtotalAmount: { type: ["number", "null"] },
    merchantAddress: { type: ["string", "null"] },
    lineItems: {
      type: ["array", "null"],
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "quantityText", "amount"],
        properties: {
          name: { type: "string" },
          quantityText: { type: ["string", "null"] },
          amount: { type: ["number", "null"] }
        }
      }
    },
    category: {
      type: ["string", "null"],
      enum: [
        "medical",
        "professionalDevelopment",
        "childcare",
        "insurance",
        "utilities",
        "groceries",
        "meals",
        "transport",
        "office",
        "fashionAndApparel",
        "selfCareAndBody",
        "other",
        "custom",
        null
      ]
    },
    paidBy: { type: ["string", "null"] },
    paymentMethod: { type: ["string", "null"] },
    suggestedTags: {
      type: ["array", "null"],
      items: { type: "string" }
    },
    confidence: { type: ["number", "null"] },
    reviewWarnings: {
      type: ["array", "null"],
      items: { type: "string" }
    }
  }
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (new URL(request.url).pathname !== "/receipt-ai") {
      return json({ error: "Not found" }, 404);
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, { Allow: "POST, OPTIONS" });
    }

    if (!env.OPENAI_API_KEY) {
      return json({ error: "AI service is not configured" }, 503);
    }

    const contentLength = Number(request.headers.get("content-length") || "0");
    if (contentLength > 1_000_000) {
      return json({ error: "Request too large" }, 413);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const rawOCRText = safeString(payload.rawOCRText).slice(0, 20_000);
    if (rawOCRText.length < 12) {
      return json({ error: "rawOCRText is required" }, 400);
    }

    const localDraft = sanitizeLocalDraft(payload.localDraft || {});
    const prompt = [
      "Clean up this receipt extraction. Return only fields supported by the schema.",
      "Use null when a field cannot be inferred. Do not invent values.",
      "Prefer the local draft when OCR is ambiguous.",
      "",
      `Locale: ${safeString(payload.locale) || "unknown"}`,
      `Currency hint: ${safeString(payload.currencyHint) || localDraft.currency || "unknown"}`,
      "",
      "Local draft:",
      JSON.stringify(localDraft),
      "",
      "OCR text:",
      rawOCRText
    ].join("\n");

    let openAIResponse;
    try {
      openAIResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: env.RECEIPT_AI_MODEL || "gpt-4.1-nano",
          instructions: [
            "You extract structured receipt data from OCR.",
            "You are conservative: uncertain fields are null, not guessed.",
            "Amounts are decimal numbers in the receipt currency.",
            "Dates must be ISO-8601 date-time strings.",
            "Categories must be one of the schema enum values."
          ].join(" "),
          input: prompt,
          text: {
            format: {
              type: "json_schema",
              name: "receipt_extraction",
              strict: true,
              schema: RECEIPT_RESPONSE_SCHEMA
            }
          }
        })
      });
    } catch {
      return json({ error: "AI provider unavailable" }, 502);
    }

    const data = await openAIResponse.json().catch(() => null);
    if (!openAIResponse.ok) {
      return json({ error: "AI provider error" }, 502);
    }

    const outputText = extractOutputText(data);
    if (!outputText) {
      return json({ error: "AI provider returned no structured output" }, 502);
    }

    let receipt;
    try {
      receipt = JSON.parse(outputText);
    } catch {
      return json({ error: "AI provider returned invalid JSON" }, 502);
    }

    return json(normalizeReceipt(receipt), 200);
  }
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      ...extraHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeLocalDraft(draft) {
  return {
    merchant: safeString(draft.merchant),
    amount: numberOrNull(draft.amount),
    taxAmount: numberOrNull(draft.taxAmount),
    currency: safeString(draft.currency).toUpperCase(),
    date: safeString(draft.date),
    subtotalAmount: numberOrNull(draft.subtotalAmount),
    merchantAddress: safeString(draft.merchantAddress),
    lineItems: Array.isArray(draft.lineItems) ? draft.lineItems.slice(0, 30).map((item) => ({
      name: safeString(item.name),
      quantityText: safeString(item.quantityText),
      amount: numberOrNull(item.amount)
    })) : [],
    category: safeString(draft.category),
    paidBy: safeString(draft.paidBy),
    paymentMethod: safeString(draft.paymentMethod),
    suggestedTags: Array.isArray(draft.suggestedTags) ? draft.suggestedTags.map(safeString).filter(Boolean).slice(0, 12) : [],
    confidence: draft.confidence || {}
  };
}

function normalizeReceipt(receipt) {
  return {
    merchant: nullableString(receipt.merchant),
    amount: numberOrNull(receipt.amount),
    taxAmount: numberOrNull(receipt.taxAmount),
    currency: nullableString(receipt.currency)?.toUpperCase() || null,
    date: nullableString(receipt.date),
    subtotalAmount: numberOrNull(receipt.subtotalAmount),
    merchantAddress: nullableString(receipt.merchantAddress),
    lineItems: Array.isArray(receipt.lineItems) ? receipt.lineItems.slice(0, 50).map((item) => ({
      name: safeString(item.name) || "Item",
      quantityText: nullableString(item.quantityText),
      amount: numberOrNull(item.amount)
    })) : null,
    category: nullableString(receipt.category),
    paidBy: nullableString(receipt.paidBy),
    paymentMethod: nullableString(receipt.paymentMethod),
    suggestedTags: Array.isArray(receipt.suggestedTags) ? receipt.suggestedTags.map(safeString).filter(Boolean).slice(0, 12) : null,
    confidence: normalizedConfidence(receipt.confidence),
    reviewWarnings: Array.isArray(receipt.reviewWarnings) ? receipt.reviewWarnings.map(safeString).filter(Boolean).slice(0, 10) : []
  };
}

function nullableString(value) {
  const string = safeString(value);
  return string.length ? string : null;
}

function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function normalizedConfidence(value) {
  const number = numberOrNull(value);
  if (number === null || number <= 0 || number > 1) {
    return 0.7;
  }
  return number;
}

function extractOutputText(response) {
  if (typeof response?.output_text === "string") {
    return response.output_text;
  }

  for (const item of response?.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") {
        return content.text;
      }
    }
  }

  return "";
}
