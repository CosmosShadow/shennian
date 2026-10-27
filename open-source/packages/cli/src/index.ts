import { registerEnglishCommand } from './commands/english.js'
// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/agents-e2e.ts
// @test src/__tests__/daemon-autostart.test.ts

import { registerConfigCommand } from './commands/config.js'
import { registerLocalAppsCommand } from './commands/local-apps.js'
import { registerReminderCommand } from './commands/reminder.js'
import { personalScheduleHandlers } from './schedules/personal-handlers.js'
import { registerScheduleCommand } from './commands/schedule.js'
import { executeServerSchedule, deliverServerSchedule } from './schedules/server-client.js'
import { Command } from 'commander'
import chalk from 'chalk'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { loadConfig, getShennianDir, resolveShennianPath, normalizeAutoUpgradePolicy } from './config/index.js'
import { CliRelayClient, type CliRelayDisconnectInfo } from './relay/client.js'
import {
  collectKnownLogSecrets,
  installCliLogRedaction,
} from './log-redaction.js'
import { registerPairCommand, runSmartStart } from './commands/pair.js'
import { registerLogoutCommand } from './commands/logout.js'
import {
  clearDaemonPidIfOwner,
  createDaemonInstanceId,
  clearDaemonLauncher,
  findRunningDaemonProcessIds,
  isRemoteAccessDisabled,
  prepareRemoteAccessPause,
  stopPreparedRemoteAccessService,
  isIsolatedDaemonE2eInstance,
  getDaemonStatus,
  registerDaemonCommand,
  writeDaemonPid,
  writeDaemonLauncher,
} from './commands/daemon.js'
import { registerRuntimeCommand } from './commands/runtime.js'
import { registerAdapterCommand } from './commands/adapter.js'
import { registerAgentCommand } from './commands/agent.js'
import { registerManagerCommand } from './commands/manager.js'
import { registerWorkerCommand } from './commands/worker.js'
import { registerProjectCommand } from './commands/project.js'
import { createProjectCoordinationIpcHandlers } from './project-coordination/ipc.js'
import { registerStewardCommand } from './commands/steward.js'
import { registerRecordingCommand } from './commands/recordings.js'
import { handleUpgradeStart, registerUpgradeCommand } from './commands/upgrade.js'
import { registerToolsCommand } from './commands/tools.js'
import { registerQueueCommand } from './commands/queue.js'
import { registerSkillCommand } from './commands/skill.js'
import { refreshExistingSkillForHosts } from './skill/hosts.js'
import { registerSetupCommand } from './commands/setup.js'
import { getUnavailableAcpAgents } from './agents/acp/discovery.js'
import { registerCommandReference } from './commands/command-reference.js'
import { registerIntegrationCommand } from './commands/integration.js'
import { registerRoomCommand } from './commands/room.js'
import { registerContactCommand } from './commands/contact.js'
import { registerSupportCommand } from './commands/support.js'
import { SessionManager } from './session/manager.js'
import { createTrustedProjectFsRequestResolver } from './session/handlers/project-fs.js'
import { SERVERS } from './region.js'
import {
  clearUpgradeAttempt,
  getCurrentVersion,
  handleStartupCrashCheck,
  readUpgradeAttempt,
} from './upgrade/engine.js'
import { AutoUpgradeScheduler } from './upgrade/scheduler.js'
import { ensureUpdaterInstalled } from './upgrade/updater-bootstrap.js'
import { launchUpdater, markUpdaterHealthy } from './upgrade/updater-launcher.js'
import { detectAgents } from './agents/detect.js'
import { PublicAgentDeliveryWorker } from './agents/public-delivery-worker.js'
import { augmentProcessPath } from './env-path.js'
import { acquireDaemonInstanceLock } from './commands/daemon-instance-lock.js'
import { isDaemonProcessRunning } from './commands/daemon-process.js'

augmentProcessPath()
const cliVersion = getCurrentVersion()
import { getCachedAgentInfos, resolveAgentInfos } from './agents/model-registry.js'
import {
  initCliLogReporter,
  reportLog,
  reportUpgradeAggregateMetric,
} from './log-reporter.js'
import { isNativeFusionEnabled } from './native-fusion/config.js'
import { NativeSessionFusionService } from './native-fusion/service.js'
import { startDaemonLogRetention } from './daemon-log.js'
import { startDaemonIpcServer } from './daemon-ipc/server.js'
import { resolveDaemonIpcPaths, resolveManagedRoomIpcPaths } from './daemon-ipc/paths.js'
import { createDaemonControlHandlers } from './daemon-ipc/control.js'
import { createAgentReadinessHandlers } from './daemon-ipc/agent-readiness.js'
import { scanMachineAgents } from './session/handlers/agents.js'
import { validateAgentWorkspaceConfiguration } from './session/handlers/agent-workspace-validation.js'
import { DAEMON_IPC_VERSION } from './daemon-ipc/protocol.js'
import { RoomSessionRegistry } from './room/session-registry.js'
import { HttpRoomBindingClient } from './room/room-binding-client.js'
import { TrustedManagedRoomBinder } from './room/managed-room-binding.js'
import { RoomHostSessionObservationStore } from './room/host-session-observations.js'
import { RoomMirrorSyncService } from './room/mirror-sync-service.js'
import { handleLiveRoomDelivery } from './room/live-delivery.js'
import { NativeSourceDeletionStore } from './native-fusion/native-source-deletions.js'
import { matchesRoomOwner, isCurrentRegistration } from './room/registration-authority.js'
import { RoomActivationService, resolveManagedAgentPolicy } from './room/activation-service.js'
import { prepareStandaloneAgentTurn } from './room/standalone-agent-turn.js'
import { RoomActivationAudit } from './room/activation-audit.js'
import { RoomAttachmentCache } from './room/attachment-cache.js'
import { RoomAttachmentUploader } from './room/attachment-upload.js'
import { ManagedRoomContextAuthority } from './room/managed-context.js'
import { createManagedRoomExecutor } from './room/managed-room-ipc.js'
import { SESSION_SYNC_PROTOCOL_VERSION, SESSION_SYNC_ADVERTISED_CAPABILITIES, type AgentType } from '@shennian/wire'
import { getDaemonInstallationId } from './session/store.js'
import { OWNER_DIRECT_TURN_OPTIONS } from './session/queue-helpers.js'
import { synchronizeMachinePersonalAuthority } from './personal-sync/machine-authority.js'
import { CLI_SESSION_SYNC_DATA_EPOCH, ensurePersonalDataEpoch } from './personal-sync/epoch.js'
import {
  DeletionSyncRetryWaitError,
  DeletionSyncTerminalError,
} from './session/deletion-sync-state.js'

