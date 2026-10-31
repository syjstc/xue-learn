# Contributing

Use Node.js 24 LTS and pnpm 9.15.9 from the repository root. Run `pnpm run setup`, then `pnpm run check` before submitting a change. Core and Desktop share the workspace source and lockfile; update them in the same change when an interface changes.

Describe the problem, the resulting behavior, and relevant validation in your pull request. Include a screenshot when changing visible UI. Add regression coverage for security boundaries, persistence, and behavior that is difficult to verify manually. Do not include API keys, real learner records, local profiles, logs, signing credentials, or generated installers.

Run `pnpm run check:security` before proposing a release. It checks source hygiene, scans the complete Git history and current distributable source with Gitleaks, and audits dependencies. See [SECURITY.md](SECURITY.md) for private vulnerability reporting.

Mac release builds require the contributor's own Developer ID and notarization credentials. Keep those outside version control; see [the release guide](docs/mac-release.md). Source contributions do not publish packages or installers automatically.

Contributions to project-owned source are provided under the repository's MIT license. Include the source, license, and required attribution for any new third-party dependency or media. Follow the separate [brand policy](desktop/BRAND_POLICY.md) when distributing a modified app.
