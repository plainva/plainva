import type { ImagePart } from "@plainva/core";

/**
 * A picture of a conversation, drawn from what was sent (plan KI-Harness
 * P4-5): the scaled copy the record keeps, never the file in the vault — so
 * the reader sees what the provider got, even after the file changed or went.
 * A `data:` address: nothing is loaded from anywhere.
 */
export function AiPicture({ picture, alt }: { picture: ImagePart; alt: string }) {
  return <img className="pv-ai-picture" src={`data:${picture.mime};base64,${picture.data}`} alt={alt} width={picture.width} height={picture.height} draggable={false} data-testid="ai-picture" />;
}
