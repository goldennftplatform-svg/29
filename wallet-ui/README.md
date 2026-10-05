# Public wallet onboarding

The public Privy App ID is configured in `src.jsx`. It is not a secret.

## Dashboard configuration required

In this Privy app:
- Enable Google login (and email if desired).
- Enable Ethereum embedded wallets, not only Solana wallets.
- Add the production origin `https://goldennftplatform-svg.github.io` to allowed domains.
- Follow Privy's Google OAuth configuration prompts if custom Google credentials are required.

Do not commit app secrets or OAuth client secrets. The browser uses the public app ID only.

## Build and publish

Builds run on GitHub via `wallet-build.yml`, not a local server. Download the `wallet-assets` artifact into the repository's `wallet-assets/` directory, review and commit the generated files, and push to publish through Pages. Source changes require a new bundle.

`wallet-setup.html` is isolated from game startup. The lobby link is added after publishing the bundle. The wallet uses Privy's per-user EVM key management; it never imports the legacy server custody mnemonic. This is not a login to the legacy backend or a game-credit deposit. Connecting those systems requires server verification of Privy access tokens and explicit account linking.

LiteForge is configured as the only supported chain (4441). Faucet claims use the official Caldera hub; CAPTCHA/rate-limit steps remain user actions. No automatic funding or settlement is claimed.
