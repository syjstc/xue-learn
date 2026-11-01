# Internationalization

The interface supports English (`en`), Simplified Chinese (`zh-Hans`) and Traditional Chinese (`zh-Hant`). Unsupported system languages fall back to English. UI language, course language and user content are separate: changing the UI must not rewrite saved courses or imported documents.

## Interface text

Use `useT()` in React and `translateCurrent()` in non-React renderer helpers. Dictionaries live in `core/sources/src/shared/i18n/locales/`. Add the same semantic key and named interpolation parameters to all three dictionaries. Translate complete sentences with parameters rather than concatenating fragments around names, counts or titles.

Use `countVariant()` with `.one` and `.other` messages for counts, and the active UI locale for dates and numbers. Language selectors may display native language names.

Desktop reads appearance preferences before mounting learning routes. Preferences live in SQLite because the HTTP origin can change on restart. New workspaces follow the system; an explicit saved choice takes precedence. API requests send the resolved UI language in `Accept-Language`. Server text uses the backend locale context; authoring uses each goal's content-language settings.

Keep the language selector accessible before model setup and in Settings → Appearance. Check keyboard access and long English labels.

## Validation

```sh
pnpm run check:i18n
pnpm run check
```

The translation check verifies keys and interpolation parameters, and detects Chinese literals embedded in desktop and shared Core JSX controls. It checks interface copy. User input, saved or generated courses and authored teaching scenes/examples retain their own content language. Standalone Core display controls use the host or system language when no app provider is present. Tests cover regional locale matching, English fallback, saved preferences, startup races, request locale, system-language changes and the existing SQLite schema.

Inspect visible changes in the development UI in English and Chinese. Check first launch, switching, reload/restart, goal creation, reading, practice and settings. Keep screenshots free of real keys and learner data. Installer and release verification are separate from source UI validation.

## Another interface language

Add a dictionary, extend locale negotiation and native names, register it with the provider and picker, and update appearance validation and persistence. Add matching keys and parameters, verify plural forms and formatting, and inspect the layouts. Document support only after translating and checking the core user journeys.
