# Data and privacy

[English](privacy.en.md) · [简体中文](privacy.md)

XueLearn stores learning records, imported materials and settings in your local workspace. API keys are encrypted on your Mac using system-provided encryption. Installers do not include developer keys, learner records or the knowledge-search model.

When you use an AI feature, the questions, conversation, relevant learning content or selected documents needed for that task are sent to the model provider you configure. Optional web search, image and voice services send the corresponding inputs to the selected services. Each provider controls its own pricing, retention and terms. When connecting a local service such as Ollama, also check that service's own runtime and network configuration.

The first local knowledge-search setup downloads a model from your chosen ModelScope or Hugging Face repository. The model is downloaded separately from the DMG and has its own license. Search runs in the search environment you configure.

Diagnostic logs may contain requests and generated content. Remove keys, private documents and identifying information before sharing logs, reproductions or a workspace. Uninstalling the app or deleting its source does not automatically remove your local learning workspace. Back up material you want to keep before clearing data.

Optional sync and extensions have their own access to data. Executable extensions can use native capabilities available to your system account. Install them only from trusted sources.
