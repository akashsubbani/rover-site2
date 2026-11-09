// Chat backend using the Gemini API (free tier). Plain fetch, no SDK needed.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

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

    // Sanitize: last 12 turns, capped length, must start with a user turn
    let clean = messages
      .slice(-12)
      .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string")
      .map((m: any) => ({ role: m.role as string, content: m.content.slice(0, 500) }));
    while (clean.length && clean[0].role !== "user") clean.shift();
    if (!clean.length) return Response.json({ error: "No message" }, { status: 400 });

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: clean.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
          generationConfig: { maxOutputTokens: 512, temperature: 0.8 },
        }),
      }
    );

    if (!res.ok) {
      const code = res.status === 429 ? "Too many requests, try again in a minute." : "The assistant is unavailable right now.";
      return Response.json({ error: code }, { status: 502 });
    }

    const data = await res.json();
    const reply = (data?.candidates?.[0]?.content?.parts ?? [])
      .map((p: any) => p?.text ?? "")
      .join("")
      .trim();
    return Response.json({ reply: reply || "Sorry, I didn't catch that." });
  } catch {
    return Response.json({ error: "The assistant is unavailable right now." }, { status: 500 });
  }
}
