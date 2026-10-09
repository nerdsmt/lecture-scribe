import AVFoundation
import ScreenCaptureKit

/// Captures system audio (every app: Zoom, Teams, Meet, …) and/or the microphone, mixes them to mono,
/// cuts 30 s AAC chunks and uploads each to the local Lecture Scribe server for transcription.
final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate {
    enum Source: String, CaseIterable { case system = "System audio (Zoom, Teams, any app)", mic = "Microphone only", both = "System audio + microphone" }

    struct Settings { var serverURL: String; var token: String; var language: String }
    struct Meta { var title: String; var course: String; var terms: String; var docId: String }

    private let q = DispatchQueue(label: "lecturescribe.recorder")
    private let rate = 24000.0, chunkSeconds = 30.0
    private var stream: SCStream?
    private var engine: AVAudioEngine?   // created per recording, after microphone access is granted
    private var sysRS = MonoResampler(), micRS = MonoResampler()
    private var sysBuf: [Float] = [], micBuf: [Float] = []
    private var micGain: Float = 1   // automatic volume boost for quiet microphones
    private var tick: DispatchSourceTimer?, chunkTimer: DispatchSourceTimer?
    private var writer: AVAudioFile?, chunkURL: URL?, chunkOffset = 0.0
    private var settings = Settings(serverURL: "", token: "", language: "auto")
    private(set) var sessionId = ""
    private var n = 0, t0 = Date(), pausedAt: Date?, pausedTotal = 0.0
    private var source: Source = .both
    private let uploads = DispatchGroup()
    private(set) var running = false, paused = false
    var onProblem: ((String) -> Void)?
    var startedAt: Date { t0 }

    // MARK: lifecycle
    func start(source: Source, meta: Meta, settings: Settings) async throws {
        self.source = source; self.settings = settings
        if source != .system, !(await AVCaptureDevice.requestAccess(for: .audio)) { throw RecError("Microphone access was denied. Allow it in System Settings → Privacy & Security → Microphone.") }
        sessionId = String((0..<20).map { _ in "0123456789abcdef".randomElement()! })
        n = 0; pausedTotal = 0; paused = false; sysBuf = []; micBuf = []; micGain = 1; t0 = Date()

        if source != .mic {
            let content: SCShareableContent
            do { content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false) }
            catch { throw RecError("Screen & System Audio Recording permission is needed to hear other apps. Allow “LectureScribe” in System Settings → Privacy & Security → Screen & System Audio Recording, then try again.") }
            guard let display = content.displays.first else { throw RecError("No display found.") }
            let cfg = SCStreamConfiguration()
            cfg.capturesAudio = true; cfg.excludesCurrentProcessAudio = true
            cfg.sampleRate = 48000; cfg.channelCount = 2
            cfg.width = 2; cfg.height = 2; cfg.minimumFrameInterval = CMTime(value: 1, timescale: 1) // we only want audio
            let s = SCStream(filter: SCContentFilter(display: display, excludingWindows: []), configuration: cfg, delegate: self)
            try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: q)
            try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: q)
            try await s.startCapture(); stream = s
        }
        if source != .system {
            let eng = AVAudioEngine()        // new engine: an engine made before permission has a dead (0 Hz) input
            let input = eng.inputNode
            let fmt = input.outputFormat(forBus: 0)
            guard fmt.sampleRate > 0, fmt.channelCount > 0 else {
                await stopStream()
                throw RecError("No working microphone input was found (format \(fmt)). Check System Settings → Sound → Input, and that LectureScribe is allowed under Privacy & Security → Microphone.")
            }
            input.installTap(onBus: 0, bufferSize: 4096, format: fmt) { [weak self] buf, _ in
                guard let self else { return }
                let samples = self.micRS.convert(buf)
                self.q.async { if !self.paused { self.micBuf += samples } }
            }
            eng.prepare()
            do { try eng.start() } catch { input.removeTap(onBus: 0); await stopStream(); throw RecError("Could not start the microphone: \(error.localizedDescription)") }
            engine = eng
        }
        try await put(meta: meta)
        q.sync {
            running = true; openChunk()
            let t = DispatchSource.makeTimerSource(queue: q); t.schedule(deadline: .now() + 0.25, repeating: 0.25)
            t.setEventHandler { [weak self] in self?.mix() }; t.resume(); tick = t
            let c = DispatchSource.makeTimerSource(queue: q); c.schedule(deadline: .now() + chunkSeconds, repeating: chunkSeconds)
            c.setEventHandler { [weak self] in self?.rotate(startNext: true) }; c.resume(); chunkTimer = c
        }
    }

    private func stopStream() async { try? await stream?.stopCapture(); stream = nil }

    func pause() { q.sync {
        guard running, !paused else { return }
        mix(); rotate(startNext: false); paused = true; pausedAt = Date()
    } }

    func resume() { q.sync {
        guard running, paused else { return }
        pausedTotal += Date().timeIntervalSince(pausedAt ?? Date()); paused = false; sysBuf = []; micBuf = []; openChunk()
    } }

    func stop(completion: @escaping () -> Void) {
        q.sync {
            guard running else { return }
            mix(); rotate(startNext: false); running = false
            tick?.cancel(); chunkTimer?.cancel(); tick = nil; chunkTimer = nil
        }
        if let e = engine { e.inputNode.removeTap(onBus: 0); e.stop(); engine = nil }
        Task {
            try? await stream?.stopCapture(); stream = nil
            uploads.notify(queue: .main, execute: completion)
        }
    }

    // MARK: SCStreamOutput
    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sb.isValid, CMSampleBufferGetNumSamples(sb) > 0, let pcm = Self.pcm(from: sb) else { return }
        let samples = sysRS.convert(pcm)
        q.async { if !self.paused { self.sysBuf += samples } }
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) { onProblem?("System audio capture stopped: \(error.localizedDescription)") }

    private static func pcm(from sb: CMSampleBuffer) -> AVAudioPCMBuffer? {
        guard let fd = CMSampleBufferGetFormatDescription(sb), let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(fd) else { return nil }
        var a = asbd.pointee
        guard let fmt = AVAudioFormat(streamDescription: &a) else { return nil }
        let frames = AVAudioFrameCount(CMSampleBufferGetNumSamples(sb))
        guard let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: frames) else { return nil }
        buf.frameLength = frames
        let st = CMSampleBufferCopyPCMDataIntoAudioBufferList(sb, at: 0, frameCount: Int32(frames), into: buf.mutableAudioBufferList)
        return st == noErr ? buf : nil
    }

    // MARK: mixing + chunking (always on q)
    private func mix() {
        guard writer != nil else { return }
        let count = max(sysBuf.count, micBuf.count); guard count > 0 else { return }
        var out = [Float](repeating: 0, count: count)
        for i in 0..<sysBuf.count { out[i] += sysBuf[i] }
        agc(&micBuf)
        for i in 0..<micBuf.count { out[i] += micBuf[i] }
        for i in 0..<count { out[i] = max(-1, min(1, out[i])) }
        sysBuf.removeAll(keepingCapacity: true); micBuf.removeAll(keepingCapacity: true)
        guard let fmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 1, interleaved: false),
              let b = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(count)) else { return }
        b.frameLength = AVAudioFrameCount(count); out.withUnsafeBufferPointer { b.floatChannelData![0].update(from: $0.baseAddress!, count: count) }
        try? writer?.write(from: b)
    }

    /// Slowly adapts the microphone gain towards a comfortable speech level (up to 12x). Only adapts when a
    /// window is clearly louder than room noise, so silence and background hiss are not pumped up.
    private func agc(_ s: inout [Float]) {
        guard !s.isEmpty else { return }
        var sum: Float = 0; for v in s { sum += v * v }
        let rms = (sum / Float(s.count)).squareRoot()
        if rms > 0.004 {
            let desired = min(12, max(1, 0.1 / rms))
            micGain += (desired - micGain) * (desired < micGain ? 0.5 : 0.15)   // drop fast when it gets loud, rise slowly
        }
        for i in s.indices { s[i] = max(-1, min(1, s[i] * micGain)) }
    }

    private func openChunk() {
        chunkOffset = Date().timeIntervalSince(t0) - pausedTotal
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("ls-\(sessionId)-\(n).m4a")
        let settings: [String: Any] = [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: rate, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 48000]
        writer = try? AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
        chunkURL = url
    }

    private func rotate(startNext: Bool) {
        mix()
        let url = chunkURL, idx = n, off = chunkOffset
        writer = nil; chunkURL = nil              // closing the file finalises the AAC container
        if let url { upload(url, n: idx, offset: off) }
        n += 1
        if startNext { openChunk() }
    }

    // MARK: network
    private func request(_ path: String, method: String, body: Data?, type: String) -> URLRequest {
        var r = URLRequest(url: URL(string: settings.serverURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path)!)
        r.httpMethod = method; r.httpBody = body; r.timeoutInterval = 600
        r.setValue("Bearer \(settings.token)", forHTTPHeaderField: "Authorization"); r.setValue(type, forHTTPHeaderField: "Content-Type")
        return r
    }

    private func put(meta: Meta) async throws {
        var m: [String: Any] = ["title": meta.title, "course": meta.course, "terms": meta.terms, "startedAt": Int(t0.timeIntervalSince1970 * 1000)]
        if !meta.docId.isEmpty { m["docId"] = meta.docId }
        let (_, resp) = try await URLSession.shared.data(for: request("/sessions/\(sessionId)", method: "PUT", body: try JSONSerialization.data(withJSONObject: m), type: "application/json"))
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw RecError("Cannot reach the Lecture Scribe server (is start.sh running?).") }
    }

    private func upload(_ url: URL, n: Int, offset: Double, attempt: Int = 0) {
        guard let data = try? Data(contentsOf: url), data.count > 1000 else { try? FileManager.default.removeItem(at: url); return }
        if attempt == 0 { uploads.enter() }
        let path = "/sessions/\(sessionId)/chunks/\(n)?offset=\(String(format: "%.1f", offset))&lang=\(settings.language)&ext=m4a"
        URLSession.shared.dataTask(with: request(path, method: "POST", body: data, type: "audio/mp4")) { [weak self] _, resp, _ in
            guard let self else { return }
            if (resp as? HTTPURLResponse)?.statusCode == 200 || attempt >= 6 {
                if attempt >= 6 { self.onProblem?("Part \(n) could not be uploaded; kept at \(url.path)") } else { try? FileManager.default.removeItem(at: url) }
                self.uploads.leave()
            } else {
                self.q.asyncAfter(deadline: .now() + 2 * pow(2, Double(attempt))) { self.upload(url, n: n, offset: offset, attempt: attempt + 1) }
            }
        }.resume()
    }
}

