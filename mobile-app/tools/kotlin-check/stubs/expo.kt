@file:Suppress("unused", "UNUSED_PARAMETER")
package expo.modules.kotlin.modules
class AppContext { val reactContext: android.content.Context? = null }
class SyncFunctionComponent
class FunctionBuilder(name: String)
class ModuleDefinitionData
open class ModuleDefinitionBuilder {
  fun Name(name: String) {}
  fun Function(name: String) = FunctionBuilder(name)
  @JvmName("FunctionWithoutArgs")
  inline fun Function(name: String, crossinline body: () -> Any?): SyncFunctionComponent = SyncFunctionComponent()
  inline fun <reified R> Function(name: String, crossinline body: () -> R): SyncFunctionComponent = SyncFunctionComponent()
  inline fun <reified R, reified P0> Function(name: String, crossinline body: (p0: P0) -> R): SyncFunctionComponent = SyncFunctionComponent()
  inline fun <reified R, reified P0, reified P1> Function(name: String, crossinline body: (p0: P0, p1: P1) -> R): SyncFunctionComponent = SyncFunctionComponent()
}
abstract class Module {
  val appContext: AppContext = AppContext()
  abstract fun definition(): ModuleDefinitionData
}
inline fun Module.ModuleDefinition(crossinline block: ModuleDefinitionBuilder.() -> Unit): ModuleDefinitionData {
  ModuleDefinitionBuilder().also(block); return ModuleDefinitionData()
}
