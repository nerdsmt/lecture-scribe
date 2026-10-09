import AppKit
import IOKit.pwr_mgt

final class AppDelegate: NSObject, NSApplicationDelegate, NSComboBoxDelegate, NSTextFieldDelegate {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let rec = Recorder()
    private var ticker: Timer?
    private var awake: IOPMAssertionID = 0
    private let d = UserDefaults.standard
    private var panel: NSPanel!
    private var courseMap: [String: String] = [:]
    private weak var courseBox: NSComboBox?
    private weak var termsField: NSTextField?
    private let status = NSTextField(labelWithString: "Ready")
    private let startBtn = NSButton(title: "● Start…", target: nil, action: nil)
    private let pauseBtn = NSButton(title: "⏸ Pause", target: nil, action: nil)
    private let stopBtn = NSButton(title: "■ Stop", target: nil, action: nil)

    func applicationDidFinishLaunching(_ n: Notification) {
        d.register(defaults: ["serverURL": "http://localhost:8787", "token": "", "language": "auto", "source": Recorder.Source.both.rawValue])
        rec.onProblem = { [weak self] msg in DispatchQueue.main.async { self?.alert("Lecture Scribe", msg) } }
        buildPanel()
        refresh()
        // First launch: there is no token yet. Ask for it (or import it from the server's config.json).
        if (d.string(forKey: "token") ?? "").isEmpty { DispatchQueue.main.async { [weak self] in self?.showSettings(firstRun: true) } }
    }