struct RecError: LocalizedError { let message: String; init(_ m: String) { message = m }; var errorDescription: String? { message } }

/// Downmixes any PCM buffer to mono and resamples it to 24 kHz Float32.
final class MonoResampler {
    private let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24000, channels: 1, interleaved: false)!
    private var conv: AVAudioConverter?, key = ""

    func convert(_ buf: AVAudioPCMBuffer) -> [Float] {
        guard let data = buf.floatChannelData, buf.frameLength > 0 else { return [] }
        let frames = Int(buf.frameLength), ch = Int(buf.format.channelCount), inter = buf.format.isInterleaved, stride = buf.stride
        guard let monoFmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: buf.format.sampleRate, channels: 1, interleaved: false),
              let mono = AVAudioPCMBuffer(pcmFormat: monoFmt, frameCapacity: buf.frameLength) else { return [] }
        mono.frameLength = buf.frameLength
        let dst = mono.floatChannelData![0]
        for i in 0..<frames {
            var sum: Float = 0
            for c in 0..<ch { sum += (inter ? data[0] + c : data[c])[i * stride] }
            dst[i] = sum / Float(ch)
        }
        let k = "\(monoFmt.sampleRate)"
        if conv == nil || k != key { conv = AVAudioConverter(from: monoFmt, to: target); key = k }
        guard let c = conv else { return [] }
        let cap = AVAudioFrameCount(Double(frames) * 24000 / monoFmt.sampleRate) + 64
        guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: cap) else { return [] }
        var given = false; var err: NSError?
        c.convert(to: out, error: &err) { _, status in
            if given { status.pointee = .noDataNow; return nil }
            given = true; status.pointee = .haveData; return mono
        }
        if err != nil { return [] }
        return Array(UnsafeBufferPointer(start: out.floatChannelData![0], count: Int(out.frameLength)))
    }
}
