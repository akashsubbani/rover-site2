import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM =
  "You are the onboard assistant of a small rover robot. Reply in one or two short, friendly sentences. " +
  "If the user gives a driving command (forward, back, left, right, stop), confirm it briefly. " +
  "The driving itself is handled separately, so never claim you cannot move.";

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();
    if (!Array.isArray(messages)) return Response.json({ error: "Bad request" }, { status: 400 });

    // Sanitize: last 12 turns, capped length, must start with a user turn
    let clean = messages
      .slice(-12)
      .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string")
      .map((m: any) => ({ role: m.role, content: m.content.slice(0, 500) }));
    while (clean.length && clean[0].role !== "user") clean.shift();
    if (!clean.length) return Response.json({ error: "No message" }, { status: 400 });

    const res = await client.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 200,
      system: SYSTEM,
      messages: clean,
    });

    const reply = res.content.map((b: any) => (b.type === "text" ? b.text : "")).join("").trim();
    return Response.json({ reply });
  } catch {
    return Response.json({ error: "The assistant is unavailable right now." }, { status: 500 });
  }
}
