import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings"
const VOYAGE_MODEL = "voyage-4-lite"
const STORAGE_BUCKET = "visual-board"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const EXT_TO_MEDIA_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
}

function parseBase64Image(image: string, filename: string): { mediaType: string; base64Data: string } {
  const dataUrlMatch = image.match(/^data:([^;]+);base64,(.*)$/s)
  if (dataUrlMatch) return { mediaType: dataUrlMatch[1], base64Data: dataUrlMatch[2] }

  const ext = filename.split(".").pop()?.toLowerCase() || ""
  return { mediaType: EXT_TO_MEDIA_TYPE[ext] || "image/png", base64Data: image }
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function characterizePrompt(filename: string): string {
  return `You are helping a designer organise a visual moodboard. Look closely at this image and describe what is actually depicted — do not use the filename as a source of truth for the title or content, it is often meaningless.

Filename (context only, do not rely on it): ${filename}

Return ONLY valid JSON with no markdown formatting, no code fences, no backticks — just the raw JSON object.

Return exactly:
{"title":"a short, descriptive title for what the image actually shows, not the filename","description":"2-3 sentences describing what you see: subject, composition, colors, style","vibe":["3","to","6","mood","or","aesthetic","words","like","minimal","dark","editorial","brutalist","warm","nostalgic","futuristic"],"tags":["5","to","10","searchable","keyword","tags","describing","subject","style","and","content"]}`
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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { image, filename } = await req.json()

    if (!image || !filename) {
      return new Response(JSON.stringify({ error: "image and filename are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY secret is not set")

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    const { mediaType, base64Data } = parseBase64Image(image, filename)
    const bytes = base64ToBytes(base64Data)

    const safeName = filename.replace(/[^a-zA-Z0-9.\-_]/g, "_")
    const storagePath = `${crypto.randomUUID()}-${safeName}`

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, bytes, { contentType: mediaType, upsert: false })
    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)

    const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath)
    const publicUrl = publicUrlData.publicUrl

    const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 700,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
            { type: "text", text: characterizePrompt(filename) },
          ],
        }],
      }),
    })

    const aiData = await aiResponse.json()
    console.log("Anthropic response:", JSON.stringify(aiData).slice(0, 500))

    let ai = { title: "", description: "", vibe: [] as string[], tags: [] as string[] }
    try {
      const raw = aiData.content[0].text
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error("No JSON object found")
      ai = JSON.parse(jsonMatch[0])
    } catch (parseErr) {
      console.error("JSON parse failed:", parseErr)
      ai.description = aiData.content?.[0]?.text || "Could not characterise"
    }

    const embeddingText = [ai.description, Array.isArray(ai.tags) ? ai.tags.join(", ") : ""]
      .filter(Boolean)
      .join(" | ")
    const embedding = await generateEmbedding(embeddingText)

    const { data: visual, error: insertError } = await supabase
      .from("visuals")
      .insert({
        storage_path: storagePath,
        public_url: publicUrl,
        title: ai.title || filename,
        description: ai.description || "",
        vibe: ai.vibe || [],
        tags: ai.tags || [],
        embedding,
      })
      .select()
      .single()
    if (insertError) throw new Error(`DB insert failed: ${insertError.message}`)

    return new Response(JSON.stringify({ visual }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("Top level error:", message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
