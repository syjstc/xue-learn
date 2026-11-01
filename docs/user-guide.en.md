# XueLearn user guide

[English](user-guide.en.md) · [简体中文](user-guide.md) · [Home](../README.md)

XueLearn helps you learn a subject one manageable step at a time. Describe what you want to understand and what you already know. Your assistant helps plan a path, prepare explanations and practice, and answer questions as you study.

For example: “I have no background in statistics. Help me understand averages, probability and correlation using everyday examples. I can study for about 20 minutes at a time.”

This guide describes **0.3.3 and later**, including the language selector. If you use an older version, check the [download page](https://github.com/syjstc/xue-learn/releases) for an update.

## The basic flow

**Describe your goal → confirm your preferences → prepare a learning path → start the first lesson → read, ask and practice → continue or review next time.**

Choose a **Learning goal** to study a subject systematically, or a **Micro course** to explore a smaller topic. You can begin with a sentence; your own materials are optional.

## 1. Install and choose a language

The validated installer is for an **Apple silicon Mac**. In the Apple menu, open **About This Mac**: an Apple M-series chip uses the `mac-arm64.dmg` installer.

1. Open the [download page](https://github.com/syjstc/xue-learn/releases) and download the `.dmg` for your version.
2. Open the DMG and drag **好会学** into **Applications**. The installation link is labeled **应用程序** in the installer.
3. Open the app from Applications.
4. Use the first setup screen's language selector to choose **English**, **简体中文** or **繁體中文**. **Match system language** chooses a supported system language and falls back to English.

You can change this later under **Settings → Appearance → Interface language**. Your choice is saved in this workspace. Course language is separate: changing the interface does not replace or translate existing lessons.

Install the DMG, rather than the download page's **Source code** archives. You do not need development tools to use the app.

## 2. Complete the two setup steps

### Connect your learning assistant

This service plans learning paths, prepares explanations and answers questions.

1. Choose a model service for which you have an account.
2. Use **Get an API key**, or create a key in the provider's official account page. Paste it into XueLearn.
3. Select **Read available models**, then choose a returned model.
4. Select **Save and continue**. The app displays **Model service saved** when the configuration is stored.

An API key lets the app call that service; it is not your login password. Cloud API usage may be billed separately from a provider's chat subscription. XueLearn does not include model credits.

If a service has no model list, use **Enter a model ID manually** and copy its exact ID. A **Generic / OpenAI-compatible** service also needs the API base URL supplied by that service. These steps describe API-key setup; supported account sign-in and local services have their own on-screen steps.

You can change model setup later under **Local settings → Quick start**. Saved keys are encrypted on this Mac; keep them out of screenshots and issue reports.

### Prepare knowledge search

Knowledge search finds and connects information in your courses and materials. It has a different purpose from the assistant. Both steps must be ready before learning.

1. Use **Knowledge search on this Mac**.
2. Choose a model source you can reach: **Hugging Face** or **ModelScope**.
3. Select **Download and use Qwen**. The current download is about 639 MB; allow enough disk space and wait for validation and preparation.
4. Continue when the app is ready.

The downloaded search model runs locally without another API key. A cloud learning assistant still needs a network connection to generate explanations. If you already use Ollama or an online search-model service, expand **Other knowledge search options**.

Voice, generated images and web search are optional. Add them when needed; you do not need to configure everything now.

## 3. Create your first goal

1. Select **New goal** in the sidebar, or use the first-goal invitation.
2. Choose **Learning goal** or **Micro course**. Start with a focused topic.
3. Describe your experience, the problem you want to solve and the result you want to achieve.
4. Optionally add PDF, Word, TXT or Markdown files, or public web links.
5. Select **Start planning**; micro-courses have their corresponding creation action.
6. Answer any follow-up questions, check the proposed learning preferences and confirm. When shown a content-language choice, choose the language you want for your lessons.
7. Follow the preparation status. When ready, select **Start first lesson**.

Try: “I'm a complete beginner. I want to use Python to organize everyday spreadsheets. Start with basic concepts, use small examples and plan for 20 minutes at a time.”

Preparation calls your model service, so speed depends on the topic, model and network. Let an active task finish. If it reports an error, use its retry action instead of creating duplicate goals.

## 4. Work through a lesson

- **Read:** follow the current section and its examples. Some diagrams continue preparing after the text appears.
- **Explore:** step through demonstrations and reasoning. Focus mode gives the content more room.
- **Ask:** select a passage and use the question action, or open the learning assistant. Try “Show an everyday example” or “Why does this step follow?”
- **Practice:** attempt self-checks before reading the feedback.
- **Continue:** use the completion or continue action. Complete any required checks before moving on.

If a diagram fails, retry that component while continuing to read the rest. AI-generated explanations can be wrong: ask for the reasoning and compare uncertain claims with your materials or reliable references.

## 5. Continue and review

Next time, use **Continue** in the sidebar, or open an existing goal and continue learning. You do not need to create the goal again. Open the full course to revisit earlier sections.

Use **Reviews** in the sidebar for recall prompts, quizzes and active practice. A new workspace may not have any reviews yet; these appear as you build learning history.

For everyday use, finish one small section, spend a few minutes practicing, and check reviews before starting new material next time.

## Frequently asked questions

**The model list is empty or unavailable.** Check the provider, complete key, account access, quota and network. For a generic service, check the API URL too. A service without a model-list endpoint can use its exact model ID. Saving configuration does not guarantee that the provider will accept a generation request.

**I saved a model but cannot begin.** Finish **Prepare knowledge search**, the second setup step.

**The search model will not download.** Check disk space and network access, try the other source, and use the retry action. Wait for validation to finish.

**Generation is slow or fails.** Check whether progress is still active. After a failure, check the service's network, quota and model name, then use the page's retry or continue action. Regeneration makes another model call and may incur more usage.

**Where can I change teaching style or appearance?** Use **Settings** for learning background, teaching assistant and appearance. Use **Local settings → Quick start** for model services and optional features. Changing providers does not automatically regenerate existing lessons.

**Will my records appear on another computer?** Records are local by default. Installing the app elsewhere does not sync them; cross-device use needs separate sync setup. Back up important material before moving computers or clearing data. Uninstalling the app does not automatically remove its workspace.

**How do I update?** Quit XueLearn, download the new DMG from [Releases](https://github.com/syjstc/xue-learn/releases), and replace the app in Applications. Back up important learning records first.

## Your data and model services

Records, imported materials and settings stay in your local workspace. When you use a cloud service, the relevant questions, conversation, course content or document excerpts needed for that feature may be sent to your selected provider. Optional voice, image and web-search services may have separate charges. Local knowledge search does not mean all AI features run locally.

The search model is downloaded from your chosen model repository. Sync and extensions have their own data access; install extensions only from trusted sources. See the [full privacy notes](privacy.en.md).

## Need more help?

Open an [issue](https://github.com/syjstc/xue-learn/issues) with your app version, what you did, what you expected and what happened. English and Chinese reports are welcome. Remove keys and private information before sharing screenshots or logs.