const SHENNIAN_DIR = getShennianDir()
const PID_FILE = resolveShennianPath('daemon.pid')
const INSTANCE_LOCK_FILE = resolveShennianPath('daemon.instance.lock')
function readDaemonPidFile(): number | null {
  try {
    const raw = fs.readFileSync(PID_FILE, 'utf-8').trim()
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw) as { pid?: unknown }
      const pid = Number(parsed.pid)
      return Number.isInteger(pid) && pid > 0 ? pid : null
    }
    const pid = parseInt(raw, 10)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function httpToWs(url: string): string {
  return url.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://')
}

function writeRetiredIntegrationError(): void {
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      error: 'integration_command_retired',
      message: 'Room MCP and Hooks were retired. Use the Shennian Skill and CLI.',
      nextAction: { type: 'open_install_guide', url: 'https://shennian.net/install.md' },
    })}\n`,
  )
  process.exitCode = 1
}

function formatDisconnectInfo(info: CliRelayDisconnectInfo): string {
  const parts = [
    `trigger=${info.trigger ?? 'unknown'}`,
    `phase=${info.phase}`,
    `code=${info.code ?? 'unknown'}`,
    `attempt=${info.reconnectAttempt}`,
  ]
  if (info.reason) parts.push(`reason=${info.reason}`)
  if (info.error) parts.push(`error=${info.error}`)
  return parts.join(' ')
}

import { assertSingleServerBinding } from './config/server-binding.js'

const program = new Command()
program.name('shennian').description('Shennian — AI Agent Control Plane').version(cliVersion)
// Keep options written after a subcommand scoped to that subcommand. In particular,
// `room create --name` must not be consumed by the legacy root machine-name option.
program.enablePositionalOptions()
program.hook('preAction', (_command, actionCommand) => {
  const opts = actionCommand.optsWithGlobals() as { api?: string; server?: string }
  const config = loadConfig()
  for (const candidate of [opts.api, opts.server, process.env.SHENNIAN_DESKTOP_SERVER_URL]) {
    assertSingleServerBinding(candidate, config)
  }
})
registerIntegrationCommand(program)
registerRoomCommand(program)
registerContactCommand(program)
registerSupportCommand(program)
registerScheduleCommand(program)
registerReminderCommand(program)

program
  .option('--api <url>', 'Server URL override')
  .option('--name <name>', 'Machine name', os.hostname())
  .action(async (opts: { api?: string; name: string }) => {
    const config = loadConfig()
    const serverUrl =
      assertSingleServerBinding(opts.api ?? process.env.SHENNIAN_DESKTOP_SERVER_URL ?? config.serverUrl ?? undefined, config)
    await runSmartStart(serverUrl, opts.name)
  })

// run-service: internal command used by the background service process
program
  .command('run-service', { hidden: true })
  .description('(internal) Connect to relay server, called by the background service')
  .option('--api <url>', 'Server URL override')
  .action(async (opts: { api?: string }) => {
    const envFile = resolveShennianPath('env.json')
    try {
      const saved = JSON.parse(fs.readFileSync(envFile, 'utf-8')) as Record<string, string>
      for (const [k, v] of Object.entries(saved)) {
        if (!process.env[k]) process.env[k] = v
      }
      augmentProcessPath()
    } catch {
      // env.json may not exist yet
    }

    installCliLogRedaction(collectKnownLogSecrets(process.env, loadConfig()))

    const logRetentionTimer = startDaemonLogRetention()
    if (isRemoteAccessDisabled()) {
      console.log(`[${new Date().toISOString()}] remote access disabled, service start skipped`)
      clearInterval(logRetentionTimer)
      process.exit(0)
    }

    const daemonInstanceId = createDaemonInstanceId()
    const instanceLock = acquireDaemonInstanceLock({
      lockPath: INSTANCE_LOCK_FILE,
      instanceId: daemonInstanceId,
    })
    if (!instanceLock.acquired) {
      console.log(
        `[${new Date().toISOString()}] daemon already running` +
          (instanceLock.ownerPid ? ` (PID ${instanceLock.ownerPid})` : '') +
          ', skipping duplicate start',
      )
      clearInterval(logRetentionTimer)
      process.exit(0)
    }
    // The lifecycle command may replace an older independently installed
    // daemon before launching run-service. Historical Desktop-managed and
    // unknown sources fail closed before reaching this entry point.
    try {
      const oldPid = readDaemonPidFile()
      if (oldPid && oldPid !== process.pid) {
        if (isDaemonProcessRunning(oldPid)) {
          console.log(
            `[${new Date().toISOString()}] daemon already running (PID ${oldPid}), skipping duplicate start`,
          )
          instanceLock.release()
          process.exit(0)
        }
      }
    } catch {
      /* noop */
    }

    const orphanPids = isIsolatedDaemonE2eInstance(process.env, SHENNIAN_DIR)
      ? []
      : findRunningDaemonProcessIds(process.pid)
    if (orphanPids.length > 0) {
      console.log(
        `[${new Date().toISOString()}] daemon already running (PID ${orphanPids[0]}), skipping duplicate start`,
      )
      instanceLock.release()
      process.exit(0)
    }

    writeDaemonPid(process.pid, daemonInstanceId, { version: cliVersion })
    writeDaemonLauncher(process.pid, undefined, daemonInstanceId)
    process.on('exit', () => {
      clearDaemonPidIfOwner(process.pid, daemonInstanceId)
      clearDaemonLauncher(daemonInstanceId)
    })
    process.on('exit', instanceLock.release)

    let updaterReadiness: ReturnType<typeof ensureUpdaterInstalled> | null = null
    try {
      updaterReadiness = ensureUpdaterInstalled()
    } catch (error) {
      console.error(
        `[upgrade] updater bootstrap unavailable: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    // A crashing replacement must never overwrite its own installed package.
    // Schedule rollback through the stable external worker and let that worker
    // terminate this process only after the durable rollback job exists.
    const rollbackAttempt = await handleStartupCrashCheck()
    if (rollbackAttempt) {
      if (!updaterReadiness) {
        console.error('[upgrade] Crash-loop rollback blocked: updater bootstrap unavailable')
        process.exit(1)
      }
      try {
        launchUpdater({
          fromVersion: cliVersion,
          targetVersion: rollbackAttempt.from,
          oldDaemonPid: process.pid,
          operation: 'rollback',
          rollbackJobId: rollbackAttempt.jobId,
        }, { readiness: updaterReadiness })
        console.error(
          `[upgrade] New version crashed ${rollbackAttempt.attemptCount} times; external rollback scheduled.`,
        )
        process.stdin.resume()
        return
      } catch (error) {
        console.error(
          `[upgrade] Crash-loop rollback could not start: ${error instanceof Error ? error.message : String(error)}`,
        )
        process.exit(1)
      }
    }

    // No personal producer may open its store until the machine generation is
    // fully migrated and its crash-safe marker is committed.
    try {
      ensurePersonalDataEpoch()
    } catch (error) {
      console.error(
        `[personal-sync] data epoch initialization failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      process.exitCode = 1
      return
    }

    const config = loadConfig()
    const serverUrl =
      assertSingleServerBinding(opts.api ?? process.env.SHENNIAN_DESKTOP_SERVER_URL ?? config.serverUrl ?? SERVERS.cn.url, config)!
    const currentCliVersion = getCurrentVersion()
    const detectedAgents = await detectAgents({
      serverUrl,
      authToken: config.machineToken ?? config.accessToken,
    })
    const agentList = detectedAgents.map((a) => a.type)
    let cachedAgentInfos = getCachedAgentInfos(detectedAgents)
    const roomSessionRegistry = new RoomSessionRegistry()
    const roomHostSessionObservations = new RoomHostSessionObservationStore()
    const managedRoomContexts = new ManagedRoomContextAuthority(roomSessionRegistry)
    assertSingleServerBinding(serverUrl, config)
    const roomBindingClient = new HttpRoomBindingClient(serverUrl)
    const roomAttachmentCache = new RoomAttachmentCache({ actionClient: roomBindingClient })
    const roomAttachmentUploader = new RoomAttachmentUploader({ actionClient: roomBindingClient })
    let roomActivationService: RoomActivationService | null = null
    // Assigned after the callbacks that capture it are declared; those callbacks
    // cannot run until the relay/session manager startup below has completed.
    // eslint-disable-next-line prefer-const
    let sessionManager!: SessionManager
    const managedRoomExecutor = createManagedRoomExecutor({
      authority: managedRoomContexts,
      actionClient: roomBindingClient,
      attachmentCache: roomAttachmentCache,
      attachmentUploader: roomAttachmentUploader,
      observations: roomHostSessionObservations,
      getMachineCredentials: () => ({ machineToken: loadConfig().machineToken }),
      managerExecutor: (input) => sessionManager.executeManagedManagerAction(input),
      onSendOutcome: (outcome) => sessionManager.noteManagedRoomSendOutcome(outcome),
      getActiveRunId: (token, bindingSessionId) =>
        sessionManager.getManagedRoomActiveRunId(token, bindingSessionId),
      scheduleExecutor: (sessionId, action, args) => {
        return executeServerSchedule({ serverUrl, machineToken: loadConfig().machineToken!, sessionId, action, args })
      },
      onPaused: ({ registryKey, sessionId }) => {
        const registration = roomSessionRegistry.getByRegistryKey(registryKey)
        const binding = registration?.binding
        if (binding) {
          roomSessionRegistry.setBinding({
            registryKey,
            bindingId: binding.bindingId,
            roomId: binding.roomId,
            agentIdentityId: binding.agentIdentityId,
            agentMembershipId: binding.agentMembershipId,
            status: 'paused',
            activationMode: 'paused',
          })
        }
        managedRoomContexts.revokeSession(registryKey)
        sessionManager?.discardPendingManagedRoomMessages(sessionId)
      },
    })
    let localUpgradeHandler: ((params: import('./daemon-ipc/json.js').JsonValue | undefined) => Promise<import('./daemon-ipc/json.js').JsonValue>) | null = null
    let localExternalUpgradePreparer: ((params: import('./daemon-ipc/json.js').JsonValue | undefined) => import('./daemon-ipc/json.js').JsonValue) | null = null
    let localExternalUpgradeCanceller: (() => import('./daemon-ipc/json.js').JsonValue) | null = null
    let localShutdown: (() => Promise<void>) | null = null
    let localShutdownRequested = false
    const controlIpc = await startDaemonIpcServer({
      paths: resolveDaemonIpcPaths(),
      handlers: { ...createProjectCoordinationIpcHandlers(() => sessionManager), ...createDaemonControlHandlers({
        daemonVersion: currentCliVersion,
        protocolVersion: DAEMON_IPC_VERSION,
        getStatus: () => getDaemonStatus(),
        getAgents: () => detectedAgents,
        requestShutdown: () => {
          if (localShutdown) void localShutdown()
          else localShutdownRequested = true
        },
        completeAgentAuthentication: (agentType) => sessionManager.resumePendingAcpAuthentication(agentType),
        bindManagedRoom: (params) => sessionManager.bindManagedRoomFromLocal(params),
        stewardSay: (params) => sessionManager.stewardSayFromLocal(params),
        startUpgrade: async (params) => {
          if (!localUpgradeHandler) throw new Error('upgrade_unavailable')
          return localUpgradeHandler(params)
        },
        prepareExternalUpgrade: (params) => {
          if (!localExternalUpgradePreparer) throw new Error('external_upgrade_unavailable')
          return localExternalUpgradePreparer(params)
        },
        cancelExternalUpgrade: () => {
          if (!localExternalUpgradeCanceller) throw new Error('external_upgrade_unavailable')
          return localExternalUpgradeCanceller()
        },
      }), ...createAgentReadinessHandlers({
        getStatus: () => getDaemonStatus(),
        getSnapshot: () => getCachedAgentInfos(detectedAgents).map((agent) => {
          const detected = detectedAgents.find((item) => item.type === agent.type)
          return { ...agent, runtimePlatform: detected?.runtimePlatform, runtimeIsWsl: detected?.runtimeIsWsl }
        }),
        getUnavailable: getUnavailableAcpAgents,
        discover: async (requestedType) => {
          if (!sessionManager) throw new Error('daemon_starting')
          const snapshot = await scanMachineAgents(true, requestedType as AgentType | undefined)
          if (requestedType) {
            const retained = detectedAgents.filter((item) => item.type !== requestedType)
            detectedAgents.splice(0, detectedAgents.length, ...retained, ...snapshot.detectedAgents)
          } else {
            detectedAgents.splice(0, detectedAgents.length, ...snapshot.detectedAgents)
          }
          const publishedAgents = getCachedAgentInfos(detectedAgents)
          client.sendEvent({ type: 'event', event: 'machine.agents',
            payload: { agentList: detectedAgents.map((agent) => agent.type), agents: publishedAgents } })
          return snapshot.agents.map((agent) => {
            const detected = snapshot.detectedAgents.find((item) => item.type === agent.type)
            return { ...agent, runtimePlatform: detected?.runtimePlatform, runtimeIsWsl: detected?.runtimeIsWsl }
          })
        },
        validate: async (input) => {
          if (!sessionManager) throw new Error('daemon_starting')
          return validateAgentWorkspaceConfiguration(input, {
            ignoreNativeSession: (agentType, sessionId) => nativeFusion?.ignoreNativeSource(agentType, sessionId),
          })
        },
      }) },
    })
    let managedRoomIpc
    try {
      managedRoomIpc = await startDaemonIpcServer({
        paths: resolveManagedRoomIpcPaths(),
        handlers: {
          'managed-room.execute': (params) => managedRoomExecutor(params),
          ...personalScheduleHandlers(serverUrl, roomSessionRegistry),
        },
      })
    } catch (error) {
      await controlIpc.close()
      throw error
    }
    let stoppingBeforeRelay = false
    const stopBeforeRelay = () => {
      if (stoppingBeforeRelay) return
      stoppingBeforeRelay = true
      void Promise.allSettled([controlIpc.close(), managedRoomIpc.close()]).finally(() =>
        process.exit(0),
      )
    }
    process.once('SIGINT', stopBeforeRelay)
    process.once('SIGTERM', stopBeforeRelay)

    if (!config.machineToken) {
      console.error(
        'Shennian CLI is not paired. Run "shennian pair --browser" or "shennian pair --token" first.',
      )
      await Promise.allSettled([controlIpc.close(), managedRoomIpc.close()])
      process.exitCode = 1
      return
    }
    process.removeListener('SIGINT', stopBeforeRelay)
    process.removeListener('SIGTERM', stopBeforeRelay)

    const wsBase = httpToWs(serverUrl)
    const wsUrl = `${wsBase}/relay/machine`
    const machineToken = config.machineToken
    if (!machineToken) return
    try {
      await synchronizeMachinePersonalAuthority({
        serverUrl,
        machineToken,
        machineId: config.machineId,
      })
    } catch (error) {
      console.error(
        `[personal-sync] machine authority verification failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      await Promise.allSettled([controlIpc.close(), managedRoomIpc.close()])
      // Agent discovery may already have opened watcher/timer handles. A
      // fatal authority failure must really terminate so launchd/systemd/the
      // scheduler can restart or trigger the external crash-loop rollback.
      process.exit(1)
    }

    if (config.machineId) {
      initCliLogReporter(serverUrl, config.machineId)
    }

    console.log(
      `[${new Date().toISOString()}] Connecting to ${wsUrl}... (v${currentCliVersion}) agents: ${agentList.join(',')}`,
    )
    reportLog({
      level: 'info',
      wsEvent: 'daemon.start',
      metadata: { version: currentCliVersion, agents: agentList },
    })

    let nativeFusion: NativeSessionFusionService | null = null
    let roomMirrorSync: RoomMirrorSyncService | null = null
    let deletionCatchupGeneration = 0
    let skillRefreshInFlight = false
    let pendingUpgradeAttempt = readUpgradeAttempt()
    const autoUpgradePolicy = normalizeAutoUpgradePolicy(config.autoUpgrade)
    const publicAgentWorker = config.machineId ? new PublicAgentDeliveryWorker({
      serverUrl, machineId: config.machineId,
      getMachineToken: () => loadConfig().machineToken,
      getDetectedAgents: () => detectAgents({
        serverUrl, authToken: loadConfig().machineToken,
      }),
      onRuntimeChanged: async () => {
        const connectedGeneration = deletionCatchupGeneration
        const snapshot = await scanMachineAgents(true)
        detectedAgents.splice(0, detectedAgents.length, ...snapshot.detectedAgents)
        agentList.splice(0, agentList.length, ...snapshot.agentList)
        cachedAgentInfos = snapshot.agents
        const response = await client.sendReq({ type: 'req', id: randomUUID(),
          method: 'machine.agents.report', params: { agents: snapshot.agents } }, 20_000)
        if (!response.ok) throw new Error('machine_capability_report_rejected')
        if (connectedGeneration === deletionCatchupGeneration
          && client.getState() === 'connected') publicAgentWorker?.start()
      },
      onError: () => console.warn('[public-agent] delivery attempt failed'),
    }) : null

    const client = new CliRelayClient({
      serverUrl: wsUrl,
      machineToken,
      cliVersion: currentCliVersion,
      agentList,
      autoUpgradePolicy,
      sessionSyncProtocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
      sessionSyncCapabilities: SESSION_SYNC_ADVERTISED_CAPABILITIES,
      daemonInstallationId: getDaemonInstallationId(),
      dataEpoch: CLI_SESSION_SYNC_DATA_EPOCH,
      updaterProtocolVersion: 1,
      onConnected: () => {
        console.log(`[${new Date().toISOString()}] ✓ Connected`)
        reportLog({ level: 'info', wsEvent: 'daemon.connected' })
        // Runtime proof must be refreshed on every reconnect, including when
        // no model catalog is cached. The Server cannot keep using an older
        // executable fingerprint after a failed capability update.
        client.sendEvent({
          type: 'event',
          event: 'machine.agents',
          payload: {
            agentList,
            agents: cachedAgentInfos,
          },
        })
        void resolveAgentInfos(detectedAgents, {
          serverUrl: config.serverUrl ?? serverUrl,
          authToken: config.machineToken ?? config.accessToken,
        })
          .then((agents) => {
            if (JSON.stringify(agents) === JSON.stringify(cachedAgentInfos)) return
            client.sendEvent({
              type: 'event',
              event: 'machine.agents',
              payload: {
                agentList,
                agents,
              },
            })
          })
          .catch(() => {})
        if (pendingUpgradeAttempt) {
          client.sendEvent({
            type: 'event',
            event: 'upgrade',
            payload: {
              state: 'recovering',
              machineId: 'self',
              from: pendingUpgradeAttempt.from,
              to: pendingUpgradeAttempt.to,
              ...(pendingUpgradeAttempt.jobId ? { jobId: pendingUpgradeAttempt.jobId } : {}),
              activeRunCount: sessionManager.getPendingRecoveryCount(),
            },
          })
        }
        upgradeScheduler.start()
        roomMirrorSync?.start()
        const catchupGeneration = ++deletionCatchupGeneration
        const catchUpBeforeDiscovery = async (): Promise<void> => {
          try {
            await sessionManager.synchronizeSessionDeletions()
            await sessionManager.recoverInterruptedRuns()
            if (pendingUpgradeAttempt) {
              const completedAttempt = pendingUpgradeAttempt
              pendingUpgradeAttempt = null
              if (completedAttempt.jobId) {
                markUpdaterHealthy(completedAttempt.jobId, completedAttempt.to)
              }
              clearUpgradeAttempt()
              console.log(
                `[${new Date().toISOString()}] [upgrade] ${completedAttempt.operation === 'rollback' ? 'Rolled back' : 'Healthy'}: ${completedAttempt.from} → ${completedAttempt.to}`,
              )
              reportUpgradeAggregateMetric({
                kind: 'upgrade',
                result: completedAttempt.operation === 'rollback' ? 'rolled_back' : 'healthy',
                stage: 'terminal',
              })
              client.sendEvent({
                type: 'event',
                event: 'upgrade',
                payload: {
                  state: completedAttempt.operation === 'rollback' ? 'rolled_back' : 'healthy',
                  machineId: 'self',
                  from: completedAttempt.from,
                  to: completedAttempt.to,
                  ...(completedAttempt.jobId ? { jobId: completedAttempt.jobId } : {}),
                },
              })
              // Legacy Apps understand success and safely ignore healthy.
              if (completedAttempt.operation !== 'rollback') {
                client.sendEvent({
                  type: 'event',
                  event: 'upgrade',
                  payload: {
                    state: 'success',
                    machineId: 'self',
                    from: completedAttempt.from,
                    to: completedAttempt.to,
                  },
                })
              }
            }
            // Run only after recovery is healthy; never make Skill networking a
            // prerequisite for the daemon, and never touch host Plugin copies.
            if (!skillRefreshInFlight) {
              skillRefreshInFlight = true
              void refreshExistingSkillForHosts({ clientVersion: currentCliVersion })
                .then((results) => {
                  const attention = results.filter((entry) => !entry.ok ||
                    !['current', 'registered', 'updated'].includes(entry.result.status))
                  if (attention.length > 0) {
                    console.warn(`[skill] ${attention.length} installed Skill copies need attention; run shennian setup for details`)
                  }
                })
                .catch(() => console.warn('[skill] Official Skill refresh failed; Client remains available'))
                .finally(() => { skillRefreshInFlight = false })
            }
            if (
              catchupGeneration === deletionCatchupGeneration &&
              client.getState() === 'connected'
            ) {
              nativeFusion?.handleConnected()
              publicAgentWorker?.start()
            }
          } catch (error) {
            // Discovery and dirty-index publication deliberately stay stopped:
            // scanning before deletion catch-up can resurrect local history.
            console.error('[session.deletions] startup catch-up failed', error)
            if (
              catchupGeneration === deletionCatchupGeneration &&
              client.getState() === 'connected'
            ) {
              if (error instanceof DeletionSyncTerminalError) return
              const delay =
                error instanceof DeletionSyncRetryWaitError
                  ? Math.max(1_000, error.retryAfterMs)
                  : 5_000
              setTimeout(() => void catchUpBeforeDiscovery(), delay).unref?.()
            }
          }
        }
        void catchUpBeforeDiscovery()
      },
      onDisconnected: (info) => {
        deletionCatchupGeneration += 1
        sessionManager?.revokeProjectFsHandles()
        publicAgentWorker?.stop()
        roomMirrorSync?.stop()
        console.log(
          `[${new Date().toISOString()}] ⚠ Disconnected, reconnecting... ${formatDisconnectInfo(info)}`,
        )
        reportLog({
          level: 'warn',
          wsEvent: 'daemon.disconnected',
          metadata: {
            code: info.code,
            reason: info.reason,
            error: info.error,
            phase: info.phase,
            trigger: info.trigger,
            reconnectAttempt: info.reconnectAttempt,
          },
        })
      },
      onProjectFsCapabilityChanged: (active) => {
        if (!active) sessionManager?.revokeProjectFsHandles()
      },
      onReq: (req) => {
        console.log(`[${new Date().toISOString()}] [req] ${req.method}`)
        reportLog({
          level: 'info',
          type: 'ws',
          wsEvent: req.method,
          wsDirection: 'in',
          traceId: req.traceId,
        })
        if (req.method === 'room.message.deliver') {
          void handleLiveRoomDelivery(client, roomMirrorSync, req)
          return
        }
        void sessionManager.handleReq(req)
      },
    })

    nativeFusion = isNativeFusionEnabled() ? new NativeSessionFusionService(client) : null
    roomMirrorSync = new RoomMirrorSyncService({
      registry: roomSessionRegistry,
      observations: roomHostSessionObservations,
      actionClient: roomBindingClient,
      getMachineCredentials: () => ({ machineToken: loadConfig().machineToken }),
      isSessionDeleted: (sessionId) => new NativeSourceDeletionStore().hasSession(sessionId),
      onMessages: async (roomId, messages, registrations, context) => {
        await roomActivationService?.processMessages(roomId, messages, registrations, context)
      },
      onBindingPaused: (registration) => {
        if (registration.lifecycleState === 'closed') {
          managedRoomContexts.revokeSession(registration.registryKey)
          void sessionManager?.retireManagedRoomSession(registration.nianSessionId).catch(() => {
            console.warn('[room.sync] retired session cleanup failed')
          })
        } else sessionManager?.discardPendingManagedRoomMessages(registration.nianSessionId)
      },
    })
    const upgradeScheduler: AutoUpgradeScheduler = new AutoUpgradeScheduler({
      currentVersion: currentCliVersion,
      machineId: config.machineId ?? 'unknown-machine',
      serverUrl: config.serverUrl ?? serverUrl,
      getIdleState: () => sessionManager.getUpgradeIdleState(),
      sessionSyncProtocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
      dataEpoch: CLI_SESSION_SYNC_DATA_EPOCH,
      advertisedCapabilities: SESSION_SYNC_ADVERTISED_CAPABILITIES,
      updaterProtocolVersion: 1,
      startUpgrade: async (targetVersion, mandatory) => {
        const { handleUpgradeStart } = await import('./commands/upgrade.js')
        await handleUpgradeStart(client, 'auto-upgrade', targetVersion, {
          currentVersion: currentCliVersion,
          prepareForUpgrade: (jobId) => sessionManager.prepareForUpgrade(jobId),
          cancelUpgradePreparation: () => sessionManager.cancelUpgradePreparation(),
          shutdownAfterHandoff: () => {
            setTimeout(() => process.kill(process.pid, 'SIGTERM'), 100).unref?.()
          },
          suppressResponse: true,
          waitForCompletion: true,
          canHandoff: mandatory ? undefined : () => sessionManager.getUpgradeIdleState().idle,
        })
      },
    })
    upgradeScheduler.setPolicy(autoUpgradePolicy)
    sessionManager = new SessionManager(
      client,
      nativeFusion,
      currentCliVersion,
      upgradeScheduler,
      new TrustedManagedRoomBinder({
        registry: roomSessionRegistry,
        observations: roomHostSessionObservations,
        bindingClient: roomBindingClient,
        getMachineCredentials: () => {
          const current = loadConfig()
          return { machineId: current.machineId, machineToken: current.machineToken }
        },
        hostProcessIdentity: () => `daemon:${daemonInstanceId}`,
      }),
      {
        prepare: () => prepareRemoteAccessPause(),
        isDisabled: () => isRemoteAccessDisabled(),
        shutdownAfterResponse: () => {
          setTimeout(() => {
            stopPreparedRemoteAccessService()
            process.kill(process.pid, 'SIGTERM')
          }, 100).unref?.()
        },
      },
      (token) => managedRoomContexts.revokeToken(token),
      managedRoomExecutor,
      null,
      createTrustedProjectFsRequestResolver(machineToken),
      () => getCachedAgentInfos(detectedAgents),
    )
    localUpgradeHandler = async (params) => {
      const object = params && typeof params === 'object' && !Array.isArray(params)
        ? params as Record<string, import('./daemon-ipc/json.js').JsonValue>
        : {}
      const targetVersion = typeof object.targetVersion === 'string' ? object.targetVersion : undefined
      const confirmedMajor = object.confirmedMajor === true
      const result = await handleUpgradeStart(client, `local-upgrade-${Date.now()}`, targetVersion, {
        currentVersion: currentCliVersion,
        confirmedMajor,
        prepareForUpgrade: (jobId) => sessionManager.prepareForUpgrade(jobId),
        cancelUpgradePreparation: () => sessionManager.cancelUpgradePreparation(),
        shutdownAfterHandoff: () => {
          setTimeout(() => process.kill(process.pid, 'SIGTERM'), 100).unref?.()
        },
        suppressResponse: true,
      })
      return result as unknown as import('./daemon-ipc/json.js').JsonValue
    }
    localExternalUpgradePreparer = (params) => {
      const object = params && typeof params === 'object' && !Array.isArray(params)
        ? params as Record<string, import('./daemon-ipc/json.js').JsonValue>
        : {}
      const version = typeof object.targetVersion === 'string' ? object.targetVersion : 'unknown'
      const jobId = `desktop-${version.replace(/[^A-Za-z0-9._-]/g, '_')}-${Date.now()}`
      return { jobId, ...sessionManager.prepareForUpgrade(jobId) }
    }
    localExternalUpgradeCanceller = () => {
      sessionManager.cancelUpgradePreparation()
      return { cancelled: true }
    }
    roomActivationService = new RoomActivationService({
      registry: roomSessionRegistry,
      observations: roomHostSessionObservations,
      enqueueConversationBatch: (inputs) => sessionManager.enqueueManagedRoomBatch(inputs),
      loadContext: async (registration) => {
        const machineToken = loadConfig().machineToken?.trim()
        const binding = registration.binding
        if (!machineToken || !binding) throw new Error('managed_room_context_unavailable')
        const remote = await roomBindingClient.status({
          machineToken,
          roomId: binding.roomId,
          bindingId: binding.bindingId,
        })
        if (!isCurrentRegistration(roomSessionRegistry, registration) || !matchesRoomOwner(registration, remote)) {
          throw new Error('managed_room_binding_unavailable')
        }
        return {
          roomName: remote.room.name,
          memberCount: remote.room.memberCount,
          members: remote.room.members,
          agentsByIdentityId: remote.agent ? { [remote.agentIdentityId]: remote.agent } : {},
          effectiveModelsBySessionId: remote.effectiveModelId !== undefined
            ? { [registration.nianSessionId]: remote.effectiveModelId }
            : undefined,
          agentSystemPromptsByIdentityId: remote.agent
            ? { [remote.agentIdentityId]: remote.agent.systemPrompt ?? '' }
            : {},
        }
      },
      issueManagedRoomContext: (registryKey, activationCauseMessageId, allowedActions, propagateWorkerRoomOrigin) => {
        const machineToken = loadConfig().machineToken
        if (!machineToken) throw new Error('machine_not_authorized')
        return managedRoomContexts.issue({
          registryKey,
          machineCredential: machineToken,
          activationCauseMessageId,
          allowedActions,
          propagateWorkerRoomOrigin,
        })
      },
      audit: new RoomActivationAudit(),
      prepareUnboundDirectTurn: prepareStandaloneAgentTurn,
      resolveManagedAgentPolicy: (input) => resolveManagedAgentPolicy({
        ...input,
        runtime: detectedAgents.find((agent) => agent.type === input.registration.runtimeAdapter),
      }),
    })
    sessionManager.scheduleHandler = (req) => deliverServerSchedule({
      serverUrl, machineToken: loadConfig().machineToken!, req, client,
      queue: sessionManager.getScheduleQueue(), registry: roomSessionRegistry,
    })
    sessionManager.getScheduleQueue().validateScheduledTarget = async (target) => {
      if (!target.bindingId || !target.roomId) return 'ready'
      const local = roomSessionRegistry.getByNianSessionId(target.sessionId)?.binding
      if (local?.bindingId !== target.bindingId) return 'ended'
      const status = await roomBindingClient.status({ machineToken: loadConfig().machineToken!, roomId: target.roomId, bindingId: target.bindingId })
      return status.status === 'active' && status.room.status === 'active' ? 'ready' : 'ended'
    }
    sessionManager.setManagedRoomTurnPreparer((contexts) =>
      roomActivationService!.prepareConversationTurn(contexts),
    )
    sessionManager.setManagedAgentDirectTurnPreparer((sessionId, options) =>
      roomActivationService!.prepareDirectConversationTurn(sessionId, options),
    )
    sessionManager.setManagedRecoveryPreparer(async (record) => {
      if (record.source === 'managed_direct') {
        // Owner direct turns retain the bound Agent's ability to publish to
        // its Room, while remaining unable to read Room history.
        return roomActivationService!.prepareDirectConversationTurn(record.sessionId, OWNER_DIRECT_TURN_OPTIONS)
      }
      if (record.source === 'manager_event') {
        // Upgrade recovery intentionally restores Manager tools only. A
        // completed Worker from the previous daemon must not regain Room send.
        return roomActivationService!.prepareDirectConversationTurn(record.sessionId, {
          allowedRoomActions: [],
          managerEvent: true,
        })
      }
      if (
        record.source !== 'managed_room' ||
        !record.roomContextRegistryKey ||
        !record.activationCauseMessageId ||
        !record.rootCauseMessageId ||
        !record.activationSequence ||
        record.activationHopCount === null
      ) return null
      return roomActivationService!.prepareConversationTurn([{
        registryKey: record.roomContextRegistryKey,
        causeMessageId: record.activationCauseMessageId,
        rootCauseMessageId: record.rootCauseMessageId,
        sequence: record.activationSequence,
        hopCount: record.activationHopCount,
      }])
    })

    fs.mkdirSync(SHENNIAN_DIR, { recursive: true })
    writeDaemonPid(process.pid, daemonInstanceId, { version: currentCliVersion })
    writeDaemonLauncher(process.pid, undefined, daemonInstanceId)

    client.connect()
    process.stdin.resume()

    let shuttingDown = false
    const shutdown = async () => {
      if (shuttingDown) return
      shuttingDown = true
      console.log(chalk.gray('\nDisconnecting...'))
      reportLog({ level: 'info', wsEvent: 'daemon.stop' })
      clearInterval(logRetentionTimer)
      publicAgentWorker?.stop()
      try {
        await sessionManager.cleanup()
        upgradeScheduler.stop()
        nativeFusion?.stop()
        roomMirrorSync?.stop()
        client.disconnect()
        await Promise.allSettled([controlIpc.close(), managedRoomIpc.close()])
        clearDaemonPidIfOwner(process.pid, daemonInstanceId)
        clearDaemonLauncher(daemonInstanceId)
      } finally {
        process.exit(0)
      }
    }

    localShutdown = shutdown
    if (localShutdownRequested) void shutdown()

    process.on('SIGINT', () => void shutdown())
    process.on('SIGTERM', () => void shutdown())
  })

