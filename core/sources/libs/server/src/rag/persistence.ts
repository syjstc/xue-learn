import type {
  RagDocumentRepository,
  RagVectorRepository,
} from "../../../domain/src/index.js";

let documents: RagDocumentRepository | undefined;
let vectors: RagVectorRepository | undefined;

export function configureRagPersistence(
  input?: Readonly<{
    documents: RagDocumentRepository;
    vectors: RagVectorRepository;
  }>,
): void {
  documents = input?.documents;
  vectors = input?.vectors;
}

export function requireRagDocuments(): RagDocumentRepository {
  if (!documents)
    throw new Error("RAG document persistence is not configured.");
  return documents;
}

export function requireRagVectors(): RagVectorRepository {
  if (!vectors) throw new Error("RAG vector persistence is not configured.");
  return vectors;
}
