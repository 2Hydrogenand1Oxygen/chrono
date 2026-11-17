import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import os from 'node:os'

let lastLogTime = 0

function networkUrlLogger(): Plugin {
  const logUrls = (protocol: string, port: number, mode: 'Dev' | 'Preview') => {
    const now = Date.now()
    if (now - lastLogTime < 1500) return
    lastLogTime = now

    const interfaces = os.networkInterfaces()
    const addresses: { name: string; ip: string; isWifi: boolean; isEthernet: boolean }[] = []

    for (const [name, netList] of Object.entries(interfaces)) {
      if (!netList) continue
      for (const net of netList) {
        const isIPv4 = net.family === 'IPv4' || (net.family as unknown) === 4
        // Exclude loopback and internal addresses
        if (isIPv4 && !net.internal) {
          // Exclude auto-assigned link-local 169.254.x.x addresses
          if (net.address.startsWith('169.254.')) continue

          const isWifi = /wi-?fi|wireless|wlan/i.test(name)
          const isEthernet = /ethernet|eth/i.test(name) && !/virtual|vethernet/i.test(name)
          addresses.push({ name, ip: net.address, isWifi, isEthernet })
        }
      }
    }

    // Sort so Wi-Fi and physical Ethernet interfaces come first
    addresses.sort((a, b) => {
      const scoreA = a.isWifi ? 2 : a.isEthernet ? 1 : 0
      const scoreB = b.isWifi ? 2 : b.isEthernet ? 1 : 0
      return scoreB - scoreA
    })

    console.log('\n\x1b[36m────────────────────────────────────────────────────────────\x1b[0m')
    console.log(`\x1b[1m\x1b[32m🚀 Chrono ${mode} Server Ready — Local Network Access:\x1b[0m`)
    console.log(`   \x1b[90mHost bound to:\x1b[0m 0.0.0.0:${port}`)
    console.log(`   \x1b[90mLocal machine:\x1b[0m ${protocol}://localhost:${port}/`)

    if (addresses.length > 0) {
      console.log(`\n\x1b[1m\x1b[33m📱 Open on other devices on the same Wi-Fi / LAN:\x1b[0m`)
      for (const { name, ip, isWifi } of addresses) {
        const badge = isWifi ? '\x1b[1m\x1b[32m[Wi-Fi Recommended]\x1b[0m' : `\x1b[90m[${name}]\x1b[0m`
        console.log(`   ➜  \x1b[1m\x1b[36m${protocol}://${ip}:${port}/\x1b[0m  ${badge}`)
      }
    } else {
      console.log(`\n   \x1b[33m➜  No external IPv4 interface detected. Verify your Wi-Fi connection.\x1b[0m`)
    }
    console.log('\x1b[36m────────────────────────────────────────────────────────────\x1b[0m\n')
  }

  return {
    name: 'chrono-network-url-logger',
    configureServer(server) {
      server.httpServer?.on('listening', () => {
        const addr = server.httpServer?.address()
        const port = typeof addr === 'object' && addr ? addr.port : 5173
        const protocol = server.config.server.https ? 'https' : 'http'
        setTimeout(() => logUrls(protocol, port, 'Dev'), 100)
      })
    },
    configurePreviewServer(server) {
      server.httpServer?.on('listening', () => {
        const addr = server.httpServer?.address()
        const port = typeof addr === 'object' && addr ? addr.port : 4173
        const protocol = server.config.preview.https ? 'https' : 'http'
        setTimeout(() => logUrls(protocol, port, 'Preview'), 100)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), networkUrlLogger()],
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
})
