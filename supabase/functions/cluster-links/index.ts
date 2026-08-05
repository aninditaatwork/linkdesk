import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })

  try {
    const { links } = await req.json()
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")

   const linkList = links.map((l: { id: string; url: string; title: string; summary: string; vibe: string; tags: string[]; user_note: string }, i: number) =>
      `${i + 1}. ID: ${l.id}\n   Title: ${l.title || l.url}\n   Summary: ${l.summary || ""}\n   Vibe: ${l.vibe || ""}\n   Tags: ${(l.tags || []).join(", ")}\n   Note: ${l.user_note || ""}`
    ).join("\n\n")

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 16000,
        messages: [{
          role: "user",
          content: `You are organising a designer's personal link collection. Look at all these links and group them into meaningful categories based on THEME, SUBJECT MATTER, or VIBE — never by source, platform, or format.

Critical rule: Do NOT create categories based on where a link came from. "Twitter posts," "X threads," "Social Thread," "LinkedIn posts," "YouTube videos" are NEVER valid categories — a link's platform is irrelevant to what it's about. A tweet about typography and an article about typography belong in the same category. A tweet about AI workflows and a tweet about minimalist design philosophy do NOT belong together just because they're both tweets.

Other rules:
- Create at least 3 categories, but as many as are genuinely needed to meaningfully represent the distinct themes in this collection — do not force unrelated links together just to keep the category count low, and do not split closely related links into separate categories just to increase the count
- Category names should be specific and descriptive, based on topic or mood. Good examples: "Typography & Editorial", "AI Design Tools", "Calm Minimalist UI", "Dark Mode & Theming", "Token & Cost Optimization", "Design Philosophy & Critique"
- Bad examples (never use patterns like these): "Design Twitter", "Founder Threads", "Social Thread", "X Posts", "LinkedIn Saves"
- Every link must be assigned to exactly one category
- Base categories on what's actually in the collection, not on a predefined list
- Use the vibe and tags fields as strong signals for thematic grouping, not just the title
- If there are clear sub-themes, name them specifically rather than using a broad catch-all

Here are all the links:

${linkList}

Return ONLY valid JSON, no markdown, no code fences:
{"categories":["Category Name 1","Category Name 2"],"assignments":[{"id":"the-uuid","category":"Category Name"}]}`
        }],
      }),
    })

    const data = await res.json()
    const raw = data.content[0].text
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim()
    const result = JSON.parse(cleaned)

    return new Response(JSON.stringify(result), {
      headers: { ...cors, "Content-Type": "application/json" },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown error"
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    })
  }
})