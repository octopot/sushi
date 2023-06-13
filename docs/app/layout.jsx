import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import { Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import 'nextra-theme-docs/style.css'
import './globals.css'
import './brand.css'
import './landing.css'
import { siteUrl } from '../site.mjs'
import { groupReleases } from '../navigation.mjs'

export const metadata = {
  title: { default: 'Susi — The prompt deserves an editor.', template: '%s · Susi' },
  description: 'A local prompt composer for macOS: write or dictate, rewrite a selection with a local model, compare versions, and send the prompt back to your coding agent.',
  metadataBase: new URL(siteUrl),
  icons: { icon: `${process.env.BASE_PATH || ''}/icon.svg` },
}

function withExportLinks(items) {
  return items.map(item => ({
    ...item,
    ...('frontMatter' in item && { href: item.href || `${item.route.replace(/\/$/, '')}/` }),
    ...(item.children && { children: withExportLinks(item.children) }),
  }))
}

export default async function RootLayout({ children }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head color={{ hue: 11, saturation: 82, lightness: { light: 46, dark: 70 } }} backgroundColor={{ light: 'rgb(251, 248, 243)', dark: 'rgb(16, 21, 19)' }} />
      <body>
        <Layout
          navbar={<Navbar logo={<span className="wordmark"><span className="brand-emoji" aria-hidden="true">🍣</span>Susi</span>} projectLink="https://github.com/octopot/susi" />}
          pageMap={withExportLinks(groupReleases(await getPageMap()))}
          docsRepositoryBase="https://github.com/octopot/susi/tree/main/docs"
          footer={<Footer><div className="site-footer"><span><b>Susi</b> <span>Dead simple prompt composer.</span></span><span>MIT © {new Date().getFullYear()} <a href="https://github.com/octolab">OctoLab</a></span></div></Footer>}
          search={null}
          copyPageButton={false}
          feedback={{ content: 'Something unclear?', link: 'https://github.com/octopot/susi/issues/new' }}
          nextThemes={{ defaultTheme: 'system' }}
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
