import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface DigestLink {
  title: string
  summary: string
  vibe: string
  image_url: string
  url: string
}

function escapeHtml(str: string): string {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function renderCard(link: DigestLink): string {
  const vibes = (link.vibe || "").split(",").map(v => v.trim()).filter(Boolean)

  const imageBlock = link.image_url
    ? `<div style="width:100%;height:180px;overflow:hidden;border-bottom:2px solid #0F0D0A;">
         <img src="${escapeHtml(link.image_url)}" alt="" width="560" style="width:100%;height:100%;object-fit:cover;display:block;" />
       </div>`
    : ""

  const summaryBlock = link.summary
    ? `<p style="font-size:13px;color:#6B5B4A;line-height:1.5;margin:0 0 12px;">${escapeHtml(link.summary)}</p>`
    : ""

  const vibesBlock = vibes.length
    ? `<div style="margin:0 0 4px;">${vibes.map(v =>
        `<span style="display:inline-block;font-size:11px;padding:3px 9px;background:#FFE1A1;border:1px solid #0F0D0A;border-radius:3px;margin:0 6px 6px 0;color:#0F0D0A;">${escapeHtml(v)}</span>`
      ).join("")}</div>`
    : ""

  return `
    <div style="background:#FCF9F5;border:2px solid #0F0D0A;border-radius:4px;overflow:hidden;margin-bottom:20px;">
      ${imageBlock}
      <div style="padding:20px;">
        <h2 style="font-family:'Space Grotesk',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;color:#0F0D0A;margin:0 0 8px;">${escapeHtml(link.title || "Untitled")}</h2>
        ${summaryBlock}
        ${vibesBlock}
        <a href="${escapeHtml(link.url)}" style="display:inline-block;margin-top:10px;padding:10px 18px;background:#0F0D0A;color:#FFEADA;text-decoration:none;font-size:13px;font-weight:600;border-radius:3px;">Open link →</a>
      </div>
    </div>`
}

function renderEmail(links: DigestLink[], dateStr: string): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body style="margin:0;padding:0;background:#FFEADA;font-family:'Space Grotesk',Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
      <h1 style="font-family:'DM Serif Display',Georgia,serif;font-size:24px;color:#0F0D0A;margin:0 0 4px;">linkdesk</h1>
      <p style="font-size:13px;color:#6B5B4A;margin:0 0 28px;">Your digest for ${dateStr}</p>
      ${links.map(renderCard).join("")}
      <p style="font-size:11px;color:#6B5B4A;opacity:0.6;text-align:center;margin-top:32px;">Sent from your personal link desk.</p>
    </div>
  </body>
</html>`
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders })

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY secret is not set")

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    const { data: links, error } = await supabase
      .from("links")
      .select("title, summary, vibe, image_url, url")
    if (error) throw error

    const picked = shuffle(links || []).slice(0, 5)
    const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    const html = renderEmail(picked, dateStr)

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // TODO: swap for a verified sender on your own domain (e.g. digest@yourdomain.com) once set up in Resend
        from: "onboarding@resend.dev",
        to: ["aninditaatwork@gmail.com"],
        subject: `Your Linkdesk digest ✦ ${dateStr}`,
        html,
      }),
    })
    if (!emailRes.ok) throw new Error(`Resend error: ${await emailRes.text()}`)

    return new Response(JSON.stringify({ sent: picked.length }), {
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
