import AppKit

/// Temporary menu-bar stop control shown for the lifetime of a recording.
/// Its sizing and symbol treatment mirror Super/Snap's RecordingStopStatusItem.
@MainActor
final class RecordingStatusItem: NSObject, NSPopoverDelegate {
    static let shared = RecordingStatusItem()

    private var statusItem: NSStatusItem?
    private var popover: NSPopover?
    private var dismissItem: DispatchWorkItem?
    private var onStop: (() -> Void)?

    private static let popoverDuration: TimeInterval = 2
    private static let horizontalPadding: CGFloat = 12
    private static let verticalPadding: CGFloat = 8

    private override init() {
        super.init()
    }

    func show(message: String, onStop: @escaping () -> Void) {
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
        presentPopover(message: message, relativeTo: button)
    }

    func hide() {
        dismissItem?.cancel()
        dismissItem = nil
        popover?.close()
        popover = nil
        onStop = nil

        if let statusItem {
            NSStatusBar.system.removeStatusItem(statusItem)
            self.statusItem = nil
        }
    }

    func popoverDidClose(_ notification: Notification) {
        if popover === notification.object as? NSPopover {
            dismissItem?.cancel()
            dismissItem = nil
            popover = nil
        }
    }

    @objc private func stopRecording(_ sender: Any?) {
        let stop = onStop
        hide()
        stop?()
    }

    private func presentPopover(message: String, relativeTo button: NSStatusBarButton) {
        let content = Self.makeContent(message: message)
        let container = NSView(frame: content.frame)
        container.addSubview(content)

        let popover = NSPopover()
        popover.behavior = .transient
        popover.animates = true
        popover.delegate = self
        let contentController = NSViewController()
        contentController.view = container
        popover.contentViewController = contentController
        self.popover = popover

        // A newly created NSStatusItem needs a short beat to attach its button
        // to the menu-bar window before AppKit can anchor a popover to it.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self, weak button, weak popover] in
            guard let self, let button, let popover, self.popover === popover else {
                return
            }
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            self.scheduleDismiss()
        }
    }

    private func scheduleDismiss() {
        let work = DispatchWorkItem { [weak self] in
            self?.popover?.performClose(nil)
        }
        dismissItem?.cancel()
        dismissItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.popoverDuration, execute: work)
    }

    private static func makeContent(message: String) -> NSView {
        let suffix = "started"
        let prefix = message.hasSuffix(suffix)
            ? String(message.dropLast(suffix.count))
            : message
        let text = NSMutableAttributedString(
            string: prefix,
            attributes: [
                .font: NSFont.menuBarFont(ofSize: 0),
                .foregroundColor: NSColor.labelColor,
            ]
        )
        if message.hasSuffix(suffix) {
            text.append(
                NSAttributedString(
                    string: suffix,
                    attributes: [
                        .font: NSFont.menuBarFont(ofSize: 0),
                        .foregroundColor: NSColor.systemGreen,
                    ]
                )
            )
        }

        let label = NSTextField(labelWithAttributedString: text)
        let textSize = label.fittingSize
        label.frame = NSRect(
            x: horizontalPadding,
            y: verticalPadding,
            width: textSize.width,
            height: textSize.height
        )

        let view = NSView(
            frame: NSRect(
                x: 0,
                y: 0,
                width: textSize.width + (horizontalPadding * 2),
                height: textSize.height + (verticalPadding * 2)
            )
        )
        view.addSubview(label)
        return view
    }
}
