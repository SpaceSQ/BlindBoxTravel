import ExpoModulesCore
import Foundation

public class RobotZeroSharedAIModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RobotZeroSharedAI")

    Function("containerUri") { () -> String? in
      Self.modelsDirectory()?.absoluteString
    }

    Function("containerIsShared") { () -> Bool in
      Self.modelsDirectory() != nil
    }
  }

  private static func groupId() -> String {
    if let value = Bundle.main.object(forInfoDictionaryKey: "RobotZeroSharedAIGroup") as? String, !value.isEmpty {
      return value
    }
    return "group.com.robotzero.shared.ai"
  }

  private static func modelsDirectory() -> URL? {
    let fileManager = FileManager.default
    guard let container = fileManager.containerURL(forSecurityApplicationGroupIdentifier: groupId()) else {
      return nil
    }
    let models = container.appendingPathComponent("models", isDirectory: true)
    do {
      try fileManager.createDirectory(at: models, withIntermediateDirectories: true)
    } catch {
      return nil
    }
    return models
  }
}
