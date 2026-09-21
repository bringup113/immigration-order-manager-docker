import { moveStoredFile } from "./file-storage-node";

export {
  commitStoredUpload,
  openStoredFile,
  deleteStoredFile,
  quarantineStoredFile,
  readStoredFile,
  saveStoredFile,
} from "./file-storage-node";
export { moveStoredFile };

export type QuarantinedStoredFile = {
  originalPath: string;
  quarantinePath: string;
};

export type MovedStoredFile = { from: string; to: string };

export async function rollbackMovedStoredFiles(
  files: MovedStoredFile[],
  startAt = 0,
) {
  const pending = files.splice(startAt).reverse();
  for (const file of pending) {
    try {
      await moveStoredFile(file.to, file.from);
    } catch (error) {
      console.error("Stored file rollback failed", {
        from: file.to,
        to: file.from,
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
  }
}
