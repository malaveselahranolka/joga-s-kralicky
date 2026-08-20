import {createClient} from '@sanity/client'

const projectId = process.env.SANITY_API_PROJECT_ID || process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
const dataset = process.env.SANITY_API_DATASET || process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'
const token = process.env.SANITY_API_READ_TOKEN

const client = createClient({
  projectId,
  dataset,
  token,
  apiVersion: '2026-07-01',
  perspective: 'published',
  useCdn: false,
})

const query = `*[_id == "siteContent"][0]{
  ...,
  shareImage{...,asset->{url}},
  heroImage{...,asset->{url}},
  heroDeck[]{...,asset->{url}},
  reasons[]{...,image{...,asset->{url}}},
  lessons[]{...,image{...,asset->{url}}},
  galleryItems[]{...,image{...,asset->{url}}},
  testimonials[]{...,image{...,asset->{url}}},
  communityFaces[]{...,asset->{url}}
}`

export default async function handler(_request, response) {
  try {
    const content = await client.fetch(query)
    if (!content) return response.status(404).json({error: 'Obsah zatím neexistuje.'})
    response.setHeader('Cache-Control', 'private, no-store, max-age=0')
    return response.status(200).json(content)
  } catch (error) {
    console.error('Sanity content fetch failed', error)
    return response.status(502).json({error: 'Obsah se nepodařilo načíst.'})
  }
}
