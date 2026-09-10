import Foundation
import Capacitor
import UIKit

/// iOS half of the deferred invite (see android/.../DeferredInvitePlugin.java for the Android
/// half and lib/deferredInvite.ts for the JS contract). Apple has no install referrer, so the
/// only first-party way for an invite to survive an App Store install is the pasteboard:
/// MobileAppGate copies the full invite URL (https://app.mybarbets.com/join/XXXX?src=qr) to the
/// clipboard when someone taps through to the App Store, and this reads it back on first open.
///
/// Two guards keep that read honest:
/// - It only happens within 24 hours of install (the app container's creation date). Reading
///   the pasteboard programmatically shows the system "paste from Safari" prompt on iOS 16+,
///   which is acceptable on a brand-new install that a QR scan just led to and unacceptable as
///   a surprise on an existing one. The JS side's run-once stamp makes it happen at most once
///   either way; this is what keeps that one time from landing on a long-standing install the
///   first time the web layer ships this code.
/// - detectPatterns is asked first whether the pasteboard even looks like a web URL. That check
///   does not read the contents and shows no prompt, so a pasteboard holding anything else
///   never triggers one.
///
/// Registered in ViewController.capacitorDidLoad(). Not verified on a device by the author of
/// this file; see the manual test steps in the PR.
@objc(DeferredInvitePlugin)
public class DeferredInvitePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DeferredInvitePlugin"
    public let jsName = "DeferredInvite"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise)
    ]

    private static let freshInstallWindow: TimeInterval = 24 * 60 * 60

    @objc func read(_ call: CAPPluginCall) {
        guard Self.isFreshInstall(), UIPasteboard.general.hasStrings else {
            call.resolve([:])
            return
        }

        UIPasteboard.general.detectPatterns(for: [.probableWebURL]) { result in
            switch result {
            case .success(let patterns) where patterns.contains(.probableWebURL):
                if let value = UIPasteboard.general.string {
                    call.resolve(["value": value])
                } else {
                    call.resolve([:])
                }
            default:
                call.resolve([:])
            }
        }
    }

    /// The Documents directory is created with the app container at install time, so its
    /// creation date is the closest thing to an install timestamp the app can see on its own.
    private static func isFreshInstall() -> Bool {
        guard let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first,
              let attributes = try? FileManager.default.attributesOfItem(atPath: documents.path),
              let created = attributes[.creationDate] as? Date else {
            return false
        }
        return Date().timeIntervalSince(created) < freshInstallWindow
    }
}
