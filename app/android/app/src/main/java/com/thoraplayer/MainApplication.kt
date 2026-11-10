package com.thoraplayer

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(PlaybackControlPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // First: the crash handler and exit-reason log must cover everything that follows.
    ThoraDiagnostics.init(this)
    loadReactNative(this)
  }
}
