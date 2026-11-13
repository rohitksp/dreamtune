// Runs in the cloud build after "cap add android": copies our native code, permissions and libraries into the project.
const fs = require('fs'), path = require('path');
const pkgDir = path.join('android', 'app', 'src', 'main', 'java', 'com', 'rohit', 'dreamtune', 'app');
fs.mkdirSync(pkgDir, { recursive: true });
['KeepAliveService.java', 'KeepAlivePlugin.java', 'MainActivity.java', 'PlayerService.java', 'NativePlayer.java', 'YtAudio.java']
  .forEach(f => fs.copyFileSync(path.join('native', f), path.join(pkgDir, f)));

// ---- manifest: permissions + services
const mf = path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml');
let x = fs.readFileSync(mf, 'utf8');
const perms = [
  'android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK', 'android.permission.WAKE_LOCK',
  'android.permission.POST_NOTIFICATIONS', 'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'
].filter(p => !x.includes(p)).map(p => '    <uses-permission android:name="' + p + '" />').join('\n');
x = x.replace('<application', perms + '\n    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />\n    <application');
x = x.replace('</application>',
  '    <service android:name=".KeepAliveService" android:exported="false" android:foregroundServiceType="mediaPlayback" />\n' +
  '    <service android:name=".PlayerService" android:exported="true" android:foregroundServiceType="mediaPlayback">\n' +
  '        <intent-filter><action android:name="androidx.media3.session.MediaSessionService" /></intent-filter>\n' +
  '    </service>\n    </application>');
fs.writeFileSync(mf, x);

// ---- gradle: JitPack (NewPipe Extractor), Media3 player, OkHttp, Java desugaring
const rootGradle = path.join('android', 'build.gradle');
let rg = fs.readFileSync(rootGradle, 'utf8');
if (!rg.includes('jitpack.io')) rg = rg.split('mavenCentral()').join("mavenCentral()\n        maven { url 'https://jitpack.io' }");
fs.writeFileSync(rootGradle, rg);

const appGradle = path.join('android', 'app', 'build.gradle');
let ag = fs.readFileSync(appGradle, 'utf8');
ag += `
android {
    compileOptions {
        coreLibraryDesugaringEnabled true
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
    packaging {
        resources {
            excludes.addAll(['META-INF/DEPENDENCIES', 'META-INF/LICENSE', 'META-INF/LICENSE.txt', 'META-INF/NOTICE', 'META-INF/NOTICE.txt', 'META-INF/INDEX.LIST'])
        }
    }
}
dependencies {
    implementation 'androidx.media3:media3-exoplayer:1.4.1'
    implementation 'androidx.media3:media3-session:1.4.1'
    implementation 'com.squareup.okhttp3:okhttp:4.12.0'
    implementation 'com.github.TeamNewPipe:NewPipeExtractor:v0.26.5'
    coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs_nio:2.0.4'
}
`;
fs.writeFileSync(appGradle, ag);
console.log('patched android project');
