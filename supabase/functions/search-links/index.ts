import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings"
const VOYAGE_MODEL = "voyage-4-lite"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    const voyageKey = Deno.env.get("VOYAGE_API_KEY")
    if (!voyageKey) throw new Error("VOYAGE_API_KEY secret is not set")

    const embedRes = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${voyageKey}` },
      body: JSON.stringify({ model: VOYAGE_MODEL, input: [query.trim()], input_type: "query" }),
    })
    if (!embedRes.ok) throw new Error(`Voyage embedding failed: ${await embedRes.text()}`)
    const { data } = await embedRes.json()
    const queryEmbedding = data[0].embedding

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    const { data: results, error } = await supabase.rpc("search_links_by_embedding", {
      query_embedding: queryEmbedding,
      match_threshold,
      match_count,
    })

    if (error) throw error

    return new Response(JSON.stringify({ results: results ?? [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
