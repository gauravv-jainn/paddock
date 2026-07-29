import { CapabilityUnavailableError } from "./errors";
import type {
  MarketType,
  ProviderCapabilities,
  ProviderId,
  RacingDataProvider,
  RegionCode,
} from "./types";

/**
 * Capability enforcement — docs/01 §4.1.
 *
 * "The capabilities object is the most important part of this design. It is
 * not documentation — it is a runtime value that the betting engine reads."
 *
 * These are the checks that make that true. A caller asks before it acts, and
 * an unsupported call raises instead of silently returning something wrong.
 */

export function assertCapability(
  provider: Pick<RacingDataProvider, "id" | "capabilities">,
  capability: {
    [K in keyof ProviderCapabilities]: ProviderCapabilities[K] extends boolean
      ? K
      : never;
  }[keyof ProviderCapabilities],
  detail?: string,
): void {
  if (!provider.capabilities[capability]) {
    throw new CapabilityUnavailableError(
      provider.id,
      capability,
      ...(detail === undefined ? [] : [detail]),
    );
  }
}

export function supportsRegion(
  capabilities: ProviderCapabilities,
  region: RegionCode,
): boolean {
  return capabilities.supportedRegions.includes(region);
}

export function assertRegion(
  provider: Pick<RacingDataProvider, "id" | "capabilities">,
  region: RegionCode,
): void {
  if (!supportsRegion(provider.capabilities, region)) {
    throw new CapabilityUnavailableError(
      provider.id,
      "supportedRegions",
      `region '${region}' (supported: ${provider.capabilities.supportedRegions.join(", ")})`,
    );
  }
}

export function supportsMarket(
  capabilities: ProviderCapabilities,
  market: MarketType,
): boolean {
  return capabilities.supportedMarkets.includes(market);
}

export function assertMarket(
  provider: Pick<RacingDataProvider, "id" | "capabilities">,
  market: MarketType,
): void {
  if (!supportsMarket(provider.capabilities, market)) {
    throw new CapabilityUnavailableError(
      provider.id,
      "supportedMarkets",
      `market '${market}' (supported: ${provider.capabilities.supportedMarkets.join(", ")})`,
    );
  }
}

/**
 * Whether a live odds subscription may be opened.
 *
 * `subscribeOdds` is optional on the port, so the method being present is not
 * on its own permission to use it — the capability is.
 */
export function canSubscribeOdds(provider: RacingDataProvider): boolean {
  return provider.capabilities.liveOdds && typeof provider.subscribeOdds === "function";
}

/**
 * Whether a result from this provider is safe to settle automatically.
 *
 * docs/01 §4.1: if the provider cannot flag dead heats, settlement must refuse
 * to auto-settle affected races rather than silently settling them wrong. The
 * same argument applies to non-runners, which void a bet outright.
 */
export function canAutoSettle(provider: RacingDataProvider): boolean {
  const c = provider.capabilities;
  return c.officialResults && c.deadHeatFlags && c.nonRunnerFeed;
}

export function assertAutoSettlable(provider: RacingDataProvider): void {
  const c = provider.capabilities;
  const missing = (
    ["officialResults", "deadHeatFlags", "nonRunnerFeed"] as const
  ).filter((k) => !c[k]);

  const first = missing[0];
  if (first) {
    throw new CapabilityUnavailableError(
      provider.id,
      first,
      `results from this provider must be reviewed manually (missing: ${missing.join(", ")})`,
    );
  }
}

export type { ProviderCapabilities, ProviderId };
