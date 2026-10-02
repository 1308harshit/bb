const { withXcodeProject } = require("expo/config-plugins");
const { mkdir, copyFile } = require("node:fs/promises");
const path = require("node:path");

const targetName = "BBNotificationContent";

module.exports = function withNotificationContent(config) {
  return withXcodeProject(config, async (mod) => {
    const project = mod.modResults;
    const destination = path.join(mod.modRequest.platformProjectRoot, targetName);
    await mkdir(destination, { recursive: true });
    for (const file of ["NotificationViewController.swift", "Info.plist"]) {
      await copyFile(
        path.join(mod.modRequest.projectRoot, "native/notification-content", file),
        path.join(destination, file),
      );
    }
    const existing = Object.values(project.pbxNativeTargetSection()).some(
      (target) => typeof target === "object" && target.name?.replaceAll('"', "") === targetName,
    );
    if (existing) return mod;
    const target = project.addTarget(
      targetName,
      "app_extension",
      targetName,
      `${mod.ios.bundleIdentifier}.notification-content`,
    );
    project.addBuildPhase(
      [`${targetName}/NotificationViewController.swift`],
      "PBXSourcesBuildPhase",
      "Sources",
      target.uuid,
    );
    project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
    project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);
    const configurations = project.pbxXCBuildConfigurationSection();
    const parent = Object.values(configurations).find(
      (entry) => typeof entry === "object" && entry.buildSettings?.PRODUCT_BUNDLE_IDENTIFIER?.replaceAll('"', "") === mod.ios.bundleIdentifier,
    )?.buildSettings;
    for (const entry of Object.values(configurations)) {
      if (typeof entry !== "object" || entry.buildSettings?.PRODUCT_NAME !== `"${targetName}"`) continue;
      Object.assign(entry.buildSettings, {
        INFOPLIST_FILE: `"${targetName}/Info.plist"`,
        SWIFT_VERSION: "5.0",
        IPHONEOS_DEPLOYMENT_TARGET: "16.0",
        TARGETED_DEVICE_FAMILY: '"1,2"',
        APPLICATION_EXTENSION_API_ONLY: "YES",
        GENERATE_INFOPLIST_FILE: "NO",
        CODE_SIGN_STYLE: "Automatic",
        CURRENT_PROJECT_VERSION: parent?.CURRENT_PROJECT_VERSION ?? "1",
        MARKETING_VERSION: parent?.MARKETING_VERSION ?? mod.version,
        ...(parent?.DEVELOPMENT_TEAM ? { DEVELOPMENT_TEAM: parent.DEVELOPMENT_TEAM } : {}),
      });
    }
    return mod;
  });
};
