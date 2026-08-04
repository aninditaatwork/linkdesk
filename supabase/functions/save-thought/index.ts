import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings"
const VOYAGE_MODEL = "voyage-4-lite"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

async function generateEmbedding(text: string): Promise<number[] | null> {
  const voyageKey = Deno.env.get("VOYAGE_API_KEY")
  if (!voyageKey) return null
  try {
    const res = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${voyageKey}` },
      body: JSON.stringify({ model: VOYAGE_MODEL, input: [text], input_type: "document" }),
    })
    if (!res.ok) {
      console.error("Voyage error:", await res.text())
      return null
    }
    const { data } = await res.json()
    return data[0]?.embedding ?? null
  } catch (err) {
    console.error("Voyage embedding error:", err)
    return null
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders })

  try {
    const { content } = await req.json()

    if (!content?.trim()) {
      return new Response(JSON.stringify({ error: "content is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }
    const trimmedContent = content.trim()

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    const embedding = await generateEmbedding(trimmedContent)

    const { data: thought, error } = await supabase
      .from("thoughts")
      .insert({ content: trimmedContent, embedding })
      .select()
      .single()
    if (error) throw error

    return new Response(JSON.stringify({ thought }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (err: unknown) {
    const message = err instanceof Error
      ? err.message
      : (err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : "Unknown error")
    console.error("save-thought error:", JSON.stringify(err))
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
