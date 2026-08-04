import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders })

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY secret is not set")

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    const { data: visuals, error: fetchError } = await supabase
      .from("visuals")
      .select("id, title, description, vibe, tags, category")
    if (fetchError) throw fetchError

    if (!visuals || !visuals.length) {
      return new Response(JSON.stringify({ categories: [], assignments: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const visualList = visuals.map((v: { id: string; title: string; description: string; vibe: string[]; tags: string[] }, i: number) =>
      `${i + 1}. ID: ${v.id}\n   Title: ${v.title || "Untitled"}\n   Description: ${v.description || ""}\n   Vibe: ${(v.vibe || []).join(", ")}\n   Tags: ${(v.tags || []).join(", ")}`
    ).join("\n\n")

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 16000,
        messages: [{
          role: "user",
          content: `You are organising a designer's visual moodboard. Look at all these saved images and group them into meaningful categories based on VISUAL THEME, SUBJECT MATTER, or VIBE — never by file type, image format, or source.

Critical rule: Do NOT create categories based on file type, image format, or platform. "PNG Images," "Screenshots," "Photos," "Uploads," "JPEGs," "Instagram Saves" are NEVER valid categories — a file's format or origin is irrelevant to what it depicts. Two screenshots of completely unrelated things do NOT belong together just because they're both screenshots. A photograph and an illustration DO belong together if they share the same visual theme, subject, or vibe.

Other rules:
- Create at least 3 categories, but as many as are genuinely needed to meaningfully represent the distinct visual themes in this collection — do not force unrelated images together just to keep the category count low, and do not split closely related images into separate categories just to increase the count
- Category names should be specific and descriptive, based on visual theme, subject matter, or mood. Good examples: "Editorial Layout", "Color Palette Reference", "Motion & Animation", "Brutalist Typography", "Warm Minimalist Interiors", "Dark Mode UI Patterns"
- Bad examples (never use patterns like these): "PNG Images", "Screenshots", "Uploaded Photos", "JPEGs", "Instagram Saves", "Website Captures"
- Every image must be assigned to exactly one category
- Base categories on what's actually in the collection, not on a predefined list
- Use the vibe and tags fields as strong signals for thematic grouping, not just the title
- If there are clear sub-themes, name them specifically rather than using a broad catch-all

Here are all the images:

${visualList}

Return ONLY valid JSON, no markdown, no code fences:
{"categories":["Category Name 1","Category Name 2"],"assignments":[{"id":"the-uuid","category":"Category Name"}]}`,
        }],
      }),
    })

    const data = await res.json()
    const raw = data.content[0].text
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim()
    const result = JSON.parse(cleaned)

    const assignments: { id: string; category: string }[] = result.assignments || []
    await Promise.all(
      assignments.map((a) =>
        supabase.from("visuals").update({ category: a.category }).eq("id", a.id)
      )
    )

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown error"
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