program
  .command('workbuddy-session-hook', { hidden: true })
  .description('(retired) WorkBuddy Room Hook')
  .allowUnknownOption(true)
  .action(() => writeRetiredIntegrationError())

program
  .command('room-session-hook', { hidden: true })
  .description('(internal) Authorize the official Room tool for one trusted Agent Session')
  .argument('<runtime>', 'Trusted runtime adapter')
  .allowUnknownOption(true)
  .action(() => writeRetiredIntegrationError())

program
  .command('room-tool-server', { hidden: true })
  .description('(internal) Run the official Shennian Room MCP tool')
  .allowUnknownOption(true)
  .action(() => writeRetiredIntegrationError())

registerConfigCommand(program)

registerSetupCommand(program)
registerPairCommand(program)
registerLogoutCommand(program)
registerDaemonCommand(program)
registerLocalAppsCommand(program)
registerRuntimeCommand(program)
registerAdapterCommand(program, { clientVersion: cliVersion })
registerAgentCommand(program)
registerManagerCommand(program)
registerWorkerCommand(program)
registerProjectCommand(program)
registerStewardCommand(program)
registerRecordingCommand(program)
registerEnglishCommand(program)
registerUpgradeCommand(program)
registerToolsCommand(program)
registerQueueCommand(program)
registerSkillCommand(program)
registerCommandReference(program, cliVersion)

program.parse()
