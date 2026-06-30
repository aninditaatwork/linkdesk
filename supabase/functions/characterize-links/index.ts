import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function isBlockedPage(html: string): boolean {
  const lower = html.toLowerCase()
  return (
    lower.includes("just a moment") ||
    lower.includes("checking your browser") ||
    lower.includes("enable javascript and cookies") ||
    lower.includes("cf-browser-verification") ||
    lower.includes("ddos-guard") ||
    (lower.includes("cloudflare") && lower.includes("security check"))
  )
}

function extractOG(html: string) {
  const g = (p: string) =>
    html.match(new RegExp(`<meta[^>]*property=["']og:${p}["'][^>]*content=["']([^"']*)["']`))?.[1] ||
    html.match(new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:${p}["']`))?.[1] || ""
  return {
    title: g("title") || html.match(/<title[^>]*>([^<]*)<\/title>/)?.[1] || "",
    description: g("description") ||
      html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/)?.[1] || "",
    image: g("image"),
  }
}

function isTwitter(url: string) {
  return url.includes("x.com") || url.includes("twitter.com")
}

function detectPlatform(url: string) {
  const u = url.toLowerCase()
  if (u.includes("x.com") || u.includes("twitter.com")) return "twitter"
  if (u.includes("linkedin.com")) return "linkedin"
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube"
  if (u.includes("instagram.com")) return "instagram"
  if (u.includes("github.com")) return "github"
  if (u.includes("dribbble.com")) return "dribbble"
  if (u.includes("behance.net")) return "behance"
  if (u.includes("figma.com")) return "figma"
  if (u.includes("tiktok.com")) return "tiktok"
  return "website"
}

const CATEGORY_PROMPT = `
Pick exactly one category. Use the user's note as your highest-priority signal — they know why they saved it. Then use the page title, then description, then the URL.

Categories and rules:

- "Tools & Products": Any app, SaaS, product, startup, or platform the user can sign up for, use, or try. Examples: Figma, Notion, a new AI writing tool, a startup homepage, a product launch page, a directory of tools, an event or community platform like a startup arena or design meetup. If the page is primarily a product or service — even if it also has a blog — pick this.

- "Design Inspo": Visual or aesthetic reference material saved for inspiration. Examples: a dribbble shot, a beautifully designed landing page saved for its visuals, a mood board, a typography showcase, a UI screenshot collection, a design award site. Only pick this if the primary value is visual inspiration, not the tool itself.

- "Portfolio": A specific person's showcase of their own work. Examples: a designer's personal site, a photographer's portfolio, a developer's project page. Must be one individual's work — not a gallery or collection of many people's work.

- "Article & Blog": Written content meant to be read. Examples: a blog post, an essay, a newsletter issue, a tutorial, a how-to guide, a case study, an opinion piece. If it's primarily text you read, pick this.

- "Social Thread": A social media post, thread, or discussion where the content lives in the post itself — opinions, takes, resource lists, conversations. BUT if the post is mainly sharing or discussing a specific tool or product, pick "Tools & Products" instead. If it's sharing a video, pick "Video".

- "Video": Any video content. Examples: a YouTube video, a Loom recording, a talk, a tutorial in video form.

- "Reference": Resources you return to repeatedly. Examples: documentation, a design system spec, a colour palette library, an icon set, a cheatsheet, a glossary, a curated resource list.

- "Other": Only if you genuinely cannot determine the category from any available signal. Do not guess — if unsure, pick this.
`

async function generateEmbeddings(texts: string[]): Promise<(number[] | null)[]> {
  const voyageKey = Deno.env.get("VOYAGE_API_KEY")
  if (!voyageKey) return texts.map(() => null)
  try {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${voyageKey}` },
      body: JSON.stringify({ model: "voyage-4-lite", input: texts, input_type: "document" }),
    })
    if (!res.ok) { console.error("Voyage error:", await res.text()); return texts.map(() => null) }
    const { data } = await res.json()
    return data.map((d: { embedding: number[] }) => d.embedding)
  } catch (err) {
    console.error("Voyage embedding error:", err)
    return texts.map(() => null)
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })

  try {
    const { links } = await req.json()
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")

    console.log("Function called with", links.length, "links")
    console.log("API key present:", !!ANTHROPIC_API_KEY)

    const pending: { result: Record<string, unknown>; embeddingText: string }[] = []

    for (const link of links) {
      const platform = detectPlatform(link.url)
      let og = { title: "", description: "", image: "" }
      let blocked = false

      const skipFetch = ["linkedin", "instagram", "tiktok"].includes(platform)

      if (!skipFetch) {
        try {
          if (isTwitter(link.url)) {
            const tweetUrl = encodeURIComponent(link.url)
            const res = await fetch(
              `https://publish.twitter.com/oembed?url=${tweetUrl}`,
              { signal: AbortSignal.timeout(4000) }
            )
            if (res.ok) {
              const oembed = await res.json()
              og.title = oembed.author_name ? `${oembed.author_name} on X` : ""
              og.description = oembed.html?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || ""
              console.log("Twitter oEmbed success:", og.title, og.description.slice(0, 100))
            } else {
              console.log("Twitter oEmbed failed, status:", res.status)
            }
          } else {
            const res = await fetch(link.url, {
              headers: { "User-Agent": "Mozilla/5.0 (compatible; Twitterbot/1.0)" },
              signal: AbortSignal.timeout(4000),
            })
            const html = await res.text()
            if (isBlockedPage(html)) {
              blocked = true
              console.log("Blocked page detected for:", link.url)
            } else {
              og = extractOG(html)
              console.log("OG fetched for", link.url, "- title:", og.title)
            }
          }
        } catch (fetchErr) {
          console.error("Fetch failed for", link.url, fetchErr)
        }
      } else {
        console.log("Skipping fetch for social platform:", platform, link.url)
      }

      const ctxLines = [
        link.note && `User note (highest priority signal): ${link.note}`,
        og.title && `Title: ${og.title}`,
        og.description && `Tweet/page content: ${og.description}`,
        blocked && `Note: Page was blocked by bot protection. Use only the URL and domain to infer meaning.`,
        skipFetch && `Note: This is a ${platform} post. No preview available — infer from URL and user note only.`,
        `Platform: ${platform}`,
        `URL: ${link.url}`,
      ].filter(Boolean).join("\n")

      const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 500,
          messages: [{
            role: "user",
            content: `You are helping a designer organise their saved links. Return ONLY valid JSON with no markdown formatting, no code fences, no backticks — just the raw JSON object.\n\n${ctxLines}\n\n${CATEGORY_PROMPT}\n\nReturn exactly:\n{"summary":"2-3 sentences describing what this is and why a designer might save it","category":"one category from the list","vibe":"3-5 comma-separated mood or aesthetic words like: minimal, dark, editorial, brutalist, typographic, experimental, playful, clean, technical, bold","tags":["5","to","8","searchable","keyword","tags"]}`,
          }],
        }),
      })

      const aiData = await aiResponse.json()
      console.log("Anthropic response:", JSON.stringify(aiData).slice(0, 500))

      let ai = { summary: "", category: "Other", vibe: "", tags: [] as string[] }
      try {
        const raw = aiData.content[0].text
        const jsonMatch = raw.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error("No JSON object found")
        ai = JSON.parse(jsonMatch[0])
        console.log("Parsed successfully:", JSON.stringify(ai).slice(0, 200))
      } catch (parseErr) {
        console.error("JSON parse failed:", parseErr)
        ai.summary = aiData.content?.[0]?.text || "Could not characterise"
      }

      const embeddingText = [
        og.title,
        ai.summary,
        ai.vibe,
        Array.isArray(ai.tags) ? ai.tags.join(", ") : "",
        link.note,
      ].filter(Boolean).join(" | ")

      pending.push({
        result: {
          url: link.url,
          user_note: link.note || "",
          title: og.title,
          description: og.description,
          image_url: og.image,
          platform,
          summary: ai.summary,
          category: ai.category || "Other",
          vibe: ai.vibe,
          tags: ai.tags || [],
        },
        embeddingText,
      })
    }

    // One Voyage API call for the entire batch
    const embeddings = await generateEmbeddings(pending.map(p => p.embeddingText))
    const results = pending.map((p, i) => ({ ...p.result, embedding: embeddings[i] }))

    return new Response(JSON.stringify({ results }), {
      headers: { ...cors, "Content-Type": "application/json" },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown error"
    console.error("Top level error:", msg)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    })
  }
})
