import { BatchResult } from "@juwa/schema";
import { useEffect, useState } from "react";

export type BatchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; batch: BatchResult };

/**
 * Charge le résultat du pipeline et le valide avec le même schéma Zod que celui qui l'a produit :
 * l'interface ne fait jamais confiance à un JSON non validé.
 */
export function useBatchResult(url = "/results.json"): BatchState {
  const [state, setState] = useState<BatchState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
        if (response.status === 404) {
          setState({ status: "error", message: "Aucun résultat pour l'instant : lancez « npm run pipeline » puis rechargez la page." });
          return;
        }
        if (!response.ok) {
          setState({ status: "error", message: `Le résultat n'a pas pu être chargé (erreur ${response.status}).` });
          return;
        }
        const parsed = BatchResult.safeParse(await response.json());
        setState(
          parsed.success
            ? { status: "ready", batch: parsed.data }
            : { status: "error", message: "Le fichier de résultats est invalide ou d'une version incompatible. Relancez le pipeline." },
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message: error instanceof SyntaxError ? "Le fichier de résultats n'est pas un JSON valide. Relancez le pipeline." : "Le résultat n'a pas pu être chargé.",
        });
      }
    }

    void load();
    return () => controller.abort();
  }, [url]);

  return state;
}
