import type { QuotaSnapshot, QuotaRegistry } from './quota-protocol.js';
export type * from './quota-protocol.js';
/** Validate and project only public fields; reject malformed facts instead of inventing zero. */
export declare function projectQuotaSnapshot(input: unknown): QuotaSnapshot;
/** One registry per Host composition. Unload aborts work and invalidates every binding. */
export declare function createQuotaRegistry(): QuotaRegistry;
/** Adapt multiple accounts to Usage Stats' existing subscription-window view. */
export declare function quotaAccountSnapshot(base: Record<string, unknown>, snapshot: QuotaSnapshot): {
    partial?: string[] | undefined;
    reason?: "reauth-required" | "credential-conflict" | "persistence-failed" | "invalid-auth-file" | "file-unavailable" | "refresh-busy" | "unsupported-auth-mode" | undefined;
    status: "ok" | "not-configured" | "unauthorized" | "rate-limited" | "unavailable" | "invalid-response";
    windows: {
        windowSeconds?: number | undefined;
        resetsAt?: string | undefined;
        kind: string;
        label: string;
        account: string;
        usedPercent: number;
        remainingPercent: number;
    }[];
    source: string;
    plan: string | undefined;
    observedAt: number;
    stale: boolean;
};
//# sourceMappingURL=quota.d.ts.map