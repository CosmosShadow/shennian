import { englishCliRoutes } from './routes/english-cli.js'
import { registerPersonalModelRoutes } from './routes/personal-model.js'
import { personalWorkspaceRoutes } from './routes/personal-workspace.js'
import { personalRecordingRoutes } from './routes/personal-recordings.js'
import { localAppsRoutes } from './routes/local-apps.js'
import { personalReminderAgentRoutes } from './routes/personal-reminder-agent.js'
import { personalModuleRoutes } from './routes/personal-modules.js'
import { interactiveContentRoutes } from './routes/interactive-content.js'
import { conversationScheduleRoutes } from './routes/conversation-schedules.js'
// @arch open-source/docs/server-runtime.md
// @test src/__tests__/trace-logging.test.ts

import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import { healthRoutes } from './routes/health.js'
import { localStorageRoutes } from './routes/local-storage.js'
import { authRoutes } from './routes/auth.js'
import { instanceRoutes } from './routes/instance.js'
import { machineRoutes } from './routes/machines.js'
import { grantRoutes } from './routes/grants.js'
import { organizationRoutes } from './routes/organizations.js'
import { sessionRoutes } from './routes/sessions.js'
import { projectRoutes } from './routes/projects.js'
import { pushRoutes } from './routes/push.js'
import { agentProxyRoutes } from './routes/agent-proxy.js'
import { downloadRoutes } from './routes/downloads.js'
import { logRoutes } from './routes/log.js'
import { geoRoutes } from './routes/geo.js'
import { voiceRoutes } from './routes/voice.js'
import { voiceAsrWsRoutes } from './routes/voice-asr-ws.js'
import { voiceChiefWsRoutes } from './routes/voice-chief-ws.js'
import { voiceChiefIncomingRoutes } from './routes/voice-chief-incoming.js'
import { internalAdminRoutes } from './routes/internal-admin.js'
import { retiredExternalChannelRoutes } from './routes/retired-external-channels.js'
import { retiredSkillRoutes } from './routes/retired-skills.js'
import { registerServerExtensions } from '@shennian/server-extensions'
import type { ServerExtension } from '@shennian/server-extensions'
import { getDeploymentMode } from './services/instance-settings.js'
import { roomRoutes } from './routes/rooms.js'
import { roomAgentActionRoutes } from './routes/room-agent-actions.js'
import { roomAgentSettingsRoutes } from './routes/room-agent-settings.js'
import { roomAttachmentLinkRoutes } from './routes/room-attachment-links.js'
import { deviceAuthorizationRoutes } from './routes/device-authorizations.js'
import { roomInviteBrowserRoutes } from './routes/room-invite-browser.js'
import { roomBrowserRoutes } from './routes/room-browser.js'
import { roomCliRoutes } from './routes/room-cli.js'
import { supportCliRoutes } from './routes/support-cli.js'
import { profileAvatarRoutes } from './routes/profile-avatars.js'
import { agentAvatarRoutes } from './routes/agent-avatars.js'
import { cliReleasePolicyRoutes } from './routes/cli-release-policy.js'
import { otaUpdateRoutes } from './routes/ota-updates.js'
import { officialRoomRoutes } from './routes/official-room.js'
import { agentRoutes } from './routes/agents.js'
import {
  agentDirectConversationRoutes,
  agentPublicationOwnerRoutes,
  agentPublicationPublicRoutes,
} from './routes/agent-publications.js'
import { agentCliRoutes } from './routes/agent-cli.js'
import { projectCliRoutes } from './routes/project-cli.js'
import { agentDiscoveryOwnerRoutes, agentDiscoveryRoutes } from './routes/agent-discovery.js'
import { contactRoutes } from './routes/contacts.js'
import { peopleRoutes } from './routes/people.js'
import { agentDirectDeliveryRoutes } from './routes/agent-direct-delivery.js'
import { acpRegistryRoutes } from './routes/acp-registry.js'
import { adapterSubmissionRoutes } from './routes/adapter-submissions.js'
import { serializeRequestForLog } from './security/sensitive-request-url.js'
import {
  redactSensitiveLogValue,
  sanitizePinoLogArguments,
  serializeErrorForLog,
} from './security/log-redaction.js'
import { relayPlugin } from './relay/index.js'
import { securityPlugin } from './middleware/security.js'
import { tracePlugin } from './middleware/trace.js'

