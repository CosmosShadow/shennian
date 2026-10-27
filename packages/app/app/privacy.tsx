// @arch docs/features/free-growth-phase.md
// @test src/__tests__/privacy-simplification.test.ts

import { Platform, View, Text, ScrollView, StyleSheet, useWindowDimensions } from 'react-native'
import { Redirect } from 'expo-router'
import { useTranslation } from 'react-i18next'

const C = {
  bg: '#FFFFFF',
  neutral400: '#A3A3A3',
  neutral700: '#404040',
  neutral900: '#171717',
} as const

export default function PrivacyPage() {
  if (Platform.OS !== 'web') return <Redirect href="/" />
  return <PrivacyContent />
}

function PrivacyContent() {
  const { t, i18n } = useTranslation()
  const { width } = useWindowDimensions()
  const isWide = width >= 768
  const isZh = i18n.language === 'zh'

  return (
    <ScrollView style={s.root} contentContainerStyle={s.rootContent}>
      <View style={[s.content, { maxWidth: 720, paddingHorizontal: isWide ? 0 : 20 }]}>
        <Text style={s.title}>{t('privacy_title')}</Text>
        <Text style={s.updated}>{t('privacy_updated')}</Text>

        {isZh ? <PrivacyZh /> : <PrivacyEn />}
      </View>
    </ScrollView>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <Text style={s.paragraph}>{children}</Text>
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <View style={s.li}>
      <Text style={s.bullet}>{'  \u2022  '}</Text>
      <Text style={[s.paragraph, { flex: 1 }]}>{children}</Text>
    </View>
  )
}

function PrivacyEn() {
  return (
    <>
      <Section title="1. Introduction">
        <P>
          Shennian ("we", "us", or "our") is operated by Wave Leap (Chengdu) Technology Co., Ltd.
          This policy covers the Shennian app, its relay service, Rooms, and related web pages.
        </P>
      </Section>

      <Section title="2. Information We Collect">
        <Li>Account data: your mobile number and profile name.</Li>
        <Li>Device, machine, Agent, pairing, authorization, and service-status metadata.</Li>
        <Li>Room data: membership, messages, replies, mentions, and attachment metadata.</Li>
        <Li>
          Security logs: event time and type, result, source IP, normalized request path, status
          code, and minimum internal account/device/machine/Room identifiers.
        </Li>
      </Section>

      <Section title="3. Personal AI Conversations">
        <P>
          Full conversation content between your devices and a personal AI Agent is relayed over
          encrypted connections and is not persistently stored in Shennian Cloud. It remains on your
          paired machine and local app storage. The cloud control plane may retain necessary session
          metadata, status, and a short preview of up to 200 characters for synchronization and
          notifications; these are removed when the account is deleted.
        </P>
        <P>
          Before the first applicable request, Shennian asks for your permission to send the text
          and attachments you choose and the conversation or project context needed for your
          request to the AI on your paired machine. If you decline, the request is not sent. That
          AI may use services configured by you. Because Shennian is a connector and does not
          control those configurations, Shennian does not require or publish the AI's underlying
          model, API provider, or implementation.
        </P>
      </Section>

      <Section title="4. Rooms and Attachments">
        <P>
          Room messages are cloud-synchronized so members and authorized Agents can collaborate.
          Each Room message is retained for six calendar months from creation and then its content
          and identity snapshots are automatically cleared. Room attachment originals and previews
          are retained for 30 days from upload completion and then automatically deleted from
          object storage. Viewing or downloading does not extend either period.
        </P>
        <P>
          Rooms can include AI agents configured by different members. Before you first send to a
          Room that contains AI, Shennian asks for your permission because messages and attachments
          you send there may be read and processed by the AI agents in that Room. If you decline,
          the message is not sent. AI participation and AI-generated or AI-sent messages are
          identified in the Room.
        </P>
      </Section>

      <Section title="5. AI Voice Features">
        <P>
          Before ordinary dictation or an AI voice call begins, Shennian asks for your permission
          to send call audio, speech transcripts, and the context needed for the request to its AI
          voice service. If you decline, recording or the call does not start. Alibaba Cloud Model
          Studio (Bailian) provides this processing for Shennian's AI voice features.
        </P>
      </Section>

      <Section title="6. Permission and Withdrawal">
        <P>
          The app records each permission once for the signed-in account and the current disclosure
          version on that device, rather than asking again for every model or Agent. You can
          withdraw these permissions at any time in Settings → AI Data &amp; Privacy. The
          next applicable personal AI request, Room message, dictation, or AI voice call will ask
          again. Withdrawal does not recall data already shared before withdrawal. Clearing app
          data, changing devices, signing in with another account, or a material disclosure change
          may cause the app to ask again.
        </P>
      </Section>

      <Section title="7. Purposes and Service Providers">
        <P>
          We process data to authenticate users, provide relay and Room features, synchronize
          devices, deliver notifications, prevent abuse, troubleshoot failures, and meet legal
          security obligations.
        </P>
        <Li>
          Alibaba Cloud provides domestic server, database, object-storage, and SMS infrastructure.
        </Li>
        <Li>
          Apple Push Notification service (APNs) and Google Firebase Cloud Messaging (FCM) deliver
          push notifications where applicable.
        </Li>
        <Li>
          Alibaba Cloud Model Studio (Bailian) processes call audio, speech transcripts, and the
          context needed for Shennian's AI voice features after you explicitly allow that use.
        </Li>
        <P>
          The current domestic login screen uses mobile-number verification only. Apple and Google
          account login are not currently offered on that screen. We do not sell personal data or
          share it for targeted advertising.
        </P>
      </Section>

      <Section title="8. Data Retention">
        <Li>
          Account and control-plane data: while the account is active; deleted through in-app
          account deletion.
        </Li>
        <Li>Room messages: six calendar months from creation.</Li>
        <Li>Room attachment files and previews: 30 days from upload completion.</Li>
        <Li>
          Network-security audit logs: six calendar months, accessible only for security,
          compliance, and lawful regulatory assistance. They do not contain conversation bodies,
          prompts, tokens, verification codes, or request payloads.
        </Li>
        <P>
          Local copies are removed on account deletion and are also pruned during synchronization
          when their cloud retention period ends.
        </P>
      </Section>

      <Section title="9. Account Deletion">
        <P>
          You can delete your account directly in Settings → Account → Delete Account; no email is
          required. Deletion revokes devices and authorizations and removes personal AI session
          data, machines, Agents, profile data, and other account data under our control. You leave
          all Rooms. Messages previously sent to Rooms remain only for the remainder of their
          original six-month period so the shared conversation and security trail are not broken;
          they are shown as sent by a deleted user while the minimum internal author identifier
          remains restricted with that record. Unexpired security audit records remain until their
          own expiry.
        </P>
      </Section>

      <Section title="10. Children and Your Rights">
        <P>
          The Service is not intended for children under 14. A child under 14 may use it only with
          consent and guidance from a parent or guardian.
        </P>
        <P>
          You may access, correct, or delete your account data and withdraw optional permissions in
          the app. Where a request cannot be completed in the app, use the “Contact Us” entry on the
          official Shennian website. We will verify the request without asking for information we
          did not originally collect unless legally necessary.
        </P>
      </Section>

      <Section title="11. Security and Policy Changes">
        <P>
          Data in transit is protected by TLS (HTTPS/WSS), and access is limited by account, device,
          and Room authorization. Material policy changes will be published here with a new
          effective date and, where required, presented for renewed consent.
        </P>
      </Section>

      <Section title="12. Contact Us">
        <P>
          For privacy questions, complaints, or rights requests, use the “Contact Us” entry on
          shennian.net. Operator: Wave Leap (Chengdu) Technology Co., Ltd.
        </P>
      </Section>
    </>
  )
}

