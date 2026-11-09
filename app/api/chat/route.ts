// Chat backend using the Gemini API (free tier). Tries several models and reports the real error.
export const maxDuration = 30;

const MODELS = [process.env.GEMINI_MODEL, "gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"].filter(
  (m, i, a): m is string => !!m && a.indexOf(m) === i
);

const SYSTEM =
  "You are the onboard assistant of a small rover robot. Reply in one or two short, friendly sentences. " +
  "If the user gives a driving command (forward, back, left, right, stop), confirm it briefly. " +
  "The driving itself is handled separately, so never claim you cannot move.";

export async function POST(req: Request) {
  try {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return Response.json({ error: "GEMINI_API_KEY is not set on the server." }, { status: 500 });

    const { messages } = await req.json();
    if (!Array.isArray(messages)) return Response.json({ error: "Bad request" }, { status: 400 });

    let clean = messages
      .slice(-12)
      .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string")
      .map((m: any) => ({ role: m.role as string, content: m.content.slice(0, 500) }));
    while (clean.length && clean[0].role !== "user") clean.shift();
    if (!clean.length) return Response.json({ error: "No message" }, { status: 400 });

    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: clean.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: { maxOutputTokens: 512, temperature: 0.8 },
    });

    let lastError = "Unknown error";
    for (const model of MODELS) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": key },
            body,
            signal: AbortSignal.timeout(8000),
          }
        );
        if (res.ok) {
          const data = await res.json();
          const reply = (data?.candidates?.[0]?.content?.parts ?? [])
            .map((p: any) => p?.text ?? "")
            .join("")
            .trim();
          if (reply) return Response.json({ reply });
          lastError = `${model}: empty reply`;
          continue;
        }
        const err = await res.json().catch(() => null);
        lastError = `${model} ${res.status}: ${err?.error?.message ?? "request failed"}`;
        if (res.status === 400 || res.status === 401 || res.status === 403) break; // key/request problem, other models won't help
      } catch {
        lastError = `${model}: timed out`;
      }
    }
    return Response.json({ error: `Assistant error. ${lastError}`.slice(0, 300) }, { status: 502 });
  } catch {
    return Response.json({ error: "Server error while contacting the assistant." }, { status: 500 });
  }
}
