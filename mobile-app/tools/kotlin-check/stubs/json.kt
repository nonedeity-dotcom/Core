@file:Suppress("unused", "UNUSED_PARAMETER")
package org.json
class JSONObject() {
  constructor(s: String?) : this()
  fun put(k: String, v: Any?): JSONObject = this
  fun optString(k: String?): String = ""
  fun optInt(k: String?, d: Int): Int = d
  fun optBoolean(k: String?, d: Boolean): Boolean = d
  fun optJSONArray(k: String?): JSONArray? = null
}
class JSONArray() {
  constructor(s: String?) : this()
  fun length(): Int = 0
  fun optJSONObject(i: Int): JSONObject? = null
  fun put(v: Any?): JSONArray = this
}
