// Draws the Dock icon: a grey, hard-edged sheet of paper on a grey plate.
// Usage: make-icon <output.png>

import Cocoa

let size = 1024
let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4,
    hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
)!
let ctx = NSGraphicsContext(bitmapImageRep: rep)!.cgContext
ctx.setShouldAntialias(false)

func grey(_ value: CGFloat) -> CGColor { CGColor(red: value, green: value, blue: value, alpha: 1) }
func fill(_ value: CGFloat, _ x: Int, _ y: Int, _ w: Int, _ h: Int) {
    ctx.setFillColor(grey(value))
    ctx.fill(CGRect(x: x, y: size - y - h, width: w, height: h)) // top-left origin
}

let ink: CGFloat = 0.07

// Plate with a bevel.
fill(0.70, 0, 0, size, size)
fill(0.92, 0, 0, size, 28)
fill(0.92, 0, 0, 28, size)
fill(0.42, 0, size - 28, size, 28)
fill(0.42, size - 28, 0, 28, size)

// Paper: hard shadow, outline, sheet.
let x = 232, y = 164, w = 560, h = 696, line = 24, fold = 150
fill(ink, x + 36, y + 36, w, h)
fill(ink, x - line, y - line, w + line * 2, h + line * 2)
fill(0.94, x, y, w, h)

// Folded corner, stepped like a low-resolution diagonal.
let step = 30
for i in 0..<(fold / step) {
    let inset = fold - i * step
    fill(0.70, x + w - inset, y - line + i * step, inset + line, step)
}
for i in 0..<(fold / step) {
    let px = x + w - fold + i * step
    fill(ink, px, y + i * step - line + 2, step + 2, line)
}
fill(0.78, x + w - fold, y, line, fold)
fill(0.78, x + w - fold, y + fold - line, fold, line)
fill(ink, x + w - fold, y + fold, fold + line, line)
fill(ink, x + w - fold - line, y, line, fold + line)

// Heading and lines of text.
fill(ink, x + 64, y + 96, 240, 56)
for (i, width) in [432, 432, 348, 432, 288].enumerated() {
    fill(0.34, x + 64, y + 236 + i * 76, width, 28)
}

// Blinking-cursor block.
fill(ink, x + 64 + 288 + 22, y + 236 + 4 * 76 - 14, 28, 56)

let png = rep.representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
