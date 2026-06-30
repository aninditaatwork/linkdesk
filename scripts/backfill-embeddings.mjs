// Run: node --env-file=.env scripts/backfill-embeddings.mjs
// Requires Node 20.6+ for --env-file support.
// Fills in the `embedding` column for any links that don't have one yet.

import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = "https://sobwdyjbgecipxhvhrtu.supabase.co"
const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings"
const BATCH_SIZE = 10
const DELAY_MS = 21000 // 3 RPM free tier limit — one request every 21s

const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function embedBatch(texts) {
  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({ model: "voyage-4-lite", input: texts, input_type: "document" }),
  })
  if (!res.ok) throw new Error(`Voyage error: ${await res.text()}`)
  const { data } = await res.json()
  return data.map(d => d.embedding)
}

async function main() {
  const { data: links, error } = await supabase
    .from("links")
    .select("id, title, summary, vibe, tags, user_note")
    .is("embedding", null)

  if (error) { console.error("Supabase error:", error.message); process.exit(1) }
  console.log(`${links.length} links need embeddings`)
  if (!links.length) return

  for (let i = 0; i < links.length; i += BATCH_SIZE) {
    const batch = links.slice(i, i + BATCH_SIZE)
    const texts = batch.map(l =>
      [
        l.title,
        l.summary,
        l.vibe,
        Array.isArray(l.tags) ? l.tags.join(", ") : (l.tags ?? ""),
        l.user_note,
      ].filter(Boolean).join(" | ")
    )
    const embeddings = await embedBatch(texts)
    await Promise.all(
      batch.map((link, j) =>
        supabase.from("links").update({ embedding: embeddings[j] }).eq("id", link.id)
      )
    )
    console.log(`  ${Math.min(i + BATCH_SIZE, links.length)} / ${links.length} done`)
    if (i + BATCH_SIZE < links.length) await new Promise(r => setTimeout(r, DELAY_MS))
  }
  console.log("Backfill complete.")
}

main()
