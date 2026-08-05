// Run: node --env-file=.env scripts/backfill-slugs.mjs
// Requires Node 20.6+ for --env-file support.
// Regenerates title + slug for any links missing a slug, via the characterize-links edge function.

import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
const EDGE_FN_URL = `${SUPABASE_URL}/functions/v1/characterize-links`
const BATCH_SIZE = 3
const DELAY_MS = 21000 // 3 RPM free tier limit on Voyage — one request every 21s

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function characterizeBatch(links) {
  const res = await fetch(EDGE_FN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ links: links.map(l => ({ url: l.url })) }),
  })
  if (!res.ok) throw new Error(`characterize-links error: ${await res.text()}`)
  const { results } = await res.json()
  return results
}

async function main() {
  const { data: links, error } = await supabase
    .from("links")
    .select("id, url, title, slug")
    .or("slug.is.null,slug.eq.")

  if (error) { console.error("Supabase error:", error.message); process.exit(1) }
  console.log(`${links.length} links need a slug`)
  if (!links.length) return

  let updatedCount = 0

  for (let i = 0; i < links.length; i += BATCH_SIZE) {
    const batch = links.slice(i, i + BATCH_SIZE)
    batch.forEach((link, j) => {
      console.log(`Processing link ${i + j + 1} of ${links.length}: ${link.title || link.url}`)
    })

    const results = await characterizeBatch(batch)

    for (let j = 0; j < batch.length; j++) {
      const link = batch[j]
      const r = results[j]
      if (!r) continue
      const { error: updateError } = await supabase
        .from("links")
        .update({ title: r.title, slug: r.slug })
        .eq("id", link.id)
      if (updateError) {
        console.error(`  Failed to update ${link.id}:`, updateError.message)
        continue
      }
      console.log(`Updated: ${r.title} → ${r.slug}`)
      updatedCount++
    }

    if (i + BATCH_SIZE < links.length) await new Promise(r => setTimeout(r, DELAY_MS))
  }

  console.log(`\nBackfill complete. ${updatedCount} of ${links.length} links updated.`)
}

main()