export type BuildAppOptions = { extensions?: readonly ServerExtension[] }

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    disableRequestLogging: true,
    logger: {
      level: process.env.DEBUG === 'true' ? 'debug' : 'info',
      serializers: {
        req: serializeRequestForLog,
        err: serializeErrorForLog,
      },
      formatters: {
        log: (object) => redactSensitiveLogValue(object) as Record<string, unknown>,
      },
      hooks: {
        logMethod(args, method) {
          method.apply(this, sanitizePinoLogArguments(args) as [unknown, string?, ...unknown[]])
        },
      },
    },
    trustProxy: true,
    // Signed Room attachment capabilities carry three scoped IDs and exceed
    // Fastify's 100-character default route-parameter limit.
    routerOptions: { maxParamLength: 512 },
    bodyLimit: 20 * 1024 * 1024, // 20MB — image base64 in agent proxy context
  })

  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  })
  await app.register(websocket)
  await app.register(securityPlugin)
  await tracePlugin(app)
  await app.register(instanceRoutes)
  await app.register(healthRoutes)
  await app.register(localStorageRoutes)
  await app.register(authRoutes, { prefix: '/auth' })
  await app.register(deviceAuthorizationRoutes, { prefix: '/auth/device-authorizations' })
  await app.register(roomInviteBrowserRoutes)
  await app.register(roomBrowserRoutes)
  await app.register(roomCliRoutes, { prefix: '/room-cli' })
  await app.register(roomCliRoutes, { prefix: '/api/room-cli' })
  await app.register(agentCliRoutes, { prefix: '/agent-cli' })
  await app.register(agentCliRoutes, { prefix: '/api/agent-cli' })
  await app.register(projectCliRoutes, { prefix: '/project-cli' })
  await app.register(projectCliRoutes, { prefix: '/api/project-cli' })
  await app.register(supportCliRoutes, { prefix: '/support-cli' })
  await app.register(supportCliRoutes, { prefix: '/api/support-cli' })
  await app.register(profileAvatarRoutes)
  await app.register(agentAvatarRoutes)
  await app.register(cliReleasePolicyRoutes)
  await app.register(otaUpdateRoutes)
  await app.register(officialRoomRoutes)
  await app.register(acpRegistryRoutes)
  await app.register(adapterSubmissionRoutes, { prefix: '/adapter-submissions' })
  await app.register(adapterSubmissionRoutes, { prefix: '/api/adapter-submissions' })
  await app.register(machineRoutes, { prefix: '/machines' })
  await app.register(grantRoutes, { prefix: '/machines' })
  // Production Nginx strips /api before forwarding. Register the same surface
  // directly as well so local CLI/daemon development has identical semantics.
  await app.register(machineRoutes, { prefix: '/api/machines' })
  await app.register(grantRoutes, { prefix: '/api/machines' })
  await app.register(organizationRoutes, { prefix: '/organizations' })
  await app.register(sessionRoutes, { prefix: '/sessions' })
  await app.register(projectRoutes, { prefix: '/projects' })
  await app.register(agentRoutes, { prefix: '/agents' })
  await app.register(agentRoutes, { prefix: '/api/agents' })
  await app.register(agentPublicationOwnerRoutes, { prefix: '/agents' })
  await app.register(agentPublicationOwnerRoutes, { prefix: '/api/agents' })
  await app.register(agentDiscoveryOwnerRoutes, { prefix: '/agents' })
  await app.register(agentDiscoveryOwnerRoutes, { prefix: '/api/agents' })
  await app.register(agentDiscoveryRoutes, { prefix: '/plaza/agents' })
  await app.register(agentDiscoveryRoutes, { prefix: '/api/plaza/agents' })
  await app.register(contactRoutes, { prefix: '/contacts' })
  await app.register(contactRoutes, { prefix: '/api/contacts' })
  await app.register(peopleRoutes, { prefix: '/people' })
  await app.register(peopleRoutes, { prefix: '/api/people' })
  await app.register(agentPublicationPublicRoutes, { prefix: '/published-agents' })
  await app.register(agentPublicationPublicRoutes, { prefix: '/api/published-agents' })
  await app.register(agentDirectConversationRoutes, { prefix: '/agent-direct-conversations' })
  await app.register(agentDirectConversationRoutes, { prefix: '/api/agent-direct-conversations' })
  await app.register(agentDirectDeliveryRoutes, { prefix: '/agent-direct-delivery' })
  await app.register(agentDirectDeliveryRoutes, { prefix: '/api/agent-direct-delivery' })
  await app.register(personalReminderAgentRoutes)
  await app.register(personalModuleRoutes, { prefix: '/personal-modules' })
  await app.register(personalModuleRoutes, { prefix: '/api/personal-modules' })
  await app.register(englishCliRoutes, { prefix: '/api/english-cli' })
  await app.register(personalRecordingRoutes, { prefix: '/personal-recordings' })
  await app.register(personalRecordingRoutes, { prefix: '/api/personal-recordings' })
  await app.register(pushRoutes)
  await app.register(agentProxyRoutes)
  await app.register(downloadRoutes, { prefix: '/download' })
  await app.register(logRoutes)
  await app.register(geoRoutes)
  await app.register(personalWorkspaceRoutes, { prefix: '/personal-workspace' })
  await app.register(personalWorkspaceRoutes, { prefix: '/api/personal-workspace' })
  await registerPersonalModelRoutes(app)
  await app.register(localAppsRoutes, { prefix: '/local-apps' })
  await app.register(localAppsRoutes, { prefix: '/api/local-apps' })
  await app.register(interactiveContentRoutes, { prefix: '/interactive-content' })
  await app.register(interactiveContentRoutes, { prefix: '/api/interactive-content' })
  await app.register(voiceRoutes, { prefix: '/voice' })
  await app.register(voiceAsrWsRoutes, { prefix: '/voice' })
  await app.register(voiceChiefWsRoutes, { prefix: '/voice-chief' })
  await app.register(voiceChiefIncomingRoutes, { prefix: '/voice-chief' })
  await app.register(internalAdminRoutes, { prefix: '/internal/admin' })
  await app.register(retiredExternalChannelRoutes, { prefix: '/integrations/wecom' })
  await app.register(retiredExternalChannelRoutes, { prefix: '/wecom' })
  await app.register(retiredExternalChannelRoutes, { prefix: '/integrations/feishu' })
  await app.register(retiredSkillRoutes, { prefix: '/skills' })
  try {
    await registerServerExtensions(app, options.extensions ?? [], getDeploymentMode())
  } catch (error) {
    // Keep the module startup error authoritative even if cleanup also fails.
    await app.close().catch(() => {})
    throw error
  }
  await app.register(retiredExternalChannelRoutes, { prefix: '/channels/wechat' })
  await app.register(retiredExternalChannelRoutes, { prefix: '/api/channels/wechat' })
  await app.register(conversationScheduleRoutes, { prefix: '/api' })
  await app.register(conversationScheduleRoutes)
  await app.register(roomRoutes, { prefix: '/rooms' })
  await app.register(roomRoutes, { prefix: '/api/rooms' })
  await app.register(roomAgentActionRoutes, { prefix: '/rooms' })
  await app.register(roomAgentActionRoutes, { prefix: '/api/rooms' })
  await app.register(roomAgentSettingsRoutes, { prefix: '/rooms' })
  await app.register(roomAgentSettingsRoutes, { prefix: '/api/rooms' })
  await app.register(roomAttachmentLinkRoutes)
  await app.register(relayPlugin)

  return app
}
