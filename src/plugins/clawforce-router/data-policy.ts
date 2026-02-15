/**
 * Policy-based data classification and tier resolution.
 *
 * Routes by channel/user/department rather than content inspection.
 * Handles the ~80% case where sensitivity is determined by source,
 * not by regex pattern matching.
 *
 * Tier hierarchy (most to least restrictive):
 *   restricted > confidential > internal > public
 */

export type DataTier = "restricted" | "confidential" | "internal" | "public";

export interface ChannelPolicy {
  channelId: string;
  tier: DataTier;
  description?: string;
}

export interface UserPolicy {
  userId: string;
  tier: DataTier;
}

export interface DataPolicy {
  defaultTier: DataTier;
  channels?: ChannelPolicy[];
  users?: UserPolicy[];
}

/**
 * Resolve the data tier for a given channel and user.
 * Channel policy takes precedence over user policy.
 * Falls back to the policy's default tier.
 */
export function resolveDataTier(
  policy: DataPolicy,
  channelId?: string,
  userId?: string,
): DataTier {
  if (channelId) {
    const match = policy.channels?.find((c) => c.channelId === channelId);
    if (match) return match.tier;
  }

  if (userId) {
    const match = policy.users?.find((u) => u.userId === userId);
    if (match) return match.tier;
  }

  return policy.defaultTier;
}

/** Only "public" tier is eligible for cloud routing by default. */
export function tierAllowsCloud(tier: DataTier): boolean {
  return tier === "public";
}

/** "restricted" and "confidential" tiers require local-only routing. */
export function tierRequiresLocal(tier: DataTier): boolean {
  return tier === "restricted" || tier === "confidential";
}
