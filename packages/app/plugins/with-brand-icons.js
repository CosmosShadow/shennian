// @arch docs/design/brand/assets/README.md
// @test packages/app/src/__tests__/app-config.test.ts
const { withXcodeProject, IOSConfig } = require('@expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')
const NAME = '[Shennian] Sync app icons'

function applyIconBuildPhase(project, projectName = 'app') {
  const target = project.getFirstTarget()
  const sections = project.hash.project.objects.PBXShellScriptBuildPhase || {}
  let uuid = Object.keys(sections).find((key) => sections[key]?.name === JSON.stringify(NAME))
  if (!uuid) {
    uuid = project.addBuildPhase([], 'PBXShellScriptBuildPhase', NAME, target.uuid, {
      shellPath: '/bin/sh',
      shellScript: `sh "$PROJECT_DIR/../scripts/sync-ios-icons.sh" "$PROJECT_DIR/.." "${projectName}"`,
    }).uuid
  }
  const phase = project.hash.project.objects.PBXShellScriptBuildPhase[uuid]
  phase.shellScript = JSON.stringify(`sh "$PROJECT_DIR/../scripts/sync-ios-icons.sh" "$PROJECT_DIR/.." "${projectName}"`)
  phase.alwaysOutOfDate = 1
  phase.inputPaths = [
    '"$(PROJECT_DIR)/../scripts/sync-ios-icons.sh"',
    ...['icon.png', 'icon-dark.png', 'icon-tinted.png'].map((name) => `"$(PROJECT_DIR)/../assets/${name}"`),
  ]
  phase.inputPaths.push('"$(PROJECT_DIR)/../assets/Shennian.icon/icon.json"', '"$(PROJECT_DIR)/../assets/Shennian.icon/Assets/Logo.svg"')
  phase.outputPaths = ['', '-dark', '-tinted'].map((suffix) =>
    `"$(PROJECT_DIR)/${projectName}/Images.xcassets/AppIcon.appiconset/App-Icon${suffix}-1024x1024@1x.png"`,
  )
  phase.outputPaths.push(`"$(PROJECT_DIR)/${projectName}/Shennian.icon/icon.json"`, `"$(PROJECT_DIR)/${projectName}/Shennian.icon/Assets/Logo.svg"`)
  // Before Resources, including builds launched directly from Xcode.
  const phases = target.firstTarget.buildPhases
  const entry = phases.find((item) => item.value === uuid)
  target.firstTarget.buildPhases = [entry, ...phases.filter((item) => item.value !== uuid)]
  return project
}

function applyComposerIcon(project, projectName) {
  IOSConfig.XcodeUtils.addResourceFileToGroup({
    filepath: `${projectName}/Shennian.icon`, groupName: projectName, project, isBuildFile: true,
  })
  const refs = project.pbxFileReferenceSection()
  for (const ref of Object.values(refs)) {
    if (ref && typeof ref === 'object' && String(ref.path).includes('Shennian.icon')) {
      ref.lastKnownFileType = 'folder.iconcomposer.icon'
    }
  }
  project.updateBuildProperty('ASSETCATALOG_COMPILER_APPICON_NAME', 'Shennian', undefined, projectName)
}

module.exports = (config) => withXcodeProject(config, (mod) => {
  const projectName = IOSConfig.XcodeUtils.getProjectName(mod.modRequest.projectRoot)
  applyIconBuildPhase(mod.modResults, projectName)
  applyComposerIcon(mod.modResults, projectName)
  return mod
})
module.exports.applyIconBuildPhase = applyIconBuildPhase

// Register the icon and sync phase in an existing local project; no full prebuild.
if (require.main === module) {
  const projectRoot = path.join(__dirname, '..')
  const iosRoot = path.join(projectRoot, 'ios')
  if (fs.existsSync(iosRoot) && fs.readdirSync(iosRoot).some((name) => name.endsWith('.xcodeproj'))) {
    const projectName = IOSConfig.XcodeUtils.getProjectName(projectRoot)
    const file = path.join(projectRoot, `ios/${projectName}.xcodeproj/project.pbxproj`)
    const project = require('xcode').project(file)
    project.parseSync()
    applyIconBuildPhase(project, projectName)
    applyComposerIcon(project, projectName)
    fs.writeFileSync(file, project.writeSync())
  }
}
