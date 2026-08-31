import { createClient } from '@supabase/supabase-js'

export const config = {
  api: { bodyParser: false },
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed')
    return
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
      res.writeHead(303, { Location: `/?${params.toString()}` })
      res.end()
      return
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
      res.writeHead(303, { Location: '/' })
      res.end()
      return
    }

    res.writeHead(303, { Location: `/?pendingImage=${encodeURIComponent(filename)}` })
    res.end()
  } catch (err) {
    console.error('share-image handler error:', err)
    res.writeHead(303, { Location: '/' })
    res.end()
  }
}
