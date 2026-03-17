plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

fun escapedBuildConfigString(value: String): String =
    "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""

fun buildUrlProperty(name: String, fallback: String): String =
    providers.gradleProperty(name).orElse(providers.environmentVariable(name)).getOrElse(fallback)

val releaseApiBaseUrl =
    buildUrlProperty(
        name = "NOTES_ANDROID_RELEASE_API_BASE_URL",
        fallback = "https://marketing-apps-notes-next.up.railway.app",
    )
val debugApiBaseUrl =
    buildUrlProperty(
        name = "NOTES_ANDROID_DEBUG_API_BASE_URL",
        fallback = "http://10.0.2.2:8787",
    )

android {
    namespace = "com.eighthbrain.notesandroid.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.eighthbrain.notesandroid.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "DEFAULT_API_BASE_URL", escapedBuildConfigString(releaseApiBaseUrl))
    }

    buildTypes {
        debug {
            buildConfigField("String", "DEFAULT_API_BASE_URL", escapedBuildConfigString(debugApiBaseUrl))
        }

        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            buildConfigField("String", "DEFAULT_API_BASE_URL", escapedBuildConfigString(releaseApiBaseUrl))
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.02.01")

    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.core:core-ktx:1.18.0")
    implementation("androidx.datastore:datastore-preferences:1.2.1")
    implementation("androidx.glance:glance-appwidget:1.1.1")
    implementation("androidx.glance:glance-material3:1.1.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.10.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.10.0")
    implementation("androidx.work:work-runtime-ktx:2.11.1")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("com.google.android.material:material:1.13.0")
    implementation("com.squareup.okhttp3:okhttp:5.3.2")

    debugImplementation("androidx.compose.ui:ui-tooling")
}
