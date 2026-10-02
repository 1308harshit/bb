import UIKit
import UserNotifications
import UserNotificationsUI

private struct Mention: Decodable {
    let offset: Int
    let length: Int
}

private struct MentionPreview: Decodable {
    let title: [Mention]
    let body: [Mention]
}

final class NotificationViewController: UIViewController, UNNotificationContentExtension {
    private let titleView = UITextView()
    private let bodyView = UITextView()
    private var content: UNNotificationContent?
    private var preview: MentionPreview?
    private var renderedWidth: CGFloat = 0

    override func loadView() {
        view = UIView()
        view.backgroundColor = .clear
        for textView in [titleView, bodyView] {
            textView.isEditable = false
            textView.isSelectable = false
            textView.isScrollEnabled = false
            textView.backgroundColor = .clear
            textView.textContainerInset = .zero
            textView.textContainer.lineFragmentPadding = 0
            textView.adjustsFontForContentSizeCategory = true
            view.addSubview(textView)
        }
    }

    func didReceive(_ notification: UNNotification) {
        content = notification.request.content
        let data = content?.userInfo["body"] as? [String: Any] ?? content?.userInfo
        preview = (data?["mentionPreview"] as? String)
            .flatMap { $0.data(using: .utf8) }
            .flatMap { try? JSONDecoder().decode(MentionPreview.self, from: $0) }
        renderedWidth = 0
        view.setNeedsLayout()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        guard let content, view.bounds.width > 32 else { return }
        let width = view.bounds.width - 32
        if renderedWidth != width {
            renderedWidth = width
            titleView.attributedText = formatted(content.title, mentions: preview?.title ?? [], font: .preferredFont(forTextStyle: .headline), width: width)
            bodyView.attributedText = formatted(content.body, mentions: preview?.body ?? [], font: .preferredFont(forTextStyle: .body), width: width)
            titleView.accessibilityLabel = content.title
            bodyView.accessibilityLabel = content.body
        }
        let titleHeight = titleView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
        let bodyHeight = bodyView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
        titleView.frame = CGRect(x: 16, y: 12, width: width, height: titleHeight)
        bodyView.frame = CGRect(x: 16, y: 20 + titleHeight, width: width, height: bodyHeight)
        preferredContentSize = CGSize(width: view.bounds.width, height: 32 + titleHeight + bodyHeight)
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        renderedWidth = 0
        view.setNeedsLayout()
    }

    private func formatted(_ text: String, mentions: [Mention], font: UIFont, width: CGFloat) -> NSAttributedString {
        let source = text as NSString
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = 5
        let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor.label, .paragraphStyle: paragraph]
        let result = NSMutableAttributedString(string: "")
        var cursor = 0
        for mention in mentions.prefix(100) {
            guard mention.offset >= cursor, mention.length > 0,
                  mention.offset <= source.length, mention.length <= source.length - mention.offset else { continue }
            result.append(NSAttributedString(string: source.substring(with: NSRange(location: cursor, length: mention.offset - cursor)), attributes: attributes))
            let label = source.substring(with: NSRange(location: mention.offset, length: mention.length))
            let attachment = NSTextAttachment()
            let image = pill(label, font: font, maxWidth: width)
            attachment.image = image
            attachment.bounds = CGRect(x: 0, y: font.descender - 3, width: image.size.width, height: image.size.height)
            result.append(NSAttributedString(attachment: attachment))
            cursor = mention.offset + mention.length
        }
        result.append(NSAttributedString(string: source.substring(from: cursor), attributes: attributes))
        result.addAttribute(.paragraphStyle, value: paragraph, range: NSRange(location: 0, length: result.length))
        return result
    }

    private func pill(_ label: String, font: UIFont, maxWidth: CGFloat) -> UIImage {
        let iconSize = font.pointSize
        let labelWidth = (label as NSString).size(withAttributes: [.font: font]).width
        let size = CGSize(width: min(maxWidth, ceil(labelWidth + iconSize + 26)), height: ceil(font.lineHeight + 8))
        return UIGraphicsImageRenderer(size: size).image { _ in
            UIColor.secondarySystemFill.setFill()
            UIBezierPath(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: size.height / 2).fill()
            let icon = UIImage(systemName: "text.bubble", withConfiguration: UIImage.SymbolConfiguration(pointSize: iconSize, weight: .medium))?.withTintColor(.secondaryLabel, renderingMode: .alwaysOriginal)
            icon?.draw(in: CGRect(x: 9, y: (size.height - iconSize) / 2, width: iconSize, height: iconSize))
            let paragraph = NSMutableParagraphStyle()
            paragraph.lineBreakMode = .byTruncatingTail
            (label as NSString).draw(in: CGRect(x: iconSize + 15, y: 4, width: size.width - iconSize - 24, height: font.lineHeight), withAttributes: [.font: font, .foregroundColor: UIColor.label, .paragraphStyle: paragraph])
        }
    }
}
