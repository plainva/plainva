import type { ComponentProps, ReactNode } from "react";
import { InlineSuggestProvider, LocalModelsProvider, type LocalEmbeddings, type LocalGists } from "@plainva/ui";

/**
 * What every surface of the shell reads beside its own screen, in one wrapper:
 * this vault's index, which `[[` and `#` in the capture fields ask (W5), and
 * the models on this device that search by meaning and write gists (AI harness
 * P2a-4, P2b-3). Both are the open vault's and both are read wherever a screen
 * happens to need them, so the shell renders them once, here — one element
 * instead of two nested ones in a file that is under a line budget
 * (appStructure.test.ts).
 */
export function ShellProviders({
  index,
  embeddings,
  gists,
  children,
}: {
  index: ComponentProps<typeof InlineSuggestProvider>["source"];
  embeddings: LocalEmbeddings | null;
  gists: LocalGists | null;
  children: ReactNode;
}) {
  return (
    <InlineSuggestProvider source={index}>
      <LocalModelsProvider embeddings={embeddings} gists={gists}>
        {children}
      </LocalModelsProvider>
    </InlineSuggestProvider>
  );
}
