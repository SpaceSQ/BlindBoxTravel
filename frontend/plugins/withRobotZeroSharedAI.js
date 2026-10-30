const { withEntitlementsPlist, withInfoPlist, withAndroidManifest, AndroidConfig } = require("expo/config-plugins");

const APP_GROUP = "group.com.robotzero.shared.ai";

const ANDROID_PACKAGES = ["com.tencent.mm", "com.whatsapp"];

function ensureAppGroup(config) {
  return withEntitlementsPlist(config, (next) => {
    const current = next.modResults["com.apple.security.application-groups"];
    const groups = Array.isArray(current) ? [...current] : current ? [current] : [];
    if (!groups.includes(APP_GROUP)) {
      groups.push(APP_GROUP);
    }
    next.modResults["com.apple.security.application-groups"] = groups;
    return next;
  });
}

function ensureInfoPlist(config) {
  return withInfoPlist(config, (next) => {
    next.modResults.RobotZeroSharedAIGroup = APP_GROUP;
    const schemes = new Set(next.modResults.LSApplicationQueriesSchemes ?? []);
    for (const scheme of ["weixin", "whatsapp", "instagram-stories", "sms"]) {
      schemes.add(scheme);
    }
    next.modResults.LSApplicationQueriesSchemes = [...schemes];
    return next;
  });
}

function ensureAndroid(config) {
  return withAndroidManifest(config, (next) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(next.modResults);
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(application, "com.robotzero.shared.ai.group", APP_GROUP);
    const queries = next.modResults.manifest.queries ?? [];
    for (const packageName of ANDROID_PACKAGES) {
      const listed = queries.some((query) => query.package?.some((item) => item.$["android:name"] === packageName));
      if (!listed) {
        queries.push({ package: [{ $: { "android:name": packageName } }] });
      }
    }
    next.modResults.manifest.queries = queries;
    return next;
  });
}

function withRobotZeroSharedAI(config) {
  return ensureAndroid(ensureInfoPlist(ensureAppGroup(config)));
}

module.exports = withRobotZeroSharedAI;
