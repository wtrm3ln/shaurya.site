// A small native window around the local editor. It starts editor/server.js,
// shows it in a web view, and shuts everything down on quit.

import Cocoa
import WebKit

let appName = "Portfolio"

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var server: Process?
    private var serverInput: Pipe?
    private var editorURL: URL?
    private var outputBuffer = ""
    private var quitting = false
    private var logHandle: FileHandle?

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        buildWindow()
        guard let root = resolveSiteRoot() else {
            NSApp.terminate(nil)
            return
        }
        startServer(root: root)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // Give the page a moment to save anything still in flight.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if quitting || editorURL == nil { return .terminateNow }
        quitting = true
        var replied = false
        let finish = {
            guard !replied else { return }
            replied = true
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        webView.callAsyncJavaScript(
            "if (window.flushForQuit) await window.flushForQuit(); return true;",
            arguments: [:], in: nil, in: .page
        ) { _ in finish() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: finish)
        return .terminateLater
    }

    func applicationWillTerminate(_ notification: Notification) {
        quitting = true
        server?.terminate()
    }

    // MARK: Window

    private func buildWindow() {
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.pageZoom = CGFloat(UserDefaults.standard.object(forKey: "zoom") as? Double ?? 1.0)
        if #available(macOS 13.3, *) { webView.isInspectable = true }

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1320, height: 840),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = appName
        window.minSize = NSSize(width: 980, height: 520)
        window.backgroundColor = NSColor(calibratedWhite: 0.776, alpha: 1)
        window.contentView = webView
        window.center()
        window.setFrameAutosaveName("PortfolioMain")
        window.makeKeyAndOrderFront(nil)
        showMessage("Starting…")
    }

    private func showMessage(_ text: String) {
        let html = """
        <html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#c6c6c6;\
        font:12px Geneva,sans-serif;color:#111">\(text)</body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    private func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About \(appName)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide \(appName)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let others = appMenu.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        others.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit \(appName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)

        // Copy, paste and undo only reach a web view through an Edit menu.
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        main.addItem(editItem)

        let viewItem = NSMenuItem()
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(withTitle: "Bigger", action: #selector(zoomIn), keyEquivalent: "=")
        viewMenu.addItem(withTitle: "Smaller", action: #selector(zoomOut), keyEquivalent: "-")
        viewMenu.addItem(withTitle: "Actual Size", action: #selector(zoomReset), keyEquivalent: "0")
        viewMenu.addItem(.separator())
        viewMenu.addItem(withTitle: "Reload", action: #selector(reloadEditor), keyEquivalent: "r")
        viewItem.submenu = viewMenu
        main.addItem(viewItem)

        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowItem.submenu = windowMenu
        main.addItem(windowItem)
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = main
    }

    @objc private func zoomIn() { setZoom(webView.pageZoom + 0.1) }
    @objc private func zoomOut() { setZoom(webView.pageZoom - 0.1) }
    @objc private func zoomReset() { setZoom(1.0) }
    @objc private func reloadEditor() {
        if let url = editorURL { webView.load(URLRequest(url: url)) }
    }

    private func setZoom(_ value: CGFloat) {
        let clamped = min(2.0, max(0.7, value))
        webView.pageZoom = clamped
        UserDefaults.standard.set(Double(clamped), forKey: "zoom")
    }

    // MARK: Finding the site

    private func isSite(_ path: String) -> Bool {
        let fm = FileManager.default
        return fm.fileExists(atPath: path + "/hugo.toml") && fm.fileExists(atPath: path + "/editor/server.js")
    }

    private func resolveSiteRoot() -> String? {
        let candidates = [
            ProcessInfo.processInfo.environment["PORTFOLIO_SITE_ROOT"],
            UserDefaults.standard.string(forKey: "siteRoot"),
            Bundle.main.object(forInfoDictionaryKey: "PortfolioSiteRoot") as? String,
        ]
        for case let path? in candidates where isSite(path) { return path }

        // The site folder moved: ask once and remember the answer.
        while true {
            let panel = NSOpenPanel()
            panel.canChooseFiles = false
            panel.canChooseDirectories = true
            panel.message = "Where is your site folder? It's the one containing hugo.toml."
            panel.prompt = "Use This Folder"
            guard panel.runModal() == .OK, let path = panel.url?.path else { return nil }
            if isSite(path) {
                UserDefaults.standard.set(path, forKey: "siteRoot")
                return path
            }
        }
    }

    // MARK: Server

    private func findNode() -> String? {
        for path in ["/opt/homebrew/bin/node", "/usr/local/bin/node"]
        where FileManager.default.isExecutableFile(atPath: path) {
            return path
        }
        let shell = Process()
        shell.executableURL = URL(fileURLWithPath: "/bin/zsh")
        shell.arguments = ["-lic", "command -v node"]
        let out = Pipe()
        shell.standardOutput = out
        shell.standardError = FileHandle.nullDevice
        guard (try? shell.run()) != nil else { return nil }
        shell.waitUntilExit()
        let found = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
            .split(separator: "\n").last.map(String.init)
        return found.flatMap { FileManager.default.isExecutableFile(atPath: $0) ? $0 : nil }
    }

    private func openLog() -> FileHandle? {
        let url = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/\(appName).log")
        FileManager.default.createFile(atPath: url.path, contents: nil)
        return try? FileHandle(forWritingTo: url)
    }

    private func startServer(root: String) {
        guard let node = findNode() else {
            fail("Couldn't find Node.js. Install it with: brew install node")
            return
        }
        logHandle = logHandle ?? openLog()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [root + "/editor/server.js", "--root", root, "--watch-stdin"]
        process.currentDirectoryURL = URL(fileURLWithPath: root)
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        process.environment = env

        let input = Pipe()
        let output = Pipe()
        process.standardInput = input
        process.standardOutput = output
        process.standardError = logHandle ?? FileHandle.nullDevice
        serverInput = input

        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async { self?.handleOutput(text) }
        }
        process.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, !self.quitting else { return }
                self.fail("The editor stopped unexpectedly. Details are in ~/Library/Logs/\(appName).log")
            }
        }

        do {
            try process.run()
            server = process
        } catch {
            fail("Couldn't start the editor: \(error.localizedDescription)")
        }
    }

    private func handleOutput(_ text: String) {
        if let data = text.data(using: .utf8) { try? logHandle?.write(contentsOf: data) }
        guard editorURL == nil else { return }
        outputBuffer += text
        for line in outputBuffer.split(separator: "\n") where line.hasPrefix("READY ") {
            if let url = URL(string: String(line.dropFirst(6))) {
                editorURL = url
                webView.load(URLRequest(url: url))
            }
            return
        }
    }

    private func fail(_ message: String) {
        showMessage(message.replacingOccurrences(of: "<", with: "&lt;"))
    }

    // MARK: Web view behaviour

    private func isEditorOrPreview(_ url: URL) -> Bool {
        let host = url.host ?? ""
        return host == "127.0.0.1" || host == "localhost" || url.scheme == "about"
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? false
        if isMainFrame && !isEditorOrPreview(url) {
            if url.scheme == "http" || url.scheme == "https" { NSWorkspace.shared.open(url) }
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    // Anything that wants a new window opens in the regular browser instead.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()
