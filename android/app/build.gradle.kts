plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.phonehand.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.phonehand.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 42
        versionName = "2.3.0"
        buildConfigField("String", "RELAY_HOST", "\"sapp-xoyi.onrender.com\"")
        buildConfigField("String", "RELAY_HOST_FALLBACK", "\"\"")
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        create("release") {
            val keystore = file("../2hotatl-release.keystore")
            if (keystore.exists()) {
                storeFile = keystore
                storePassword = "hotatl2026"
                keyAlias = "hotatl"
                keyPassword = "hotatl2026"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
        debug {
            applicationIdSuffix = ".debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.2.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.media3:media3-exoplayer:1.5.1")
    implementation("androidx.media3:media3-ui:1.5.1")
}
