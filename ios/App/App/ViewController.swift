import UIKit
import Capacitor

// Enables WKWebView's native edge-swipe-back gesture. Next.js App Router uses real
// browser history (pushState), so the WebView's own back/forward list already tracks
// in-app navigation correctly once this is turned on.
class ViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        webView?.allowsBackForwardNavigationGestures = true
    }
}
