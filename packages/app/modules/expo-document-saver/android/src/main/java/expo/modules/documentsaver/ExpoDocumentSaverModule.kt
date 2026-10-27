package expo.modules.documentsaver

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.Serializable

internal class SaveDocumentOptions : Record {
  @Field var filename: String = "download"
  @Field var mimeType: String = "application/octet-stream"
  @Field var data: String = ""
}

internal data class SaveDocumentRequest(
  val filename: String,
  val mimeType: String,
) : Serializable

internal sealed class SaveDocumentPickerResult {
  data class Selected(val uri: Uri) : SaveDocumentPickerResult()
  data object Canceled : SaveDocumentPickerResult()
}

internal class SaveDocumentContract : AppContextActivityResultContract<SaveDocumentRequest, SaveDocumentPickerResult> {
  override fun createIntent(context: Context, input: SaveDocumentRequest): Intent =
    Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = input.mimeType
      putExtra(Intent.EXTRA_TITLE, input.filename)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    }

  override fun parseResult(
    input: SaveDocumentRequest,
    resultCode: Int,
    intent: Intent?,
  ): SaveDocumentPickerResult {
    if (resultCode != Activity.RESULT_OK) return SaveDocumentPickerResult.Canceled
    val uri = intent?.data ?: return SaveDocumentPickerResult.Canceled
    return SaveDocumentPickerResult.Selected(uri)
  }
}

class ExpoDocumentSaverModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoDocumentSaver")

    lateinit var launcher: AppContextActivityResultLauncher<SaveDocumentRequest, SaveDocumentPickerResult>

    RegisterActivityContracts {
      launcher = registerForActivityResult(SaveDocumentContract())
    }

    AsyncFunction("save") Coroutine { options: SaveDocumentOptions ->
      val result = launcher.launch(SaveDocumentRequest(options.filename, options.mimeType))
      if (result is SaveDocumentPickerResult.Canceled) return@Coroutine "canceled"

      val context = appContext.reactContext ?: throw Exception("react context unavailable")
      val uri = (result as SaveDocumentPickerResult.Selected).uri
      val bytes = Base64.decode(options.data, Base64.DEFAULT)
      context.contentResolver.openOutputStream(uri, "w").use { output ->
        requireNotNull(output) { "unable to open selected document" }
        output.write(bytes)
        output.flush()
      }
      "saved"
    }
  }
}
