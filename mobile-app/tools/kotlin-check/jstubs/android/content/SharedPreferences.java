package android.content;
public interface SharedPreferences {
  String getString(String key, String def);
  Editor edit();
  interface Editor { Editor putString(String k, String v); Editor remove(String k); boolean commit(); }
}
