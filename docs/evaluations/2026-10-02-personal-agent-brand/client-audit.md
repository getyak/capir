# Personal Agent client migration audit

Date: 2026-10-02. Scope: iOS, native macOS, macOS Hybrid, browser capture,
and shared workspace presentation. This audit distinguishes implemented copy
changes from compatibility identities and unverified runtime behavior.

## Implemented generic product language

- The iOS welcome headline describes keeping important people and resuming
  unfinished things. Its Simplified Chinese catalog entry changes together
  with its source and the affected UI assertion.
- New standalone setup defaults to the existing partnership template with an
  empty outcome rather than a prefilled VP Engineering hiring goal. Hiring
  remains an explicit template and the synthetic hiring example remains
  labeled as an example; no historical candidate records are relabeled.
- Empty local account display names use `You`; generic review surfaces use
  `Current user`. Audio purpose and attestation name the user rather than
  assuming a recruiter. This does not replace recorded actors or authorization.
- General screenshot/settings guidance names people and personal data while
  retaining exact identity review, no automatic fact confirmation, local
  storage, and external-effect controls.
- Native macOS selected-text accessibility and source presentation say
  `User-selected text`. Quick Panel and relationship work descriptions use
  user-owned work; existing domain ownership remains unchanged.
- The iOS contact-intake model instructions describe a user-authored request.
  They still require a stable identity clue copied from the same source,
  exclude quoted speech as creation authority, preserve ambiguity, and require
  human review. The deterministic interpreter, schemas, parser version, and
  write behavior are unchanged. The prohibition now refers to a person's worth.

## Brand display migration

The final display spelling is `capri`, following the user's latest explicit
new-name instruction and the coordinating agent's confirmed scope.

Display-name and descriptive copy now use `capri` in iOS permission text,
App Intents, Share and Live Activity extensions, login/settings, source and
calendar feedback, bilingual catalogs and affected assertions; native macOS
menus, windows, capture panels, connection/login errors, Services registration
and review labels; Hybrid window/frontend copy, SVG accessible titles and
package description/author metadata; and the browser extension manifest,
panel, capture and handoff errors.

The existing brand mark geometry is preserved on client surfaces. This
migration does not claim a redesigned native icon or a verified branded
installation/upgrade. Package names and filesystem/application identities
remain compatible as detailed below.

## Compatibility identities retained

| Identity | Reason |
| --- | --- |
| Swift types, Xcode targets/schemes, `PRODUCT_NAME`, `@talent-signal/*` package names and imports | Engineering identities with active callers and build configuration |
| `com.talentsignal.*` Bundle IDs, keychain/app-group identifiers, existing URL schemes | Installed applications, authorization and extension continuity |
| `TalentSignal*` Info.plist configuration keys, runtime contracts, fixtures and API/event roles | Existing resolvers and protocol compatibility |
| `talent-signal.*` preferences and `TalentSignal/…` storage paths | Preserve prior login, capture, calendar and recovery state |
| Update feed and repository release URLs | Preserve the current distribution channel |
| macOS `CFBundleName`, Services `NSPortName`, Tauri `productName`, installation/package filenames | Require separate packaging and upgrade verification before changing |
| Historical/synthetic recruiting fixtures, test TLS certificate subjects and actual recruiting labels | Retain real recruiting semantics and repeatable evaluation evidence |

Changing a macOS Services menu title may require users to revisit the system
Services shortcut assignment. Existing persisted application shortcut keys
are preserved. System registration and shortcut continuity must be checked on
an installed native build before declaring the branded upgrade verified.

## Verification performed

- `/Users/cubxxw/.local/bin/dev-storage-guard audit`: 75 GiB free, below the
  80 GiB heavyweight-build threshold; shared devices were shut down and no
  devices were created or started. Other tasks' artifacts were not removed.
- `pnpm ios:localization:check`: passed with 2,743 catalog keys, 176 existing
  inline bilingual calls and 210 existing raw SwiftUI literals.
- Swift frontend syntax parsing passed for all 60 changed Swift files after
  the display-name migration.
- `pnpm docs:check`: passed, including Wiki and architecture checks.
- Hybrid presentation tests: `pnpm --filter @talent-signal/macos-hybrid test`,
  14 passed, 0 failed.
- Browser capture tests: `node --test apps/browser-extension/tests/*.test.mjs`,
  42 passed, 0 failed.
- Parsed plist comparison with `HEAD` confirmed non-display identity keys in
  the four application/extension plists are unchanged. Hybrid configuration
  differs only in the window title; browser manifest permissions, host access,
  command bindings and storage authority are unchanged.
- A static contact-intake boundary inspection confirmed stable identity,
  exact-source fields, ambiguity, third-party quotation isolation and user
  review remain explicit. This is source evidence, not a model evaluation.

No native build, XCTest execution, simulator run, App Store installation,
macOS upgrade or actual model evaluation has been performed. The screenshot
capture → identity review → unfinished item → subsequent update product loop
is not newly implemented by these copy changes. Existing domain behavior is
preserved and must be accepted separately from a visual or naming migration.
