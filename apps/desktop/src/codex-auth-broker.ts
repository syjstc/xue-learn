import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { SafeStoragePort } from "./credential-vault.ts";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const ISSUER = "https://auth.openai.com";
const TOKEN_URL = ISSUER + "/oauth/token";
const DEVICE_URL = ISSUER + "/api/accounts/deviceauth/usercode";
const DEVICE_TOKEN_URL = ISSUER + "/api/accounts/deviceauth/token";

type StoredTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  accountId: string | null;
};

type PendingLogin = {
  id: string;
  deviceAuthId: string;
  userCode: string;
  expiresAt: number;
  intervalMs: number;
  verificationUrl: string;
  controller: AbortController;
};

export type CodexAuthStatus = {
  signedIn: boolean;
  accountId: string | null;
  expiresAt: number | null;
  pendingLogin: {
    id: string;
    verificationUrl: string;
    userCode: string;
    expiresAt: number;
  } | null;
};

export type CodexLoginChallenge = NonNullable<
  CodexAuthStatus["pendingLogin"]
>;

type AuthEnvelope = { version: 1; ciphertext: string };

function accountIdFromJwt(token: string): string | null {
  try {
    const [, encoded] = token.split(".");
    if (!encoded) return null;
    const payload = JSON.parse(
      Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
        "utf8",
      ),
    ) as Record<string, unknown>;
    const direct = payload["https://api.openai.com/auth.chatgpt_account_id"];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    const auth = payload["https://api.openai.com/auth"];
    const id =
      auth && typeof auth === "object"
        ? (auth as Record<string, unknown>).chatgpt_account_id
        : undefined;
    return typeof id === "string" && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

function expiryFromPayload(payload: Record<string, unknown>): number {
  const absolute = Number(payload.expires_at);
  if (Number.isFinite(absolute) && absolute > 0) {
    return absolute < 2_000_000_000 ? absolute * 1000 : absolute;
  }
  const expiresIn = Number(payload.expires_in);
  return Date.now() +
    (Number.isFinite(expiresIn) && expiresIn > 0
      ? expiresIn * 1000
      : 3_600_000);
}

export class CodexAuthBroker {
  private tokens: StoredTokens | null = null;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private pending: PendingLogin | null = null;
  private refreshPromise: Promise<string> | null = null;
  private refreshPromiseVersion = -1;
  private persistQueue: Promise<void> = Promise.resolve();
  /** Invalidates late refresh results after logout/cancel/re-login. */
  private authVersion = 0;

  constructor(
    private readonly path: string,
    private readonly safeStorage: SafeStoragePort,
  ) {}

  async status(): Promise<CodexAuthStatus> {
    await this.load();
    return {
      signedIn: Boolean(
        this.tokens &&
          (this.tokens.refreshToken || this.tokens.expiresAt > Date.now()),
      ),
      accountId: this.tokens?.accountId ?? null,
      expiresAt: this.tokens?.expiresAt ?? null,
      pendingLogin: this.pending
        ? {
            id: this.pending.id,
            verificationUrl: this.pending.verificationUrl,
            userCode: this.pending.userCode,
            expiresAt: this.pending.expiresAt,
          }
        : null,
    };
  }

  async startLogin(): Promise<CodexLoginChallenge> {
    await this.load();
    await this.cancelLogin();
    const response = await fetch(DEVICE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID }),
    });
    if (!response.ok)
      throw new Error("Codex device login failed (HTTP " + response.status + ")");
    const payload = (await response.json()) as Record<string, unknown>;
    const deviceAuthId = String(payload.device_auth_id ?? "");
    const userCode = String(payload.user_code ?? "");
    const expiresIn = Number(payload.expires_in ?? 900);
    if (!deviceAuthId || !userCode)
      throw new Error("Codex device login returned an incomplete challenge");
    const id = randomUUID();
    const controller = new AbortController();
    const intervalSeconds = Number(payload.interval ?? 5);
    const verificationUrl =
      typeof payload.verification_url === "string" &&
      payload.verification_url.startsWith("https://")
        ? payload.verification_url
        : ISSUER + "/codex/device";
    this.pending = {
      id,
      deviceAuthId,
      userCode,
      expiresAt: Date.now() + Math.max(1, expiresIn) * 1000,
      intervalMs:
        Math.max(3, Number.isFinite(intervalSeconds) ? intervalSeconds : 5) *
        1000,
      verificationUrl,
      controller,
    };
    void this.pollLogin(this.pending);
    return {
      id,
      verificationUrl,
      userCode,
      expiresAt: this.pending.expiresAt,
    };
  }

  async cancelLogin(): Promise<void> {
    this.authVersion += 1;
    this.pending?.controller.abort();
    this.pending = null;
  }

  async logout(): Promise<void> {
    await this.load();
    await this.cancelLogin();
    this.tokens = null;
    await this.persist();
  }

  async getAccessToken(options?: { forceRefresh?: boolean }): Promise<string> {
    await this.load();
    if (!this.tokens) throw new Error("Codex is not signed in");
    if (!options?.forceRefresh && this.tokens.expiresAt > Date.now() + 120_000)
      return this.tokens.accessToken;
    if (!this.tokens.refreshToken)
      throw new Error("Codex session expired; please sign in again");
    if (!this.refreshPromise || this.refreshPromiseVersion !== this.authVersion) {
      const version = this.authVersion;
      this.refreshPromiseVersion = version;
      this.refreshPromise = this.refresh(this.tokens.refreshToken, version).finally(
        () => {
          if (this.refreshPromiseVersion === version) {
            this.refreshPromise = null;
            this.refreshPromiseVersion = -1;
          }
        },
      );
    }
    return this.refreshPromise;
  }

  private async pollLogin(login: PendingLogin): Promise<void> {
    try {
      while (this.pending?.id === login.id && Date.now() < login.expiresAt) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, login.intervalMs);
          login.controller.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
        if (login.controller.signal.aborted) return;
        const response = await fetch(DEVICE_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            device_auth_id: login.deviceAuthId,
            user_code: login.userCode,
          }),
          signal: login.controller.signal,
        });
        if (response.status === 403 || response.status === 404) continue;
        if (!response.ok)
          throw new Error("Codex device polling failed (HTTP " + response.status + ")");
        const codePayload = (await response.json()) as Record<string, unknown>;
        const code = String(codePayload.authorization_code ?? "");
        const verifier = String(codePayload.code_verifier ?? "");
        if (!code || !verifier)
          throw new Error("Codex device authorization returned an incomplete code");
        const tokenResponse = await fetch(TOKEN_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: ISSUER + "/deviceauth/callback",
            client_id: CLIENT_ID,
            code_verifier: verifier,
          }),
          signal: login.controller.signal,
        });
        if (!tokenResponse.ok)
          throw new Error("Codex token exchange failed (HTTP " + tokenResponse.status + ")");
        const payload = (await tokenResponse.json()) as Record<string, unknown>;
        const accessToken = String(payload.access_token ?? "");
        if (!accessToken)
          throw new Error("Codex token exchange returned no access token");
        if (this.pending?.id !== login.id || login.controller.signal.aborted)
          return;
        this.tokens = {
          accessToken,
          refreshToken:
            typeof payload.refresh_token === "string"
              ? payload.refresh_token
              : null,
          expiresAt: expiryFromPayload(payload),
          accountId: accountIdFromJwt(accessToken),
        };
        await this.persist();
        this.pending = null;
        return;
      }
      if (this.pending?.id === login.id) this.pending = null;
    } catch (error) {
      if (!login.controller.signal.aborted) this.pending = null;
      console.warn(
        "[codex-auth] login failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async refresh(refreshToken: string, version: number): Promise<string> {
    if (
      version !== this.authVersion ||
      this.tokens?.refreshToken !== refreshToken
    ) {
      throw new Error("Codex authentication changed while refreshing");
    }
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }),
    });
    if (!response.ok) {
      if (
        version === this.authVersion &&
        this.tokens?.refreshToken === refreshToken
      ) {
        this.tokens = null;
        await this.persist();
      }
      throw new Error("Codex session refresh failed; please sign in again");
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const accessToken = String(payload.access_token ?? "");
    if (!accessToken) throw new Error("Codex refresh returned no access token");
    if (
      version !== this.authVersion ||
      this.tokens?.refreshToken !== refreshToken
    ) {
      throw new Error("Codex authentication changed while refreshing");
    }
    this.tokens = {
      accessToken,
      refreshToken:
        typeof payload.refresh_token === "string"
          ? payload.refresh_token
          : refreshToken,
      expiresAt: expiryFromPayload(payload),
      accountId: accountIdFromJwt(accessToken),
    };
    await this.persist();
    return accessToken;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const serialized = await readFile(this.path, "utf8");
          const envelope = JSON.parse(serialized) as AuthEnvelope;
          if (envelope.version !== 1) return;
          const plaintext = this.safeStorage.decryptString(
            Buffer.from(envelope.ciphertext, "base64"),
          );
          const parsed = JSON.parse(plaintext) as Partial<StoredTokens>;
          if (
            typeof parsed.accessToken === "string" &&
            typeof parsed.expiresAt === "number"
          ) {
            this.tokens = {
              accessToken: parsed.accessToken,
              refreshToken:
                typeof parsed.refreshToken === "string"
                  ? parsed.refreshToken
                  : null,
              expiresAt: parsed.expiresAt,
              accountId:
                typeof parsed.accountId === "string" ? parsed.accountId : null,
            };
          }
        } catch {
          this.tokens = null;
        } finally {
          this.loaded = true;
        }
      })().finally(() => {
        this.loadPromise = null;
      });
    }
    await this.loadPromise;
  }

  private persist(): Promise<void> {
    const write = async () => {
      if (!this.safeStorage.isEncryptionAvailable())
        throw new Error("macOS Keychain encryption is unavailable");
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const plaintext = this.tokens ? JSON.stringify(this.tokens) : "{}";
      const envelope: AuthEnvelope = {
        version: 1,
        ciphertext: this.safeStorage
          .encryptString(plaintext)
          .toString("base64"),
      };
      const temporary = this.path + ".tmp";
      await writeFile(temporary, JSON.stringify(envelope) + "\n", {
        mode: 0o600,
      });
      await rename(temporary, this.path);
    };
    this.persistQueue = this.persistQueue.then(write, write);
    return this.persistQueue;
  }
}
