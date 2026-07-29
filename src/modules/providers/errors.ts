import type { ProviderCapabilities, ProviderId } from "./types";

/**
 * Thrown when a caller asks a provider for something its capabilities say it
 * cannot do. This is the mechanism that makes `capabilities` a runtime value
 * rather than a comment.
 */
export class CapabilityUnavailableError extends Error {
  constructor(
    readonly providerId: ProviderId,
    readonly capability: keyof ProviderCapabilities,
    detail?: string,
  ) {
    super(
      `provider '${providerId}' does not support ${String(capability)}` +
        (detail ? `: ${detail}` : ""),
    );
    this.name = "CapabilityUnavailableError";
  }
}

/** The archive holds no data for the reference asked for. */
export class ProviderNotFoundError extends Error {
  constructor(
    readonly providerId: ProviderId,
    readonly ref: string,
  ) {
    super(`provider '${providerId}' has no data for '${ref}'`);
    this.name = "ProviderNotFoundError";
  }
}

/**
 * The payload is present but does not match the canonical model.
 *
 * Always a hard failure. A missing field is never filled in with a plausible
 * value — if the feed does not supply it, the feature does not ship.
 */
export class ProviderPayloadError extends Error {
  constructor(
    readonly providerId: ProviderId,
    readonly path: string,
    detail: string,
  ) {
    super(`provider '${providerId}' payload invalid at ${path}: ${detail}`);
    this.name = "ProviderPayloadError";
  }
}
