# Keep all app classes — narrow keeps in v2.9.0 stripped HomeActivity/OnboardingActivity
# helpers and broke PermissionStep lambdas at launch (instant crash on release APK).
-keep class com.phonehand.app.** { *; }
-keepattributes *Annotation*
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn androidx.media3.**
