# XueLearn · 好会学

[English](README.md) · [简体中文](README.zh-CN.md)

XueLearn is a personal learning app for your desktop. Tell it what you want to learn and what you already know. It helps you build a learning path, then work through explanations, interactive demonstrations, questions and practice. Return later to continue where you left off or review earlier material.

<p align="center">
  <img src="docs/images/learning-flow-hero.png" alt="Learning flow: Goal → Path → Ask → Practice. Set a goal, follow a path of modules, select a passage to ask, then practice and review. 设定目标、学习路径、选中追问、练习巩固" width="960">
</p>

For example: “I’m new to statistics. I want to understand averages, probability and correlation in the news. Please use everyday examples.” You can also start with your own textbooks, notes or public web articles.

**[Download for Mac](https://github.com/syjstc/xue-learn/releases) · [User guide: installation to your first lesson](docs/user-guide.en.md) · [Frequently asked questions](docs/user-guide.en.md#frequently-asked-questions)**

- **Learning paths:** turn a broad goal into manageable modules and lessons.
- **Read and ask:** study explanations, select a passage to ask about it, and keep the context of your questions.
- **Interactive explanations:** explore diagrams, demonstrations and step-by-step reasoning.
- **Practice and review:** check your understanding and revisit material over time.
- **Your local workspace:** keep learning records on your device and choose the model services you use.

## Install and start learning

The currently validated platform is an Apple silicon Mac. Download the `mac-arm64.dmg`, open it, and drag **好会学** into **Applications**. The installer includes the app and its local service; you do not need Node.js or other development tools to use it. Formal Mac installers use Developer ID signing, Apple notarization and Gatekeeper verification.

Starting with **0.3.3**, the interface supports **English, Simplified Chinese and Traditional Chinese**. It initially follows your system language, with English as the fallback for unsupported languages. You can change the language on the first setup screen or under **Settings → Appearance**. Course content has its own language setting; changing the interface does not rewrite existing lessons. If 0.3.3 is not listed on the download page yet, these improvements are awaiting release.

At first launch, connect your learning assistant: choose a model service, enter your own API key, read the available models and save your choice. Then prepare local knowledge search and create your first learning goal. Voice, image generation and web search are optional and can be configured later.

Cloud model services may charge for usage. XueLearn does not include API keys or model credits. Relevant questions, course material or selected documents are sent to the services you configure when those services are used. See [Data and privacy](docs/user-guide.en.md#your-data-and-model-services).

## Develop from source

This repository contains [Core](core/) and the [Desktop app](desktop/) in one pnpm workspace. Desktop builds and uses the current Core source.

Use Node.js 24 LTS from `.nvmrc` and pnpm `9.15.9`:

```sh
pnpm run setup
pnpm run check
pnpm run dev
```

`check` audits source boundaries and translations, builds and tests Core and Desktop, checks types, and builds the renderer and local service. Development watches Core source and rebuilds it when needed.

```sh
pnpm run check:i18n     # Translation keys, placeholders and static UI copy
pnpm run test:core
pnpm run test:desktop
pnpm run check:security # Gitleaks and dependency advisories
pnpm run build:mac      # macOS with your signing/notarization credentials
pnpm run release:mac    # Full checks, formal build and a draft GitHub Release
```

The default release command stops at a draft. After reviewing the exact installer, `pnpm run release:mac --resume --publish` publishes it. See the [Mac release guide (中文)](docs/mac-release.md) for prerequisites and recovery. Source commits do not update installed apps automatically; users install a new release to update.

Windows, Linux and Intel Mac builds need validation on those platforms.

See the [contribution guide](CONTRIBUTING.md), [translation guide](docs/internationalization.md), [Core API](core/docs/public-api.md), [Desktop plugins](desktop/docs/desktop-plugins.md) and [security policy](SECURITY.md).

## License

Project-owned source uses the [MIT license](LICENSE). Names, icons and some media have separate terms; third-party dependencies retain their original licenses. See [license scope](LICENSING.md), [Core notices](core/THIRD_PARTY_NOTICES.md), [Desktop notices](desktop/THIRD_PARTY_NOTICES.md) and the [brand policy](desktop/BRAND_POLICY.md).
