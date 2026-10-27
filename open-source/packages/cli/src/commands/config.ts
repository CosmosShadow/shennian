// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/config.test.ts
import type { Command } from 'commander'
import chalk from 'chalk'
import { loadConfig, saveConfig, getConfigPath } from '../config/index.js'
import { collectKnownLogSecrets, sanitizeCliLogValue } from '../log-redaction.js'
import { SERVERS, regionToUrl, urlToRegion, type Region } from '../region.js'
import { assertSingleServerBinding } from '../config/server-binding.js'
export function registerConfigCommand(program: Command) {
  // config: view and modify settings
  const configCmd = program.command('config').description('View or modify configuration')

  configCmd
    .command('show', { isDefault: true })
    .description('Show current configuration')
    .action(() => {
      console.log(`Config file: ${getConfigPath()}`)
      const config = loadConfig()
      const display = sanitizeCliLogValue(config, collectKnownLogSecrets(process.env, config))
      if (config.serverUrl) {
        const region = urlToRegion(config.serverUrl)
        console.log(`Region: ${region} (${SERVERS[region].label})`)
      }
      console.log(JSON.stringify(display, null, 2))
    })

  configCmd
    .command('set')
    .description('Update a config value')
    .argument('<key>', 'Config key (e.g. "server")')
    .argument('<value>', 'Config value (e.g. "cn" or "global")')
    .action((key: string, value: string) => {
      const config = loadConfig()

      if (key === 'server') {
        if (value !== 'cn' && value !== 'global') {
          console.error(chalk.red('✗ Value must be "cn" or "global"'))
          process.exit(1)
        }
        const region = value as Region
        config.serverUrl = assertSingleServerBinding(regionToUrl(region), config)
        saveConfig(config)
        console.log(chalk.green(`✓ Server set to ${SERVERS[region].label}`))
        console.log(
          chalk.yellow(
            '  Restart the background service for this to take effect: shennian stop && shennian start',
          ),
        )
        return
      }

      console.error(chalk.red(`✗ Unknown config key: ${key}. Supported: server`))
      process.exit(1)
    })
}
