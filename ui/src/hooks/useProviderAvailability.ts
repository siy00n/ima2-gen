import type { Provider } from "../types";
import { useBilling } from "./useBilling";
import { useOAuthStatus } from "./useOAuthStatus";
import { useI18n } from "../i18n";

export type ProviderAvailability = {
  ok: boolean;
  reason: string;
  hint?: string;
};

export function useProviderAvailability(): Record<Provider, ProviderAvailability> {
  const { t } = useI18n();
  const oauth = useOAuthStatus();
  const { data } = useBilling();

  const oauthReady = oauth?.status === "ready";
  let oauthReason = t("provider.oauthNotReady");
  let oauthHint: string | undefined;
  if (oauth?.status === "auth_required") {
    oauthReason = t("provider.codexLoginRequired");
    oauthHint = t("provider.codexLoginHint");
  } else if (oauth?.status === "starting") {
    oauthReason = t("provider.oauthStarting");
  } else if (!oauth) {
    oauthReason = t("provider.serverUnreachable");
  }

  const apiOk = data?.apiKeyValid === true;

  return {
    oauth: { ok: oauthReady, reason: oauthReason, hint: oauthHint },
    api: {
      ok: apiOk,
      reason: apiOk ? "" : t("provider.apiInvalid"),
    },
  };
}
