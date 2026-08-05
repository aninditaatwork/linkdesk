import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings"
const VOYAGE_MODEL = "voyage-4-lite"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

type SearchResult = Record<string, unknown> & { id: string; similarity?: number }

function tagResults(results: SearchResult[] | null, type: "link" | "visual" | "thought"): SearchResult[] {
  return (results ?? []).map((r) => ({ ...r, type }))
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { query, match_count = 20, match_threshold = 0.2 } = await req.json()

    if (!query?.trim()) {
      return new Response(JSON.stringify({ error: "query is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }
    const trimmedQuery = query.trim()

    const voyageKey = Deno.env.get("VOYAGE_API_KEY")
    if (!voyageKey) throw new Error("VOYAGE_API_KEY secret is not set")

    // Embed the query once, reused for both tables' vector search
    const embedRes = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${voyageKey}` },
      body: JSON.stringify({ model: VOYAGE_MODEL, input: [trimmedQuery], input_type: "query" }),
    })
    if (!embedRes.ok) throw new Error(`Voyage embedding failed: ${await embedRes.text()}`)
    const { data } = await embedRes.json()
    const queryEmbedding = data[0].embedding

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    const [linksBySimilarity, visualsBySimilarity, thoughtsBySimilarity, linksByKeyword, visualsByKeyword, thoughtsByKeyword] = await Promise.all([
      supabase.rpc("search_links_by_embedding", { query_embedding: queryEmbedding, match_threshold, match_count }),
      supabase.rpc("search_visuals_by_embedding", { query_embedding: queryEmbedding, match_threshold, match_count }),
      supabase.rpc("search_thoughts_by_embedding", { query_embedding: queryEmbedding, match_threshold, match_count }),
      supabase.rpc("search_links_by_keyword", { query: trimmedQuery, match_count }),
      supabase.rpc("search_visuals_by_keyword", { query: trimmedQuery, match_count }),
      supabase.rpc("search_thoughts_by_keyword", { query: trimmedQuery, match_count }),
    ])

    for (const { error } of [linksBySimilarity, visualsBySimilarity, thoughtsBySimilarity, linksByKeyword, visualsByKeyword, thoughtsByKeyword]) {
      if (error) throw error
    }

    // Semantic hits are ranked highest, sorted by similarity across all three tables
    const semanticHits = [
      ...tagResults(linksBySimilarity.data, "link"),
      ...tagResults(visualsBySimilarity.data, "visual"),
      ...tagResults(thoughtsBySimilarity.data, "thought"),
    ].sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))

    const keywordHits = [
      ...tagResults(linksByKeyword.data, "link"),
      ...tagResults(visualsByKeyword.data, "visual"),
      ...tagResults(thoughtsByKeyword.data, "thought"),
    ]

    const seen = new Set(semanticHits.map((r) => r.id))
    const results = [...semanticHits, ...keywordHits.filter((r) => !seen.has(r.id))]

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (err: unknown) {
    const message = err instanceof Error
      ? err.message
      : (err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : "Unknown error")
    console.error("search-all error:", JSON.stringify(err))
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
