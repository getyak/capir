// swift-tools-version:6.2
import PackageDescription

let package = Package(
    name: "InstallerLayout",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/sindresorhus/DSStore", exact: "1.0.0"),
    ],
    targets: [
        .executableTarget(name: "InstallerLayout", dependencies: ["DSStore"]),
    ]
)
