import AppKit

/// Temporary menu-bar stop control shown for the lifetime of a recording.
/// Its sizing and symbol treatment mirror Super/Snap's RecordingStopStatusItem.
@MainActor
final class RecordingStatusItem: NSObject {
    static let shared = RecordingStatusItem()

    private var statusItem: NSStatusItem?
    private var onStop: (() -> Void)?

    private override init() {
        super.init()
    }

    func show(onStop: @escaping () -> Void) {
        hide()
        self.onStop = onStop

        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        guard let button = item.button else {
            NSStatusBar.system.removeStatusItem(item)
            self.onStop = nil
            return
        }

        let symbol = NSImage(
            systemSymbolName: "stop.circle.fill",
            accessibilityDescription: "Stop recording"
        )
        let configured = symbol?.withSymbolConfiguration(
            NSImage.SymbolConfiguration(pointSize: 15, weight: .medium)
        )
        configured?.isTemplate = true
        button.image = configured
        button.toolTip = "Stop recording"
        button.setAccessibilityLabel("Stop recording")
        button.target = self
        button.action = #selector(stopRecording(_:))
        button.sendAction(on: [.leftMouseUp])

        statusItem = item
    }

    func hide() {
        onStop = nil

        if let statusItem {
            NSStatusBar.system.removeStatusItem(statusItem)
            self.statusItem = nil
        }
    }

    @objc private func stopRecording(_ sender: Any?) {
        let stop = onStop
        hide()
        stop?()
    }
}
