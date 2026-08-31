import { createClient } from '@supabase/supabase-js'

export const config = {
  runtime: 'edge',
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const formData = await req.formData()
    const file = formData.get('image') as File | null
    const sharedUrl = (formData.get('url') as string) || ''
    const sharedTitle = (formData.get('title') as string) || ''
    const sharedText = (formData.get('text') as string) || ''

    if (!file) {
      const params = new URLSearchParams()
      if (sharedUrl) params.set('url', sharedUrl)
      const combinedText = [sharedTitle, sharedText].filter(Boolean).join(' ')
      if (combinedText) params.set('text', combinedText)
      return Response.redirect(new URL(`/?${params.toString()}`, req.url), 303)
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const filename = `${Date.now()}-${file.name}`
    const arrayBuffer = await file.arrayBuffer()

    const { error } = await supabase.storage
      .from('share-inbox')
      .upload(filename, arrayBuffer, {
        contentType: file.type || 'image/jpeg',
      })

    if (error) {
      console.error('share-inbox upload failed:', error.message)
      return Response.redirect(new URL('/', req.url), 303)
    }

    return Response.redirect(new URL(`/?pendingImage=${encodeURIComponent(filename)}`, req.url), 303)
  } catch (err) {
    console.error('share-image handler error:', err)
    return Response.redirect(new URL('/', req.url), 303)
  }
}
