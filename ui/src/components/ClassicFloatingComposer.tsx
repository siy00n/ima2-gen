import { useI18n } from "../i18n";
import { GenerateButton } from "./GenerateButton";
import { PromptComposer } from "./PromptComposer";

export function ClassicFloatingComposer() {
  const { t } = useI18n();

  return (
    <section className="classic-composer-dock" aria-label={t("prompt.floatingComposer")}>
      <PromptComposer variant="floating" />
      <GenerateButton variant="dock" />
    </section>
  );
}
