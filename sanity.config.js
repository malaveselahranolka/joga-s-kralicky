import {createElement} from 'react'
import {defineConfig} from 'sanity'
import {presentationTool} from 'sanity/presentation'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import {schemaTypes} from './sanity/schemaTypes.js'

const projectId = process.env.SANITY_STUDIO_PROJECT_ID || process.env.SANITY_API_PROJECT_ID
const dataset = process.env.SANITY_STUDIO_DATASET || process.env.SANITY_API_DATASET || 'production'
const previewOrigin = process.env.SANITY_STUDIO_PREVIEW_URL || 'https://www.jogaskralicky.cz'

function StudioLogo() {
  return createElement(
    'div',
    {style: {display: 'flex', alignItems: 'center', gap: 9, fontWeight: 700}},
    createElement('span', {style: {fontSize: 22}}, '🐰'),
    createElement('span', null, 'Jóga s králíčky'),
  )
}

export default defineConfig({
  name: 'default',
  title: 'Správa obsahu · Jóga s králíčky',
  projectId,
  dataset,
  icon: () => createElement('span', null, '🐰'),
  studio: {components: {logo: StudioLogo}},
  plugins: [
    structureTool({
      structure: (S) =>
        S.list()
          .title('Obsah webu')
          .items([
            S.listItem()
              .title('Jóga s králíčky')
              .icon(() => createElement('span', null, '🐰'))
              .child(S.document().schemaType('siteContent').documentId('siteContent')),
          ]),
    }),
    presentationTool({
      previewUrl: {origin: previewOrigin},
    }),
    visionTool(),
  ],
  schema: {types: schemaTypes},
  document: {
    actions: (previous, context) =>
      context.schemaType === 'siteContent'
        ? previous.filter(({action}) => !['delete', 'duplicate'].includes(action))
        : previous,
  },
})