function PrivacyZh() {
  return (
    <>
      <Section title="一、引言">
        <P>
          神念（“我们”）由波动跃迁（成都）科技有限公司运营。本政策适用于神念 App、中继服务、群聊及相关网页。
        </P>
      </Section>

      <Section title="二、我们收集的信息">
        <Li>账号信息：手机号码和个人资料名称。</Li>
        <Li>设备、机器、Agent、配对、授权及服务状态等控制面信息。</Li>
        <Li>群聊信息：成员关系、消息、回复、提及和附件元数据。</Li>
        <Li>
          网络安全日志：事件时间和类型、结果、来源
          IP、规范化请求路径、状态码，以及最少必要的内部账号、设备、机器或群聊标识。
        </Li>
      </Section>

      <Section title="三、个人 AI 对话">
        <P>
          您的设备与个人 AI Agent
          之间的完整对话正文通过加密连接中转，不在神念云端持久化，正文保留在配对机器和 App 本地。
          为完成跨设备同步和通知，云端控制面可能保留必要的 Session 元数据、状态及不超过 200
          个字符的短预览；注销账号时一并删除。
        </P>
        <P>
          首次执行相应请求前，神念会征得您的许可，再把您主动选择的文字、附件，以及完成请求所需的会话或项目上下文
          转交至配对机器上的 AI；如果拒绝，请求不会发送。该 AI 可能继续使用您自行配置的服务处理数据。
          神念是连接器，并不控制这些配置。神念不要求也不公开该 AI 的底层模型、API 厂商或技术实现。
        </P>
      </Section>

      <Section title="四、群聊与附件">
        <P>
          群聊消息会同步至云端，以便群成员和获授权的 Agent
          协作。每条群聊消息自创建之日起保存六个自然月，
          到期后自动清除正文及身份快照。群聊附件原文件和预览自上传完成之日起保存三十天，之后从对象存储自动删除。
          查看或下载不会延长上述期限。
        </P>
        <P>
          群聊可以包含不同成员配置的 AI。首次向含 AI 的群聊发送内容前，神念会征得您的许可，因为您发送的消息和附件
          可能被群内 AI 读取和处理；如果拒绝，消息不会发送。群内会标明 AI 身份，以及由 AI 生成或发送的消息。
        </P>
      </Section>

      <Section title="五、AI 语音功能">
        <P>
          普通听写或 AI 语音通话开始前，神念会征得您的许可，再把通话音频、语音转写以及完成请求所需的上下文
          交给 AI 语音服务处理；如果拒绝，不会开始录音或通话。神念的 AI 语音功能由阿里云百炼提供上述处理服务。
        </P>
      </Section>

      <Section title="六、许可记录与撤回">
        <P>
          App 会按当前登录账号和披露版本，在本设备记录一次许可，不会针对每个模型或智能体重复询问。
          您可随时在“设置 → AI 数据与隐私”中撤回；下一次相应的个人 AI 请求、含 AI 群聊发送、普通听写或 AI
          语音通话会重新询问。撤回不会追回此前已分享的数据。清除 App 数据、更换设备、切换账号或披露内容发生重大变化时，
          也可能重新询问。
        </P>
      </Section>

      <Section title="七、处理目的与第三方服务">
        <P>
          我们仅为身份验证、提供中继与群聊、设备同步、发送通知、防范滥用、故障排查及履行网络安全义务处理信息。
        </P>
        <Li>阿里云提供国内服务器、数据库、对象存储和短信基础设施。</Li>
        <Li>Apple APNs 和 Google FCM 在适用平台提供推送通知服务。</Li>
        <Li>阿里云百炼在您明确同意后，为神念 AI 语音功能处理通话音频、语音转写及完成请求所需的上下文。</Li>
        <P>
          当前国内版登录界面仅提供手机号码验证码登录，不提供 Apple 或 Google 账号登录入口。
          我们不会出售个人信息，也不会为定向广告目的分享个人信息。
        </P>
      </Section>

      <Section title="八、数据保留">
        <Li>账号及控制面数据：账号存续期间保存，可通过 App 内注销删除。</Li>
        <Li>群聊消息：自创建之日起六个自然月。</Li>
        <Li>群聊附件原文件与预览：自上传完成之日起三十天。</Li>
        <Li>
          网络安全审计日志：保存六个自然月，仅用于安全、合规和依法配合监管；不包含对话正文、Prompt、Token、验证码或请求
          payload。
        </Li>
        <P>
          注销时清除当前设备中的账号本地副本；各端同步时也会删除超过云端保留期限的群聊本地副本。
        </P>
      </Section>

      <Section title="九、注销账号">
        <P>
          您可在“设置 → 账号 → 注销账号”中直接完成注销，无需发送邮件。注销会撤销设备和授权，删除个人
          AI Session 数据、
          机器、Agent、个人资料及我们控制范围内的其他账号数据，并使您退出全部群聊。此前发送的群聊消息仍按原创建时间保留至六个月期限届满，
          以保持共享会话及安全追溯的完整性；对外显示为“已注销用户”，最少必要的内部作者标识仅随该消息受限保存。
          尚未到期的网络安全审计记录按其原期限保留。
        </P>
      </Section>

      <Section title="十、未成年人及您的权利">
        <P>
          本服务不面向未满十四周岁的儿童。未满十四周岁的儿童仅可在父母或其他监护人同意并指导下使用。
        </P>
        <P>
          您可在 App 内访问、更正或注销账号，并撤回非必要权限。如某项请求无法在 App
          内完成，请通过神念官网的“联系我们”入口提交。除法律确有要求外，我们不会要求您提供注册时未收集的信息。
        </P>
      </Section>

      <Section title="十一、安全保护与政策变更">
        <P>
          数据传输使用
          TLS（HTTPS/WSS）保护，并通过账号、设备和群聊权限限制访问。发生重大政策变更时，
          我们会在此公布新的生效日期，并在法律要求时重新征得您的同意。
        </P>
      </Section>

      <Section title="十二、联系我们">
        <P>
          如有隐私问题、投诉或权利请求，请使用 shennian.net
          官网的“联系我们”入口。运营者：波动跃迁（成都）科技有限公司。
        </P>
      </Section>
    </>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  rootContent: { minHeight: '100%' },

  content: {
    alignSelf: 'center',
    width: '100%',
    paddingTop: 64,
    paddingBottom: 96,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: C.neutral900,
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  updated: {
    fontSize: 14,
    color: C.neutral400,
    marginBottom: 40,
  },

  section: { marginBottom: 32 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.neutral900,
    marginBottom: 12,
  },
  paragraph: {
    fontSize: 15,
    lineHeight: 26,
    color: C.neutral700,
    marginBottom: 8,
  },
  li: {
    flexDirection: 'row',
    paddingLeft: 4,
    marginBottom: 4,
  },
  bullet: {
    fontSize: 15,
    lineHeight: 26,
    color: C.neutral400,
  },
})
