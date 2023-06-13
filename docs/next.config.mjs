import nextra from 'nextra'

const withNextra = nextra({ defaultShowCopyCode: true })
const staticExport = process.env.TARGET === 'static'

export default withNextra({
  agentRules: false,
  basePath: process.env.BASE_PATH || '',
  // The landing page loads the interactive panel from public/demo/ and needs the prefix on the client.
  env: { BASE_PATH: process.env.BASE_PATH || '' },
  trailingSlash: true,
  // Keep explicit slashes on version-like routes such as /changelog/v0.1.0/.
  skipTrailingSlashRedirect: true,
  ...(staticExport && {
    output: 'export',
    distDir: 'dist',
    images: { unoptimized: true },
  }),
})
