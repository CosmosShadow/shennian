// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/daemon-autostart.test.ts

import path from 'node:path'

type WindowsLaunchSpec = {
  command: string
  args: string[]
  electronRunAsNode?: boolean
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function quoteSystemdArg(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function quoteCmdArg(text: string): string {
  return `"${text.replace(/"/g, '""')}"`
}

function escapeVbsString(text: string): string {
  return text.replace(/"/g, '""')
}

function escapeXmlValue(text: string): string {
  return escapeXml(text)
}

export function isWindowsCmdScript(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return ext === '.cmd' || ext === '.bat'
}

export function buildWindowsLauncherCommand(spec: WindowsLaunchSpec, logFile: string): string {
  const batchQuote = (value: string) => quoteCmdArg(value.replace(/%/g, '%%'))
  const commandLine = [spec.command, ...spec.args].map(batchQuote).join(' ')
  const invocation = isWindowsCmdScript(spec.command) ? `call ${commandLine}` : commandLine
  return [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal DisableDelayedExpansion',
    'if not defined SHENNIAN_HOME set "SHENNIAN_HOME=%~dp0."',
    `${invocation} >> ${batchQuote(logFile)} 2>&1`,
    '',
  ].join('\r\n')
}

export function buildWindowsStartupVbs(cmdPath: string): string {
  return [
    'Set shell = CreateObject("WScript.Shell")',
    `shell.Run Chr(34) & "${escapeVbsString(cmdPath)}" & Chr(34), 0, False`,
    '',
  ].join('\r\n')
}

export function buildWindowsScheduledTaskXml(input: {
  userId: string
  command: string
  arguments: string[]
}): string {
  const joinedArgs = input.arguments.join(' ')
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Shennian Agent Daemon</Description>
  </RegistrationInfo>
  <Triggers>
    <BootTrigger>
      <Enabled>true</Enabled>
      <Delay>PT15S</Delay>
    </BootTrigger>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${escapeXmlValue(input.userId)}</UserId>
    </LogonTrigger>
    <EventTrigger>
      <Enabled>true</Enabled>
      <Subscription><![CDATA[
<QueryList>
  <Query Id="0" Path="System">
    <Select Path="System">*[System[Provider[@Name='Microsoft-Windows-Power-Troubleshooter'] and EventID=1]]</Select>
  </Query>
</QueryList>]]></Subscription>
    </EventTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${escapeXmlValue(input.userId)}</UserId>
      <LogonType>S4U</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>true</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${escapeXmlValue(input.command)}</Command>
      <Arguments>${escapeXmlValue(joinedArgs)}</Arguments>
    </Exec>
  </Actions>
</Task>`
}

export function buildWindowsScheduledTaskCommands(input: {
  taskName: string
  xmlPath: string
}): { create: string; run: string } {
  return {
    create: `schtasks /create /tn ${quoteCmdArg(input.taskName)} /xml ${quoteCmdArg(input.xmlPath)} /f`,
    run: `schtasks /run /tn ${quoteCmdArg(input.taskName)}`,
  }
}

export function registerWindowsScheduledTask(
  input: { taskName: string; xmlPath: string },
  execute: (command: string) => void,
): boolean {
  const commands = buildWindowsScheduledTaskCommands(input)
  for (const [phase, command] of [['create', commands.create], ['run', commands.run]] as const) {
    try {
      execute(command)
    } catch (error) {
      const failure = error as Error & { status?: number; stderr?: Buffer | string }
      const detail = failure.stderr ? String(failure.stderr).trim() : failure.message
      const exit = typeof failure.status === 'number' ? ` (exit ${failure.status})` : ''
      throw new Error(`windows_autostart_registration_failed:${phase}${exit}: ${detail || 'unknown_error'}`)
    }
  }
  return true
}

export function buildWindowsScheduledTaskSuspendCommands(taskName: string): {
  disable: string
  end: string
} {
  return {
    disable: `schtasks /change /tn ${quoteCmdArg(taskName)} /disable`,
    end: `schtasks /end /tn ${quoteCmdArg(taskName)}`,
  }
}

export function suspendWindowsScheduledTask(
  taskName: string,
  execute: (command: string) => void,
): void {
  const commands = buildWindowsScheduledTaskSuspendCommands(taskName)
  for (const command of [commands.disable, commands.end]) {
    try {
      execute(command)
    } catch {
      // Missing/idle tasks are harmless; the caller recreates the task after shutdown.
    }
  }
}