    // The menu-bar icon can be hidden when the menu bar is crowded (macOS adds its own mic indicator),
    // so there is also a small always-on-top control window and a Dock icon with the same menu.
    private func buildPanel() {
        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 300, height: 92), styleMask: [.titled, .closable, .utilityWindow], backing: .buffered, defer: false)
        panel.title = "Lecture Scribe"; panel.level = .floating; panel.isReleasedWhenClosed = false; panel.hidesOnDeactivate = false
        status.font = .monospacedDigitSystemFont(ofSize: 15, weight: .medium); status.alignment = .center
        startBtn.target = self; startBtn.action = #selector(start)
        pauseBtn.target = self; pauseBtn.action = #selector(togglePause)
        stopBtn.target = self; stopBtn.action = #selector(stop)
        let row = NSStackView(views: [startBtn, pauseBtn, stopBtn]); row.spacing = 8
        let col = NSStackView(views: [status, row]); col.orientation = .vertical; col.spacing = 10
        col.edgeInsets = NSEdgeInsets(top: 12, left: 16, bottom: 12, right: 16)
        panel.contentView = col
        if let screen = NSScreen.main { panel.setFrameTopLeftPoint(NSPoint(x: screen.visibleFrame.maxX - 320, y: screen.visibleFrame.maxY - 20)) }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { panel.orderFrontRegardless(); return true }
    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? { item.menu }
    @objc private func showPanel() { panel.orderFrontRegardless() }

    // MARK: menu
    private func refresh() {
        let b = item.button
        if rec.running {
            // Coloured text drawn explicitly (a tinted image made the system render dark-on-dark).
            let t = Int(Date().timeIntervalSince(rec.startedAt))
            let font = NSFont.monospacedDigitSystemFont(ofSize: 13, weight: .semibold)
            let dot = NSAttributedString(string: rec.paused ? "⏸ " : "● ", attributes: [.foregroundColor: rec.paused ? NSColor.systemOrange : NSColor.systemRed, .font: font])
            let time = NSAttributedString(string: rec.paused ? "Paused" : String(format: "%d:%02d:%02d", t / 3600, t % 3600 / 60, t % 60), attributes: [.foregroundColor: NSColor.labelColor, .font: font])
            let full = NSMutableAttributedString(attributedString: dot); full.append(time)
            b?.image = nil; b?.contentTintColor = nil; b?.attributedTitle = full
        } else {
            b?.attributedTitle = NSAttributedString(string: ""); b?.title = ""
            b?.image = NSImage(systemSymbolName: "mic.circle", accessibilityDescription: "Lecture Scribe"); b?.contentTintColor = nil
        }
        let t2 = Int(Date().timeIntervalSince(rec.startedAt))
        status.stringValue = rec.running ? (rec.paused ? "⏸ Paused" : String(format: "🔴 Recording %d:%02d:%02d", t2 / 3600, t2 % 3600 / 60, t2 % 60)) : "Ready"
        startBtn.isEnabled = !rec.running; pauseBtn.isEnabled = rec.running; stopBtn.isEnabled = rec.running
        pauseBtn.title = rec.paused ? "▶ Resume" : "⏸ Pause"
        let m = NSMenu()
        if rec.running {
            m.addItem(withTitle: "Stop recording", action: #selector(stop), keyEquivalent: "").target = self
            m.addItem(withTitle: rec.paused ? "Resume" : "Pause", action: #selector(togglePause), keyEquivalent: "").target = self
        } else {
            m.addItem(withTitle: "Start recording…", action: #selector(start), keyEquivalent: "").target = self
        }
        m.addItem(.separator())
        m.addItem(withTitle: "Show control window", action: #selector(showPanel), keyEquivalent: "").target = self
        m.addItem(withTitle: "Open export folder", action: #selector(openFolder), keyEquivalent: "").target = self
        m.addItem(withTitle: "Server settings…", action: #selector(settings), keyEquivalent: "").target = self
        m.addItem(.separator())
        m.addItem(withTitle: "Quit", action: #selector(quit), keyEquivalent: "q").target = self
        item.menu = m
    }

    private func alert(_ title: String, _ text: String) {
        NSApp.activate(ignoringOtherApps: true)
        let a = NSAlert(); a.messageText = title; a.informativeText = text; a.runModal()
    }

    // MARK: saved course term lists
    private func serverRequest(_ path: String, method: String = "GET", body: Data? = nil) -> URLRequest {
        let base = (d.string(forKey: "serverURL") ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        var r = URLRequest(url: URL(string: base + path)!); r.httpMethod = method; r.httpBody = body; r.timeoutInterval = 3
        r.setValue("Bearer \(d.string(forKey: "token") ?? "")", forHTTPHeaderField: "Authorization"); return r
    }
    private func fetchCourses() -> [String: String] {
        var out: [String: String] = [:]; let sem = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: serverRequest("/courses")) { data, _, _ in
            if let data, let j = try? JSONSerialization.jsonObject(with: data) as? [String: String] { out = j }; sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + 3); return out
    }
    private func saveCourse(_ name: String, terms: String) {
        guard let enc = name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed), let body = try? JSONSerialization.data(withJSONObject: ["terms": terms]) else { return }
        URLSession.shared.dataTask(with: serverRequest("/courses/" + enc, method: "PUT", body: body)).resume()
    }
    func comboBoxSelectionDidChange(_ n: Notification) {   // picking a saved course fills its terms
        guard let box = courseBox, let name = box.objectValueOfSelectedItem as? String, let t = courseMap[name], let tf = termsField, tf.stringValue.isEmpty else { return }
        tf.stringValue = t
    }
    func controlTextDidEndEditing(_ n: Notification) {      // typed course name that matches a saved one
        guard let box = courseBox, let tf = termsField, tf.stringValue.isEmpty, let t = courseMap[box.stringValue.trimmingCharacters(in: .whitespaces)] else { return }
        tf.stringValue = t
    }

    // MARK: actions
    @objc private func start() {
        NSApp.activate(ignoringOtherApps: true)
        if (d.string(forKey: "token") ?? "").isEmpty { showSettings(firstRun: true); return }
        if !d.bool(forKey: "consentAck") {   // shown once, before the first recording
            let c = NSAlert(); c.messageText = "Before you record"
            c.informativeText = "Only record where you have permission. Laws and course rules about recording differ by country and by school, and many lecturers must agree first.\n\nKeep recordings for your own study and do not share them. Transcripts stay on this Mac unless you turn on an optional export. AI tools can make mistakes, so check anything important against the lecture."
            c.addButton(withTitle: "I understand"); c.addButton(withTitle: "Cancel")
            guard c.runModal() == .alertFirstButtonReturn else { return }
            d.set(true, forKey: "consentAck")
        }
        let a = NSAlert(); a.messageText = "Start recording"; a.informativeText = "Everything is transcribed on this Mac."
        a.addButton(withTitle: "Start"); a.addButton(withTitle: "Cancel")
        courseMap = fetchCourses()
        let title = field("Lecture title"), terms = field("Course terms (spelling help; saved for the course)"), doc = field("Live Google Doc link (optional)")
        let course = NSComboBox(); course.placeholderString = "Course (pick a saved one or type a new one)"; course.completes = true; course.numberOfVisibleItems = 10
        course.addItems(withObjectValues: courseMap.keys.sorted()); course.delegate = self; courseBox = course; termsField = terms; terms.delegate = self
        let src = NSPopUpButton(frame: .zero, pullsDown: false); src.addItems(withTitles: Recorder.Source.allCases.map(\.rawValue)); src.selectItem(withTitle: d.string(forKey: "source") ?? "")
        let stack = NSStackView(views: [title, course, terms, doc, src]); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 8
        stack.frame = NSRect(x: 0, y: 0, width: 340, height: 5 * 28 + 4 * 8)
        title.widthAnchor.constraint(equalToConstant: 340).isActive = true; [course, terms, doc, src].forEach { $0.widthAnchor.constraint(equalToConstant: 340).isActive = true }
        a.accessoryView = stack; a.window.initialFirstResponder = title
        guard a.runModal() == .alertFirstButtonReturn else { return }
        let source = Recorder.Source.allCases.first { $0.rawValue == src.titleOfSelectedItem } ?? .both
        d.set(source.rawValue, forKey: "source")
        let link = doc.stringValue
        let docId = link.range(of: "/d/([\\w-]+)", options: .regularExpression).map { String(link[$0]).dropFirst(3) }.map(String.init) ?? ""
        let name = title.stringValue.isEmpty ? "Lecture " + DateFormatter.localizedString(from: Date(), dateStyle: .short, timeStyle: .short) : title.stringValue
if !course.stringValue.trimmingCharacters(in: .whitespaces).isEmpty && !terms.stringValue.isEmpty { saveCourse(course.stringValue.trimmingCharacters(in: .whitespaces), terms: terms.stringValue) }
        let meta = Recorder.Meta(title: name, course: course.stringValue, terms: terms.stringValue, docId: docId)
        let s = Recorder.Settings(serverURL: d.string(forKey: "serverURL")!, token: d.string(forKey: "token")!, language: d.string(forKey: "language")!)
        item.button?.title = " Starting…"
        Task { @MainActor in
            do {
                try await rec.start(source: source, meta: meta, settings: s)
                IOPMAssertionCreateWithName(kIOPMAssertionTypeNoIdleSleep as CFString, IOPMAssertionLevel(kIOPMAssertionLevelOn), "Lecture Scribe recording" as CFString, &awake)
                ticker = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.refresh() }
            } catch { alert("Could not start", error.localizedDescription) }
            refresh()
        }
    }

    @objc private func togglePause() { rec.paused ? rec.resume() : rec.pause(); refresh() }

    @objc private func stop() {
        item.button?.title = " Finishing uploads…"
        rec.stop { [weak self] in
            guard let self else { return }
            self.ticker?.invalidate(); if self.awake != 0 { IOPMAssertionRelease(self.awake); self.awake = 0 }
            self.refresh()
        }
    }

    // The export folder is optional and chosen in the extension Options; the server knows it.
    @objc private func openFolder() {
        var dir = ""; let sem = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: serverRequest("/config")) { data, _, _ in
            if let data, let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let e = j["exportDir"] as? String { dir = e }; sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + 3)
        if dir.isEmpty { alert("Lecture Scribe", "No export folder is set. Choose one in the extension Options (optional), or find your lectures in local-server/data.") }
        else { try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true); NSWorkspace.shared.open(URL(fileURLWithPath: dir)) }
    }

    @objc private func settings() { showSettings(firstRun: false) }

    // Reads token and port from the server's config.json so nothing has to be copied by hand.
    @objc private func importConfig() {
        let p = NSOpenPanel(); p.title = "Choose local-server/config.json"; p.allowedContentTypes = [.json]; p.canChooseDirectories = false
        guard p.runModal() == .OK, let u = p.url, let data = try? Data(contentsOf: u), let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let t = j["token"] as? String, !t.isEmpty else {
            if p.url != nil { alert("Lecture Scribe", "That file has no token. Start the server once (or run install.sh) so it creates config.json.") }
            return
        }
        d.set(t, forKey: "token")
        if let port = j["port"] as? Int { d.set("http://localhost:\(port)", forKey: "serverURL") }
        alert("Lecture Scribe", "Token imported.")
    }

    private func showSettings(firstRun: Bool) {
        NSApp.activate(ignoringOtherApps: true)
        let a = NSAlert(); a.messageText = firstRun ? "Connect to the local server" : "Server settings"
        a.informativeText = "The local server started by start.sh. It shows a token the first time it runs: paste it here, or import local-server/config.json."
        a.addButton(withTitle: "Save"); a.addButton(withTitle: "Cancel"); a.addButton(withTitle: "Import config.json…")
        let url = field("Server URL"), tok = field("Token"), lang = field("Language (auto, en, es, fr …)")
        url.stringValue = d.string(forKey: "serverURL")!; tok.stringValue = d.string(forKey: "token")!; lang.stringValue = d.string(forKey: "language")!
        let stack = NSStackView(views: [url, tok, lang]); stack.orientation = .vertical; stack.spacing = 8
        stack.frame = NSRect(x: 0, y: 0, width: 320, height: 3 * 28 + 16); [url, tok, lang].forEach { $0.widthAnchor.constraint(equalToConstant: 320).isActive = true }
        a.accessoryView = stack
        let r = a.runModal()
        if r == .alertThirdButtonReturn { importConfig(); return }
        if r == .alertFirstButtonReturn { d.set(url.stringValue, forKey: "serverURL"); d.set(tok.stringValue, forKey: "token"); d.set(lang.stringValue.isEmpty ? "auto" : lang.stringValue, forKey: "language") }
    }

    @objc private func quit() {
        guard rec.running else { NSApp.terminate(nil); return }
        alert("Recording in progress", "Stop the recording first so the last part is uploaded.")
    }

    private func field(_ placeholder: String) -> NSTextField { let f = NSTextField(); f.placeholderString = placeholder; return f }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)   // menu-bar only; "Show control window" in the menu brings the small window back
let delegate = AppDelegate()
app.delegate = delegate
app.run()
