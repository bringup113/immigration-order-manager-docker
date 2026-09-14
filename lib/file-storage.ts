export {
  commitStoredUpload,
  openStoredFile,
  deleteStoredFile,
  moveStoredFile,
  quarantineStoredFile,
  readStoredFile,
  saveStoredFile,
} from "./file-storage-node";

export type QuarantinedStoredFile = {
  originalPath: string;
  quarantinePath: string;
};
