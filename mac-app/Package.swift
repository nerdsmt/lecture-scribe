// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "LectureScribeMac",
    platforms: [.macOS(.v13)],
    targets: [.executableTarget(name: "LectureScribeMac", path: "Sources/LectureScribeMac")]
)
