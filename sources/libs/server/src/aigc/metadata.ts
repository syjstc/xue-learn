export const AIGC_METADATA_FIELD = "AIGC";
export const AIGC_CONTENT_PROVIDER = "xue-learn";

export type AigcMetadata = {
  Label: "1";
  ContentProducer: string;
  ProduceID: string;
  ReservedCode1: string;
  ContentPropagator: string;
  PropagateID: string;
  ReservedCode2: string;
};

const AIGC_VALUE_PATTERN = /^[\x21\x23-\x5b\x5d-\x7e]*$/;

export function buildAigcMetadata(contentId: string): AigcMetadata {
  const id = contentId.trim();
  if (!id || !AIGC_VALUE_PATTERN.test(id)) {
    throw new Error(
      "AIGC content id must contain only supported ASCII characters",
    );
  }
  return {
    Label: "1",
    ContentProducer: AIGC_CONTENT_PROVIDER,
    ProduceID: id,
    ReservedCode1: "",
    ContentPropagator: AIGC_CONTENT_PROVIDER,
    PropagateID: id,
    ReservedCode2: "",
  };
}

export function serializeAigcMetadata(contentId: string): string {
  return JSON.stringify(buildAigcMetadata(contentId));
}
