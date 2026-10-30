package expo.modules.robotzerosharedai

import android.content.pm.PackageManager
import android.os.Environment
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class RobotZeroSharedAIModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RobotZeroSharedAI")

    Function("containerUri") {
      resolve()?.uri
    }

    Function("containerIsShared") {
      resolve()?.shared ?: false
    }
  }

  private data class Container(val uri: String, val shared: Boolean)

  private fun groupId(): String {
    val context = appContext.reactContext ?: return "group.com.robotzero.shared.ai"
    return try {
      val info = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
      info.metaData?.getString("com.robotzero.shared.ai.group") ?: "group.com.robotzero.shared.ai"
    } catch (_: Exception) {
      "group.com.robotzero.shared.ai"
    }
  }

  private fun resolve(): Container? {
    val context = appContext.reactContext ?: return null
    val publicModels = File(
      Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS),
      "RobotZeroSharedAI/models",
    )
    if ((publicModels.mkdirs() || publicModels.isDirectory) && publicModels.canWrite()) {
      return Container("file://${publicModels.absolutePath}", true)
    }
    val base = context.getExternalFilesDir(null) ?: context.filesDir
    val sandbox = File(base, "${groupId()}/models")
    sandbox.mkdirs()
    return Container("file://${sandbox.absolutePath}", false)
  }
}
