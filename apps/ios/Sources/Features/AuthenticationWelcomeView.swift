import SwiftUI
import UIKit

/// A reversible, direct-manipulation invitation with an equivalent tap action.
struct AuthenticationWelcomeView<Content: View>: View {
    var openLab: (() -> Void)? = nil
    var needsRecovery = false
    @ViewBuilder let content: () -> Content
    @Environment(\.talentSignalReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.appLanguage) private var language
    @AppStorage("talent-signal.authentication.welcome-entered") private var hasEntered = false
    @GestureState(resetTransaction: Transaction(animation: .spring(response: 0.58, dampingFraction: 0.86)))
    private var pull: CGFloat = 0
    @State private var thresholdFeedbackArmed = true
    @State private var feedback = UIImpactFeedbackGenerator(style: .soft)

    private var motion: Animation {
        reduceMotion ? .easeOut(duration: 0.18) : .spring(response: 0.62, dampingFraction: 0.86)
    }

    var body: some View {
        GeometryReader { geometry in
            let travel = max(170, min(235, geometry.size.height * 0.28))
            let progress = hasEntered ? CGFloat(1) : AuthenticationWelcomeGesture.progress(pull: pull, travel: travel)
            let heroHeight: CGFloat = typeSize.isAccessibilitySize ? 174 : min(geometry.size.height * 0.43, 350)
            ScrollView {
                VStack(spacing: 0) {
                    HStack {
                        Text("capri")
                            .font(.system(.subheadline, design: .serif).weight(.medium))
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                            .accessibilityIdentifier("welcome-brand")
                            .contextMenu {
                                if let openLab {
                                    Button(action: openLab) {
                                        Label(language.text("LAB · Experiments & tools"), systemImage: "flask")
                                    }
                                    .accessibilityIdentifier("login-product-lab")
                                }
                            }
                        Spacer()
                        Button {
                            if hasEntered {
                                withAnimation(motion) { hasEntered = false }
                            } else { enter() }
                        } label: {
                            Group {
                                if hasEntered {
                                    Image(systemName: "arrow.counterclockwise")
                                        .font(.system(size: 18, weight: .regular))
                                } else { Text(language.text("Sign in")) }
                            }
                            .font(.subheadline)
                            .foregroundStyle(Color.tsMutedInk)
                            .frame(minWidth: 44, minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(language.text(hasEntered ? "Introduction" : "Sign in"))
                        .accessibilityIdentifier("welcome-skip")
                    }
                    .padding(.horizontal, 28)

                    if !typeSize.isAccessibilitySize || !hasEntered {
                        ZStack(alignment: .bottom) {
                            AuthenticationPortraits(progress: progress)
                                .contentShape(Rectangle())
                                .onTapGesture { enter() }
                                .highPriorityGesture(revealGesture(travel: travel))
                            TalentSignalBrandMark()
                                .frame(width: 76, height: 76)
                                .opacity(Double(1 - AuthenticationPortraitLayout.phase(progress, from: 0.04, to: 0.25)))
                                .scaleEffect(1 - (reduceMotion ? (hasEntered ? CGFloat(1) : 0) : progress) * 0.42)
                                .rotationEffect(.degrees(reduceMotion ? 0 : -12 * (1 - progress)))
                                .offset(y: -heroHeight * 0.38 * (1 - (reduceMotion ? (hasEntered ? CGFloat(1) : 0) : progress)))
                                .transaction { if reduceMotion { $0.animation = nil } }
                                .padding(.bottom, 4)
                                .accessibilityHidden(true)
                                .allowsHitTesting(false)
                                .opacity(typeSize.isAccessibilitySize ? 0 : 1)
                        }
                        .frame(height: heroHeight)
                        .padding(.top, 12)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(language.text("Example link"))
                        .accessibilityAddTraits(.isButton)
                        .accessibilityAction { enter() }
                        .accessibilityIdentifier("welcome-link")
                        .accessibilityHidden(hasEntered)

                        Text(language.text("Keep important people.\nPick up unfinished things."))
                            .font(.system(typeSize.isAccessibilitySize ? .title3 : .largeTitle, design: .serif).weight(.regular))
                            .lineLimit(nil)
                            .tracking(-0.9)
                            .lineSpacing(3)
                            .foregroundStyle(Color.tsInk)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.isHeader)
                            .padding(.horizontal, 28)
                            .padding(.top, 16)
                    }

                    Spacer(minLength: 28)

                    Group {
                        if hasEntered {
                            content()
                                .transition(.opacity.combined(with: reduceMotion ? .identity : .offset(y: 18)))
                        } else {
                            Button(action: enter) {
                                VStack(spacing: 12) {
                                    Image(systemName: "chevron.up")
                                        .font(.system(size: 20, weight: .medium))
                                        .frame(width: 56, height: 56)
                                        .background(Color.tsCanvas, in: Circle())
                                        .overlay {
                                            Circle().trim(from: 0, to: min(1, progress / AuthenticationWelcomeGesture.commitProgress))
                                                .stroke(Color.tsVermilion, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                                                .rotationEffect(.degrees(-90))
                                        }
                                    Text(language.text(pull >= travel * AuthenticationWelcomeGesture.commitProgress
                                        ? "Release to connect" : "Pull a link. Reveal its connections."))
                                        .font(.subheadline)
                                }
                                .foregroundStyle(Color.tsInk)
                                .frame(maxWidth: .infinity, minHeight: 100)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .offset(y: reduceMotion ? 0 : -min(pull, travel) * 0.12)
                            .accessibilityIdentifier("welcome-enter")
                            .accessibilityLabel(language.text("Swipe up, or tap to begin"))
                            .accessibilityHint(language.text("Explore an example link and its relationships."))
                            .highPriorityGesture(revealGesture(travel: travel))
                        }
                    }
                    .padding(.horizontal, 28)
                    .padding(.bottom, 24)
                }
                .frame(maxWidth: 480)
                .frame(minHeight: geometry.size.height, alignment: .top)
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
            }
            .scrollIndicators(.hidden)
            .scrollDisabled(!hasEntered && !typeSize.isAccessibilitySize && geometry.size.height > 600)
            .simultaneousGesture(revealGesture(travel: travel))
            .coordinateSpace(name: "welcome-pull")
            .onChange(of: pull) { distance in
                // Hysteresis prevents a stream of impacts while hovering at the threshold.
                if distance < travel * 0.48 { thresholdFeedbackArmed = true }
                if distance > 0 && distance < 12 { feedback.prepare() }
                if !hasEntered && distance >= travel * AuthenticationWelcomeGesture.commitProgress && thresholdFeedbackArmed {
                    thresholdFeedbackArmed = false
                    if !reduceMotion { feedback.impactOccurred(intensity: 0.65) }
                }
            }
        }
        .background(Color.tsSurface.ignoresSafeArea())
        .onAppear {
#if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--welcome-first-meeting") { hasEntered = false }
#endif
            if needsRecovery { hasEntered = true }
        }
        .onChange(of: needsRecovery) { required in
            if required { withAnimation(motion) { hasEntered = true } }
        }
    }

    private func revealGesture(travel: CGFloat) -> some Gesture {
        // A stable space prevents the moving source from changing its own translation.
        DragGesture(minimumDistance: 8, coordinateSpace: .named("welcome-pull"))
            .updating($pull) { value, state, transaction in
                transaction.animation = nil
                state = 0
                guard !hasEntered, value.translation.height < 0,
                      abs(value.translation.height) > abs(value.translation.width) else { return }
                state = -value.translation.height
            }
            .onEnded { value in
                guard !hasEntered else { return }
                if AuthenticationWelcomeGesture.shouldEnter(translation: value.translation,
                    predicted: value.predictedEndTranslation, travel: travel) { enter() }
            }
    }

    private func enter() {
        guard !hasEntered else { return }
        if !reduceMotion { feedback.impactOccurred(intensity: 0.9) }
        withAnimation(motion) { hasEntered = true }
    }
}

enum AuthenticationWelcomeGesture {
    static let commitProgress: CGFloat = 0.62

    static func progress(pull: CGFloat, travel: CGFloat) -> CGFloat {
        guard travel > 0 else { return 0 }
        // Follow directly up to commitment, then resist excess travel.
        let raw = max(0, pull / travel)
        if raw <= commitProgress { return raw }
        let excess = raw - commitProgress
        return commitProgress + (1 - commitProgress) * excess / (excess + 1 - commitProgress)
    }

    static func shouldEnter(translation: CGSize, predicted: CGSize, travel: CGFloat) -> Bool {
        let distance = -translation.height
        guard distance > abs(translation.width) else { return false }
        // A small exploratory tug always returns, regardless of a noisy fling prediction.
        return distance >= travel * commitProgress || (distance >= travel * 0.28 && -predicted.height >= travel)
    }
}
